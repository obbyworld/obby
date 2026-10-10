import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { IconType } from "react-icons";
import {
  FaBell,
  FaCalendarAlt,
  FaChartBar,
  FaCode,
  FaLanguage,
  FaPalette,
  FaRobot,
  FaSearch,
} from "react-icons/fa";
import { TextInput } from "./TextInput";

interface MockPlugin {
  name: string;
  description: string;
  author: string;
  icon: IconType;
  color: string;
}

function mockPlugins(): MockPlugin[] {
  return [
    {
      name: t`Theme Studio`,
      description: t`Design your own colors and share them as themes.`,
      author: "obby",
      icon: FaPalette,
      color: "hsl(280 42% 38%)",
    },
    {
      name: t`Live Translate`,
      description: t`Read every message in your own language.`,
      author: "community",
      icon: FaLanguage,
      color: "hsl(200 42% 38%)",
    },
    {
      name: t`Code Snippets`,
      description: t`Paste code with syntax highlighting and line numbers.`,
      author: "community",
      icon: FaCode,
      color: "hsl(140 42% 32%)",
    },
    {
      name: t`Keyword Alerts`,
      description: t`Get notified when someone says the words you follow.`,
      author: "obby",
      icon: FaBell,
      color: "hsl(40 55% 36%)",
    },
    {
      name: t`Channel Stats`,
      description: t`See who talks most and when your channel is busy.`,
      author: "community",
      icon: FaChartBar,
      color: "hsl(10 45% 40%)",
    },
    {
      name: t`Event Planner`,
      description: t`Schedule meetups and remind the channel before they start.`,
      author: "community",
      icon: FaCalendarAlt,
      color: "hsl(320 40% 38%)",
    },
    {
      name: t`Bot Builder`,
      description: t`Make simple bots that answer commands, with no code.`,
      author: "obby",
      icon: FaRobot,
      color: "hsl(230 42% 42%)",
    },
  ];
}

const PluginsScreen = () => {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const needle = query.toLowerCase();
  const plugins = mockPlugins().filter(
    (plugin) =>
      plugin.name.toLowerCase().includes(needle) ||
      plugin.description.toLowerCase().includes(needle),
  );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-discord-dark-200 text-white">
      <div className="px-4 pt-6 pb-1 flex-shrink-0 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">
            <Trans>Plugins</Trans>
          </h1>
          <span className="chip-action pointer-events-none">
            <Trans>Coming soon</Trans>
          </span>
        </div>
        <div className="bg-discord-dark-400 rounded-lg flex items-center px-2 h-10">
          <FaSearch className="mx-2 text-discord-text-muted" aria-hidden />
          <TextInput
            placeholder={t`Search plugins...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent border-none outline-none flex-grow text-discord-text-normal placeholder-discord-text-muted"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {plugins.length > 0 ? (
          <ul className="grid p-4 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {plugins.map((plugin) => (
              <li
                key={plugin.name}
                className="flex items-start gap-3 bg-discord-dark-100 rounded-xl p-3.5 ring-1 ring-white/[0.04]"
              >
                <span
                  aria-hidden
                  className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg text-white"
                  style={{ backgroundColor: plugin.color }}
                >
                  <plugin.icon />
                </span>
                <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <span className="truncate text-[15px] font-semibold">
                    {plugin.name}
                  </span>
                  <span className="text-[13px] text-discord-text-muted line-clamp-2">
                    {plugin.description}
                  </span>
                  <span className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs text-discord-text-muted truncate">
                      <Trans>by {plugin.author}</Trans>
                    </span>
                    <button
                      type="button"
                      disabled
                      className="chip-action opacity-60 cursor-not-allowed"
                    >
                      <Trans>Install</Trans>
                    </button>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-discord-text-muted">
            <Trans>No plugins found.</Trans>
          </p>
        )}
      </div>
    </div>
  );
};

export default PluginsScreen;
