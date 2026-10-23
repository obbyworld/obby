import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import {
  FaBan,
  FaChevronDown,
  FaChevronRight,
  FaCopy,
  FaSkull,
} from "react-icons/fa";
import ircClient from "../../lib/ircClient";
import useStore from "../../store";
import type { JsonValue, MessageType, User } from "../../types";

interface JsonLogMessageProps {
  message: MessageType;
  showDate: boolean;
  messageUser?: User;
  onUsernameContextMenu: (
    e: React.MouseEvent,
    username: string,
    serverId: string,
    channelId: string,
    avatarElement?: Element | null,
  ) => void;
  onIrcLinkClick?: (url: string) => void;
  joinChannel?: (serverId: string, channelName: string) => void;
}

// Format field names: replace _ with spaces and capitalize each word
const formatFieldName = (fieldName: string): string => {
  return fieldName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

// Copy to clipboard helper
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error("Failed to copy to clipboard:", err);
  }
};

// Generate formatted text representation of the data
const generateFormattedText = (data: Record<string, JsonValue>): string => {
  const lines: string[] = [];

  const formatValue = (value: JsonValue, indent = 0): string => {
    const indentStr = "  ".repeat(indent);

    if (value === null || value === undefined) {
      return "null";
    }

    if (typeof value === "boolean" || typeof value === "number") {
      return value.toString();
    }

    if (typeof value === "string") {
      // Format timestamps nicely
      if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
        return new Date(value).toLocaleString();
      }
      return value;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "None";
      }
      let result = `Array (${value.length} items)`;
      value.forEach((item) => {
        result += `\n${indentStr}• ${formatValue(item, indent + 1)}`;
      });
      return result;
    }

    if (typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        return "No data";
      }
      let result = `Object (${entries.length} properties)`;
      entries.forEach(([key, val]) => {
        result += `\n${indentStr}${formatFieldName(key)}: ${formatValue(val, indent + 1)}`;
      });
      return result;
    }

    return String(value);
  };

  // Filter out excluded fields and render the rest
  const excludedFields = new Set([
    "timestamp",
    "level",
    "subsystem",
    "event_id",
    "log_source",
    "msg",
  ]);
  const filteredEntries = Object.entries(data).filter(
    ([key]) => !excludedFields.has(key),
  );

  filteredEntries.forEach(([key, value]) => {
    lines.push(formatFieldName(key));
    lines.push(formatValue(value, 1));
    lines.push(""); // Empty line between sections
  });

  return lines.join("\n").trim();
};

