import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import ircClient from "../../lib/ircClient";
import { openExternalUrl } from "../../lib/openUrl";
import { isTauri } from "../../lib/platformUtils";
import { settingsRegistry } from "../../lib/settings";
import type { SettingDefinition, SettingValue } from "../../lib/settings/types";
import useStore, {
  type GlobalSettings,
  loadSavedServers,
  serverSupportsMetadata,
} from "../../store";
import type { SettingsSection } from "../../store/types";
import AvatarUpload from "../ui/AvatarUpload";
import InvitationsPanel from "../ui/InvitationsPanel";
import PersistenceSettingsPanel from "../ui/PersistenceSettingsPanel";
import { ProfileBanner } from "../ui/ProfileBanner";
import { PageShell } from "../ui/page/PageShell";
import { SettingGroup, SettingRow, Switch } from "../ui/page/SettingRow";
import { SettingField, TextDraftInput } from "../ui/settings/SettingRenderer";
import { TextInput } from "../ui/TextInput";
import type { PageProps } from "./PageHost";
import { getSettingsSections } from "./pageSections";

const METADATA_KEYS: Record<string, string> = {
  "profile.displayName": "display-name",
  "profile.avatar": "avatar",
  "profile.homepage": "homepage",
  "profile.status": "status",
  "profile.color": "color",
  "profile.bot": "bot",
  "profile.pronouns": "pronouns",
};

// These rows save with the Save profile button, since NICK, SETNAME and METADATA go to the server.
const DRAFT_PROFILE_IDS = [
  "profile.nickname",
  "profile.realname",
  ...Object.keys(METADATA_KEYS),
];

const LOCALES: Array<[string, string]> = [
  ["en", "English"],
  ["es", "Español"],
  ["fr", "Français"],
  ["zh", "中文 (简体)"],
  ["zh-TW", "中文 (繁體)"],
  ["pt", "Português"],
  ["de", "Deutsch"],
  ["it", "Italiano"],
  ["ro", "Română"],
  ["ru", "Русский"],
  ["fi", "Suomi"],
  ["ja", "日本語"],
  ["pl", "Polski"],
  ["nl", "Nederlands"],
  ["ko", "한국어"],
  ["tr", "Türkçe"],
  ["uk", "Українська"],
  ["sv", "Svenska"],
  ["cs", "Čeština"],
];

const changeLocale = (next: string) => {
  localStorage.setItem("locale", next);
  const url = new URL(window.location.href);
  if (url.searchParams.has("lang")) {
    url.searchParams.set("lang", next);
    window.location.href = url.toString();
  } else {
    window.location.reload();
  }
};

const subcategoryLabel = (name: string): string => {
  const labels: Record<string, string> = {
    Identity: t`Identity`,
    Appearance: t`Appearance`,
    Social: t`Social`,
    "Status Messages": t`Status Messages`,
    Audio: t`Audio`,
    Mentions: t`Mentions`,
    Chat: t`Chat`,
    Events: t`Events`,
    Input: t`Input`,
    Privacy: t`Privacy`,
    History: t`History`,
    Devices: t`Devices`,
    "Audio Processing": t`Audio Processing`,
  };
  return labels[name] ?? name;
};

const groupBySubcategory = (
  settings: SettingDefinition[],
): Array<[string | undefined, SettingDefinition[]]> => {
  const groups = new Map<string | undefined, SettingDefinition[]>();
  for (const setting of settings) {
    groups.set(setting.subcategory, [
      ...(groups.get(setting.subcategory) ?? []),
      setting,
    ]);
  }
  return [...groups];
};

const PROFILE_SAVE_DELAY_MS = 600;

