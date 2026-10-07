import { t } from "@lingui/core/macro";
import type * as React from "react";
import { useRef, useState } from "react";
import {
  FaCaretDown,
  FaDesktop,
  FaHashtag,
  FaPlus,
  FaVolumeUp,
} from "react-icons/fa";
import { type ChannelKind, getChannelKind } from "../../lib/channelFolders";
import { isChannelTarget } from "../../lib/ircUtils";
import Menu from "../ui/Menu";
import InlineEntryRow from "./InlineEntryRow";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setIsOpen(false);
    setPrefix(KIND_PREFIXES.text);
    setHasTypedPrefix(false);
    setName("");
    setKindMenuAnchor(null);
  };

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
    <InlineEntryRow
      isOpen={isOpen}
      onOpen={() => setIsOpen(true)}
      label={t`add channel`}
      icon={<FaPlus />}
      openIcon={
        canAddLive ? (
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
            className="h-7 -ml-1 px-1 flex items-center gap-0.5 rounded hover:text-white hover:bg-discord-dark-300"
          >
            {prefixIcon}
            <FaCaretDown className="text-[10px] opacity-70" />
          </button>
        ) : (
          prefixIcon
        )
      }
      value={name}
      onChange={changeName}
      onKeyDown={(e) => {
        if (e.key === "Backspace" && name === "") {
          setPrefix(KIND_PREFIXES.text);
          setHasTypedPrefix(false);
        }
      }}
      placeholder={placeholders[kind]}
      inputLabel={kindLabels[kind]}
      submitLabel={t`Add channel`}
      onSubmit={submit}
      onClose={close}
      inputRef={inputRef}
    >
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
    </InlineEntryRow>
  );
};

export default AddChannelRow;
