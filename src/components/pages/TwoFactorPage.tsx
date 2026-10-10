import { Trans, useLingui } from "@lingui/react/macro";
import QRCode from "qrcode";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import {
  beginOauthLogin,
  getBuiltinOAuthConfig,
  OAUTH_PRESETS,
} from "../../lib/oauth";
import {
  b64StdDecode,
  bytesToB64Std,
  isWebAuthnAvailable,
  webauthnRegister,
} from "../../lib/sasl/webauthn";
import useStore, { loadSavedServers } from "../../store";
import { PageShell } from "../ui/page/PageShell";
import { SettingGroup, SettingRow } from "../ui/page/SettingRow";
import type { PageProps } from "./PageHost";

function decodeChallenge(blob: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(b64StdDecode(blob)));
  } catch {
    return null;
  }
}

const TwoFactorPage: React.FC<PageProps<"twoFactor">> = ({ page }) => {
  const { serverId } = page;
  const { t } = useLingui();
  const openPage = useStore((s) => s.openPage);
  const typeLabels: Record<string, string> = {
    totp: t`Authenticator app (TOTP)`,
    webauthn: t`Biometric / security key`,
    oauth: t`OAuth identity`,
    external: t`TLS certificate fingerprint`,
  };
  const status = useStore((s) => s.twofaStatus[serverId] ?? "unknown") as
    | "enabled"
    | "disabled"
    | "unknown";
  const credentials = useStore((s) => s.twofaCredentials[serverId] ?? []);
  const challenge = useStore((s) => s.pendingTwofaChallenge);
  const server = useStore((s) => s.servers.find((srv) => srv.id === serverId));

  const twofaStatusQuery = useStore((s) => s.twofaStatusQuery);
  const twofaListQuery = useStore((s) => s.twofaListQuery);
  const twofaChallenge = useStore((s) => s.twofaChallenge);
  const twofaAdd = useStore((s) => s.twofaAdd);
  const twofaRemove = useStore((s) => s.twofaRemove);
  const twofaEnable = useStore((s) => s.twofaEnable);
  const twofaDisable = useStore((s) => s.twofaDisable);
  const linkOauthCredential = useStore((s) => s.linkOauthCredential);

  const oauthProviders = useMemo(() => {
    const builtin = __HIDE_SERVER_LIST__ ? getBuiltinOAuthConfig() : undefined;
    if (builtin) return [builtin];
    const saved = loadSavedServers().find((s) => s.id === serverId);
    if (saved?.oauth?.enabled && saved.oauth.issuer && saved.oauth.clientId) {
      return [saved.oauth];
    }
    return [];
  }, [serverId]);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const supportsWebAuthn = (() => {
    if (!server?.capabilities?.includes("draft/account-2fa")) return false;
    // CAP ACK only echoes the cap name, so the factor list comes from the CAP LS value we stored.
    const factors = server.capabilityValues?.["draft/account-2fa"];
    // We assume the standard factor set when CAP LS sent no value, so enrolment stays open.
    if (!factors) return true;
    return factors
      .split(",")
      .map((f) => f.trim().toLowerCase())
      .includes("webauthn");
  })();

  const [enrollName, setEnrollName] = useState("");
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  useEffect(() => {
    twofaStatusQuery(serverId);
    twofaListQuery(serverId);
  }, [serverId]);

  useEffect(() => {
    if (
      !challenge ||
      challenge.serverId !== serverId ||
      challenge.type !== "totp"
    ) {
      setQrSvg(null);
      return;
    }
    const decoded = decodeChallenge(challenge.blob);
    const uri =
      decoded &&
      typeof decoded === "object" &&
      decoded !== null &&
      "uri" in decoded &&
      typeof (decoded as { uri: unknown }).uri === "string"
        ? (decoded as { uri: string }).uri
        : null;
    if (!uri) {
      setQrSvg(null);
      return;
    }
    QRCode.toString(uri, { type: "svg", margin: 2, width: 220 })
      .then(setQrSvg)
      .catch(() => setQrSvg(null));
  }, [challenge, serverId]);

  const onAddTotp = () => {
    setEnrollError(null);
    setEnrollName("");
    setEnrollCode("");
    twofaChallenge(serverId, "totp");
  };

  const onLinkOauth = async (
    provider: (typeof oauthProviders)[number],
    name: string,
  ) => {
    setOauthError(null);
    const tag = provider.serverProvider || provider.providerLabel;
    setOauthBusy(tag);
    try {
      const result = await beginOauthLogin({
        issuer: provider.issuer,
        clientId: provider.clientId,
        scopes: provider.scopes || undefined,
        redirectUri: provider.redirectUri || undefined,
        authorizeEndpoint: provider.authorizeEndpoint || undefined,
        tokenEndpoint: provider.tokenEndpoint || undefined,
      });
      const isOpaque = provider.tokenKind === "opaque";
      const bearer = isOpaque
        ? result.accessToken
        : (result.idToken ?? result.accessToken);
      if (!bearer) throw new Error(t`Provider returned no bearer token.`);
      const serverProvider =
        provider.serverProvider ||
        // We fall back to the preset id so the name matches the oauth-provider block on the server.
        OAUTH_PRESETS.find(
          (p) => p.label.toLowerCase() === provider.providerLabel.toLowerCase(),
        )?.id ||
        provider.providerLabel.toLowerCase();
      linkOauthCredential(serverId, serverProvider, bearer, name);
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : String(err));
    } finally {
      setOauthBusy(null);
    }
  };

  const onAddWebAuthn = async () => {
    if (!isWebAuthnAvailable()) {
      setEnrollError(t`WebAuthn is not available in this environment.`);
      return;
    }
    setEnrollError(null);
    twofaChallenge(serverId, "webauthn");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  useEffect(() => {
    if (
      !challenge ||
      challenge.serverId !== serverId ||
      challenge.type !== "webauthn" ||
      enrollBusy
    )
      return;
    const decoded = decodeChallenge(challenge.blob);
    if (!decoded || typeof decoded !== "object") {
      setEnrollError(t`Server returned an invalid WebAuthn challenge.`);
      return;
    }
    const name = enrollName.trim() || `Device-${Date.now()}`;
    setEnrollBusy(true);
    webauthnRegister(decoded as Parameters<typeof webauthnRegister>[0])
      .then((result) => {
        const payload = bytesToB64Std(
          new TextEncoder().encode(JSON.stringify(result)),
        );
        twofaAdd(serverId, "webauthn", name, payload);
        setEnrollBusy(false);
      })
      .catch((err) => {
        setEnrollError(err instanceof Error ? err.message : String(err));
        setEnrollBusy(false);
      });
  }, [challenge?.blob, challenge?.type, challenge?.serverId, serverId]);

  const onSubmitTotp = (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollError(null);
    const name = enrollName.trim();
    if (!name || /\s/.test(name)) {
      setEnrollError(t`Pick a single-word name (no spaces).`);
      return;
    }
    if (!/^\d{6}$/.test(enrollCode.trim())) {
      setEnrollError(t`Enter the 6-digit code from your authenticator app.`);
      return;
    }
    twofaAdd(serverId, "totp", name, enrollCode.trim());
    setEnrollName("");
    setEnrollCode("");
  };

  const onDisable = () => {
    setEnrollError(null);
    if (!/^\d{6}$/.test(disableCode.trim())) {
      setEnrollError(
        t`Enter a 6-digit code from any of your authenticator apps to disable 2FA.`,
      );
      return;
    }
    twofaDisable(serverId, "totp", disableCode.trim());
    setDisableCode("");
  };

  const confirmRemoval = () => {
    if (!pendingRemoval) return;
    twofaRemove(serverId, pendingRemoval.id);
    setPendingRemoval(null);
  };

  const inflightTotp = useMemo(
    () =>
      challenge?.serverId === serverId && challenge?.type === "totp" && !!qrSvg,
    [challenge, qrSvg, serverId],
  );

  // Removing the last credential under enforced 2FA would lock the account out, so we block it.
  const removingLastWhileEnabled =
    status === "enabled" && credentials.length === 1;

  const statusLabel =
    status === "enabled"
      ? t`Enabled`
      : status === "disabled"
        ? t`Disabled`
        : t`Loading…`;

  const webauthnHint = !supportsWebAuthn
    ? t`Server does not advertise WebAuthn support`
    : !isWebAuthnAvailable()
      ? t`Browser does not expose WebAuthn`
      : undefined;

  return (
    <PageShell
      title={t`Two-factor authentication`}
      back={{
        label: t`Back to Settings`,
        onBack: () => openPage({ kind: "settings", section: "account" }),
      }}
    >
      <SettingGroup>
        <SettingRow
          title={<Trans>Status</Trans>}
          control={
            <span
              className={
                status === "enabled"
                  ? "text-sm text-discord-green"
                  : "text-sm text-discord-text-muted"
              }
            >
              {statusLabel}
            </span>
          }
        />
        {status === "enabled" ? (
          <SettingRow
            title={<Trans>Disable 2FA</Trans>}
            description={
              <Trans>
                Enter a 6-digit code from any of your registered authenticator
                apps to confirm.
              </Trans>
            }
          >
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                pattern="\d{6}"
                placeholder="000000"
                value={disableCode}
                onChange={(e) =>
                  setDisableCode(e.target.value.replace(/\D/g, ""))
                }
                className="field-input text-center tracking-[0.4em] font-mono"
              />
              <Button variant="danger" onClick={onDisable}>
                <Trans>Disable</Trans>
              </Button>
            </div>
          </SettingRow>
        ) : (
          <SettingRow
            title={<Trans>Enable 2FA</Trans>}
            control={
              <Button
                variant="success"
                disabled={credentials.length === 0}
                onClick={() => twofaEnable(serverId)}
              >
                {credentials.length === 0
                  ? t`Add a credential to enable 2FA`
                  : t`Enable 2FA`}
              </Button>
            }
          />
        )}
      </SettingGroup>

      <SettingGroup title={<Trans>Registered credentials</Trans>}>
        {credentials.length === 0 && (
          <SettingRow
            title={
              <span className="text-discord-text-muted">
                <Trans>No 2FA credentials yet. Add one below.</Trans>
              </span>
            }
          />
        )}
        {credentials.map((c) => (
          <SettingRow
            key={c.id}
            title={c.name}
            description={
              <>
                {typeLabels[c.type] ?? c.type}
                {c.createdAt && (
                  <>
                    {" · "}
                    <Trans>added {c.createdAt}</Trans>
                  </>
                )}
              </>
            }
            control={
              <Button
                variant="secondary"
                onClick={() => setPendingRemoval({ id: c.id, name: c.name })}
              >
                <Trans>Remove</Trans>
              </Button>
            }
          />
        ))}
      </SettingGroup>

      <SettingGroup title={<Trans>Add a credential</Trans>}>
        <SettingRow
          title={<Trans>Authenticator app</Trans>}
          description={typeLabels.totp}
          control={
            <Button variant="primary" onClick={onAddTotp}>
              <Trans>Add</Trans>
            </Button>
          }
        />
        <SettingRow
          title={<Trans>Biometric / security key</Trans>}
          description={webauthnHint ?? typeLabels.webauthn}
          control={
            <Button
              variant="primary"
              disabled={!supportsWebAuthn || !isWebAuthnAvailable()}
              onClick={onAddWebAuthn}
            >
              <Trans>Add</Trans>
            </Button>
          }
        />
        {oauthProviders.map((p) => {
          const tag = p.serverProvider || p.providerLabel;
          const busy = oauthBusy === tag;
          return (
            <SettingRow
              key={tag}
              title={t`Link with ${p.providerLabel}`}
              description={
                <Trans>
                  Sign in with the provider to link it to your account. Then you
                  can log in with it on later connections (SASL OAUTHBEARER and
                  IRCV3BEARER).
                </Trans>
              }
              control={
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => onLinkOauth(p, p.providerLabel.toLowerCase())}
                >
                  {busy ? t`Waiting for sign-in…` : t`Link`}
                </Button>
              }
            />
          );
        })}
      </SettingGroup>

      {oauthError && (
        <p role="alert" className="text-discord-red text-xs">
          {oauthError}
        </p>
      )}

      {inflightTotp && qrSvg && (
        <SettingGroup title={<Trans>Confirm authenticator app</Trans>}>
          <form
            onSubmit={onSubmitTotp}
            className="px-4 py-3.5 flex flex-col gap-3"
          >
            <p className="text-sm text-white">
              <Trans>
                Scan this QR code with your authenticator app, then confirm with
                the 6-digit code it shows.
              </Trans>
            </p>
            <div
              className="bg-white p-2 rounded-lg self-start"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: QR SVG is generated by qrcode lib from a known otpauth URI
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <input
              type="text"
              placeholder={t`Name (e.g. iPhone)`}
              value={enrollName}
              onChange={(e) => setEnrollName(e.target.value)}
              className="field-input"
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              pattern="\d{6}"
              placeholder={t`6-digit code`}
              value={enrollCode}
              onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, ""))}
              className="field-input text-center tracking-[0.4em] font-mono"
            />
            <Button type="submit" variant="success">
              <Trans>Confirm enrolment</Trans>
            </Button>
          </form>
        </SettingGroup>
      )}

      {enrollError && (
        <p role="alert" className="text-discord-red text-xs">
          {enrollError}
        </p>
      )}
      {enrollBusy && (
        <p className="text-discord-text-muted text-xs">
          <Trans>Waiting for biometric prompt…</Trans>
        </p>
      )}

      <BaseModal
        isOpen={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        title={
          removingLastWhileEnabled
            ? t`Can't remove your last 2FA credential`
            : t`Remove credential`
        }
        maxWidth="sm"
      >
        <ModalBody>
          <p className="text-sm text-discord-text-muted">
            {removingLastWhileEnabled ? (
              <Trans>
                2FA is currently enforced on this account. Removing the only
                registered credential would lock you out of login. Add another
                credential first, or disable 2FA first.
              </Trans>
            ) : (
              <Trans>
                Remove "{pendingRemoval?.name}"? You will no longer be able to
                use it as a second factor.
              </Trans>
            )}
          </p>
        </ModalBody>
        <ModalFooter>
          {removingLastWhileEnabled ? (
            <Button variant="primary" onClick={() => setPendingRemoval(null)}>
              <Trans>OK</Trans>
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => setPendingRemoval(null)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button variant="danger" onClick={confirmRemoval}>
                <Trans>Confirm remove</Trans>
              </Button>
            </>
          )}
        </ModalFooter>
      </BaseModal>
    </PageShell>
  );
};

export default TwoFactorPage;
