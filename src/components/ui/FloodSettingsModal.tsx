import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaPlus, FaSpinner, FaTrash } from "react-icons/fa";
import { BaseModal } from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";

interface FloodRule {
  id: string;
  amount: number;
  type: "c" | "j" | "k" | "m" | "n" | "t" | "r";
  action?: string;
  time?: number; // in minutes
}

interface FloodActionDef {
  value: string;
  label: string;
}

interface FloodRuleDef {
  type: FloodRule["type"];
  label: string;
  defaultAction: string;
  availableActions: FloodActionDef[];
}

const FLOOD_RULE_DEFINITIONS: readonly FloodRuleDef[] = [
  {
    type: "c",
    label: "CTCP",
    defaultAction: "C",
    availableActions: [
      { value: "C", label: "C (CTCP block)" },
      { value: "m", label: "m (moderated)" },
      { value: "M", label: "M (registered-only)" },
    ],
  },
  {
    type: "j",
    label: "Join",
    defaultAction: "i",
    availableActions: [
      { value: "i", label: "i (invite-only)" },
      { value: "R", label: "R (registered-only)" },
    ],
  },
  {
    type: "k",
    label: "Knock",
    defaultAction: "K",
    availableActions: [{ value: "K", label: "K (no knocks)" }],
  },
  {
    type: "m",
    label: "Messages (channel-wide)",
    defaultAction: "m",
    availableActions: [
      { value: "m", label: "m (moderated)" },
      { value: "M", label: "M (registered-only)" },
    ],
  },
  {
    type: "n",
    label: "Nickchange",
    defaultAction: "N",
    availableActions: [{ value: "N", label: "N (no nick changes)" }],
  },
  {
    type: "t",
    label: "Text (per-user)",
    defaultAction: "kick",
    availableActions: [
      { value: "kick", label: "kick" },
      { value: "b", label: "b (ban)" },
      { value: "d", label: "d (deter)" },
    ],
  },
  {
    type: "r",
    label: "Repeat",
    defaultAction: "kick",
    availableActions: [
      { value: "kick", label: "kick" },
      { value: "d", label: "d (deter)" },
      { value: "b", label: "b (ban)" },
    ],
  },
];

interface FloodSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    floodProfile: string,
    floodRules: FloodRule[],
    seconds: number,
  ) => void;
  initialFloodProfile: string;
  initialFloodParams: string;
}