// Render structured data excluding basic fields
const renderStructuredData = (
  data: Record<string, JsonValue>,
  message: MessageType,
  joinChannel?: (serverId: string, channelName: string) => void,
): React.ReactNode => {
  // Fields to exclude as they're already shown elsewhere
  const excludedFields = new Set([
    "timestamp",
    "level",
    "subsystem",
    "event_id",
    "log_source",
    "msg",
  ]);

  const renderValue = (
    value: JsonValue,
    indent = 0,
    isTopLevel = false,
    contextPath: string[] = [],
  ): React.ReactNode => {
    const indentStyle = { marginLeft: `${indent * 20}px` };

    if (value === null || value === undefined) {
      return (
        <div className="flex items-center gap-2">
          <span
            className="text-gray-500 italic hover:bg-gray-700 px-1 py-0.5 rounded cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard("null");
            }}
            title={t`Click to copy`}
          >
            null
          </span>
        </div>
      );
    }
    if (typeof value === "boolean") {
      return (
        <div className="flex items-center gap-2">
          <span
            className={`hover:bg-gray-700 px-1 py-0.5 rounded cursor-pointer ${value ? "text-green-400" : "text-red-400"}`}
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(value.toString());
            }}
            title={t`Click to copy`}
          >
            {value.toString()}
          </span>
        </div>
      );
    }
    if (typeof value === "number") {
      return (
        <div className="flex items-center gap-2">
          <span
            className="text-blue-400 hover:bg-gray-700 px-1 py-0.5 rounded cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(value.toString());
            }}
            title={t`Click to copy`}
          >
            {value.toString()}
          </span>
        </div>
      );
    }
    if (typeof value === "string") {
      const isChannelName = ircClient.isChannel(message.serverId, value);

      // Format timestamps nicely
      if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
        return (
          <span
            className="text-cyan-300 hover:bg-gray-700 px-1 py-0.5 rounded cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(value);
            }}
            title={t`Click to copy`}
          >
            {new Date(value).toLocaleString()}
          </span>
        );
      }

      if (isChannelName && message.serverId && joinChannel) {
        return (
          <div className="flex items-center gap-2">
            <span
              className="text-yellow-300 hover:bg-gray-700 px-1 py-0.5 rounded cursor-pointer relative"
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(value);
              }}
              title={t`Click to copy`}
            >
              {value}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  joinChannel(message.serverId, value);
                }}
                className="absolute -right-12 top-0 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded flex items-center gap-1"
                title={t`Join ${value}`}
              >
                <Trans>Join</Trans>
              </button>
            </span>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-2">
          <span
            className="text-yellow-300 hover:bg-gray-700 px-1 py-0.5 rounded cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(value);
            }}
            title={t`Click to copy`}
          >
            {value}
          </span>
        </div>
      );
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return (
          <div className="flex items-center gap-2">
            <span
              className="text-gray-500 hover:bg-gray-700 px-1 py-0.5 rounded cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard("[]");
              }}
              title={t`Click to copy`}
            >
              <Trans>None</Trans>
            </span>
          </div>
        );
      }
      return (
        <div
          className="space-y-1 hover:bg-gray-800 p-2 rounded cursor-pointer"
          onClick={() => copyToClipboard(JSON.stringify(value, null, 2))}
          title={t`Click to copy as JSON`}
        >
          <div className="ml-4 space-y-1">
            {Array.from(value, (item, i) => ({ item, i })).map(
              ({ item, i }) => (
                <div
                  key={`${contextPath.join(".")}.${i}`}
                  className="flex items-start"
                >
                  <span className="text-gray-500 mr-2">•</span>
                  {renderValue(item, 0, false, [...contextPath, i.toString()])}
                </div>
              ),
            )}
          </div>
        </div>
      );
    }
    if (typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        return (
          <div className="flex items-center gap-2">
            <span
              className="text-gray-500 hover:bg-gray-700 px-1 py-0.5 rounded cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard("{}");
              }}
              title={t`Click to copy`}
            >
              <Trans>No data</Trans>
            </span>
          </div>
        );
      }
      return (
        <div
          className="space-y-1 hover:bg-gray-800 p-2 rounded cursor-pointer"
          onClick={() => copyToClipboard(JSON.stringify(value, null, 2))}
          title={t`Click to copy as JSON`}
        >
          <div className="ml-4 space-y-1">
            {entries.map(([key, val]) => (
              <div key={key} className="flex items-start">
                <span className="text-purple-400 font-medium mr-2">
                  {formatFieldName(key)}:
                </span>
                <div className="flex-1">
                  {renderValue(val, 0, false, [...contextPath, key])}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <span
        className="text-gray-300 hover:bg-gray-700 px-1 py-0.5 rounded cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          copyToClipboard(String(value));
        }}
        title={t`Click to copy`}
      >
        {String(value)}
      </span>
    );
  };

  // Filter out excluded fields and render the rest
  const filteredEntries = Object.entries(data).filter(
    ([key]) => !excludedFields.has(key),
  );

  if (filteredEntries.length === 0) {
    return (
      <span className="text-gray-500 italic">
        <Trans>No additional data</Trans>
      </span>
    );
  }

  return (
    <div className="space-y-3">
      {filteredEntries.map(([key, value]) => (
        <div key={key}>
          <div className="text-purple-300 font-semibold text-sm mb-2">
            {formatFieldName(key)}
          </div>
          <div>{renderValue(value, 0, true)}</div>
        </div>
      ))}
    </div>
  );
};

