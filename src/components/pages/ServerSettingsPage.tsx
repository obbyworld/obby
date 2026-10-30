import { t } from "@lingui/core/macro";
import type React from "react";
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { Button } from "../../lib/modal/components";
import { getBuiltinOAuthConfig } from "../../lib/oauth";
import useStore, { loadSavedServers } from "../../store";
import { normalizeHost } from "../../store/helpers";
import type { Server, ServerConfig, ServerOAuthConfig } from "../../types";
import ChangePasswordModal from "../ui/ChangePasswordModal";
import LoadingSpinner from "../ui/LoadingSpinner";
import { OAuthSection } from "../ui/OAuthSection";
import PasswordRecoveryModal from "../ui/PasswordRecoveryModal";
import { PageShell } from "../ui/page/PageShell";
import { SettingGroup, SettingRow, Switch } from "../ui/page/SettingRow";
import { TextInput } from "../ui/TextInput";
import type { PageProps } from "./PageHost";
import { getServerSettingsSections } from "./pageSections";

const sectionIds = ["general", "auth", "oauth", "operator"] as const;
type SectionId = (typeof sectionIds)[number];

const toSectionId = (id: string | undefined): SectionId =>
  sectionIds.find((s) => s === id) ?? "general";

interface Draft {
  name: string;
  host: string;
  port: string;
  nickname: string;
  operName: string;
  operPassword: string;
  operOnConnect: boolean;
  forgetOperCredentials: boolean;
  oauth: ServerOAuthConfig | undefined;
}

const savedDraft = (
  server: Server | undefined,
  serverConfig: ServerConfig | undefined,
): Draft => ({
  name: serverConfig?.name || server?.name || "",
  host: serverConfig?.host || server?.host || "",
  port: serverConfig?.port?.toString() || server?.port?.toString() || "443",
  nickname: serverConfig?.nickname || "",
  operName: serverConfig?.operUsername || "",
  operPassword: "",
  operOnConnect: serverConfig?.operOnConnect || false,
  forgetOperCredentials: false,
  oauth: serverConfig?.oauth,
});

const forgottenPasswords: Partial<ServerConfig> = {
  password: undefined,
  saslPassword: undefined,
  saslEnabled: false,
};

// Credentials only take effect on a new login, so this section saves them with
// its Log in button and reconnects, which shows the result right away.
const LoginSection: React.FC<{
  server: Server | undefined;
  serverConfig: ServerConfig | undefined;
  onRecover: () => void;
  onChangePassword: () => void;
}> = ({ server, serverConfig, onRecover, onChangePassword }) => {
  const { updateServer, reconnectServer } = useStore();
  const [account, setAccount] = useState(serverConfig?.saslAccountName ?? "");
  const [saslPassword, setSaslPassword] = useState("");
  const [password, setPassword] = useState("");
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  if (!serverConfig) return null;

  const isLoggingIn =
    server?.connectionState === "connecting" ||
    (server?.isConnected && !server.isRegistered);

  const logIn = () => {
    updateServer(serverConfig.id, {
      saslAccountName: account.trim() || serverConfig.nickname || undefined,
      // The stored format expects SASL passwords base64-encoded, so we encode them here.
      ...(saslPassword
        ? { saslPassword: btoa(saslPassword), saslEnabled: true }
        : {}),
      ...(password ? { password } : {}),
    });
    setSaslPassword("");
    setPassword("");
    reconnectServer(serverConfig.id);
  };

  const forgetPasswords = () => {
    updateServer(serverConfig.id, forgottenPasswords);
    setSaslPassword("");
    setPassword("");
    refresh();
  };

  const status = (): ReactNode => {
    if (isLoggingIn)
      return (
        <LoadingSpinner
          size="sm"
          text={t`Logging in`}
          className="!flex-row !space-y-0 gap-2"
        />
      );
    if (server?.saslFailed)
      return (
        <span className="text-discord-red">
          {t`Sign-in failed. Check the account name and password`}
        </span>
      );
    if (server?.account)
      return (
        <span className="text-discord-green">{t`Logged in as ${server.account}`}</span>
      );
    if (server?.isConnected) return t`Connected as a guest`;
    return t`Not connected`;
  };

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        logIn();
      }}
    >
      <SettingGroup title={t`SASL PLAIN account`}>
        <SettingRow
          id="server.saslAccountName"
          title={t`Account name`}
          description={t`Enter an account name to log in with SASL PLAIN before joining channels. Leave blank to use your nickname.`}
          field={
            <TextInput
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={serverConfig.nickname || "account"}
              autoComplete="username"
              className="field-input"
            />
          }
        />
        <SettingRow
          id="server.saslPassword"
          title={t`Password`}
          field={
            <TextInput
              type="password"
              value={saslPassword}
              onChange={(e) => setSaslPassword(e.target.value)}
              placeholder={
                serverConfig.saslPassword
                  ? t`(stored, leave blank to keep)`
                  : t`Password`
              }
              autoComplete="current-password"
              className="field-input"
            />
          }
        />
        <SettingRow
          id="server.password"
          title={t`Server password`}
          description={t`Enter the server password only if your network requires one. It is separate from your account password.`}
          field={
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                serverConfig.password
                  ? t`(stored, leave blank to keep)`
                  : t`Server password`
              }
              autoComplete="off"
              className="field-input"
            />
          }
        />
        <SettingRow
          title={status()}
          control={
            <Button type="submit" disabled={isLoggingIn}>
              {t`Log in`}
            </Button>
          }
        />
      </SettingGroup>

      {(serverConfig.password || serverConfig.saslPassword) && (
        <SettingGroup>
          <SettingRow
            title={t`Stored passwords`}
            description={t`Forget the stored SASL and server passwords to stop sending them on connect.`}
            control={
              <Button variant="secondary" onClick={forgetPasswords}>
                {t`Forget passwords`}
              </Button>
            }
          />
        </SettingGroup>
      )}

      {server?.capabilities?.includes("draft/account-recovery") && (
        <SettingGroup>
          <SettingRow
            title={t`Account password`}
            description={t`Change or reset the password for your account.`}
          >
            <div className="flex flex-wrap gap-2">
              {server.isConnected && (
                <Button variant="secondary" onClick={onChangePassword}>
                  {t`Change password`}
                </Button>
              )}
              <Button variant="secondary" onClick={onRecover}>
                {t`Forgot password?`}
              </Button>
            </div>
          </SettingRow>
        </SettingGroup>
      )}
    </form>
  );
};

