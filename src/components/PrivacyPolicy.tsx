import { t } from "@lingui/core/macro";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Privacy Policy - ObsidianIRC";
  }, []);

  return (
    <div className="h-screen bg-discord-dark-200 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 bg-discord-primary rounded-lg flex items-center justify-center">
              <img
                src="/images/obsidian.png"
                alt={t`ObsidianIRC`}
                className="w-full h-full rounded-lg"
              />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-discord-channels-active">
                ObsidianIRC
              </h1>
              <p className="text-discord-text-muted text-lg">Privacy Policy</p>
            </div>
          </div>
          <p className="text-discord-text-muted text-sm">
            Last updated: December 4, 2025
          </p>
        </header>

        {/* Main Content */}
        <main className="space-y-6 pb-8">
          {/* Overview */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </span>
              Overview
            </h2>
            <div className="space-y-4 text-discord-text-normal leading-relaxed">
              <p>
                ObsidianIRC is a modern IRC client that connects you to Internet
                Relay Chat (IRC) servers of your choice. We are committed to
                protecting your privacy and being transparent about how we
                handle your data.
              </p>
              <p>
                This privacy policy explains what data we collect, how we use
                it, and your rights regarding your information.
              </p>
            </div>
          </section>

          {/* Data We Collect */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                  />
                </svg>
              </span>
              Data We Collect
            </h2>

            <div className="grid gap-4">
              <div className="bg-discord-dark-200 rounded-lg p-4 border border-discord-dark-500/20">
                <h3 className="text-base font-medium text-discord-text-normal mb-2">
                  IRC Server Information
                </h3>
                <p className="text-discord-text-muted text-sm leading-relaxed">
                  When you connect to IRC servers, we store server addresses and
                  connection details locally on your device to enable quick
                  reconnection. This data never leaves your device.
                </p>
              </div>

              <div className="bg-discord-dark-200 rounded-lg p-4 border border-discord-dark-500/20">
                <h3 className="text-base font-medium text-discord-text-normal mb-2">
                  Local Message History
                </h3>
                <p className="text-discord-text-muted text-sm leading-relaxed">
                  Your IRC messages and chat history are stored locally on your
                  device for your convenience. We do not access, store, or
                  transmit your message content to any central server.
                </p>
              </div>

              <div className="bg-discord-dark-200 rounded-lg p-4 border border-discord-dark-500/20">
                <h3 className="text-base font-medium text-discord-text-normal mb-2">
                  App Settings
                </h3>
                <p className="text-discord-text-muted text-sm leading-relaxed">
                  Your preferences, themes, and app settings are stored locally
                  on your device to personalize your experience.
                </p>
              </div>

              <div className="bg-discord-dark-200 rounded-lg p-4 border border-discord-dark-500/20">
                <h3 className="text-base font-medium text-discord-text-normal mb-2">
                  Technical Data
                </h3>
                <p className="text-discord-text-muted text-sm leading-relaxed">
                  We may collect anonymous technical data about app performance
                  and crashes to improve the app. This data is aggregated and
                  cannot be linked to you personally.
                </p>
              </div>
            </div>
          </section>

          {/* Data We Don't Collect */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-green/20 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-green"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </span>
              Data We Don't Collect
            </h2>
            <ul className="space-y-3">
              <li className="flex items-start gap-3 text-discord-text-normal">
                <svg
                  className="w-5 h-5 text-discord-green mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>
                  No personal information collection beyond what you provide for
                  IRC connections
                </span>
              </li>
              <li className="flex items-start gap-3 text-discord-text-normal">
                <svg
                  className="w-5 h-5 text-discord-green mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>No location data, contacts, or SMS access</span>
              </li>
              <li className="flex items-start gap-3 text-discord-text-normal">
                <svg
                  className="w-5 h-5 text-discord-green mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>No advertising tracking or analytics for marketing</span>
              </li>
              <li className="flex items-start gap-3 text-discord-text-normal">
                <svg
                  className="w-5 h-5 text-discord-green mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>No central server storing your IRC communications</span>
              </li>
            </ul>
          </section>

          {/* How We Use Data */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </span>
              How We Use Your Data
            </h2>
            <div className="space-y-3 text-discord-text-normal">
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">
                    IRC Connectivity:
                  </strong>{" "}
                  Connect to IRC servers you specify and transmit your messages
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">
                    Local Storage:
                  </strong>{" "}
                  Store your settings and message history on your device
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">
                    App Improvement:
                  </strong>{" "}
                  Analyze anonymous crash reports and performance data
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">
                    User Experience:
                  </strong>{" "}
                  Remember your preferences and connection details
                </span>
              </p>
            </div>
          </section>

          {/* Data Sharing */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                  />
                </svg>
              </span>
              Data Sharing
            </h2>
            <div className="space-y-4 text-discord-text-normal leading-relaxed">
              <p>
                We do not sell, rent, or share your personal data with third
                parties for marketing purposes. Your IRC communications are
                transmitted only to IRC servers you choose to connect to.
              </p>
              <p>
                Each IRC server has its own privacy policy. We are not
                responsible for how IRC servers handle your data once
                transmitted to them.
              </p>
            </div>
          </section>

          {/* Data Security */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </span>
              Data Security
            </h2>
            <div className="space-y-3 text-discord-text-normal">
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">
                    Local Encryption:
                  </strong>{" "}
                  Your locally stored data is protected by device security
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">
                    Secure Connections:
                  </strong>{" "}
                  We support TLS/SSL encryption for IRC connections
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">
                    No Central Storage:
                  </strong>{" "}
                  Your messages aren't stored on our servers
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">
                    Regular Updates:
                  </strong>{" "}
                  We maintain security through regular app updates
                </span>
              </p>
            </div>
          </section>

          {/* Your Rights */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </span>
              Your Rights
            </h2>
            <div className="space-y-3 text-discord-text-normal">
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">Access:</strong>{" "}
                  You can access all your data within the app
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">Export:</strong>{" "}
                  Export your message history and settings
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">Delete:</strong>{" "}
                  Remove your data at any time through the app
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-discord-primary">•</span>
                <span>
                  <strong className="text-discord-text-normal">Opt-out:</strong>{" "}
                  Disable crash reporting in app settings
                </span>
              </p>
            </div>
          </section>

          {/* Children's Privacy */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              </span>
              Children's Privacy
            </h2>
            <p className="text-discord-text-normal leading-relaxed">
              ObsidianIRC is not directed to children under 13. We do not
              knowingly collect personal information from children under 13. If
              we become aware that we have collected such information, we will
              delete it promptly.
            </p>
          </section>

          {/* International Users */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </span>
              International Users
            </h2>
            <p className="text-discord-text-normal leading-relaxed">
              Since we don't collect personal data or use central servers,
              international data transfers are minimal. Any technical data we
              collect is processed in accordance with applicable privacy laws.
            </p>
          </section>

          {/* Changes */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </span>
              Changes to This Policy
            </h2>
            <p className="text-discord-text-normal leading-relaxed">
              We may update this privacy policy from time to time. Significant
              changes will be communicated through the app or by updating the
              "Last updated" date above.
            </p>
          </section>

          {/* Contact */}
          <section className="bg-discord-dark-100 rounded-xl p-6 border border-discord-dark-500/30">
            <h2 className="text-xl font-semibold text-discord-channels-active mb-4 flex items-center gap-3">
              <span className="w-8 h-8 bg-discord-dark-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-discord-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </span>
              Contact Us
            </h2>
            <div className="space-y-3 text-discord-text-normal">
              <p>
                If you have questions about this privacy policy or how we handle
                your data, please contact us:
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="mailto:support@obby.world"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-discord-dark-200 text-discord-text-normal rounded-lg hover:bg-discord-dark-300 transition-colors border border-discord-dark-500/30"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  support@obby.world
                </a>
                <a
                  href="https://github.com/obbyworld/obby"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-discord-dark-200 text-discord-text-normal rounded-lg hover:bg-discord-dark-300 transition-colors border border-discord-dark-500/30"
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  GitHub
                </a>
              </div>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="mt-8 pt-8 border-t border-discord-dark-500/30">
          <div className="text-center">
            <p className="text-discord-text-muted text-sm mb-4">
              &copy; 2025 ObsidianIRC. Open source IRC client.
            </p>
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-discord-primary text-white rounded-lg hover:bg-discord-primary/80 transition-all"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back to App
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
