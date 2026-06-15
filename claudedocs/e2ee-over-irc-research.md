# End-to-End Encryption over IRC — Research & Recommendation for Obby

*Compiled June 2026. Every factual claim below was verified against primary sources (RFCs, cloned spec repos, cloned reference implementations, npm/caniuse/WebKit at research time). "Spec says" is separated from "verified real-world behaviour" throughout. Sources listed at the end.*

---

## 0. TL;DR — the answer

**There is no standard for E2EE over IRC.** The IRCv3 working group has *discussed* it (one dormant proposal) but never shipped a spec. So "the most standard way" resolves to three real, very different options, and the right move for Obby is a **tiered** one:

| Tier | What | Crypto quality | Interop reach (2026) | Effort in JS/TS |
|---|---|---|---|---|
| **1. Modern pairwise (recommended primary)** | X3DH + Double Ratchet for **queries/DMs**, carried over IRCv3 client-only tags (the KiwiIRC `ircv3-ideas #29` pattern) | **Strong** (FS + PCS + deniability) | **Obby↔Obby only** (island) — but you control both ends | Medium |
| **2. FiSH (CBC + DH1080)** | Blowfish-CBC shared key + DH1080 key exchange | **Weak** (no MAC, no PFS, MITM-able exchange, 1080-bit DH) | **Widest live interop**: mIRC, HexChat, KVIrc, irssi, WeeChat, Quassel, AdiIRC, Konversation | Low (~150 LOC + Blowfish lib) |
| **3. OTRv3** | libotr-style OTR | Strong (FS + deniability), 1:1 only | irssi (native), Pidgin, Textual, WeeChat — **a shrinking legacy island on unmaintained libs** | High + maintenance liability |

**Recommendation:** Ship **Tier 1** as Obby's real E2EE story (it reuses plumbing you *already built* for bot-tools — base64 client-only tags + batch reassembly), and publish the wire format as an IRCv3 draft to invite interop. Add **Tier 2 (FiSH-CBC)** as an explicitly-labelled "legacy compatibility / passive-eavesdropper protection only" feature for reach. **Skip Tier 3 (OTR)** unless there's concrete demand — the only browser library is abandoned and unaudited. **Channel/group E2EE is genuinely hard** — defer it (see §9); offer FiSH shared-key for channels with honest caveats, and track MLS (`ts-mls`) for the future.

**Obby's structural advantage:** in the **Tauri build the IRC socket is held on-device**, so Obby can do *genuine* end-to-end encryption past any bouncer — unlike The Lounge / Convos / IRCCloud, whose server-side architecture sees plaintext and structurally cannot do E2EE.

---

## 1. The honest landscape

Real-world E2EE on IRC in 2026 is **only OTRv2/v3 and FiSH**. Everything else is either (a) a dormant proposal, (b) a single-client proprietary scheme with zero interop, or (c) belongs to another network (Matrix Olm/Megolm, XMPP OMEMO).

- **No ratified or draft IRCv3 E2EE messaging spec exists.** A `grep` of the entire `ircv3-specifications` repo finds "encrypt" only in: `message-redaction` (server may encrypt *internal msgid metadata*), `sts` (TLS cipher suites), and the **deprecated** `sasl-dh-aes` / `sasl-dh-blowfish` (which encrypted the *password* during auth, not messages — dead).
- The only concrete design ever written is **`ircv3-ideas` issue #29 — "Proposed end-to-end encryption protocol"** (opened 2019-01-25 by *vith*, under KiwiIRC guidance; **still open, never adopted**). It adapts **Matrix Olm/Megolm** (Double Ratchet lineage) to IRC, carrying ciphertext in **client-only message tags** (`+kiwi/olm-packet`, `+kiwi/olm-identity`, `+kiwi/megolm-packet`) with CBOR payloads, base64-no-pad, and an **invented fragmentation scheme** (`+kiwi/fragmented` / `+kiwi/previous-frag`) for blobs over the tag cap. Its authors explicitly flag the pain: *"unfortunate to reimplement layer-3 packet fragmentation inside a layer-7 protocol"* and *"significant overhead through base64."* **This is the de-facto prior art and the closest thing to a "standard."**
- `ircv3-specifications #113` ("detect encryption type of a message", 2017) was **closed without producing any encryption standard**.