const FloodSettingsModal: React.FC<FloodSettingsModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialFloodProfile,
  initialFloodParams,
}) => {
  const [floodProfile, setFloodProfile] = useState(initialFloodProfile);
  const [floodRules, setFloodRules] = useState<FloodRule[]>([]);
  const [seconds, setSeconds] = useState(60);
  const [isSaving, setIsSaving] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const parseFloodRule = useCallback((ruleStr: string): FloodRule | null => {
    const match = ruleStr.match(/^(\d+)([cjkemntr])(?:#([^#]+))?/);
    if (!match) return null;

    const [, amountStr, type, actionPart] = match;
    const amount = Number.parseInt(amountStr, 10);

    let action: string | undefined;
    let time: number | undefined;

    if (actionPart) {
      const actionMatch = actionPart.match(/^([^:]+)(?::(\d+))?/);
      if (actionMatch) {
        action = actionMatch[1];
        if (actionMatch[2]) {
          time = Number.parseInt(actionMatch[2], 10);
        }
      }
    }

    return {
      id: crypto.randomUUID(),
      amount,
      type: type as FloodRule["type"],
      action,
      time,
    };
  }, []);

  const parseFloodParams = useCallback(
    (params: string) => {
      try {
        const colonIndex = params.lastIndexOf(":");
        if (colonIndex === -1) return;

        const rulesPart = params.substring(0, colonIndex);
        const secondsPart = params.substring(colonIndex + 1);

        const parsedSeconds = Number.parseInt(secondsPart, 10);
        if (!Number.isNaN(parsedSeconds)) {
          setSeconds(parsedSeconds);
        }

        if (rulesPart.startsWith("[") && rulesPart.endsWith("]")) {
          const rulesStr = rulesPart.substring(1, rulesPart.length - 1);
          const ruleStrings = rulesStr.split(",");

          const parsedRules: FloodRule[] = [];
          for (const ruleStr of ruleStrings) {
            const rule = parseFloodRule(ruleStr.trim());
            if (rule) {
              parsedRules.push(rule);
            }
          }
          setFloodRules(parsedRules);
        }
      } catch (error) {
        console.error("Failed to parse flood parameters:", error);
      }
    },
    [parseFloodRule],
  );

  // We reset on every open, so rules from a previous channel don't leak into the new one.
  useEffect(() => {
    if (!isOpen) return;
    setFloodProfile(initialFloodProfile);
    setFloodRules([]);
    setSeconds(60);
    if (initialFloodParams && initialFloodParams !== "Default") {
      parseFloodParams(initialFloodParams);
    }
  }, [isOpen, initialFloodProfile, initialFloodParams, parseFloodParams]);

  const addFloodRule = () => {
    setFloodRules([
      ...floodRules,
      { id: crypto.randomUUID(), amount: 5, type: "m" },
    ]);
    setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight;
      }
    }, 0);
  };

  const updateFloodRule = (id: string, updates: Partial<FloodRule>) => {
    setFloodRules(
      floodRules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    );
  };

  const removeFloodRule = (id: string) => {
    setFloodRules(floodRules.filter((r) => r.id !== id));
  };

  const getTypeDescription = (type: FloodRule["type"]): string =>
    FLOOD_RULE_DEFINITIONS.find((d) => d.type === type)?.label ?? type;

  const getDefaultAction = (type: FloodRule["type"]): string =>
    FLOOD_RULE_DEFINITIONS.find((d) => d.type === type)?.defaultAction ?? "";

  const getAvailableActions = (type: FloodRule["type"]): string[] =>
    FLOOD_RULE_DEFINITIONS.find((d) => d.type === type)?.availableActions.map(
      (a) => a.value,
    ) ?? [];

  const formatFloodParams = (): string => {
    if (floodRules.length === 0) return "";

    const ruleStrings = floodRules.map((rule) => {
      let ruleStr = `${rule.amount}${rule.type}`;
      if (rule.action && rule.action !== getDefaultAction(rule.type)) {
        ruleStr += `#${rule.action}`;
        if (rule.time) {
          ruleStr += `:${rule.time}`;
        }
      }
      return ruleStr;
    });

    return `[${ruleStrings.join(",")}]:${seconds}`;
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(floodProfile, floodRules, seconds);
      onClose();
    } catch (error) {
      console.error("Failed to save flood settings:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const floodProfiles = [
    { value: "", label: t`Default (no profile)` },
    { value: "normal", label: t`Normal - Standard protection` },
    { value: "strict", label: t`Strict - More aggressive protection` },
    { value: "wide", label: t`Wide - Broader protection scope` },
    { value: "relaxed", label: t`Relaxed - Less aggressive protection` },
  ];

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t`Flood protection settings`}
      maxWidth="2xl"
    >
      <ModalBody scrollable ref={scrollContainerRef} className="space-y-6">
        <div className="space-y-3">
          <div>
            <h3 className="text-lg font-medium text-white mb-2">
              <Trans>Flood Profile (+F)</Trans>
            </h3>
            <p className="text-sm text-discord-text-muted mb-4">
              <Trans>
                Choose a predefined flood protection profile for common use
                cases.
              </Trans>
              <a
                href="https://www.unrealircd.org/docs/Channel_anti-flood_settings#flood-profiles"
                target="_blank"
                rel="noopener noreferrer"
                className="text-discord-primary hover:underline ml-1"
              >
                <Trans>Learn more about profiles →</Trans>
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-white block">
              <Trans>Profile</Trans>
            </label>
            <select
              value={floodProfile}
              onChange={(e) => setFloodProfile(e.target.value)}
              className="w-full px-3 py-2 bg-discord-dark-400 border border-discord-dark-300 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-discord-primary focus:border-transparent"
            >
              {floodProfiles.map((profile) => (
                <option key={profile.value} value={profile.value}>
                  {profile.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-lg font-medium text-white mb-2">
              <Trans>Custom Flood Rules (+f)</Trans>
            </h3>
            <p className="text-sm text-discord-text-muted mb-4">
              <Trans>
                Add rules that set which activity to watch and what to do when a
                threshold is exceeded.
              </Trans>
              <a
                href="https://www.unrealircd.org/docs/Channel_anti-flood_settings#Channel_mode_f"
                target="_blank"
                rel="noopener noreferrer"
                className="text-discord-primary hover:underline ml-1"
              >
                <Trans>Learn more about custom rules →</Trans>
              </a>
            </p>
          </div>

          <div className="p-4 bg-discord-dark-300 rounded-lg">
            <label className="text-sm font-medium text-white block mb-2">
              <Trans>Time Window (seconds)</Trans>
            </label>
            <p className="text-xs text-discord-text-muted mb-3">
              <Trans>
                Set how many seconds to count flood activity before the counters
                reset
              </Trans>
            </p>
            <input
              type="number"
              value={seconds}
              onChange={(e) =>
                setSeconds(Number.parseInt(e.target.value, 10) || 60)
              }
              min="10"
              max="3600"
              className="w-full px-3 py-2 bg-discord-dark-400 border border-discord-dark-300 rounded-md text-white placeholder-discord-text-muted focus:outline-none focus:ring-2 focus:ring-discord-primary focus:border-transparent"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-md font-medium text-white">
                <Trans>Rules</Trans>
              </h4>
            </div>

            {floodRules.length === 0 ? (
              <div className="flex justify-center py-8">
                <button
                  onClick={addFloodRule}
                  className="px-4 py-2 button-primary rounded-md text-sm flex items-center gap-2"
                >
                  <FaPlus size={14} />
                  <Trans>Add Rule</Trans>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {floodRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="p-4 bg-discord-dark-300 rounded-lg"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="text-xs font-medium text-discord-text-muted block mb-1">
                          <Trans>Amount</Trans>
                        </label>
                        <input
                          type="number"
                          value={rule.amount}
                          onChange={(e) =>
                            updateFloodRule(rule.id, {
                              amount: Number.parseInt(e.target.value, 10) || 1,
                            })
                          }
                          min="1"
                          className="w-full px-2 py-1 bg-discord-dark-400 border border-discord-dark-300 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-discord-primary"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-medium text-discord-text-muted block mb-1">
                          <Trans>Type</Trans>
                        </label>
                        <select
                          value={rule.type}
                          onChange={(e) =>
                            updateFloodRule(rule.id, {
                              type: e.target.value as FloodRule["type"],
                            })
                          }
                          className="w-full px-2 py-1 bg-discord-dark-400 border border-discord-dark-300 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-discord-primary"
                        >
                          <option value="c">
                            CTCP ({getTypeDescription("c")})
                          </option>
                          <option value="j">
                            Join ({getTypeDescription("j")})
                          </option>
                          <option value="k">
                            Knock ({getTypeDescription("k")})
                          </option>
                          <option value="m">
                            Messages ({getTypeDescription("m")})
                          </option>
                          <option value="n">
                            Nickchange ({getTypeDescription("n")})
                          </option>
                          <option value="t">
                            Text ({getTypeDescription("t")})
                          </option>
                          <option value="r">
                            Repeat ({getTypeDescription("r")})
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-discord-text-muted block mb-1">
                          <Trans>Action</Trans>
                        </label>
                        <select
                          value={rule.action || getDefaultAction(rule.type)}
                          onChange={(e) =>
                            updateFloodRule(rule.id, {
                              action: e.target.value,
                            })
                          }
                          className="w-full px-2 py-1 bg-discord-dark-400 border border-discord-dark-300 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-discord-primary"
                        >
                          <option value={getDefaultAction(rule.type)}>
                            {getDefaultAction(rule.type)} (default)
                          </option>
                          {getAvailableActions(rule.type)
                            .filter(
                              (action) =>
                                action !== getDefaultAction(rule.type),
                            )
                            .map((action) => (
                              <option key={action} value={action}>
                                {action}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-discord-text-muted block mb-1">
                          <Trans>Time (min)</Trans>
                        </label>
                        <input
                          type="number"
                          value={rule.time || ""}
                          onChange={(e) =>
                            updateFloodRule(rule.id, {
                              time: e.target.value
                                ? Number.parseInt(e.target.value, 10)
                                : undefined,
                            })
                          }
                          placeholder={t`Permanent`}
                          min="1"
                          className="w-full px-2 py-1 bg-discord-dark-400 border border-discord-dark-300 rounded text-white text-sm placeholder-discord-text-muted focus:outline-none focus:ring-1 focus:ring-discord-primary"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end mt-3">
                      <button
                        onClick={() => removeFloodRule(rule.id)}
                        className="text-red-400 hover:text-red-300 text-sm flex items-center gap-1"
                      >
                        <FaTrash size={12} />
                        <Trans>Remove Rule</Trans>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {floodRules.length > 0 && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={addFloodRule}
                  className="px-4 py-2 button-primary rounded-md text-sm flex items-center gap-2"
                >
                  <FaPlus size={14} />
                  <Trans>Add Rule</Trans>
                </button>
              </div>
            )}
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <FaSpinner className="animate-spin" size={14} />
              <Trans>Saving...</Trans>
            </>
          ) : (
            <Trans>Save settings</Trans>
          )}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};

export default FloodSettingsModal;