const formatClientObject = (
  // biome-ignore lint/suspicious/noExplicitAny: Arbitrary JSON data from IRC logs
  client: any,
  title: string,
  serverId: string,
  sendMessage: (serverId: string, channelId: string, content: string) => void,
) => {
  const handleGLine = () => {
    if (client.hostname) {
      sendMessage(
        serverId,
        "server-notices",
        `/gline ${client.hostname} IRC Operator Action`,
      );
    }
  };

  const handleGZLine = () => {
    if (client.ip) {
      sendMessage(
        serverId,
        "server-notices",
        `/gzline ${client.ip} IRC Operator Action`,
      );
    }
  };

  const handleKill = () => {
    if (client.name) {
      sendMessage(
        serverId,
        "server-notices",
        `/kill ${client.name} IRC Operator Action`,
      );
    }
  };

  if (!client) return null;

  return (
    <div className="space-y-2">
      <div className="text-cyan-400 font-medium text-sm">
        {title ? t`${title} Client` : t`Client`}
      </div>
      <div className="ml-2 space-y-1">
        <div className="flex items-center">
          <span className="text-cyan-400 font-medium mr-2 text-sm">
            <Trans>Name:</Trans>
          </span>
          <span className="text-white text-sm">{client.name}</span>
          {client.id && (
            <span className="text-gray-400 ml-2 text-sm">({client.id})</span>
          )}
        </div>

        {client.hostname && (
          <div className="flex items-center">
            <span className="text-cyan-400 mr-2 text-sm">
              <Trans>Hostname:</Trans>
            </span>
            <span className="text-gray-300 text-sm">{client.hostname}</span>
          </div>
        )}

        {client.ip && (
          <div className="flex items-center">
            <span className="text-cyan-400 mr-2 text-sm">IP:</span>
            <span className="text-gray-300 text-sm">{client.ip}</span>
          </div>
        )}

        {client.user && (
          <div className="ml-2">
            <div className="text-cyan-400 font-medium text-sm mb-1">
              <Trans>User Information</Trans>
            </div>
            <div className="ml-2 space-y-1">
              {client.user.username && (
                <div className="flex items-center">
                  <span className="text-cyan-400 mr-2 text-sm">
                    <Trans>Username:</Trans>
                  </span>
                  <span className="text-gray-300 text-sm">
                    {client.user.username}
                  </span>
                </div>
              )}
              {client.user.realname && (
                <div className="flex items-center">
                  <span className="text-cyan-400 mr-2 text-sm">
                    <Trans>Realname:</Trans>
                  </span>
                  <span className="text-gray-300 text-sm">
                    {client.user.realname}
                  </span>
                </div>
              )}
              {client.user.account && (
                <div className="flex items-center">
                  <span className="text-cyan-400 mr-2 text-sm">
                    <Trans>Account:</Trans>
                  </span>
                  <span className="text-gray-300 text-sm">
                    {client.user.account}
                  </span>
                </div>
              )}
              {client.user.modes && (
                <div className="flex items-center">
                  <span className="text-cyan-400 mr-2 text-sm">
                    <Trans>Modes:</Trans>
                  </span>
                  <span className="text-gray-300 text-sm">
                    {client.user.modes}
                  </span>
                </div>
              )}
              {client.user.away_reason && (
                <div className="flex items-start">
                  <span className="text-cyan-400 mr-2 text-sm">
                    <Trans>Away:</Trans>
                  </span>
                  <span className="text-gray-300 text-sm">
                    {client.user.away_reason}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {client.server && (
          <div className="ml-2">
            <div className="text-cyan-400 font-medium text-sm mb-1">
              <Trans>Server Information</Trans>
            </div>
            <div className="ml-2 space-y-1">
              {client.server.info && (
                <div className="flex items-start">
                  <span className="text-cyan-400 mr-2 text-sm">
                    <Trans>Info:</Trans>
                  </span>
                  <span className="text-gray-300 text-sm">
                    {client.server.info}
                  </span>
                </div>
              )}
              {client.server.num_users && (
                <div className="flex items-center">
                  <span className="text-cyan-400 mr-2 text-sm">
                    <Trans>Users:</Trans>
                  </span>
                  <span className="text-gray-300 text-sm">
                    {client.server.num_users}
                  </span>
                </div>
              )}
              {client.server.features?.software && (
                <div className="flex items-center">
                  <span className="text-cyan-400 mr-2 text-sm">
                    <Trans>Software:</Trans>
                  </span>
                  <span className="text-gray-300 text-sm">
                    {client.server.features.software}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* IRC Operator Actions */}
        {(client.hostname || client.ip || client.name) && (
          <div className="flex gap-2 mt-2">
            {client.hostname && (
              <button
                onClick={handleGLine}
                className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded flex items-center gap-1"
                title={t`G-Line (Global Ban)`}
              >
                <FaBan className="text-xs" />
                <Trans>G-Line</Trans>
              </button>
            )}
            {client.ip && (
              <button
                onClick={handleGZLine}
                className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded flex items-center gap-1"
                title={t`GZ-Line (Global Z-Line)`}
              >
                <FaBan className="text-xs" />
                <Trans>GZ-Line</Trans>
              </button>
            )}
            {client.name && (
              <button
                onClick={handleKill}
                className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded flex items-center gap-1"
                title={t`Kill User`}
              >
                <FaSkull className="text-xs" />
                <Trans>Kill</Trans>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const formatChannelObject = (
  // biome-ignore lint/suspicious/noExplicitAny: Arbitrary JSON data from IRC logs
  channel: any,
) => {
  if (!channel) return null;

  return (
    <div className="space-y-2">
      <div className="text-cyan-400 font-medium text-sm">
        <Trans>Channel Information</Trans>
      </div>
      <div className="ml-2 space-y-1">
        <div className="flex items-center">
          <span className="text-cyan-400 font-medium mr-2 text-sm">
            <Trans>Name:</Trans>
          </span>
          <span className="text-white font-medium text-sm">{channel.name}</span>
        </div>

        {channel.num_users && (
          <div className="flex items-center">
            <span className="text-cyan-400 mr-2 text-sm">
              <Trans>Users:</Trans>
            </span>
            <span className="text-gray-300 text-sm">{channel.num_users}</span>
          </div>
        )}

        {channel.topic && (
          <div className="flex items-start">
            <span className="text-cyan-400 mr-2 text-sm">
              <Trans>Topic:</Trans>
            </span>
            <span className="text-gray-300 text-sm">"{channel.topic}"</span>
          </div>
        )}

        {channel.topic_set_by && (
          <div className="flex items-center">
            <span className="text-cyan-400 mr-2 text-sm">
              <Trans>Set by:</Trans>
            </span>
            <span className="text-gray-300 text-sm">
              {channel.topic_set_by}
            </span>
          </div>
        )}

        {channel.modes && (
          <div className="flex items-start">
            <span className="text-cyan-400 mr-2 text-sm">
              <Trans>Modes:</Trans>
            </span>
            <span className="text-gray-300 font-mono text-sm">
              {channel.modes}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const JsonLogMessage: React.FC<JsonLogMessageProps> = ({
  message,
  showDate,
  messageUser,
  onUsernameContextMenu,
  onIrcLinkClick,
  joinChannel,
}) => {
  const jsonData = message.jsonLogData;
  const [isDeepDiveOpen, setIsDeepDiveOpen] = useState(false);
  const { sendMessage, ui } = useStore();

  // If popup is open, don't render inline notices
  if (ui.isServerNoticesPopupOpen) {
    return null;
  }

  if (!jsonData) {
    return null;
  }

  // Type guard: ensure jsonData is an object
  if (
    typeof jsonData !== "object" ||
    jsonData === null ||
    Array.isArray(jsonData)
  ) {
    return null;
  }

  const typedJsonData = jsonData as Record<string, JsonValue>;

  const getLevelColor = (level: string) => {
    switch (level?.toLowerCase()) {
      case "error":
      case "fatal":
        return "text-red-400";
      case "warn":
      case "warning":
        return "text-yellow-400";
      case "info":
        return "text-blue-400";
      case "debug":
        return "text-gray-400";
      default:
        return "text-gray-300";
    }
  };

  return (
    <div className="px-2 py-1">
      <div
        className="bg-gray-800 rounded-lg p-2 space-y-2 cursor-pointer"
        onClick={() => !isDeepDiveOpen && setIsDeepDiveOpen(true)}
      >
        {/* Compact Header */}
        <div
          className="flex items-center justify-between pb-1 border-b border-gray-600"
          onClick={(e) => {
            e.stopPropagation();
            setIsDeepDiveOpen(!isDeepDiveOpen);
          }}
        >
          <div className="flex items-center gap-2">
            {typedJsonData.level && (
              <div
                className={`px-1.5 py-0.5 rounded text-xs font-medium ${getLevelColor(typedJsonData.level as string)} bg-gray-700`}
              >
                {(typedJsonData.level as string).toUpperCase()}
              </div>
            )}
            {typedJsonData.subsystem && typedJsonData.event_id && (
              <span className="font-mono text-xs text-gray-400">
                [{typedJsonData.subsystem as string}.
                {typedJsonData.event_id as string}]
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-gray-400">
            {typedJsonData.timestamp && (
              <span>
                {new Date(
                  typedJsonData.timestamp as string | number,
                ).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Message with Deep Dive Button */}
        <div
          className="flex items-start justify-between"
          onClick={(e) => {
            e.stopPropagation();
            setIsDeepDiveOpen(!isDeepDiveOpen);
          }}
        >
          <div className="flex-1">
            {typedJsonData.msg && (
              <div className="text-white text-sm">
                {typedJsonData.msg as string}
              </div>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsDeepDiveOpen(!isDeepDiveOpen);
            }}
            className="ml-4 px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded flex items-center gap-1 flex-shrink-0"
          >
            <span>
              <Trans>Deep dive</Trans>
            </span>
            {isDeepDiveOpen ? (
              <FaChevronDown className="text-gray-400 text-xs" />
            ) : (
              <FaChevronRight className="text-gray-400 text-xs" />
            )}
          </button>
        </div>

        {/* Deep Dive Content */}
        {isDeepDiveOpen && (
          <div
            className="border border-gray-600 rounded-lg p-3 bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-cyan-400 font-medium text-sm">
                <Trans>Additional Details</Trans>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(JSON.stringify(typedJsonData, null, 2));
                  }}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
                  title={t`Copy entire JSON`}
                >
                  <Trans>Copy JSON</Trans>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // For formatted output, we'll copy the text content of the rendered data
                    const formattedText = generateFormattedText(typedJsonData);
                    copyToClipboard(formattedText);
                  }}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded"
                  title={t`Copy formatted output`}
                >
                  <FaCopy className="text-xs" />
                </button>
              </div>
            </div>
            <div className="text-sm">
              {renderStructuredData(typedJsonData, message, joinChannel)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
