import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import { getBuiltinOAuthConfig } from "../../lib/oauth";
import { isTauri } from "../../lib/platformUtils";
import useStore from "../../store";
import type { ServerOAuthConfig } from "../../types";
import { OAuthSection } from "./OAuthSection";
import { TextInput } from "./TextInput";

export const AddServerModal: React.FC = () => {
  const { t } = useLingui();
  const {
    toggleAddServerModal,
    connect,
    isConnecting,
    connectionError,
    ui: { prefillServerDetails, isAddServerModalOpen },
  } = useStore();

  const [serverName, setServerName] = useState(
    prefillServerDetails?.name || "",
  );
  const [serverHost, setServerHost] = useState(
    prefillServerDetails?.host || "",
  );
  const [serverPort, setServerPort] = useState(
    prefillServerDetails?.port || (isTauri() ? "6697" : "443"),
  );
  const [nickname, setNickname] = useState(
    prefillServerDetails?.nickname || `user${Math.floor(Math.random() * 1000)}`,
  );
  const [password, setPassword] = useState("");
  const [saslAccountName, setSaslAccountName] = useState("");
  const [saslPassword, setSaslPassword] = useState("");
  const [saslEnabled, setSaslEnabled] = useState("");
  const [showServerPassword, setShowServerPassword] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [registerAccount, setRegisterAccount] = useState(false);
  const [useWebSocket, setUseWebSocket] = useState(
    prefillServerDetails?.useWebSocket ?? false,
  );
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [oauthConfig, setOauthConfig] = useState<ServerOAuthConfig | undefined>(
    undefined,
  );

  const [error, setError] = useState("");

  // In single-server lock-mode, surface the deployer-baked OAuth config so
  // the welcome screen exposes a "Sign in with X" CTA instead of the full
  // editable provider form.
  const lockedOauth = __HIDE_SERVER_LIST__
    ? getBuiltinOAuthConfig()
    : undefined;

  useEffect(() => {
    setServerName(prefillServerDetails?.name || "");
    setServerHost(prefillServerDetails?.host || "");
    setServerPort(prefillServerDetails?.port || (isTauri() ? "6697" : "443"));
    setNickname(
      prefillServerDetails?.nickname ||
        `user${Math.floor(Math.random() * 1000)}`,
    );
    setUseWebSocket(prefillServerDetails?.useWebSocket || false);
  }, [prefillServerDetails]);

  useEffect(() => {
    if (!isTauri()) return;

    const currentPort = serverPort;
    const ircPorts = ["6667", "6697"];
    const wssPorts = ["443"];

    if (useWebSocket && ircPorts.includes(currentPort)) {
      setServerPort("443");
    } else if (!useWebSocket && wssPorts.includes(currentPort)) {
      setServerPort("6697");
    }
  }, [useWebSocket, serverPort]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const finalServerName = serverName.trim() || serverHost.trim();
    const finalSaslAccountName = saslAccountName.trim() || nickname.trim();

    if (!finalServerName) {
      setError(t`Server name is required`);
      return;
    }

    if (!serverHost.trim()) {
      setError(t`Server host is required`);
      return;
    }

    if (!serverPort.trim() || Number.isNaN(Number.parseInt(serverPort, 10))) {
      setError(t`Valid server port is required`);
      return;
    }

    if (!nickname.trim()) {
      setError(t`Nickname is required`);
      return;
    }

    try {
      let finalHost = serverHost;
      if (isTauri()) {
        const port = Number.parseInt(serverPort, 10);
        const cleanHost = serverHost
          .replace(/^(https?|wss?|ircs?):\/\//, "")
          .replace(/:\d+$/, "");
        finalHost = useWebSocket
          ? `wss://${cleanHost}:${port}`
          : `ircs://${cleanHost}:${port}`;
      }

      await connect(
        finalServerName,
        finalHost,
        Number.parseInt(serverPort, 10),
        nickname,
        !!saslPassword,
        password,
        finalSaslAccountName,
        saslPassword,
        registerAccount,
        registerEmail,
        registerPassword,
        true,
        oauthConfig,
      );
      toggleAddServerModal(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMessage);
    }
  };

  const disableServerConnectionInfo =
    prefillServerDetails?.ui?.disableServerConnectionInfo;
  const hideServerInfo = prefillServerDetails?.ui?.hideServerInfo;
  const lockWebSocket = prefillServerDetails?.ui?.lockWebSocket;

  return (
    <BaseModal
      isOpen={!!isAddServerModalOpen}
      onClose={() => toggleAddServerModal(false)}
      title={prefillServerDetails?.ui?.title || t`Add IRC Server`}
      maxWidth="md"
      showCloseButton={!prefillServerDetails?.ui?.hideClose}
      closeOnEsc={!prefillServerDetails?.ui?.hideClose}
      closeOnClickOutside={!prefillServerDetails?.ui?.hideClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ModalBody scrollable>
          {!hideServerInfo && (
            <>
              <div className="mb-4">
                <label className="block text-discord-text-muted text-sm font-medium mb-1">
                  <Trans>Network Name</Trans>
                </label>
                <TextInput
                  value={serverName || serverHost || ""}
                  onChange={(e) => setServerName(e.target.value)}
                  placeholder={t`ExampleNET`}
                  className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
                />
              </div>

              <div className="mb-4">
                <label className="block text-discord-text-muted text-sm font-medium mb-1">
                  <Trans>Server Host</Trans>
                </label>
                <TextInput
                  inputMode="url"
                  value={
                    disableServerConnectionInfo && serverHost.includes("://")
                      ? new URL(serverHost).hostname
                      : serverHost || ""
                  }
                  onChange={(e) => setServerHost(e.target.value)}
                  placeholder="irc.example.com"
                  className={`w-full rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary ${
                    disableServerConnectionInfo
                      ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                      : "bg-discord-dark-400 text-discord-text-normal"
                  }`}
                  disabled={disableServerConnectionInfo}
                />
              </div>

              <div className="mb-4 flex items-end gap-4">
                <div className="w-24 sm:w-28">
                  <label className="block text-discord-text-muted text-sm font-medium mb-1">
                    <Trans>Port</Trans>{" "}
                    <FaQuestionCircle
                      title={t`Only secure websockets are supported`}
                      className="inline-block text-discord-text-muted cursor-help text-xs ml-1"
                    />
                  </label>
                  <TextInput
                    inputMode="numeric"
                    value={serverPort}
                    onChange={(e) => setServerPort(e.target.value)}
                    placeholder="443"
                    className={`w-full rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary ${
                      disableServerConnectionInfo
                        ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                        : "bg-discord-dark-400 text-discord-text-normal"
                    }`}
                    disabled={disableServerConnectionInfo || undefined}
                  />
                </div>

                {isTauri() && (
                  <div className="flex items-center pb-2">
                    <input
                      type="checkbox"
                      id="useWebSocket"
                      checked={useWebSocket}
                      onChange={() =>
                        !lockWebSocket && setUseWebSocket(!useWebSocket)
                      }
                      disabled={!!lockWebSocket}
                      className={`accent-discord-accent rounded ${lockWebSocket ? "opacity-50 cursor-not-allowed" : ""}`}
                    />
                    <label
                      htmlFor="useWebSocket"
                      className={`text-discord-text-muted text-sm flex items-center ml-2 ${lockWebSocket ? "opacity-50" : ""}`}
                    >
                      WSS{" "}
                      <FaQuestionCircle
                        title={
                          lockWebSocket
                            ? t`This server only supports one connection type`
                            : t`Use WebSocket instead of raw TCP`
                        }
                        className="inline-block text-discord-text-muted cursor-help text-xs ml-1"
                      />
                    </label>
                  </div>
                )}
              </div>
            </>
          )}

          {lockedOauth && (
            <OAuthSection
              initial={oauthConfig}
              onChange={setOauthConfig}
              locked={lockedOauth}
            />
          )}

          <div className="mb-4">
            <label className="block text-discord-text-muted text-sm font-medium mb-1">
              <Trans>Nickname</Trans>
            </label>
            <TextInput
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t`YourNickname`}
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
            />
          </div>

          <div className="space-y-3">
            {/* Login to an account */}
            <div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="showAccount"
                  checked={showAccount}
                  onChange={() => setShowAccount(!showAccount)}
                  className="accent-discord-accent rounded"
                />
                <label
                  htmlFor="showAccount"
                  className="text-discord-text-muted text-sm"
                >
                  <Trans>Login to an account</Trans>
                </label>
              </div>
              {showAccount && (
                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                  <TextInput
                    value={saslAccountName || nickname}
                    onChange={(e) => setSaslAccountName(e.target.value)}
                    placeholder={t`Account Name`}
                    className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
                  />
                  <TextInput
                    type="password"
                    value={atob(saslPassword)}
                    onChange={(e) => setSaslPassword(btoa(e.target.value))}
                    placeholder={t`Password`}
                    className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
                  />
                </div>
              )}
            </div>

            {/* Server password */}
            <div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="showServerPassword"
                  checked={showServerPassword}
                  onChange={() => setShowServerPassword(!showServerPassword)}
                  className="accent-discord-accent rounded"
                />
                <label
                  htmlFor="showServerPassword"
                  className="text-discord-text-muted text-sm"
                >
                  <Trans>Use server password</Trans>
                </label>
              </div>
              {showServerPassword && (
                <div className="mt-2">
                  <TextInput
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t`Server Password`}
                    className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
                  />
                </div>
              )}
            </div>

            {/* Register for an account */}
            <div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="registerAccount"
                  checked={registerAccount}
                  onChange={() => setRegisterAccount(!registerAccount)}
                  className="accent-discord-accent rounded"
                />
                <label
                  htmlFor="registerAccount"
                  className="text-discord-text-muted text-sm"
                >
                  <Trans>Register for an account</Trans>
                </label>
              </div>
              {registerAccount && (
                <div className="mt-2 space-y-2">
                  <TextInput
                    type="email"
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    placeholder={t`your@email.com`}
                    className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
                  />
                  <TextInput
                    type="password"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    placeholder={t`Choose a secure password`}
                    className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-discord-primary"
                  />
                </div>
              )}
            </div>
          </div>

          {(error || connectionError) && (
            <div className="mt-3 text-discord-red text-sm">
              {error || connectionError}
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          {!prefillServerDetails?.ui?.hideClose && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => toggleAddServerModal(false)}
            >
              <Trans>Cancel</Trans>
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={isConnecting}>
            {isConnecting ? (
              <Trans>Connecting...</Trans>
            ) : (
              <Trans>Connect</Trans>
            )}
          </Button>
        </ModalFooter>
      </form>
    </BaseModal>
  );
};

export default AddServerModal;
