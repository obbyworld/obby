import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  FaArrowDown,
  FaExclamationTriangle,
  FaShieldAlt,
  FaSpinner,
} from "react-icons/fa";
import ircClient from "../../lib/ircClient";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore, {
  loadSavedServers,
  saveServersToLocalStorage,
} from "../../store";

interface WarningModalProps {
  serverId: string;
  timestamp: number;
}

const playErrorSound = () => {
  const audio = new Audio("/sounds/error.mp3");
  audio.volume = 0.3;
  audio.play().catch(() => {});
};

const SingleWarningModal: React.FC<WarningModalProps> = ({ serverId }) => {
  const { t } = useLingui();
  const [timerExpired, setTimerExpired] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(false);
  const [hasScrollbar, setHasScrollbar] = useState(false);
  const [skipLinkSecurityWarning, setSkipLinkSecurityWarning] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timerStartedRef = useRef(false);

  // Scroll detection and scrollbar check
  useEffect(() => {
    const checkScroll = () => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const hasScroll = container.scrollHeight > container.clientHeight;
      const isAtBottom =
        Math.abs(
          container.scrollHeight - container.scrollTop - container.clientHeight,
        ) < 5;

      setHasScrollbar(hasScroll);
      setIsScrolledToBottom(isAtBottom);

      // Start timer only when scrolled to bottom (or no scrollbar)
      if (!timerStartedRef.current && (!hasScroll || isAtBottom)) {
        timerStartedRef.current = true;
        setTimeout(() => {
          setTimerExpired(true);
        }, 2000);
      }
    };

    const container = scrollContainerRef.current;
    if (container) {
      checkScroll();
      container.addEventListener("scroll", checkScroll);
      const resizeObserver = new ResizeObserver(checkScroll);
      resizeObserver.observe(container);

      return () => {
        container.removeEventListener("scroll", checkScroll);
        resizeObserver.disconnect();
      };
    }
  }, []);

  const server = useStore.getState().servers.find((s) => s.id === serverId);
  const savedServers = loadSavedServers();
  const serverConfig = savedServers.find((s) => s.id === serverId);

  if (!server) return null;

  const serverName =
    server.name || serverConfig?.name || server.host || t`Unknown Server`;
  const securityLevel = server.linkSecurity || 0;
  const isLinkSecurityWarning =
    server.linkSecurity !== undefined && server.linkSecurity < 2;

  const removeWarning = () => {
    useStore.setState((state) => ({
      ui: {
        ...state.ui,
        linkSecurityWarnings: state.ui.linkSecurityWarnings.filter(
          (w) => w.serverId !== serverId,
        ),
      },
    }));
  };

  const buttonsEnabled = timerExpired && isScrolledToBottom;

  const handleContinue = () => {
    if (!buttonsEnabled) return;

    const currentSavedServers = loadSavedServers();
    const updatedServers = currentSavedServers.map((s) => {
      if (s.id === serverId) {
        return {
          ...s,
          ...(skipLinkSecurityWarning &&
            isLinkSecurityWarning && { skipLinkSecurityWarning: true }),
        };
      }
      return s;
    });
    saveServersToLocalStorage(updatedServers);

    removeWarning();

    // Resume connection by sending CAP END (guarded one-shot so it
    // doesn't race with the parallel CAP ACK / SASL completion
    // handlers).
    if (!ircClient.capNegotiationComplete.get(serverId)) {
      ircClient.sendCapEnd(serverId);
      ircClient.capNegotiationComplete.set(serverId, true);
      ircClient.userOnConnect(serverId);
    }
  };

  const handleCancel = () => {
    const state = useStore.getState();
    state.disconnect(serverId);

    const savedServers = loadSavedServers();
    const updatedServers = savedServers.filter((s) => s.id !== serverId);
    saveServersToLocalStorage(updatedServers);

    useStore.setState((state) => ({
      servers: state.servers.filter((server) => server.id !== serverId),
    }));

    removeWarning();
  };

  const handleScrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const showScrollButton = hasScrollbar && !isScrolledToBottom;

  return (
    <BaseModal
      isOpen
      onClose={playErrorSound}
      showCloseButton={false}
      maxWidth="md"
      title={
        <span className="flex items-center gap-3">
          <FaExclamationTriangle className="text-yellow-500 text-xl flex-shrink-0" />
          <Trans>Security Warning</Trans>
        </span>
      }
    >
      <div className="relative flex-1 min-h-0 flex flex-col">
        <ModalBody
          ref={scrollContainerRef}
          scrollable
          className="gap-4 max-h-[60vh]"
        >
          <p className="text-discord-text-normal">
            <Trans>
              The connection to <strong>{serverName}</strong> has the following
              security concerns:
            </Trans>
          </p>

          <div className="space-y-3">
            {isLinkSecurityWarning && (
              <div className="bg-orange-500 bg-opacity-10 border border-orange-500 border-opacity-30 rounded p-3">
                <div className="flex items-start gap-2">
                  <FaShieldAlt className="text-orange-500 text-sm mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-orange-200">
                      <Trans>Low Link Security (Level {securityLevel})</Trans>
                    </p>
                    <p className="text-xs text-orange-100">
                      <Trans>
                        The IRC server has reported that its server-to-server
                        links have a low security level. This means that when
                        your messages are relayed between IRC servers in the
                        network, they may not be properly encrypted or the
                        SSL/TLS certificates may not be validated correctly.
                      </Trans>
                    </p>
                    <p className="text-xs text-orange-100">
                      <strong>
                        <Trans>What this means:</Trans>
                      </strong>
                    </p>
                    <ul className="text-xs text-orange-100 list-disc list-inside pl-2 space-y-0.5">
                      <li>
                        <Trans>
                          Server-to-server communication may use unencrypted
                          connections
                        </Trans>
                      </li>
                      <li>
                        <Trans>
                          Server operators on the network could potentially read
                          your messages
                        </Trans>
                      </li>
                      <li>
                        <Trans>
                          Man-in-the-middle attacks on server links are possible
                        </Trans>
                      </li>
                      <li>
                        <Trans>
                          Your messages could be intercepted when relayed
                          between servers
                        </Trans>
                      </li>
                    </ul>
                    <p className="text-xs text-orange-100">
                      <Trans>
                        <strong>Risk:</strong> Sensitive information (messages,
                        private conversations, authentication details) could be
                        exposed to network administrators or attackers
                        positioned between IRC servers.
                      </Trans>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!isLinkSecurityWarning && (
              <div className="bg-yellow-500 bg-opacity-10 border border-yellow-500 border-opacity-30 rounded p-3">
                <p className="text-sm text-yellow-200">
                  <Trans>
                    <strong>Security Risk!</strong> This connection may be
                    vulnerable to interception or man-in-the-middle attacks.
                  </Trans>
                </p>
              </div>
            )}
          </div>

          {isLinkSecurityWarning && (
            <div className="bg-blue-500 bg-opacity-10 border border-blue-500 border-opacity-30 rounded p-3">
              <p className="text-xs text-blue-200">
                <Trans>
                  <strong>Recommendation:</strong> Only proceed if you trust
                  this server and understand the risks. Avoid sharing sensitive
                  information or passwords over this connection.
                </Trans>
              </p>
            </div>
          )}

          {isLinkSecurityWarning && (
            <label className="flex items-center gap-2 text-sm text-discord-text-muted cursor-pointer hover:text-discord-text-normal">
              <input
                type="checkbox"
                checked={skipLinkSecurityWarning}
                onChange={(e) => setSkipLinkSecurityWarning(e.target.checked)}
                className="rounded border-discord-dark-200"
              />
              <span>
                <Trans>
                  Don't warn me about low link security for this server
                </Trans>
              </span>
            </label>
          )}
        </ModalBody>

        {showScrollButton && (
          <button
            type="button"
            onClick={handleScrollToBottom}
            className="absolute bottom-4 right-4 bg-discord-primary hover:bg-opacity-80 text-white p-3 rounded-full shadow-lg transition-all transform hover:scale-110 z-10"
            aria-label={t`Scroll to bottom`}
          >
            <FaArrowDown className="text-lg" />
          </button>
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={handleCancel}>
          <Trans>Cancel Connection</Trans>
        </Button>
        <Button
          variant="primary"
          onClick={handleContinue}
          disabled={!buttonsEnabled}
          className="flex items-center gap-2"
        >
          {!timerExpired ? (
            <>
              <FaSpinner className="text-sm animate-spin" />
              <Trans>Please wait...</Trans>
            </>
          ) : (
            <>
              <FaShieldAlt className="text-sm" />
              <Trans>Continue Anyway</Trans>
            </>
          )}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};

// Main component that renders all active warnings
const LinkSecurityWarningModal: React.FC = () => {
  const { linkSecurityWarnings } = useStore((state) => state.ui);

  return (
    <>
      {linkSecurityWarnings.map((warning) => (
        <SingleWarningModal
          key={`${warning.serverId}-${warning.timestamp}`}
          serverId={warning.serverId}
          timestamp={warning.timestamp}
        />
      ))}
    </>
  );
};

export default LinkSecurityWarningModal;
