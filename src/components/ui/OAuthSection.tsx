import type React from "react";
import { useState } from "react";
import { beginOauthLogin, OAUTH_PRESETS } from "../../lib/oauth";
import type { ServerOAuthConfig } from "../../types";
import { TextInput } from "./TextInput";

interface OAuthSectionProps {
  // Initial config loaded from the saved server (may be undefined for a
  // freshly added server).
  initial: ServerOAuthConfig | undefined;
  // Called whenever any field changes; the parent persists on submit.
  onChange: (next: ServerOAuthConfig | undefined) => void;
  // When provided, the panel runs in "locked" mode: the deployer baked
  // these provider settings in via VITE_DEFAULT_OAUTH_* env vars, the
  // editable issuer/client/scopes inputs are hidden, and OAuth is
  // implicitly enabled. Used in __HIDE_SERVER_LIST__ deployments.
  locked?: {
    providerLabel: string;
    issuer: string;
    clientId: string;
    scopes?: string;
    redirectUri?: string;
    tokenKind?: "jwt" | "opaque";
    serverProvider?: string;
    authorizeEndpoint?: string;
    tokenEndpoint?: string;
  };
}

// In-modal panel: pick a provider preset, fill in issuer + clientId, hit
// "Sign in" to run the popup OAuth flow, and persist the resulting tokens
// alongside the rest of the server config. Tokens are written to the
// outer config via onChange so the parent's submit picks them up.
//
// In `locked` mode the provider fields are baked into the build; the user
// only sees the Sign-in / Sign-out actions and a token status line.
export const OAuthSection: React.FC<OAuthSectionProps> = ({
  initial,
  onChange,
  locked,
}) => {
  // In locked mode OAuth is implicit (always enabled) and the user can't
  // toggle it off. In editable mode the checkbox controls visibility of
  // the provider fields.
  const [enabled, setEnabled] = useState(
    locked ? true : (initial?.enabled ?? false),
  );
  const [presetId, setPresetId] = useState<string>(() => {
    if (!initial?.issuer) return "custom";
    const lower = initial.issuer.toLowerCase();
    if (lower.includes("logto")) return "logto";
    if (lower.includes("auth0")) return "auth0";
    if (lower.includes("/realms/")) return "keycloak";
    return "custom";
  });
  const preset =
    OAUTH_PRESETS.find((p) => p.id === presetId) ?? OAUTH_PRESETS[0];

  const [providerLabel, setProviderLabel] = useState(
    locked?.providerLabel ?? initial?.providerLabel ?? preset.label,
  );
  const [issuer, setIssuer] = useState(locked?.issuer ?? initial?.issuer ?? "");
  const [clientId, setClientId] = useState(
    locked?.clientId ?? initial?.clientId ?? "",
  );
  const [scopes, setScopes] = useState(
    locked?.scopes ?? initial?.scopes ?? preset.defaultScopes,
  );
  const [redirectUri, setRedirectUri] = useState(
    locked?.redirectUri ?? initial?.redirectUri ?? "",
  );
  const [accessToken, setAccessToken] = useState(initial?.accessToken ?? "");
  const [idToken, setIdToken] = useState(initial?.idToken ?? "");
  const [refreshToken, setRefreshToken] = useState(initial?.refreshToken ?? "");
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | undefined>(
    initial?.tokenExpiresAt,
  );
  const [tokenKind, setTokenKind] = useState<"jwt" | "opaque">(
    locked?.tokenKind ?? initial?.tokenKind ?? "jwt",
  );
  const [serverProvider, setServerProvider] = useState(
    locked?.serverProvider ?? initial?.serverProvider ?? "",
  );
  // Non-OIDC providers (GitHub) supply explicit authorize/token URLs
  // because there's no /.well-known/openid-configuration to discover.
  const [authorizeEndpoint, setAuthorizeEndpoint] = useState(
    locked?.authorizeEndpoint ?? initial?.authorizeEndpoint ?? "",
  );
  const [tokenEndpoint, setTokenEndpoint] = useState(
    locked?.tokenEndpoint ?? initial?.tokenEndpoint ?? "",
  );

  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Centralize the parent notification so every state setter goes through
  // the same shape. Pass overrides for the field that just changed, since
  // useState's setters won't have flushed yet.
  // We let a patch key override even when it is undefined, so sign-out can clear the tokens.
  const emit = (patch: Partial<ServerOAuthConfig> = {}) => {
    const next: ServerOAuthConfig = {
      enabled,
      providerLabel,
      issuer,
      clientId,
      scopes,
      redirectUri,
      accessToken,
      idToken,
      refreshToken,
      tokenExpiresAt,
      tokenKind,
      serverProvider,
      authorizeEndpoint,
      tokenEndpoint,
      ...patch,
    };
    onChange(next.enabled ? next : undefined);
  };

  const onPresetChange = (next: string) => {
    setPresetId(next);
    const np = OAUTH_PRESETS.find((p) => p.id === next) ?? OAUTH_PRESETS[0];
    const patch: Partial<ServerOAuthConfig> = {};
    if (!providerLabel.trim() || providerLabel === preset.label) {
      patch.providerLabel = np.label;
      setProviderLabel(np.label);
    }
    if (!scopes.trim() || scopes === preset.defaultScopes) {
      patch.scopes = np.defaultScopes;
      setScopes(np.defaultScopes);
    }
    if (np.issuer && (!issuer.trim() || issuer === preset.issuer)) {
      patch.issuer = np.issuer;
      setIssuer(np.issuer);
    }
    // Apply token kind + manual endpoints baked into the preset (GitHub
    // is opaque + non-OIDC; Google is jwt + OIDC; etc.). For "custom"
    // we don't override anything.
    if (np.tokenKind && np.id !== "custom") {
      patch.tokenKind = np.tokenKind;
      setTokenKind(np.tokenKind);
    }
    if (np.authorizeEndpoint !== undefined) {
      patch.authorizeEndpoint = np.authorizeEndpoint;
      setAuthorizeEndpoint(np.authorizeEndpoint);
    }
    if (np.tokenEndpoint !== undefined) {
      patch.tokenEndpoint = np.tokenEndpoint;
      setTokenEndpoint(np.tokenEndpoint);
    }
    // Default the server-provider hint to the preset id for opaque flows
    // so the user sees a sensible default ("github") matching what
    // obbyircd's oauth-provider {} block would typically be named.
    if (np.tokenKind === "opaque" && !serverProvider.trim()) {
      patch.serverProvider = np.id;
      setServerProvider(np.id);
    }
    emit(patch);
  };

  const handleSignIn = async () => {
    setSignInError(null);
    if (!issuer.trim()) {
      setSignInError("Issuer URL is required.");
      return;
    }
    if (!clientId.trim()) {
      setSignInError("Client ID is required.");
      return;
    }
    setSigningIn(true);
    try {
      const result = await beginOauthLogin({
        issuer: issuer.trim(),
        clientId: clientId.trim(),
        scopes: scopes.trim() || undefined,
        redirectUri: redirectUri.trim() || undefined,
        authorizeEndpoint: authorizeEndpoint.trim() || undefined,
        tokenEndpoint: tokenEndpoint.trim() || undefined,
      });
      setAccessToken(result.accessToken);
      setIdToken(result.idToken ?? "");
      setRefreshToken(result.refreshToken ?? "");
      setTokenExpiresAt(result.tokenExpiresAt);
      setEnabled(true);
      emit({
        enabled: true,
        accessToken: result.accessToken,
        idToken: result.idToken ?? undefined,
        refreshToken: result.refreshToken ?? undefined,
        tokenExpiresAt: result.tokenExpiresAt,
      });
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = () => {
    setAccessToken("");
    setIdToken("");
    setRefreshToken("");
    setTokenExpiresAt(undefined);
    emit({
      accessToken: undefined,
      idToken: undefined,
      refreshToken: undefined,
      tokenExpiresAt: undefined,
    });
  };

  const tokenStatus = (() => {
    if (!accessToken) return "Not signed in";
    if (tokenExpiresAt) {
      const remaining = tokenExpiresAt - Math.floor(Date.now() / 1000);
      if (remaining <= 0) return "Signed in (token expired)";
      const mins = Math.floor(remaining / 60);
      return `Signed in (token expires in ~${mins}m)`;
    }
    return "Signed in";
  })();

  // ---- Locked-mode render: provider settings are baked in, just show
  // the Sign-in/Sign-out actions plus the current token status. ----
  if (locked) {
    return (
      <div className="mb-4 border-t border-discord-dark-300 pt-4">
        <h3 className="text-discord-text-normal text-lg font-semibold mb-1">
          Sign in with {locked.providerLabel}
        </h3>
        <p className="text-discord-text-muted text-xs mb-3">
          Configured by your network administrator.
        </p>
        <div className="mb-3 text-xs text-discord-text-muted">
          {tokenStatus}
        </div>
        {signInError && (
          <div className="mb-3 text-sm text-discord-red">{signInError}</div>
        )}
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={handleSignIn}
            disabled={signingIn}
            className={`px-3 py-1 text-sm rounded font-medium ${
              signingIn
                ? "bg-gray-600 text-gray-300 cursor-not-allowed"
                : "bg-discord-primary text-white hover:bg-opacity-80"
            }`}
          >
            {signingIn
              ? "Signing in..."
              : accessToken
                ? `Re-sign in with ${locked.providerLabel}`
                : `Sign in with ${locked.providerLabel}`}
          </button>
          {accessToken && (
            <button
              type="button"
              onClick={handleSignOut}
              className="px-3 py-1 text-sm rounded font-medium bg-gray-600 text-gray-300 hover:bg-gray-500"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- Editable-mode render (default, multi-server build). ----
  return (
    <div className="mb-4 border-t border-discord-dark-300 pt-4">
      <h3 className="text-discord-text-normal text-lg font-semibold mb-3">
        OAuth2 / OIDC sign-in
      </h3>

      <div className="mb-3 flex items-center space-x-2">
        <input
          type="checkbox"
          id="oauthEnabled"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            emit({ enabled: e.target.checked });
          }}
          className="accent-discord-primary rounded"
        />
        <label
          htmlFor="oauthEnabled"
          className="text-discord-text-muted text-sm"
        >
          Use OAuth2 to sign in (SASL IRCV3BEARER)
        </label>
      </div>

      {enabled && (
        <>
          <div className="mb-3">
            <label className="block text-discord-text-muted text-sm font-medium mb-1">
              Provider preset
            </label>
            <select
              value={presetId}
              onChange={(e) => onPresetChange(e.target.value)}
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
            >
              {OAUTH_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {preset.hint && (
              <p className="text-discord-text-muted text-xs mt-1">
                {preset.hint}
              </p>
            )}
          </div>

          <div className="mb-3">
            <label className="block text-discord-text-muted text-sm font-medium mb-1">
              Display name
            </label>
            <TextInput
              value={providerLabel}
              onChange={(e) => {
                setProviderLabel(e.target.value);
                emit({ providerLabel: e.target.value });
              }}
              placeholder="Logto"
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
            />
          </div>

          <div className="mb-3">
            <label className="block text-discord-text-muted text-sm font-medium mb-1">
              Issuer URL
            </label>
            <TextInput
              value={issuer}
              onChange={(e) => {
                setIssuer(e.target.value);
                emit({ issuer: e.target.value });
              }}
              placeholder="https://my-tenant.logto.app/oidc"
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
            />
          </div>

          <div className="mb-3">
            <label className="block text-discord-text-muted text-sm font-medium mb-1">
              Client ID
            </label>
            <TextInput
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                emit({ clientId: e.target.value });
              }}
              placeholder="m0obbyircd1234"
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
            />
          </div>

          <div className="mb-3">
            <label className="block text-discord-text-muted text-sm font-medium mb-1">
              Scopes (space-separated)
            </label>
            <TextInput
              value={scopes}
              onChange={(e) => {
                setScopes(e.target.value);
                emit({ scopes: e.target.value });
              }}
              placeholder="openid"
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
            />
          </div>

          <div className="mb-3">
            <label className="block text-discord-text-muted text-sm font-medium mb-1">
              Redirect URI override (optional)
            </label>
            <TextInput
              value={redirectUri}
              onChange={(e) => {
                setRedirectUri(e.target.value);
                emit({ redirectUri: e.target.value });
              }}
              placeholder={`${window.location.origin}/oauth/callback`}
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
            />
            <p className="text-discord-text-muted text-xs mt-1">
              Default: <code>{`${window.location.origin}/oauth/callback`}</code>
              . Register this in your IdP.
            </p>
          </div>

          <div className="mb-3">
            <label className="block text-discord-text-muted text-sm font-medium mb-1">
              Token type
            </label>
            <select
              value={tokenKind}
              onChange={(e) => {
                const v = e.target.value as "jwt" | "opaque";
                setTokenKind(v);
                emit({ tokenKind: v });
              }}
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
            >
              <option value="jwt">
                JWT — server validates locally (Logto / Auth0 / Keycloak /
                Google id_token)
              </option>
              <option value="opaque">
                Opaque — server hits userinfo endpoint (GitHub / Discord /
                Slack)
              </option>
            </select>
          </div>

          {tokenKind === "opaque" && (
            <div className="mb-3">
              <label className="block text-discord-text-muted text-sm font-medium mb-1">
                Server provider name
              </label>
              <TextInput
                value={serverProvider}
                onChange={(e) => {
                  setServerProvider(e.target.value);
                  emit({ serverProvider: e.target.value });
                }}
                placeholder="github"
                className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
              />
              <p className="text-discord-text-muted text-xs mt-1">
                Must match the <code>oauth-provider "name"</code> block on the
                IRC server (obbyircd's <code>userinfo-url</code>
                config).
              </p>
            </div>
          )}

          <div className="mb-3 text-xs text-discord-text-muted">
            {tokenStatus}
          </div>

          {signInError && (
            <div className="mb-3 text-sm text-discord-red">{signInError}</div>
          )}

          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={handleSignIn}
              disabled={signingIn}
              className={`px-3 py-1 text-sm rounded font-medium ${
                signingIn
                  ? "bg-gray-600 text-gray-300 cursor-not-allowed"
                  : "bg-discord-primary text-white hover:bg-opacity-80"
              }`}
            >
              {signingIn
                ? "Signing in..."
                : accessToken
                  ? `Re-sign in with ${providerLabel || "OAuth"}`
                  : `Sign in with ${providerLabel || "OAuth"}`}
            </button>
            {accessToken && (
              <button
                type="button"
                onClick={handleSignOut}
                className="px-3 py-1 text-sm rounded font-medium bg-gray-600 text-gray-300 hover:bg-gray-500"
              >
                Sign out
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default OAuthSection;
