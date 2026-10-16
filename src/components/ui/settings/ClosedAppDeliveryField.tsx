import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import {
  type ClosedAppDelivery,
  closedAppDelivery,
  type NotificationPlatform,
} from "../../../lib/closedAppDelivery";
import { needsHistoryPoll } from "../../../lib/historyPoll/historyPollConfig";
import { areChatNotificationsOn } from "../../../lib/notifications";
import {
  isTauriAndroid,
  isTauriDesktop,
  isTauriIOS,
} from "../../../lib/platformUtils";
import { findPushRegistration } from "../../../lib/pushRegistration";
import type { SettingComponentProps } from "../../../lib/settings/types";
import useStore from "../../../store";

function currentPlatform(): NotificationPlatform {
  if (isTauriAndroid()) return "android";
  if (isTauriIOS()) return "ios";
  if (isTauriDesktop()) return "desktop";
  return "web";
}

export const ClosedAppDeliveryField: React.FC<SettingComponentProps> = () => {
  const { t } = useLingui();
  const servers = useStore((s) => s.servers);
  const globalSettings = useStore((s) => s.globalSettings);
  const [pushServerIds, setPushServerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let isCancelled = false;
    Promise.all(
      servers.map(async (server) =>
        (await findPushRegistration(server.id)) ? server.id : null,
      ),
    ).then((ids) => {
      if (!isCancelled)
        setPushServerIds(new Set(ids.filter((id) => id !== null)));
    });
    return () => {
      isCancelled = true;
    };
  }, [servers]);

  const describe = (delivery: ClosedAppDelivery): string => {
    switch (delivery) {
      case "off":
        return t`Turn on Show Notifications to get any`;
      case "instant":
        return t`Instant, even with Obby closed`;
      case "tray":
        return t`Keep Obby in the tray to get them`;
      case "periodic-check":
        return t`Up to 15 minutes late while Obby is closed`;
      case "background-only":
        return t`Leave Obby in the background to get them, since swiping it away stops them`;
      case "while-open":
        return t`Keep Obby open to get them`;
    }
  };

  const shown = servers.filter((server) => !server.isBouncerControl);
  if (shown.length === 0)
    return (
      <p className="text-sm text-discord-text-muted">{t`Add a server to see how its notifications reach you`}</p>
    );
  return (
    <ul className="space-y-2">
      {shown.map((server) => (
        <li key={server.id} className="flex flex-col">
          <span className="text-sm font-medium text-discord-text-normal break-words">
            {server.name}
          </span>
          <span className="text-sm text-discord-text-muted">
            {describe(
              closedAppDelivery({
                platform: currentPlatform(),
                areNotificationsOn: areChatNotificationsOn(globalSettings),
                hasPushRegistration:
                  pushServerIds.has(server.id) || !!server.pushEndpoint,
                needsHistoryPoll: needsHistoryPoll(server),
                keepsRunningInTray: globalSettings.closeToTray,
              }),
            )}
          </span>
        </li>
      ))}
    </ul>
  );
};
