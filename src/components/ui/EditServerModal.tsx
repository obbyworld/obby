import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaChevronLeft,
  FaChevronRight,
  FaKey,
  FaQuestionCircle,
  FaServer,
  FaShieldAlt,
  FaTimes,
  FaUserShield,
} from "react-icons/fa";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useModalBehavior } from "../../hooks/useModalBehavior";
import { getBuiltinOAuthConfig } from "../../lib/oauth";
import useStore, { loadSavedServers } from "../../store";
import type { ServerConfig, ServerOAuthConfig } from "../../types";
import ChangePasswordModal from "./ChangePasswordModal";
import { OAuthSection } from "./OAuthSection";
import PasswordRecoveryModal from "./PasswordRecoveryModal";
import { TextInput } from "./TextInput";

interface EditServerModalProps {
  serverId: string;
  onClose: () => void;
}

type TabId = "general" | "auth" | "oauth" | "operator";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const EditServerModal: React.FC<EditServerModalProps> = ({
  serverId,
  onClose,
}) => {
  const { t } = useLingui();
  const { servers, updateServer, sendRaw, isConnecting } = useStore();

  const server = servers.find((s) => s.id === serverId);
  const savedServers = loadSavedServers();
  const serverConfig = savedServers.find((s) => s.id === serverId);

  // ---- Form state ----
  const [serverName, setServerName] = useState(
    serverConfig?.name || server?.name || "",
  );
  const [serverHost, setServerHost] = useState(
    serverConfig?.host || server?.host || "",
  );
  const [serverPort, setServerPort] = useState(
    serverConfig?.port?.toString() || server?.port?.toString() || "443",
  );
  const [nickname, setNickname] = useState(serverConfig?.nickname || "");
  const [password, setPassword] = useState("");

  const [saslAccountName, setSaslAccountName] = useState(
    serverConfig?.saslAccountName || "",
  );
  // Stored as base64 to match the existing localStorage format. State holds
  // the raw user input; we only encode on submit.
  const [saslPassword, setSaslPassword] = useState("");

  const [operName, setOperName] = useState(serverConfig?.operUsername || "");
  const [operPassword, setOperPassword] = useState("");
  const [operOnConnect, setOperOnConnect] = useState(
    serverConfig?.operOnConnect || false,
  );
  const [forgetOperCredentials, setForgetOperCredentials] = useState(false);

  const [oauthConfig, setOauthConfig] = useState<ServerOAuthConfig | undefined>(
    serverConfig?.oauth,
  );
  // draft/account-recovery: opens the matching modals from the
  // Authentication tab when the server advertises the cap.
  const [showRecovery, setShowRecovery] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const [error, setError] = useState("");

  // ---- Layout state ----
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [mobileView, setMobileView] = useState<"categories" | "content">(
    "categories",
  );
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const { getBackdropProps, getContentProps } = useModalBehavior({
    onClose,
    isOpen: true,
  });

  // Reset mobile navigation when the device width crosses the breakpoint so
  // a desktop -> mobile transition doesn't leave the user stuck on the
  // content view with no way back.
  useEffect(() => {
    if (isMobile) setMobileView("categories");
  }, [isMobile]);

  const lockedOauth = __HIDE_SERVER_LIST__
    ? getBuiltinOAuthConfig()
    : undefined;

  const tabs: TabDef[] = [
    { id: "general", label: "General", icon: FaServer },
    { id: "auth", label: "Authentication", icon: FaKey },
    { id: "oauth", label: "OAuth2", icon: FaShieldAlt },
    { id: "operator", label: "IRC Operator", icon: FaUserShield },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const finalServerName = serverName.trim() || serverHost.trim();
    const finalSaslAccountName = saslAccountName.trim() || nickname.trim();

    if (!finalServerName) {
      setError(t`Server name is required`);
      setActiveTab("general");
      if (isMobile) setMobileView("content");
      return;
    }
    if (!serverHost.trim()) {
      setError(t`Server host is required`);
      setActiveTab("general");
      if (isMobile) setMobileView("content");
      return;
    }
    if (!serverPort.trim() || Number.isNaN(Number.parseInt(serverPort, 10))) {
      setError(t`Valid server port is required`);
      setActiveTab("general");
      if (isMobile) setMobileView("content");
      return;
    }
    if (!nickname.trim()) {
      setError(t`Nickname is required`);
      setActiveTab("general");
      if (isMobile) setMobileView("content");
      return;
    }

    try {
      const updatedConfig: Partial<ServerConfig> = {
        name: finalServerName,
        host: serverHost.trim(),
        port: Number.parseInt(serverPort, 10),
        nickname: nickname.trim(),
        password: password.trim() || undefined,
        saslAccountName: finalSaslAccountName || undefined,
        // The existing storage format keeps SASL passwords base64-encoded.
        saslPassword: saslPassword.trim()
          ? btoa(saslPassword.trim())
          : undefined,
        saslEnabled: !!saslPassword.trim(),
        ...(forgetOperCredentials
          ? { operUsername: undefined, operPassword: undefined }
          : operName.trim()
            ? {
                operUsername: operName.trim(),
                ...(operPassword.trim()
                  ? { operPassword: btoa(operPassword.trim()) }
                  : {}),
              }
            : {}),
        operOnConnect,
        oauth: oauthConfig,
      };
      updateServer(serverId, updatedConfig);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    }
  };

  const handleOperUp = () => {
    if (operName.trim() && operPassword.trim()) {
      sendRaw(serverId, `OPER ${operName.trim()} ${operPassword.trim()}`);
    } else {
      setError(t`Oper name and password are required`);
    }
  };

  const inputClass =
    "w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary";
  const labelClass = "block text-discord-text-muted text-sm font-medium mb-1";

  // ----- Tab content panels -----
  const generalPanel = (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Network name</label>
        <TextInput
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
          placeholder="ExampleNET"
          className={inputClass}
        />
      </div>
      <div className="flex gap-4">
        <div className="flex-1">
          <label className={labelClass}>Server host</label>
          <TextInput
            value={serverHost}
            onChange={(e) => setServerHost(e.target.value)}
            placeholder="irc.example.com"
            className={inputClass}
          />
        </div>
        <div className="w-28">
          <label className={labelClass}>
            Port{" "}
            <FaQuestionCircle
              title={t`Only secure websockets are supported`}
              className="inline-block text-discord-text-muted cursor-help text-xs ml-1"
            />
          </label>
          <TextInput
            value={serverPort}
            onChange={(e) => setServerPort(e.target.value)}
            placeholder="443"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Nickname</label>
        <TextInput
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="YourNickname"
          className={inputClass}
        />
      </div>
    </div>
  );

  const authPanel = (
    <div className="space-y-6">
      <section>
        <h4 className="text-discord-text-normal font-medium mb-2">
          SASL PLAIN account
        </h4>
        <p className="text-discord-text-muted text-xs mb-3">
          Logged-in users authenticate via SASL PLAIN before joining channels.
          Leave blank to connect anonymously.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Account name</label>
            <TextInput
              value={saslAccountName}
              onChange={(e) => setSaslAccountName(e.target.value)}
              placeholder={nickname || "account"}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Password</label>
            <TextInput
              type="password"
              value={saslPassword}
              onChange={(e) => setSaslPassword(e.target.value)}
              placeholder={
                serverConfig?.saslPassword
                  ? "(stored — leave blank to keep)"
                  : "Password"
              }
              className={inputClass}
            />
          </div>
        </div>
      </section>

      <section>
        <h4 className="text-discord-text-normal font-medium mb-2">
          Server password
        </h4>
        <p className="text-discord-text-muted text-xs mb-3">
          Some networks require a PASS line during connection registration
          (separate from your account password).
        </p>
        <TextInput
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={
            serverConfig?.password
              ? "(stored — leave blank to keep)"
              : "Server password"
          }
          className={inputClass}
        />
      </section>

      {server?.capabilities?.includes("draft/account-recovery") && (
        <section>
          <h4 className="text-discord-text-normal font-medium mb-2">
            Account password
          </h4>
          <p className="text-discord-text-muted text-xs mb-3">
            Server supports draft/account-recovery -- change or reset the
            password tied to your account.
          </p>
          <div className="flex flex-wrap gap-2">
            {server.isConnected && (
              <button
                type="button"
                onClick={() => setShowChangePassword(true)}
                className="px-3 py-2 rounded bg-discord-dark-400 text-discord-text-normal hover:bg-discord-dark-300 text-sm"
              >
                Change password
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowRecovery(true)}
              className="px-3 py-2 rounded bg-discord-dark-400 text-discord-text-muted hover:bg-discord-dark-300 hover:text-white text-sm"
            >
              Forgot password?
            </button>
          </div>
        </section>
      )}
    </div>
  );

  // OAuthSection's existing border-t separator harmlessly sits under the
  // tab title; no wrapper needed.
  const oauthPanel = (
    <OAuthSection
      initial={oauthConfig}
      onChange={setOauthConfig}
      locked={lockedOauth}
    />
  );

  const operatorPanel = (
    <div className="space-y-4">
      <p className="text-discord-text-muted text-xs">
        Stored credentials are sent as <code>OPER name password</code> when
        "Oper on connect" is on, or via the manual "Oper up" button below.
      </p>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass}>Oper name</label>
          <TextInput
            value={operName}
            onChange={(e) => setOperName(e.target.value)}
            placeholder={t`IRC operator username`}
            className={inputClass}
          />
        </div>
        <div className="flex-1">
          <label className={labelClass}>Oper password</label>
          <TextInput
            type="password"
            value={operPassword}
            onChange={(e) => setOperPassword(e.target.value)}
            placeholder={
              serverConfig?.operPassword
                ? "(stored — leave blank to keep)"
                : "Operator password"
            }
            className={inputClass}
          />
        </div>
      </div>
      <div className="text-xs text-discord-text-muted">
        {forgetOperCredentials ? (
          <span className="text-red-400">
            ⚠️ Existing oper credentials will be forgotten
          </span>
        ) : operName.trim() && operPassword.trim() ? (
          <span className="text-green-400">
            ✓ Both username and password will be updated
          </span>
        ) : operName.trim() ? (
          <span className="text-blue-400">
            ✓ Username will be updated, password preserved
          </span>
        ) : serverConfig?.operUsername ? (
          <span>Existing credentials will be preserved</span>
        ) : (
          <span>No oper credentials configured</span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="operOnConnect"
            checked={operOnConnect}
            onChange={() => setOperOnConnect(!operOnConnect)}
            className="accent-discord-primary rounded"
          />
          <label
            htmlFor="operOnConnect"
            className="text-discord-text-muted text-sm"
          >
            Oper on connect
          </label>
        </div>
        <div className="flex gap-2">
          {serverConfig?.operUsername && (
            <button
              type="button"
              onClick={() => setForgetOperCredentials(!forgetOperCredentials)}
              className={`px-3 py-1 text-sm rounded font-medium ${
                forgetOperCredentials
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-gray-600 text-gray-300 hover:bg-gray-500"
              }`}
            >
              {forgetOperCredentials ? "Will Forget" : "Forget Credentials"}
            </button>
          )}
          <button
            type="button"
            onClick={handleOperUp}
            disabled={!operName.trim() || !operPassword.trim()}
            className={`px-3 py-1 text-sm rounded font-medium ${
              operName.trim() && operPassword.trim()
                ? "bg-discord-primary text-white hover:bg-opacity-80"
                : "bg-gray-600 text-gray-400 cursor-not-allowed"
            }`}
          >
            Oper Up
          </button>
        </div>
      </div>
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case "general":
        return generalPanel;
      case "auth":
        return authPanel;
      case "oauth":
        return oauthPanel;
      case "operator":
        return operatorPanel;
    }
  };

  // ----- Footer (Cancel / Save) shared by both layouts -----
  const footer = (
    <div className="flex justify-end gap-3 p-4 border-t border-discord-dark-500 flex-shrink-0">
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 text-discord-text-normal hover:underline"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="edit-server-form"
        disabled={isConnecting}
        className={`px-4 py-2 bg-discord-primary text-white rounded font-medium ${
          isConnecting ? "opacity-70 cursor-not-allowed" : "hover:bg-opacity-80"
        }`}
      >
        {isConnecting ? "Updating..." : "Update server"}
      </button>
    </div>
  );

  // ----- Mobile: categories list -> content view (matches ChannelSettingsModal) -----
  if (isMobile) {
    const portalTarget = document.getElementById("root") || document.body;
    return createPortal(
      <div
        className="fixed inset-0 z-[9999] bg-discord-dark-200 flex flex-col animate-in fade-in"
        style={{
          paddingTop: "var(--safe-area-inset-top, 0px)",
          paddingBottom: "var(--safe-area-inset-bottom, 0px)",
          paddingLeft: "var(--safe-area-inset-left, 0px)",
          paddingRight: "var(--safe-area-inset-right, 0px)",
        }}
      >
        {mobileView === "categories" ? (
          <>
            <div className="flex items-center justify-between p-4 border-b border-discord-dark-500 flex-shrink-0">
              <h2 className="text-white text-lg font-semibold">Edit server</h2>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                aria-label={t`Close`}
              >
                <FaTimes />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setMobileView("content");
                    }}
                    className="w-full flex items-center gap-4 px-4 py-4 border-b border-discord-dark-400 hover:bg-discord-dark-300 text-left transition-colors"
                  >
                    <Icon className="text-discord-text-muted text-lg flex-shrink-0" />
                    <div className="min-w-0 flex-1 text-white font-medium">
                      {tab.label}
                    </div>
                    <FaChevronRight className="text-discord-text-muted flex-shrink-0" />
                  </button>
                );
              })}
            </div>
            {footer}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between p-4 border-b border-discord-dark-500 flex-shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileView("categories")}
                  className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                  aria-label={t`Back`}
                >
                  <FaChevronLeft />
                </button>
                <h2 className="text-white text-lg font-semibold">
                  {tabs.find((t) => t.id === activeTab)?.label}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                aria-label={t`Close`}
              >
                <FaTimes />
              </button>
            </div>
            <form
              id="edit-server-form"
              onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto p-4"
            >
              {renderTab()}
              {error && (
                <div className="mt-3 text-discord-red text-sm">{error}</div>
              )}
            </form>
            {footer}
          </>
        )}
      </div>,
      portalTarget,
    );
  }

  // ----- Desktop: left sidebar tabs + main content (matches ChannelSettingsModal) -----
  return createPortal(
    <div
      {...getBackdropProps()}
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
    >
      <div
        {...getContentProps()}
        className="bg-discord-dark-200 rounded-lg w-full max-w-3xl h-[80vh] flex overflow-hidden"
      >
        {/* Sidebar */}
        <div className="bg-discord-dark-300 w-56 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-discord-dark-500 flex justify-center">
            <h2 className="text-white text-lg font-bold">Edit server</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            <nav className="p-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center w-full px-3 text-left py-2 mb-1 rounded transition-colors ${
                      activeTab === tab.id
                        ? "bg-discord-primary text-white"
                        : "text-discord-text-muted hover:text-white hover:bg-discord-dark-400"
                    }`}
                  >
                    <Icon className="mr-3 text-sm" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex justify-between items-center p-4 border-b border-discord-dark-500 flex-shrink-0">
            <h3 className="text-white text-lg font-semibold">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-discord-text-muted hover:text-white"
              aria-label={t`Close`}
            >
              <FaTimes />
            </button>
          </div>
          <form
            id="edit-server-form"
            onSubmit={handleSubmit}
            className="flex-1 overflow-y-auto p-4"
          >
            {renderTab()}
            {error && (
              <div className="mt-3 text-discord-red text-sm">{error}</div>
            )}
          </form>
          {footer}
        </div>
      </div>
      {showRecovery && (
        <PasswordRecoveryModal
          serverId={serverId}
          initialAccount={saslAccountName || nickname}
          onClose={() => setShowRecovery(false)}
        />
      )}
      {showChangePassword && (
        <ChangePasswordModal
          serverId={serverId}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </div>,
    document.body,
  );
};

export default EditServerModal;