const ServerSettingsPage: React.FC<PageProps<"serverSettings">> = ({
  page,
}) => {
  const { servers, updateServer, sendRaw, isConnecting } = useStore();
  const server = servers.find((s) => s.id === page.serverId);
  const serverConfig = loadSavedServers().find((s) => s.id === page.serverId);

  const [baseline, setBaseline] = useState<Draft>(() =>
    savedDraft(server, serverConfig),
  );
  const [draft, setDraft] = useState<Draft>(baseline);
  const [error, setError] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const [section, setSection] = useState<SectionId>(toSectionId(page.section));
  useEffect(() => {
    if (page.section) setSection(toSectionId(page.section));
  }, [page.section]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const lockedOauth = __HIDE_SERVER_LIST__
    ? getBuiltinOAuthConfig()
    : undefined;

  const sections = getServerSettingsSections();

  const save = () => {
    setError("");

    const finalServerName = draft.name.trim() || draft.host.trim();

    if (!finalServerName) {
      setError(t`Server name is required`);
      setSection("general");
      return;
    }
    if (!draft.host.trim()) {
      setError(t`Server host is required`);
      setSection("general");
      return;
    }
    if (!draft.port.trim() || Number.isNaN(Number.parseInt(draft.port, 10))) {
      setError(t`Valid server port is required`);
      setSection("general");
      return;
    }
    if (!draft.nickname.trim()) {
      setError(t`Nickname is required`);
      setSection("general");
      return;
    }

    // We drop stored passwords when the host moves to another network, so we never send them to a server they were not saved for.
    const isNewNetwork =
      !!serverConfig &&
      normalizeHost(draft.host.trim()).toLowerCase() !==
        normalizeHost(serverConfig.host).toLowerCase();

    try {
      const updatedConfig: Partial<ServerConfig> = {
        name: finalServerName,
        host: draft.host.trim(),
        port: Number.parseInt(draft.port, 10),
        nickname: draft.nickname.trim(),
        ...(isNewNetwork ? forgottenPasswords : {}),
        ...(draft.forgetOperCredentials
          ? { operUsername: undefined, operPassword: undefined }
          : draft.operName.trim()
            ? {
                operUsername: draft.operName.trim(),
                ...(draft.operPassword.trim()
                  ? { operPassword: btoa(draft.operPassword.trim()) }
                  : {}),
              }
            : {}),
        operOnConnect: draft.operOnConnect,
        oauth: draft.oauth,
      };
      updateServer(page.serverId, updatedConfig);
      const saved: Draft = draft.forgetOperCredentials
        ? {
            ...draft,
            operName: "",
            operPassword: "",
            forgetOperCredentials: false,
          }
        : draft;
      setDraft(saved);
      setBaseline(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    }
  };

  // Text fields save when they lose focus; switches and OAuth save as they
  // change, and whatever is still unsaved saves when the page closes.
  const saveRef = useRef(save);
  saveRef.current = save;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only these fields save without a blur
  useEffect(() => {
    if (isDirtyRef.current) saveRef.current();
  }, [draft.operOnConnect, draft.oauth, draft.forgetOperCredentials]);
  useEffect(
    () => () => {
      if (isDirtyRef.current) saveRef.current();
    },
    [],
  );

  const operPassword =
    draft.operPassword.trim() ||
    (serverConfig?.operPassword ? atob(serverConfig.operPassword) : "");
  const handleOperUp = () =>
    sendRaw(page.serverId, `OPER ${draft.operName.trim()} ${operPassword}`);

  const operStatus = (): ReactNode => {
    if (serverConfig?.operUsername)
      return t`Leave blank to keep the stored credentials`;
    return t`No oper credentials yet. Enter a name and password.`;
  };

  const generalSection = (
    <SettingGroup>
      <SettingRow
        id="server.name"
        title={t`Network name`}
        field={
          <TextInput
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="ExampleNET"
            className="field-input"
          />
        }
      />
      <SettingRow
        id="server.host"
        title={t`Server host`}
        field={
          <TextInput
            value={draft.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="irc.example.com"
            className="field-input"
          />
        }
      />
      <SettingRow
        id="server.port"
        title={t`Port`}
        description={t`Use a secure websocket port.`}
        field={
          <TextInput
            value={draft.port}
            onChange={(e) => set("port", e.target.value)}
            placeholder="443"
            className="field-input"
          />
        }
      />
      <SettingRow
        id="server.nickname"
        title={t`Nickname`}
        field={
          <TextInput
            value={draft.nickname}
            onChange={(e) => set("nickname", e.target.value)}
            placeholder="YourNickname"
            className="field-input"
          />
        }
      />
    </SettingGroup>
  );

  const oauthSection = (
    <SettingGroup>
      <div className="px-4 py-3.5">
        <OAuthSection
          initial={draft.oauth}
          onChange={(oauth) => set("oauth", oauth)}
          locked={lockedOauth}
        />
      </div>
    </SettingGroup>
  );

  const operatorSection = (
    <>
      <SettingGroup>
        <SettingRow
          id="server.operName"
          title={t`Oper name`}
          description={t`Turn on Oper on connect to send the stored name and password as OPER on every connection, or use Oper up below.`}
          field={
            <TextInput
              value={draft.operName}
              onChange={(e) => set("operName", e.target.value)}
              placeholder={t`IRC operator username`}
              className="field-input"
            />
          }
        />
        <SettingRow
          id="server.operPassword"
          title={t`Oper password`}
          field={
            <TextInput
              type="password"
              value={draft.operPassword}
              onChange={(e) => set("operPassword", e.target.value)}
              placeholder={
                serverConfig?.operPassword
                  ? t`(stored, leave blank to keep)`
                  : t`Operator password`
              }
              className="field-input"
            />
          }
        />
        <SettingRow
          id="server.operOnConnect"
          title={t`Oper on connect`}
          control={
            <Switch
              checked={draft.operOnConnect}
              onChange={(checked) => set("operOnConnect", checked)}
              label={t`Oper on connect`}
            />
          }
        />
        <SettingRow
          title={t`Oper credentials`}
          description={operStatus()}
          control={
            serverConfig?.operUsername && (
              <Button
                variant={draft.forgetOperCredentials ? "danger" : "secondary"}
                onClick={() =>
                  set("forgetOperCredentials", !draft.forgetOperCredentials)
                }
              >
                {draft.forgetOperCredentials
                  ? t`Keep credentials`
                  : t`Forget credentials`}
              </Button>
            )
          }
        />
        <SettingRow
          title={t`Manual oper`}
          description={t`Send OPER with the name and password above now.`}
          control={
            <Button
              disabled={!draft.operName.trim() || !operPassword}
              onClick={handleOperUp}
            >
              {t`Oper up`}
            </Button>
          }
        />
      </SettingGroup>
    </>
  );

  const sectionBodies: Record<SectionId, ReactNode> = {
    general: generalSection,
    auth: (
      <LoginSection
        server={server}
        serverConfig={serverConfig}
        onRecover={() => setShowRecovery(true)}
        onChangePassword={() => setShowChangePassword(true)}
      />
    ),
    oauth: oauthSection,
    operator: operatorSection,
  };

  return (
    <PageShell
      title={server?.name || t`Server settings`}
      sections={sections}
      activeSection={section}
      onSectionChange={(id) => setSection(toSectionId(id))}
      startOnSection={!!page.section}
      columns
    >
      {section === "auth" ? (
        sectionBodies.auth
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onBlur={() => {
            if (isDirty) save();
          }}
          className="contents"
        >
          {sectionBodies[section]}
          {error && (
            <p role="alert" className="page-span text-discord-red text-sm">
              {error}
            </p>
          )}
        </form>
      )}
      {showRecovery && (
        <PasswordRecoveryModal
          serverId={page.serverId}
          initialAccount={serverConfig?.saslAccountName || draft.nickname}
          onClose={() => setShowRecovery(false)}
        />
      )}
      {showChangePassword && (
        <ChangePasswordModal
          serverId={page.serverId}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </PageShell>
  );
};

export default ServerSettingsPage;
