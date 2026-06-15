# Obby — Private-Message E2EE Implementation Plan

*Scope: 1:1 (PM/query) end-to-end encryption. Two schemes shipped in v1:*
- **Obby-native** — modern Double Ratchet (FS + PCS + integrity) for Obby↔Obby.
- **OTRv3** — legacy interop with irssi / Pidgin / Textual / WeeChat.

*Group/channel E2EE is explicitly out of scope (future: MLS via `ts-mls`). The architecture leaves the door open — see §11.*

**Decisions locked** (2026-06): build both schemes in v1 · **manual per-chat lock toggle** to start · **vodozemac** (audited Olm/double-ratchet WASM) as the native crypto engine · identity **anchored to SASL account + TOFU fingerprint**. · **No server changes required** — pure client-to-client over standard IRCv3 your `obbyircd` already supports.

---

## 1. Simple points (the whole thing in 12 bullets)

1. **No server work.** OTR rides in PRIVMSG bodies (works on any server). Obby-native rides in **client-only tags on TAGMSG** — your obbyircd already relays those (standard `message-tags`). Nothing to build or configure server-side.
2. **One pluggable E2EE layer, two backends.** A single interface (`encrypt`/`decrypt`/`session`/`identity`) with `DoubleRatchet` (vodozemac) and `OTR` (otr.js) behind it. Shared transport, identity, key-store, and UI.
3. **User starts it manually** — a lock button in the PM header. No silent/auto encryption.
4. **Clicking the lock probes the peer:** try Obby-native first (TAGMSG handshake); if the peer isn't Obby, fall back to offering OTR (`?OTRv23?`). The user sees which scheme they got.
5. **Both sides consent.** The receiver gets an **Accept / Reject** prompt showing the peer's fingerprint before any session is established (for both schemes).
6. **Obby-native handshake = X3DH over invisible TAGMSG tags**, then a vodozemac Olm (Double Ratchet) session. Messages are sent as **TAGMSG** (`+obby.world/e2ee-msg`) — invisible to non-Obby clients, never logged as content.
7. **OTR handshake = the standard AKE** (`?OTRv23?` → 4-message exchange), fragmented over IRC by our wrapper; driven by a vendored `otr.js`.
8. **Identity is anchored to the SASL account**, not the nick. First contact pins (account → key fingerprint) (TOFU); a **key change triggers a loud warning** and blocks silent re-encryption.
9. **Verification UX:** show a fingerprint / safety-number to compare out-of-band; OTR also offers SMP (question-and-answer).
10. **Keys live encrypted at rest** — AES-GCM blob in IndexedDB, wrapping key in the OS keychain (Tauri) or passkey/passphrase-derived (web).
11. **vodozemac sidesteps the WKWebView X25519 gap** — it carries its own Curve25519 in WASM, so older iOS/macOS webviews are fine.
12. **Honest limits:** content is encrypted; **metadata is not** (who/when/sizes/that-you're-encrypting). 1:1 only. Both parties online to start. Single-device in v1.

---

## 2. Summary flowchart

```
                      ┌─────────────────────── OUTBOUND (Alice starts) ───────────────────────┐
                      │                                                                        │
   Alice opens PM with Bob ──▶ clicks 🔓 lock in PM header                                     │
                                      │                                                         │
                                      ▼                                                         │
                    ┌──────────────────────────────────┐                                       │
                    │ Probe: send Obby-native init      │  @+obby.world/e2ee-init=<b64>         │
                    │ (X3DH offer) on TAGMSG bob        │  TAGMSG bob                           │
                    └──────────────────────────────────┘                                       │
                            │                         │ no reply in N s                         │
              Bob is Obby ◀─┘                         └─▶ fall back: send `?OTRv23?` (PRIVMSG)  │
                    │                                              │                            │
                    ▼                                              ▼                            │
        [Bob accepts/rejects]                          [OTR AKE: Commit→Key→                    │
                    │ accept                            Reveal-Sig→Sig, fragmented]             │
                    ▼                                              │                            │
        derive X3DH secret → init                                  ▼                            │
        vodozemac Olm session                          otr.js session established               │
                    │                                              │                            │
                    └──────────────┬───────────────────────────────┘                           │
                                   ▼                                                            │
                        🔒 Session established                                                  │
                        UI: lock + scheme badge (Obby E2EE / OTR) + "verify fingerprint"        │
                                   │                                                            │
        Alice types "hi" ─────────┘                                                            │
                                   ▼                                                            │
            backend.encrypt("hi") ─▶ Obby-native: TAGMSG +obby.world/e2ee-msg=<ct>             │
                                     OTR:        PRIVMSG :?OTR:<ct>.   (fragment if >limit)     │
                                   │                                                            │
   ════════════════════════════════ obbyircd relays opaque bytes ══════════════════════════════
                                   ▼
                      ┌─────────────────────── INBOUND (Bob receives) ────────────────────────┐
                      │ Classifier on every incoming message:                                  │
                      │   has +obby.world/e2ee-* tag?  → Obby-native backend                   │
                      │   body starts ?OTR / ?OTR| ?   → OTR backend                           │
                      │   else                          → plaintext (normal path)              │
                      └────────────────────────────────────────────────────────────────────────┘
                                   │
              e2ee-init? ──▶ show Accept/Reject prompt (fingerprint, account)
              e2ee-msg / ?OTR: ──▶ backend.decrypt(ct) ──▶ plaintext
                                   ▼
                       inject into normal message store
                       (render via MessageItem; URLs still pass canShowMedia trust gate)
```

---

## 3. Architecture — the pluggable layer

```
src/lib/e2ee/
  index.ts          # E2EESession interface + SessionManager (per-conversation state machine)
  doubleRatchet.ts  # Obby-native backend (vodozemac Olm Account/Session)
  otr.ts            # OTR backend (vendored otr.js) + IRC fragmentation
  transport.ts      # wire framing: TAGMSG client-only tags, PRIVMSG body, fragmentation/reassembly
  identity.ts       # long-term identity keys, SASL-account anchoring, TOFU pinning, fingerprints
  keystore.ts       # encrypted-at-rest persistence (IndexedDB blob + keychain-wrapped key)
  classify.ts       # inbound message → scheme router
  vendor/otr/        # forked, pinned arlolra/otr (audited/patched), bundled for Vite
```

**The interface every backend implements:**

```ts
interface E2EEBackend {
  scheme: "obby" | "otr";
  startSession(peer: PeerRef): Promise<HandshakeOffer>;     // outbound: produce init payload
  acceptOffer(offer: HandshakeOffer): Promise<HandshakeReply>;
  completeSession(reply: HandshakeReply): Promise<void>;
  encrypt(peer: PeerRef, plaintext: string): Promise<WireFrame>;
  decrypt(peer: PeerRef, frame: WireFrame): Promise<string>;
  fingerprint(peer: PeerRef): Fingerprint | null;
  verify(peer: PeerRef, method: "fingerprint" | "smp", ...): Promise<boolean>;
}
```

- `SessionManager` owns per-conversation state (`none → negotiating → established(unverified|verified) → error`), picks the backend, drives the handshake, and exposes status to the UI.
- **Reuses existing Obby plumbing:** base64 client-only tags + batch reassembly (built for bot-tools) → `transport.ts` is mostly assembly of pieces you already have.

---

## 4. Wire format — Obby-native

Namespace: **`+obby.world/e2ee-*`** client-only tags. All values are **base64url (no padding)** of a CBOR map `{v:1, ...}`.

| Tag | Carried on | Payload | Meaning |
|---|---|---|---|
| `+obby.world/e2ee-init` | TAGMSG | `{ik, ek, otk_id?, account, fp}` | X3DH offer: identity key, ephemeral key, optional one-time-key id, sender SASL account, fingerprint |
| `+obby.world/e2ee-accept` | TAGMSG | `{ik, ek, account, fp}` | handshake response (receiver consented) |
| `+obby.world/e2ee-reject` | TAGMSG | `{reason?}` | declined |
| `+obby.world/e2ee-msg` | TAGMSG | `{ct}` | the Olm/Double-Ratchet ciphertext (prekey or normal message) |
| `+obby.world/e2ee-frag` | TAGMSG | `{id, i, n, ct}` | fragment of an oversized payload (only if >~3.5 KB; rare for chat) |

**Why TAGMSG for messages, not PRIVMSG:** a TAGMSG has no visible body, so non-Obby clients and the server log see *nothing* (not even a `[encrypted]` placeholder). Obby decrypts the tag and renders the message locally. Clean and quiet.

**Fragmentation:** a single message's client tags cap at 4094 bytes ⇒ ciphertext under ~3 KB fits one TAGMSG. Normal chat never fragments. The `e2ee-frag` scheme (sequence `i/n`, reassemble by `id`) handles the rare oversized case; multiline batch is the alternative if the network advertises it. **v1: implement `e2ee-frag`, document that it's an edge case.**

**Capability discovery:** clicking the lock sends `e2ee-init` directly (the offer *is* the probe). If no `accept`/`reject` arrives within a timeout, the peer isn't Obby-native → fall back to OTR. (Optional later: advertise support via a `obby.world/e2ee` METADATA key so the lock can show capability before probing.)

---

## 5. Wire format — OTR (interop)

Standard OTRv3, unchanged so it interops:
- Initiation: `?OTRv23?` in a PRIVMSG body.
- AKE + data messages: `?OTR:<base64>.` in PRIVMSG bodies.
- **Fragmentation (ours to drive):** `?OTR|<sender_inst>|<recv_inst>,k,n,piece,` — we pick a fragment size = 512 − (`PRIVMSG <target> :` prefix) − (~25-byte header) ≈ **350 bytes**. Add a reassembly timeout (the v3 spec has none) to avoid stuck sessions.
- Driven by the vendored `otr.js`; we wrap it with the IRC fragmenter + a reassembly buffer.

---

## 6. The handshake + accept/reject flow

### Obby-native (interactive X3DH)
1. **Alice** clicks 🔓 → `SessionManager` calls `doubleRatchet.startSession(bob)` → sends `e2ee-init` TAGMSG. UI: "Negotiating…".
2. **Bob's** classifier routes `e2ee-init` → `SessionManager` → **Accept/Reject modal**: *"Alice (account: alice) wants to start an encrypted chat. Fingerprint: 7F2A…. [Accept] [Reject]"*.
3. Bob **Accept** → `acceptOffer` runs X3DH, sends `e2ee-accept`, both init the vodozemac Olm session. Both UIs → 🔒 "Encrypted (Obby) — unverified".
   Bob **Reject** → `e2ee-reject` → Alice sees "Bob declined."
4. First few messages may be Olm *pre-key* messages until the ratchet establishes; transparent to the user.

### OTR
1. Lock → (after Obby-native probe times out) Obby sends `?OTRv23?`.
2. **Consent shim:** on receiving an inbound `?OTRv23?`, Obby shows the same **Accept/Reject** modal *before* responding to the AKE (OTR normally auto-responds; we gate it to match the manual-consent model).
3. On accept → otr.js runs the AKE (fragmented) → 🔒 "Encrypted (OTR) — unverified".

### State machine (per conversation)
`none → negotiating → established(unverified) → established(verified)`; plus `rejected`, `error`, `peer-key-changed(blocked)`.

---

## 7. Identity & trust — SASL account + TOFU fingerprint

- Each Obby install holds a **long-term identity keypair** (vodozemac `Account`: Curve25519 + Ed25519) + a pool of one-time keys.
- **Anchor to account:** the handshake payload carries the sender's **SASL account name** (independently cross-checkable via the `account-tag` on their messages). The trust store pins **`account → identityKeyFingerprint`** on first use (TOFU).
- **Fingerprint / safety-number:** derived from the identity key; shown in the conversation's security panel for out-of-band comparison.
- **Key-change = loud stop:** if a pinned account presents a new identity key, **block auto-encryption**, show *"Bob's encryption key changed — could be a new device or an attacker"*, require explicit re-pin. This is the #1 MITM guard.
- **No account?** Still allow E2EE via nick-TOFU, but mark identity as **weaker** in the UI (nicks are reassignable). (We chose account-anchored *with* TOFU fallback, not strict-account-required — so unregistered peers still work, just labelled lower-trust.)
- **OTR** uses its own fingerprint + **SMP** (socialist-millionaire question/answer) — surface both; SMP is great UX for verifying without reading hex aloud.

---

## 8. Key storage

- Serialize: vodozemac `Account` pickle + per-peer `Session` pickles + OTR DSA key + trust-pin table.
- Encrypt the whole blob with **AES-GCM** (WebCrypto) and store in **IndexedDB**.
- Wrapping key:
  - **Tauri build** → OS keychain via `tauri-plugin-keyring` (Secure Enclave / Keystore / Credential Manager; add Linux keyring plugin).
  - **Web build** → non-extractable `CryptoKey` derived from a passphrase/passkey (WebAuthn PRF).
- Honest note in UX: pure-browser long-term keys are TOFU-grade, XSS-exposed — not hardware-grade.

---

## 9. Crypto stack & bundle

| Piece | Choice | Notes |
|---|---|---|
| Obby-native ratchet | **vodozemac** (Olm `Account`/`Session`) via WASM | Audited Rust. Use the **Olm 1:1 pieces only**, not the full Matrix `OlmMachine`. Packaging vodozemac standalone is some work; pragmatic fallback = deprecated-but-functional `@matrix-org/olm` (libolm WASM) which exposes exactly `Account`/`Session`. |
| Curve ops | inside vodozemac WASM | **Sidesteps the WKWebView <18.4 X25519 gap** — no SubtleCrypto X25519 dependency. |
| AES-GCM / HKDF / SHA-2 | native WebCrypto | key wrapping, derivations. |
| OTRv3 | **vendored `arlolra/otr`** (forked, pinned, patched) | legacy DSA/SHA-1 is inherent to OTRv3; bundle for Vite; **lazy-load**. Self-flagged unaudited — own it, security-review the fork. |
| Loading | **lazy `import()`** on first lock-click | Obby already lazy-loads heavy deps; WASM init behind a spinner, cached for the session. |

---

## 10. Integration points in the existing codebase

- **IRC layer** (`src/lib/irc/handlers/`): add detection in the message dispatch — `+obby.world/e2ee-*` tags and `?OTR` bodies → `ctx.triggerEvent("E2EE_FRAME", …)`. (New `handlers/e2ee.ts` + entry in `IRC_DISPATCH`/the PRIVMSG/TAGMSG handlers.)
- **Store layer** (`src/store/handlers/e2ee.ts`): subscribe to `E2EE_FRAME`, drive `SessionManager`, decrypt, and inject plaintext into the existing messages slice (so it renders through `MessageItem` unchanged). Surface session status + handshake prompts to UI state. Remember: `setState` returns `Partial<AppState>` (no mutation).
- **Send path** (`src/hooks/useMessageSending.ts`): if a conversation has an established E2EE session, route the outgoing text through `backend.encrypt` → transport, instead of plain PRIVMSG.
- **UI**:
  - PM header **lock button** + state icon (open / spinner / locked-unverified / locked-verified / warning) + **scheme badge** ("Obby E2EE" vs "OTR" — visually distinct so users know native vs interop).
  - **Accept/Reject modal** on inbound handshake.
  - **Security panel**: fingerprint/safety-number, "mark verified", SMP dialog (OTR).
  - **Key-change banner** (prominent, blocks send until acknowledged).
  - All strings wrapped in LinguiJS (`<Trans>` / `t`); translate before commit per repo i18n rules.
- **Security invariants (hard):** decrypted content with URLs **must still pass `canShowMedia`** before any probe; never `openExternalUrl` without the warning modal; bounds-check all decoders (E2EE payloads are attacker-controlled).

---

## 11. Future-proofing for group E2EE (do nothing now, keep the door open)

- The pluggable `E2EEBackend` interface + shared transport/identity/keystore means a future **MLS** backend (`ts-mls`, browser-native RFC 9420) drops in as a third backend for *channels*, with no rewrite.
- The pairwise Obby-native session is also the **bootstrap channel MLS needs** (group members establish pairwise secure channels, then distribute group keys). So building PM E2EE well is direct progress toward group E2EE.
- This aligns with where the ecosystem is heading (emersion's `go-mls`). **No MLS code, concepts, or deps in v1.**

---

## 12. Build order (within v1)

1. **Shared scaffolding** — `E2EEBackend` interface, `SessionManager` state machine, `transport.ts` (TAGMSG/PRIVMSG framing + fragmentation), `keystore.ts`, `identity.ts`, UI shell (lock button, modal, panel, banner). No crypto yet — wire up with a stub backend + tests.
2. **Obby-native backend** — vodozemac integration, X3DH handshake, Olm session, account-anchored TOFU + fingerprints. End-to-end Obby↔Obby encrypted PM.
3. **OTR backend** — vendor + patch otr.js, IRC fragmenter + reassembly timeout, consent shim, SMP. Interop-test against real irssi/Pidgin.
4. **Verification UX** — fingerprint/safety-number compare, SMP flow, key-change warnings.
5. **Hardening + security review** — decoder bounds-checks, media-trust gate, key-storage threat review, i18n, tests (handshake, ratchet round-trip, fragmentation, malformed-input, key-change).

---

## 13. Threat model — what it does and doesn't protect

**Protects:** message *content* from the server operator and passive network observers (both schemes). Obby-native adds forward secrecy, post-compromise security, and integrity/authentication. OTR adds FS + deniability.

**Does NOT protect:**
- **Metadata** — who talks to whom, when, message sizes/timing, and the *fact* that you're encrypting (TAGMSG/OTR traffic is visible to the server).
- **Typing/presence/away** — unencrypted.
- **OTR specifics** — 1:1 only, both parties online, breaks with bouncers, legacy crypto, unaudited JS lib.
- **Obby-native v1** — 1:1 only (group = future MLS), interactive (both online to start; offline/async needs a prekey directory — deferred), single-device (no cross-device key sync in v1).

---

## 14. Open questions for you

1. **Multi-device:** v1 is single-device (keys per install, no sync). OK? Or do you want encrypted history to follow a user across their devices (much harder — needs key backup / cross-signing, MLS-style)?
2. **OTR consent shim:** OTR normally auto-responds to `?OTRv23?`. I'm gating it behind an Accept/Reject prompt for consistency with Obby-native. Good — or should OTR auto-accept (more "standard" OTR behavior, less consistent UX)?
3. **Unregistered peers:** we allow E2EE with non-SASL nicks (labelled lower-trust). Keep that, or do you want a setting to *require* a verified account for the lock to even be available?
4. **Lock scope:** PM-only for now (confirmed). Should the lock button also appear (disabled, "channels not yet supported") in channels as a discoverability hint, or be hidden entirely there?
5. **Encrypted-message persistence:** do we store decrypted PM history locally (encrypted at rest), or keep E2EE messages ephemeral (gone on reload) for extra safety? (OTR culture leans ephemeral; Obby's offline-first lean suggests persisted-encrypted.)
6. **Fallback visibility:** when Obby-native probe fails and we fall back to OTR, auto-proceed, or ask the user "Bob only supports OTR (weaker) — continue?"

Answer any/all and I'll fold them in + start on the scaffolding (step 1).
```
