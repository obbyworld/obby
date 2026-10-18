import { useLingui } from "@lingui/react/macro";
import type React from "react";
import {
  type ClosedAppDelivery,
  closedAppDelivery,
} from "../../../lib/closedAppDelivery";
import { needsHistoryPoll } from "../../../lib/historyPoll/historyPollConfig";
import { areChatNotificationsOn } from "../../../lib/notifications";
import { isTauriAndroid } from "../../../lib/platformUtils";
import type { SettingComponentProps } from "../../../lib/settings/types";
import useStore from "../../../store";

export const ClosedAppDeliveryField: React.FC<SettingComponentProps> = () => {
  const { t } = useLingui();
  const servers = useStore((s) => s.servers);
  const globalSettings = useStore((s) => s.globalSettings);

  const describe = (delivery: ClosedAppDelivery): string => {
    switch (delivery) {
      case "off":
        return globalSettings.enableNotifications
          ? t`Unmute notifications with the bell to get any`
          : t`Turn on Show Notifications to get any`;
      case "instant":
        return t`Get them instantly, even with Obby closed`;
      case "periodic-check":
        return t`Expect them up to 15 minutes late while Obby is closed`;
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
                platform: isTauriAndroid() ? "android" : "ios",
                areNotificationsOn: areChatNotificationsOn(globalSettings),
                hasPushRegistration: !!server.pushEndpoint,
                needsHistoryPoll: needsHistoryPoll(server),
              }),
            )}
          </span>
        </li>
      ))}
    </ul>
  );
};