const SettingsPage: React.FC<PageProps<"settings">> = ({ page }) => {
  const {
    servers,
    ui,
    sendRaw,
    setName,
    changeNick,
    updateServer,
    globalSettings,
    updateGlobalSettings,
    openPage,
    openProfile,
  } = useStore();

  const [activeSection, setActiveSection] = useState<SettingsSection>(
    page.section ?? "profile",
  );
  useEffect(() => {
    setActiveSection(page.section ?? "profile");
  }, [page.section]);

  const { i18n } = useLingui();
  const [profileDraft, setProfileDraft] = useState<Record<string, string>>({});
  // Profile fields go to the server, so we send them shortly after the last
  // change and once more when the page closes with one still pending.
  const profileSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (!profileSaveTimer.current) return;
      clearTimeout(profileSaveTimer.current);
      saveProfileRef.current();
    },
    [],
  );

  const currentServer = servers.find((s) => s.id === ui.selectedServerId);
  const serverConfig = loadSavedServers().find(
    (s) => s.id === ui.selectedServerId,
  );
  const [operName, setOperName] = useState(serverConfig?.operUsername ?? "");
  const [operPassword, setOperPassword] = useState("");
  const [operOnConnect, setOperOnConnect] = useState(
    serverConfig?.operOnConnect ?? false,
  );

  const ircCurrentUser = currentServer
    ? ircClient.getCurrentUser(currentServer.id)
    : null;
  const currentUser =
    currentServer && ircCurrentUser
      ? (currentServer.channels
          .flatMap((channel) => channel.users)
          .find((u) => u.username === ircCurrentUser.username) ??
        ircCurrentUser)
      : null;
  const supportsMetadata = currentServer
    ? serverSupportsMetadata(currentServer.id)
    : false;

  const globalValues: Record<string, SettingValue | undefined> = {
    ...globalSettings,
  };
  const globalValue = (setting: SettingDefinition): SettingValue =>
    globalValues[setting.key] ?? setting.defaultValue;
  const setGlobal = (key: string, value: SettingValue) =>
    updateGlobalSettings({ [key]: value } as Partial<GlobalSettings>);

  const current: Record<string, string> = {
    "profile.nickname": currentUser?.username ?? "",
    "profile.realname": currentUser?.realname ?? "",
  };
  for (const [id, key] of Object.entries(METADATA_KEYS)) {
    current[id] = currentUser?.metadata?.[key]?.value ?? "";
  }
  const profileValue = (id: string) => profileDraft[id] ?? current[id] ?? "";
  const setProfileField = (id: string, value: SettingValue) => {
    setProfileDraft((draft) => ({ ...draft, [id]: String(value) }));
    if (profileSaveTimer.current) clearTimeout(profileSaveTimer.current);
    profileSaveTimer.current = setTimeout(() => {
      profileSaveTimer.current = null;
      saveProfileRef.current();
    }, PROFILE_SAVE_DELAY_MS);
  };

  const saveProfile = () => {
    if (!currentServer) return;
    const nickname = profileValue("profile.nickname");
    if (nickname && nickname !== current["profile.nickname"]) {
      changeNick(currentServer.id, nickname);
    }
    const realname = profileValue("profile.realname");
    if (realname && realname !== current["profile.realname"]) {
      setName(currentServer.id, realname);
    }
    if (!supportsMetadata) return;
    for (const [id, key] of Object.entries(METADATA_KEYS)) {
      const value = profileValue(id);
      if (value === current[id]) continue;
      // We send a bare SET for an empty value, since IRCv3 uses that form to delete the key.
      sendRaw(
        currentServer.id,
        value ? `METADATA * SET ${key} :${value}` : `METADATA * SET ${key}`,
      );
    }
  };

  const saveProfileRef = useRef(saveProfile);
  saveProfileRef.current = saveProfile;

  const handleOperUp = () => {
    if (operName.trim() && operPassword.trim() && currentServer) {
      sendRaw(
        currentServer.id,
        `OPER ${operName.trim()} ${operPassword.trim()}`,
      );
    }
  };

  const sections = getSettingsSections();

  const renderRegistryGroups = (settings: SettingDefinition[]) =>
    groupBySubcategory(settings).map(([subcategory, group]) => (
      <SettingGroup
        key={subcategory ?? ""}
        title={subcategory && subcategoryLabel(subcategory)}
      >
        {group.map((setting) => (
          <SettingField
            key={setting.id}
            setting={setting}
            value={globalValue(setting)}
            onChange={(value) => setGlobal(setting.key, value)}
            disabled={setting.dependencies?.some(({ settingId, condition }) => {
              const dependency = settingsRegistry.get(settingId);
              return dependency && !condition(globalValue(dependency));
            })}
          />
        ))}
      </SettingGroup>
    ));

  const renderProfile = () => {
    const profileSettings = settingsRegistry
      .getByCategory("profile")
      .filter((setting) => supportsMetadata || !(setting.id in METADATA_KEYS));
    return (
      <>
        {currentServer && currentUser && (
          <ProfileBanner
            serverId={currentServer.id}
            nickname={profileValue("profile.nickname")}
            displayName={profileValue("profile.displayName")}
            avatarUrl={profileValue("profile.avatar")}
            color={profileValue("profile.color")}
            status={profileValue("profile.status")}
            actions={
              <button
                type="button"
                onClick={() =>
                  openProfile(currentServer.id, currentUser.username)
                }
                className="h-9 px-3 rounded-lg bg-discord-dark-400 hover:bg-discord-dark-300 text-sm text-discord-text-normal"
              >
                <Trans>View profile</Trans>
              </button>
            }
          />
        )}
        {groupBySubcategory(profileSettings).map(([subcategory, group]) => (
          <SettingGroup
            key={subcategory ?? ""}
            title={subcategory && subcategoryLabel(subcategory)}
          >
            {group.map((setting) =>
              DRAFT_PROFILE_IDS.includes(setting.id) ? (
                <SettingField
                  key={setting.id}
                  setting={setting}
                  value={profileValue(setting.id)}
                  onChange={(value) => setProfileField(setting.id, value)}
                >
                  {setting.id === "profile.avatar" && currentServer && (
                    <AvatarUpload
                      currentAvatarUrl={profileValue(setting.id)}
                      onAvatarUrlChange={(url) =>
                        setProfileField(setting.id, url)
                      }
                      serverId={currentServer.id}
                    />
                  )}
                </SettingField>
              ) : (
                <SettingField
                  key={setting.id}
                  setting={setting}
                  value={globalValue(setting)}
                  onChange={(value) => setGlobal(setting.key, value)}
                />
              ),
            )}
          </SettingGroup>
        ))}
        {!supportsMetadata && (
          <SettingGroup>
            <SettingRow
              title={<Trans>Extended profile unavailable</Trans>}
              description={
                <Trans>
                  Use a server with IRCv3 METADATA to set your avatar, display
                  name, and status.
                </Trans>
              }
            />
          </SettingGroup>
        )}
      </>
    );
  };

  const renderPreferences = () => (
    <>
      <SettingGroup>
        <SettingRow
          title={<Trans>Language</Trans>}
          control={
            <select
              className="field-input w-auto min-w-40"
              value={i18n.locale}
              onChange={(e) => changeLocale(e.target.value)}
            >
              {LOCALES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          }
        />
      </SettingGroup>
      {renderRegistryGroups(settingsRegistry.getByCategory("preferences"))}
    </>
  );

  const renderMedia = () => {
    type LevelInfo = { label: string; description: string; warning?: true };
    const LEVELS: LevelInfo[] = [
      { label: t`Off`, description: t`Turn off media previews.` },
      {
        label: t`Safe`,
        description: t`Preview media from your server's trusted file host only. Make no requests to external services.`,
      },
      {
        label: t`Trusted Sources`,
        description: t`Also preview YouTube, Vimeo, SoundCloud, and similar known services.`,
      },
      {
        label: t`All Content`,
        description: t`Preview all external media. Any URL can trigger a request to an unknown server.`,
        warning: true,
      },
    ];

    const level =
      (globalValues.mediaVisibilityLevel as number | undefined) ?? 1;
    const levelInfo = LEVELS[level as 0 | 1 | 2 | 3];
    const fillPct = (level / 3) * 100;

    return (
      <SettingGroup>
        <SettingRow
          id="media.visibilityLevel"
          title={<Trans>Media Previews</Trans>}
          description={
            <Trans>Choose how much external media loads in chat.</Trans>
          }
          control={
            <span
              className={`text-sm font-semibold ${levelInfo.warning ? "text-yellow-400" : "text-discord-primary"}`}
            >
              {levelInfo.label}
            </span>
          }
        >
          <input
            type="range"
            min={0}
            max={3}
            step={1}
            value={level}
            onChange={(e) =>
              setGlobal("mediaVisibilityLevel", Number(e.target.value))
            }
            className="media-level-slider w-full h-2 cursor-pointer appearance-none rounded-full outline-none"
            style={{
              background: `linear-gradient(to right, #5865f2 ${fillPct}%, #3f4147 ${fillPct}%)`,
            }}
          />
          <div className="mt-2 flex justify-between">
            {LEVELS.map((l, i) => (
              <button
                key={l.label}
                type="button"
                onClick={() => setGlobal("mediaVisibilityLevel", i)}
                className={`text-xs leading-tight transition-colors ${
                  i === level
                    ? "font-medium text-discord-text-normal"
                    : "text-discord-text-muted hover:text-discord-text-normal"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p
            className={`mt-4 text-sm leading-relaxed ${levelInfo.warning ? "text-yellow-400" : "text-discord-text-muted"}`}
          >
            {levelInfo.warning && (
              <span className="mr-1 font-semibold">
                <Trans>Privacy warning:</Trans>
              </span>
            )}
            {levelInfo.description}
          </p>
        </SettingRow>
      </SettingGroup>
    );
  };

  const renderAccount = () => {
    if (!currentServer || !serverConfig) {
      return (
        <SettingGroup>
          <SettingRow
            title={
              <Trans>Connect to a server to manage operator settings.</Trans>
            }
          />
        </SettingGroup>
      );
    }

    const supportsTwoFactor =
      currentServer.capabilities?.some((c) =>
        c.startsWith("draft/account-2fa"),
      ) ?? false;

    return (
      <>
        <PersistenceSettingsPanel serverId={currentServer.id} />
        {supportsTwoFactor && (
          <SettingGroup>
            <SettingRow
              title={<Trans>Two-factor authentication</Trans>}
              description={
                <Trans>
                  Add an authenticator app or biometric / security key to
                  require a second factor when logging in.
                </Trans>
              }
              control={
                <button
                  type="button"
                  onClick={() =>
                    openPage({ kind: "twoFactor", serverId: currentServer.id })
                  }
                  className="h-8 px-3 rounded-lg bg-discord-dark-400 hover:bg-discord-dark-300 text-sm text-discord-text-normal whitespace-nowrap"
                >
                  <Trans>Manage two-factor authentication</Trans>
                </button>
              }
            />
          </SettingGroup>
        )}
        <SettingGroup title={<Trans>IRC Operator</Trans>}>
          <SettingRow
            id="account.operName"
            title={<Trans>Oper Name</Trans>}
            description={
              <Trans>
                Authenticate as an IRC Operator for administrative access
              </Trans>
            }
            field={
              <TextDraftInput
                value={operName}
                placeholder={t`Enter oper username`}
                onCommit={(value) => {
                  setOperName(value);
                  updateServer(serverConfig.id, { operUsername: value });
                }}
              />
            }
          />
          <SettingRow
            id="account.operPassword"
            title={<Trans>Oper Password</Trans>}
            field={
              <TextInput
                type="password"
                className="field-input"
                value={operPassword}
                onChange={(e) => setOperPassword(e.target.value)}
                placeholder={t`Enter oper password`}
              />
            }
          />
          <SettingRow
            id="account.operOnConnect"
            title={<Trans>Authenticate on connect</Trans>}
            control={
              <Switch
                checked={operOnConnect}
                label={t`Authenticate on connect`}
                onChange={(value) => {
                  setOperOnConnect(value);
                  updateServer(serverConfig.id, { operOnConnect: value });
                }}
              />
            }
          />
          <SettingRow
            title={<Trans>Authenticate now</Trans>}
            control={
              <button
                type="button"
                onClick={handleOperUp}
                disabled={!operName.trim() || !operPassword.trim()}
                className="h-8 px-3 rounded-lg bg-discord-button-success-default text-sm text-white hover:bg-discord-button-success-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trans>Authenticate now</Trans>
              </button>
            }
          />
        </SettingGroup>
        {currentUser?.isIrcOp && currentServer.emojiPackUrl && (
          <SettingGroup>
            <SettingRow
              title={<Trans>Custom emoji packs</Trans>}
              description={
                <Trans>
                  Manage the network-wide and channel-scoped emoji packs that
                  this server publishes via draft/EMOJI.
                </Trans>
              }
              control={
                <button
                  type="button"
                  onClick={() =>
                    openPage({ kind: "emojiPacks", serverId: currentServer.id })
                  }
                  className="button-primary h-8 px-3 rounded-lg text-sm whitespace-nowrap"
                >
                  <Trans>Manage packs</Trans>
                </button>
              }
            />
          </SettingGroup>
        )}
      </>
    );
  };

  const renderPrivacy = () => (
    <>
      <SettingGroup>
        <SettingRow
          title={<Trans>Privacy Policy</Trans>}
          description={
            <Trans>
              Learn how we handle your data and protect your privacy.
            </Trans>
          }
          control={
            <button
              type="button"
              onClick={() => {
                if (isTauri()) {
                  openExternalUrl("https://obsidianirc.pages.dev/privacy");
                } else {
                  window.open("/privacy", "_blank");
                }
              }}
              className="h-8 px-3 rounded-lg bg-discord-dark-400 hover:bg-discord-dark-300 text-sm text-discord-text-normal whitespace-nowrap"
            >
              <Trans>View Full Privacy Policy</Trans>
            </button>
          }
        />
      </SettingGroup>
      <SettingGroup title={<Trans>Data Collection</Trans>}>
        <div className="px-4 py-3.5">
          <ul className="flex flex-col gap-2 text-sm text-discord-text-muted">
            <li>
              <strong>
                <Trans>Local Storage:</Trans>
              </strong>{" "}
              <Trans>
                Your messages and settings are stored locally on your device
              </Trans>
            </li>
            <li>
              <strong>
                <Trans>No Central Server:</Trans>
              </strong>{" "}
              <Trans>
                We don't store your IRC communications on our servers
              </Trans>
            </li>
            <li>
              <strong>
                <Trans>IRC Servers:</Trans>
              </strong>{" "}
              <Trans>Only connect to servers you choose</Trans>
            </li>
            <li>
              <strong>
                <Trans>Anonymous Analytics:</Trans>
              </strong>{" "}
              <Trans>Optional crash reports to improve the app</Trans>
            </li>
          </ul>
        </div>
      </SettingGroup>
      <SettingGroup title={<Trans>Contact</Trans>}>
        <SettingRow title={<Trans>Questions about privacy? Contact us:</Trans>}>
          <ul className="flex flex-col gap-2 text-sm text-discord-text-muted">
            <li>
              <strong>
                <Trans>Email:</Trans>
              </strong>{" "}
              <a
                href="mailto:support@obby.world"
                className="text-discord-primary hover:text-discord-text-link"
              >
                support@obby.world
              </a>
            </li>
            <li>
              <strong>
                <Trans>GitHub:</Trans>
              </strong>{" "}
              <a
                href="https://github.com/obbyworld/obby"
                target="_blank"
                rel="noopener noreferrer"
                className="text-discord-primary hover:text-discord-text-link"
              >
                github.com/obbyworld/obby
              </a>
            </li>
          </ul>
        </SettingRow>
      </SettingGroup>
    </>
  );

  const renderSection = (): ReactNode => {
    switch (activeSection) {
      case "profile":
        return renderProfile();
      case "preferences":
        return renderPreferences();
      case "media":
        return renderMedia();
      case "account":
        return renderAccount();
      case "privacy":
        return renderPrivacy();
      case "invitations":
        return <InvitationsPanel serverId={currentServer?.id} />;
      default:
        return renderRegistryGroups(
          settingsRegistry.getByCategory(activeSection),
        );
    }
  };

  return (
    <PageShell
      title={t`Settings`}
      sections={sections}
      activeSection={activeSection}
      onSectionChange={(id) => setActiveSection(id as SettingsSection)}
      startOnSection={!!page.section}
      columns
    >
      {renderSection()}
    </PageShell>
  );
};

export default SettingsPage;
