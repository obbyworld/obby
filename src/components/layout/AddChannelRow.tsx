import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  FaCaretDown,
  FaDesktop,
  FaHashtag,
  FaPlus,
  FaVolumeUp,
} from "react-icons/fa";
import { useTypingOwner } from "../../hooks/useAutoFocusTyping";
import { type ChannelKind, getChannelKind } from "../../lib/channelFolders";
import { isChannelTarget } from "../../lib/ircUtils";
import Menu from "../ui/Menu";
import { TextInput } from "../ui/TextInput";

const KIND_ICONS: Record<ChannelKind, React.ReactNode> = {
  text: <FaHashtag />,
  voice: <FaVolumeUp />,
  stream: <FaDesktop />,
};

const KIND_PREFIXES: Record<ChannelKind, string> = {
  text: "#",
  voice: "^",
  stream: "$",
};

interface AddChannelRowProps {
  canAddLive: boolean;
  onAdd: (channelName: string) => void;
}

export const AddChannelRow: React.FC<AddChannelRowProps> = ({
  canAddLive,
  onAdd,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [prefix, setPrefix] = useState(KIND_PREFIXES.text);
  const kind = getChannelKind(prefix);
  const [hasTypedPrefix, setHasTypedPrefix] = useState(false);
  const [name, setName] = useState("");
  const [kindMenuAnchor, setKindMenuAnchor] = useState<HTMLElement | null>(
    null,
  );
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useTypingOwner(inputRef, isOpen);

  const close = () => {
    setIsOpen(false);
    setPrefix(KIND_PREFIXES.text);
    setHasTypedPrefix(false);
    setName("");
    setKindMenuAnchor(null);
  };

  // We cancel the add on any press outside the row, and we count the portaled
  // kind menu as inside it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close only calls stable state setters
  useEffect(() => {
    if (!isOpen) return;
    const cancelOnOutsidePress = (e: PointerEvent) => {
      const target = e.target as Element;
      if (rowRef.current?.contains(target)) return;
      if (target.closest?.("[data-popover-panel]")) return;
      close();
    };
    document.addEventListener("pointerdown", cancelOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", cancelOnOutsidePress);
  }, [isOpen]);

  const pickKind = (option: ChannelKind) => {
    setPrefix(KIND_PREFIXES[option]);
    inputRef.current?.focus();
  };

  // The first channel prefix typed or pasted picks the kind, and every later
  // one belongs to the name, so "##linux" can be typed key by key.
  const changeName = (value: string) => {
    const typedPrefix = value[0];
    const isUsablePrefix =
      name === "" &&
      !hasTypedPrefix &&
      isChannelTarget(value) &&
      (canAddLive || getChannelKind(typedPrefix) === "text");
    if (isUsablePrefix) {
      setPrefix(typedPrefix);
      setHasTypedPrefix(true);
      setName(value.slice(1));
    } else {
      setName(value);
    }
  };

  const submit = () => {
    if (!name.trim()) return;
    onAdd(prefix + name.trim());
    close();
  };

  const kindLabels: Record<ChannelKind, string> = {
    text: t`Text channel`,
    voice: t`Voice channel`,
    stream: t`Stream`,
  };
  const placeholders: Record<ChannelKind, string> = {
    text: t`channel-name`,
    voice: t`voice-channel`,
    stream: t`stream-name`,
  };
  const kinds: ChannelKind[] = ["text", "voice", "stream"];
  const prefixIcon =
    prefix === "&" ? (
      <span className="w-3.5 text-center font-semibold">&amp;</span>
    ) : (
      KIND_ICONS[kind]
    );

  return (
    <div ref={rowRef} className="mb-2">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        className={`w-full min-h-10 px-2 flex items-center gap-2 rounded-md text-left whitespace-nowrap border transition-colors ${
          isOpen
            ? "border-solid border-discord-text-muted/50 bg-discord-dark-500/40 text-white"
            : "border-dashed border-discord-text-muted/35 text-discord-channels-default hover:border-discord-text-muted/70 hover:text-discord-text-normal hover:bg-discord-dark-500/20"
        }`}
      >
        <span className="w-6 flex-shrink-0 flex items-center justify-center">
          <FaPlus
            className={`transition-transform ${isOpen ? "rotate-45" : ""}`}
          />
        </span>
        <span className="font-medium truncate">
          <Trans>add channel</Trans>
        </span>
      </button>
      {isOpen && (
        <div className="mt-1 flex items-center bg-discord-dark-400 rounded overflow-hidden max-w-full">
          {canAddLive ? (
            <button
              type="button"
              aria-label={t`Pick channel kind`}
              title={kindLabels[kind]}
              aria-haspopup="menu"
              aria-expanded={!!kindMenuAnchor}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) =>
                setKindMenuAnchor(kindMenuAnchor ? null : e.currentTarget)
              }
              className="self-stretch pl-2 pr-1 flex flex-shrink-0 items-center gap-0.5 text-discord-channels-default hover:text-white hover:bg-discord-dark-300"
            >
              {prefixIcon}
              <FaCaretDown className="text-[10px] opacity-70" />
            </button>
          ) : (
            <span className="pl-2 pr-1 flex-shrink-0 text-discord-channels-default">
              {prefixIcon}
            </span>
          )}
          <TextInput
            ref={inputRef}
            className="bg-transparent border-none outline-none py-1 w-full min-w-0 text-discord-channels-active"
            placeholder={placeholders[kind]}
            aria-label={kindLabels[kind]}
            value={name}
            onChange={(e) => changeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && name === "") {
                setPrefix(KIND_PREFIXES.text);
                setHasTypedPrefix(false);
              } else if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                close();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="px-2 self-stretch flex-shrink-0 text-discord-green hover:bg-discord-dark-300"
            aria-label={t`Add channel`}
            onClick={submit}
          >
            <FaPlus />
          </button>
        </div>
      )}
      <Menu
        isOpen={!!kindMenuAnchor}
        anchorElement={kindMenuAnchor}
        onClose={() => {
          setKindMenuAnchor(null);
          inputRef.current?.focus();
        }}
        menuItems={kinds.map((option) => ({
          id: option,
          label: kindLabels[option],
          icon: KIND_ICONS[option],
          onClick: () => pickKind(option),
        }))}
      />
    </div>
  );
};

export default AddChannelRow;