**Takeaway:** any E2EE Obby ships is, by definition, non-standard and (for the modern option) initially single-client. The most you can align with is the `#29` design pattern — and you'd do the ecosystem a favour by publishing your wire format as a draft.

---

## 2. The line-length problem & how IRCv3 solves it

### Classic limit
RFC 1459/2812 §2.3: **IRC messages must not exceed 512 bytes including the trailing CRLF** → 510 for command+params. After the relayed source prefix (`:nick!user@host`), `PRIVMSG`, target, and ` :`, the realistic usable **message body is ~350–400 bytes** (the multiline spec's own worst-case math: 20-char nick + 20 user + 63 host + 32 channel → **"353 bytes for each message"**). Ciphertext is binary → must be base64-armoured (+33%), so a single Double-Ratchet/Olm message — let alone a group key-distribution packet — **does not fit one PRIVMSG**. This is *the* wall, and it's a transport problem, not a crypto problem.

### How the schemes cope
- **FiSH fits natively.** Blowfish-ECB is **12 base64 chars per 8 plaintext bytes** (~1.5× + 4-char prefix); a 350-char line carries ~230 plaintext bytes. CBC adds only a fixed 8-byte IV. Key exchange is a one-time NOTICE pair. Fragmentation rarely needed — *this is precisely why FiSH, not OTR, became the IRC default.*
- **OTR brings its own fragmentation.** OTR handshakes/data messages routinely exceed 512 B, so OTR defines an application-layer split:
  - OTRv2: `?OTR,k,n,piece,`
  - OTRv3: `?OTR|sender_instance|receiver_instance,k,n,piece,`
  - OTRv4: `?OTR|identifier|sender_instance|receiver_instance,index,total,piece,`
  - `k`/`n` are unsigned shorts (max 65535); receiver discards if `k==0||n==0||k>n`; **the client must pick a fragment size accounting for IRC's 512 minus the `PRIVMSG <target> :` prefix and the ~25-byte header** (~350–400 typical). v2/v3 have **no in-spec retransmit or reassembly timeout** → a dropped fragment (netsplit, flood throttle) stalls the conversation.

### The IRCv3 mechanisms that change the game
- **`message-tags`** adds a **separate 8191-byte tag budget on top of the 512-byte line**, split **4094 bytes client-added / 4094 server-added** (`Clients MUST NOT send tag data exceeding 4094 bytes`). Over-limit → `ERR_INPUTTOOLONG (417)`, **no truncation**.
- **Client-only tags (`+` prefix)** **MUST be relayed by servers on `PRIVMSG`, `NOTICE`, and `TAGMSG`** to the same recipients — non-`+` tags are stripped. Base64 (and base64url) contain none of the escaped chars (`;`, space, `\`, CR, LF) so ciphertext rides raw. Caveat: a network *may* block client tags via `CLIENTTAGDENY` (not default), and operators may moderate tag content.
- **`TAGMSG`** = a tag-only message with no visible body, delivered like PRIVMSG. **Clients must not show it in history by default.** → ideal for the **control plane** (handshakes, key exchange): invisible, non-logging, MUST-relay.
- **`draft/multiline`** (WIP) — a `BATCH` that lets one logical message exceed 512 B by splitting across PRIVMSG/NOTICE lines reassembled by the receiver. **Only the message-text param counts toward `max-bytes`** (the per-line 512 overhead is *not* charged), and **`draft/multiline-concat`** joins lines with no separator → **byte-exact reassembly of a single long base64 blob**. This is the cleanest spec-native way to move a large ciphertext **body**, scaling to the server's advertised `max-bytes` (kilobytes). **Two gotchas:** (1) you **cannot** attach custom `+` tags to the *inner* lines — all client tags must sit on the opening `BATCH` line (within the 4094-byte cap); (2) servers cap it low and unevenly — **Ergo default `max-bytes=4096, max-lines=100`; Solanum has no multiline; UnrealIRCd/InspIRCd have it configurable.**
- **`echo-message` + `msgid`** — learn the server-assigned ID of your *own* ciphertext (for cross-device sync, redaction, dedupe of self-echo). **`labeled-response`** (≤64-byte label) correlates a send with its ack.
- **`METADATA` (draft)** — could **publish fingerprints** (not full keys — value-size caps; UTF-8 only) for discovery. But it's a **transport, not a PKI**: the server relays it, so a fingerprint must still be verified out-of-band (TOFU). Uneven server support — don't depend on it cross-network.
- **`draft/message-redaction`** — `REDACT <target> <msgid>`; **its own Security Considerations say redaction gives _no_ confidentiality** ("assume [a sent message] will remain visible to recipients/servers whether or not subsequently redacted"). Cosmetic only.

### Cleanest IRCv3-native transport for E2EE (synthesis)
A **hybrid**:
1. **Control plane** (key exchange, prekeys, session setup, small packets) → **vendor-prefixed client-only tags on `TAGMSG`** (e.g. `+obby.world/e2ee-kex`). MUST-relay, invisible, non-logging. Hard ceiling 4094 B/message → fragment only if a handshake exceeds it.
2. **Data plane** (the encrypted body, large after base64) → **`draft/multiline` batch with `multiline-concat`** where advertised (scales to KB); **fall back to your own fragmented PRIVMSG/TAGMSG** where multiline is absent or capped low (Solanum, etc.).
3. **Lifecycle** → negotiate `echo-message`+`msgid` (own-message IDs), `labeled-response` (ack correlation), `METADATA` (fingerprint discovery, verified out-of-band).

> **You already have most of this.** Obby's bot-tools work uses base64 in client-only tags **and** does batch reassembly — the exact two primitives the data/control planes need.

---

## 3. Option A — FiSH / blowcrypt (Blowfish + DH1080)

**What it is.** The de-facto IRC crypto family (blowcrypt / FiSH / FiSH 10 / Mircryption — all the same wire format). Symmetric Blowfish with a shared key, optional DH1080 key exchange for queries.

**Wire format (verified against WeeChat `fish.py` + `FiSH-irssi` C):**
- Prefix `+OK ` (blowcrypt) or `mcps ` (Mircryption) — decoders treat them interchangeably.
- **ECB mode** (classic): zero-pad plaintext to 8 bytes; encode with a **custom "B64" alphabet** `./0-9A-Za-z` (12 chars per 8 bytes, no `=`). **No integrity, no IV → identical plaintext blocks → identical ciphertext (pattern leakage).**
- **CBC mode** (FiSH 10 / Mircryption, marked by a leading `*`): **standard** base64 of `8-byte random IV ‖ Blowfish-CBC ciphertext`. Fixes pattern leakage **but is still unauthenticated (no MAC) → malleable.**
- **DH1080 key exchange:** `DH1080_INIT <b64 pub>` / `DH1080_FINISH <b64 pub>` over NOTICEs; **g=2, fixed 1080-bit Sophie-Germain prime (135 bytes)**; Blowfish key = `base64(SHA-256(shared_secret))`. **No authentication → MITM-able** (incl. by a malicious server). 1080-bit is below the modern ≥2048-bit floor. Known interop bug: ~**1/128 handshakes fail** when a pubkey starts with `0x00` (mishandled by OrbitIRC, Trillian, FiSH-irssi) — **implement the leading-zero fix.**
- **Channels:** one **pre-shared** symmetric key, distributed out-of-band; no group key agreement, no PFS, no rotation, ECB pattern leakage at scale.

**Security verdict:** "obfuscation-grade." Protects against the **passive sniffer and the server operator reading plaintext logs**. Does **not** provide integrity, authentication, forward secrecy, or protection against an active/resourced adversary. Even CBC is unauthenticated.

**JS reality:** no turnkey FiSH library — but trivial to build: Blowfish ECB/CBC via `egoroof-blowfish` (browser+Node, ES modules), DH1080 via native `BigInt` modexp, SHA-256 via `crypto.subtle`. The custom-B64 + framing is ~150 lines ported from `fish.py`. No native deps → fits Obby's WebSocket-only model.

**Still alive?** Yes — FiSH 10 shipped July 2023; WeeChat/HexChat/KVIrc/ZNC modules maintained. Concentrated on **EFNet** and **Rizon** (warez/channel-key culture). Usage is niche and undocumented quantitatively, but clearly alive.

---

## 4. Option B — OTR (Off-the-Record)

**What it is.** Real E2EE for 1:1 chat: **encryption + live authentication + deniability + perfect forward secrecy** — the deliberate inverse of PGP (which signs → non-repudiation, and uses static keys → no FS).

- **OTRv3** (production standard, what `libotr 4.x` speaks): 1536-bit DH, AES-128-CTR, SHA-256, truncated HMAC-SHA1, SMP (Socialist Millionaire) for verification, instance tags for multi-session disambiguation. Initiated via `?OTRv23?` query or an invisible whitespace tag; data messages are `?OTR:<base64>.` in PRIVMSG bodies.
- **OTRv4** (Sofía Celi et al.): Ed448-Goldilocks, SHAKE-256, ChaCha20, deniable AKE (DAKEZ/XZDH), **Double Ratchet**, offline via an untrusted prekey server. **But the spec has been a frozen draft since Oct 2022, the C reference (libotr-ng) is dormant, and no mainstream IRC/XMPP client ships it.** Treat as research-grade.

**Structural limits over IRC:** **1:1 only** (no channel encryption — mpOTR never shipped); **both parties must be online** (v2/v3); **no multi-device/offline**; metadata fully exposed; the conspicuous `?OTR:` blobs flood server logs; **breaks with bouncers**; first-message-before-negotiation can leak plaintext; a dropped fragment stalls (no in-spec retransmit).

**JS reality:** the **only** browser option is **`arlolra/otr` (otr.js)** — pure-JS OTRv2/v3, **last release Dec 2015, abandoned, self-flagged "not for life-and-death situations," unaudited**, ships its own old `crypto-js` MPI math. **No OTRv4 JS/WASM exists.** Adopting OTR means vendoring/forking dead code + hand-rolling IRC-aware fragmentation.

**Interop population (2026):** irssi (native since 1.2.0), Pidgin (pidgin-otr), Textual (native, macOS), WeeChat (dormant `potr` script). HexChat-otr is dead. The whole stack rests on **libotr 4.1.1 (2016, last fixed CVE-2016-2851) + potr (unmaintained)** — a real but **aging-out, shrinking** island.

---

## 5. Option C — Modern Double Ratchet / MLS (the good crypto)

**Pairwise (X3DH + Double Ratchet):** the Signal primitives (also under OTRv4, Olm). X3DH does async session setup from a published prekey bundle (identity + signed prekey + one-time prekeys + ephemeral); the Double Ratchet then gives **per-message keys with FS + post-compromise security** and handles out-of-order/dropped messages (skipped-key store). Needs out-of-band fingerprint verification to stop MITM. **This is eminently doable for Obby queries** — two parties, small ciphertext, no membership problem.

**Group/channel — three real approaches, all hard over IRC:**
- **Sender Keys** (Signal/WhatsApp/Matrix-Megolm): encrypt-once-fan-out (matches IRC channel broadcast), but **weak PCS within a session** and **O(N) rekey on every membership change**.
- **MLS / TreeKEM (RFC 9420, 2023; deployed by Webex, Wire, Discord, RCS):** the cryptographically *correct* answer — **O(log N) rekey**, real group FS+PCS, async. RFC 9750 explicitly separates an untrusted **Delivery Service** (relay + KeyPackage directory) — **IRC could in theory be that DS**. But: no IRCv3 capability, no KeyPackage-directory standard, no Authentication Service, IRC membership is server-asserted/unreliable (epoch reconciliation falls on clients), and large binary Welcome/Commit blobs fight the transport. **You'd be building the entire IRC-MLS binding single-client.**
- **Shared symmetric key** (FiSH): the only thing that interoperates today; weak.

**JS/WASM libraries (verified versions):**
- `ts-mls` (LukaJCB) — **pure TS, RFC 9420, browser-native, post-quantum ciphersuites**, v1.6.2 (2026-03). **Unaudited/experimental** — pilot, don't found v1 on it.
- `@matrix-org/matrix-sdk-crypto-wasm` (vodozemac) — **audited** Double Ratchet/Megolm, but **large WASM + a Matrix-shaped API** to adapt; lazy-load + `await initAsync()`.
- `2key-ratchet` (PeculiarVentures) — Double Ratchet + X3DH on **WebCrypto (P-256)**, no WASM; lightly maintained but a clean structural reference.
- `@privacyresearch/libsignal-protocol-typescript` — X3DH+DR in TS, **unmaintained (~3 yr)**; vendor-and-own only. Signal's official `libsignal` is Node-native, **no browser WASM** ("use outside Signal unsupported").

---

## 6. Client interop matrix (who Obby would actually talk to)

| Client | Platform | OTR | FiSH | Maintained? |
|---|---|---|---|---|
| **irssi** | terminal | **native (libotr) since 1.2.0** | fish-irssi (ECB/CBC, DH1080) | yes |
| **WeeChat** | terminal | `weechat-otr` (potr, v2/v3) | fish scripts | dormant but works |
| **HexChat** | desktop | hexchat-otr (**dead**) | **FiSHLiM bundled** | FiSH yes, OTR no |
| **Pidgin** | desktop | **pidgin-otr (canonical)** | no | frozen 2016, works |
| **Textual** | macOS | **native OTR** | no | yes (commercial) |
| **mIRC** | Windows | no | **FiSH 10 (reference, ECB+CBC+DH1080)** | yes (2023) |
| **KVIrc** | desktop | no | **built-in Blowfish ECB/CBC** | yes |
| **Konversation** | KDE | no | built-in Blowfish ECB | yes |
| **AdiIRC** | Windows | no | Blowfish plugin (CBC default) | yes |
| **Quassel** | desktop | no (FR #1418) | built-in Blowfish ECB | core-relays-plaintext |
| **senpai / catgirl / halloy / tiny / goguma** | modern/terminal/mobile | **none** | none | TLS-only by design |
| **The Lounge / Kiwi / Convos / Gamja / IRCCloud** | **web** | **none** | none | **structurally can't** (server sees plaintext) |
| *AndroidIRCX* | Android | no | no | **libsodium XChaCha20** — modern but **zero interop** |

**Reads:** **FiSH reaches far more live clients** (mIRC/HexChat/KVIrc/irssi/WeeChat/Quassel/AdiIRC/Konversation), concentrated on EFNet/Rizon. **OTR is a smaller, shrinking, terminal/privacy crowd** (irssi/Pidgin/Textual). **No web client does any E2EE** — Obby (Tauri, on-device socket) would be near-unique among web-lineage clients in being *able* to.

---

## 7. Recommended architecture for Obby (concrete)

### 7.1 Primary: modern pairwise (query/DM) E2EE — "obby-e2ee v1"
- **Crypto:** X3DH-style handshake → Double Ratchet. Primitives via **WebCrypto** (AES-GCM, HKDF, HMAC, SHA-256 — native everywhere) + **X25519/Ed25519**.
  - **⚠️ Critical browser caveat:** X25519 is native in Chrome 133+, Firefox 130+, **but Safari/WKWebView only 18.4+ (March 2025)**. Ed25519 is WKWebView 17.0+. So **Tauri on iOS/macOS < 18.4 has Ed25519 but no native X25519** — exactly what the ratchet needs. **Feature-detect and fall back to `@noble/curves` v2.2.0** (audited, ~26 KB/11 KB gzip, no WASM). Optionally `libsodium-wrappers` v0.8.4 (WASM) for XChaCha20-Poly1305 + sealed-box prekeys.
  - **Ratchet engine:** either vendor **vodozemac WASM** (audited, lazy-loaded, adapt the API) or build X3DH+DR on noble/libsodium using **`2key-ratchet`** as the structural reference. Vodozemac = trust faster; hand-rolled = lighter + full control (audit it).
- **Transport (reuse your bot-tools plumbing):**
  - Handshake/prekeys → `+obby.world/e2ee-kex` client-only tag on **TAGMSG** (invisible, MUST-relay, non-logging).
  - Ciphertext body → `+obby.world/e2ee-msg` tag for short messages; **`draft/multiline` batch with `multiline-concat`** for long ones; **own fragmentation fallback** where multiline is absent/low-capped.
  - Use `echo-message`+`msgid` for own-message IDs; `labeled-response` for ack correlation.
- **Identity & verification:** TOFU pin on first contact; show **safety-number/fingerprint** (Signal-style); **QR verify** in Tauri mobile; optional **SMP** (shared-secret Q&A). **Hard, prominent key-change warning** (the #1 MITM guard) — never silently re-encrypt to a changed key. Publish fingerprint via `METADATA` for discovery (verified out-of-band).
- **Key storage:** ratchet/identity keys as **AES-GCM-encrypted blobs in IndexedDB**; wrapping key = **non-extractable `CryptoKey`** (passphrase/passkey-derived) in the web build, stored in the **OS keychain via `tauri-plugin-keyring`** (Secure Enclave / Keystore / Credential Manager; add a Linux keyring plugin) in the Tauri build. Be honest in-UX that pure-browser long-term keys are TOFU-grade, not hardware-grade, and XSS-exposed.
- **Standardise it:** write the wire format up as an IRCv3 draft (revive/extend `#29`) so other clients can interop. Until then it's Obby↔Obby.

### 7.2 Secondary: FiSH (CBC + DH1080) — legacy interop
- Implement **decode/encode of `+OK `/`mcps `** (ECB **and** CBC) + **DH1080** (with the leading-`0x00` fix). `egoroof-blowfish` + `BigInt` modexp + `crypto.subtle` SHA-256, ~150 LOC framing.
- **CBC by default; never auto-negotiate ECB; surface an "ECB leaks patterns / no integrity" warning.** Label the whole feature **"FiSH-compatible obfuscation for legacy IRC — not secure messaging."** Channel keys are manual/out-of-band.
- Lazy-load the module (Obby already lazy-loads heavy deps).

### 7.3 Skip / defer
- **OTRv3** — only if a real interop demand for irssi/Pidgin/Textual appears; means vendoring abandoned `arlolra/otr` + hand-rolled fragmentation. High liability.
- **Channel/group E2EE** — defer. For interop now: FiSH shared-key (weak, labelled). For "the right way" later: MLS via `ts-mls`, treating IRC as the untrusted Delivery Service — but budget for KeyPackage publication, epoch/membership reconciliation against unreliable IRC state, an out-of-band AS, and a binary-safe blob transport. You'd be an island until an IRCv3 standard exists.

### 7.4 Security invariants to respect (Obby-specific)
- FiSH/E2EE payloads are **attacker-controlled** → bounds-check all decoders; never let decrypted content trigger a media probe outside the existing `canShowMedia` trust gate, and never `openExternalUrl` without the warning modal.
- Treat any sent ciphertext as **permanently visible** to servers/recipients (redaction ≠ confidentiality).

---

## 8. Phased plan

1. **Phase 0 — spec & threat model.** Write the `obby-e2ee` wire format (TAGMSG control + multiline data); document the threat model (passive server, active MITM, XSS, bouncer) and what each tier does/doesn't protect.
2. **Phase 1 — FiSH-CBC + DH1080** (fast interop win, low risk, clearly labelled). Ships value to EFNet/Rizon users immediately.
3. **Phase 2 — pairwise Double Ratchet for queries** (the real E2EE), WebCrypto + noble/libsodium or vodozemac, TOFU + fingerprint verify + key-change warnings, keychain-backed storage.
4. **Phase 3 — publish the IRCv3 draft**; invite interop.
5. **Phase 4 (optional, later) — channel E2EE**: shared-key interim, MLS (`ts-mls`) pilot.

---

## 9. Honest expectations

- **No standard exists**; the modern option is single-client until/unless an IRCv3 spec lands. FiSH is the only thing with broad interop and it's weak. OTR is real but dying and has no maintained JS.
- **Channel E2EE over IRC is unsolved** in any interoperable, strong form — shared-key or be an island.
- **The transport, not the crypto, is the wall** (the KiwiIRC #29 authors learned this) — but Obby is unusually well-placed because it already has the base64-tag + batch-reassembly machinery and (in Tauri) an on-device socket.
- **Metadata is always exposed** (who/when/sizes); E2EE hides content, not the social graph.

---

## Sources

**OTR:** libotr Protocol v2/v3 (github.com/off-the-record/libotr); otr.cypherpunks.ca (PFS/deniability, libotr 4.1.1, CVE-2016-2851); OTRv4 spec (github.com/otrv4/otrv4, last commit 2022-10-17); arlolra/otr (last release 2015); coyim/otr3; otr4j.
**FiSH:** WeeChat `fish.py`; J0s3f/FiSH-irssi `DH1080.c`; flakes/mirc_fish_10 (README, SECURITY.md, DH1080 bug #58); Mircryption (donationcoder.com); ZNC fish (wiki.znc.in/Fish); blog.bjrn.se "A proposal for better IRC encryption"; egoroof/blowfish (+ issue #16).
**IRCv3:** RFC 2812 §2.3 / RFC 1459 §2.3; ircv3.net specs — message-tags (4094/8191), multiline, batch, labeled-response, echo-message, message-ids, message-redaction, metadata; ircv3-ideas #29 (KiwiIRC Olm/Megolm); ircv3-specifications #113 (closed); Ergo default.yaml (multiline 4096/100); unrealircd.org/docs/Message_tags; dashboard.irctest.limnoria.net.
**Group/modern:** RFC 9420 (MLS) + RFC 9750 (MLS architecture, DS/AS); Signal Double Ratchet & X3DH specs; Sender Keys (Wikipedia; arXiv 2301.07045); Matrix E2EE / vodozemac (+ Soatok 2026-02-17 vodozemac issues; eprint 2023/485); IETF "RCS adopts MLS"; OpenMLS; awslabs/mls-rs (+ @river-build/mls-rs-wasm); LukaJCB/ts-mls; soatok/mls-js.
**Web/JS crypto:** caniuse Ed25519 / X25519; WebKit Safari 17.0 & 18.4 release notes; Igalia Ed25519 blog; libsodium.js (libsodium-wrappers 0.8.4); @noble/curves 2.2.0; @privacyresearch/libsignal-protocol-typescript; signalapp/libsignal (#350 WASM request); 2key-ratchet; openpgpjs 6.3.1; @matrix-org/matrix-sdk-crypto-wasm 18.2.0; tauri-plugin-keyring; Tauri Stronghold (deprecated).
