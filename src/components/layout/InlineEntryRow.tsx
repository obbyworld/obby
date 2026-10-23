import type * as React from "react";
import { useEffect, useRef } from "react";
import { FaArrowRight } from "react-icons/fa";
import { useTypingOwner } from "../../hooks/useAutoFocusTyping";
import { TextInput } from "../ui/TextInput";

interface InlineEntryRowProps {
  isOpen: boolean;
  onOpen: () => void;
  label: React.ReactNode;
  icon: React.ReactNode;
  openIcon?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  inputLabel: string;
  submitLabel: string;
  onSubmit: () => void;
  onClose: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  frameRef?: React.Ref<HTMLDivElement>;
  inputAriaProps?: React.AriaAttributes & { role?: string };
  children?: React.ReactNode;
}

export const InlineEntryRow: React.FC<InlineEntryRowProps> = ({
  isOpen,
  onOpen,
  label,
  icon,
  openIcon,
  value,
  onChange,
  onKeyDown,
  placeholder,
  inputLabel,
  submitLabel,
  onSubmit,
  onClose,
  inputRef: externalInputRef,
  frameRef,
  inputAriaProps,
  children,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const ownInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? ownInputRef;
  useTypingOwner(inputRef, isOpen);

  // We cancel the entry on any press outside the row, and we count portaled
  // menus as inside it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onClose only calls the parent's state setters
  useEffect(() => {
    if (!isOpen) return;
    const cancelOnOutsidePress = (e: PointerEvent) => {
      const target = e.target as Element;
      if (rowRef.current?.contains(target)) return;
      if (target.closest?.("[data-popover-panel]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", cancelOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", cancelOnOutsidePress);
  }, [isOpen]);

  const rowFrameClass =
    "w-full min-h-10 px-2 flex items-center gap-2 rounded-md border transition-colors";

  return (
    <div ref={rowRef} className="mb-2">
      {isOpen ? (
        <div
          ref={frameRef}
          className={`${rowFrameClass} border-transparent bg-discord-dark-400 text-white`}
        >
          <span className="min-w-6 flex-shrink-0 flex items-center justify-center text-discord-channels-default">
            {openIcon ?? icon}
          </span>
          <TextInput
            ref={inputRef}
            className="flex-1 min-w-0 bg-transparent border-none outline-none py-1 font-medium text-discord-channels-active"
            placeholder={placeholder}
            aria-label={inputLabel}
            {...inputAriaProps}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              onKeyDown?.(e);
              if (e.defaultPrevented) return;
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            aria-label={submitLabel}
            disabled={!value.trim()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSubmit}
            className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded text-xs text-discord-green hover:bg-discord-dark-300 disabled:opacity-0"
          >
            <FaArrowRight />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className={`${rowFrameClass} text-left whitespace-nowrap border-dashed border-discord-text-muted/35 text-discord-channels-default hover:border-discord-text-muted/70 hover:text-discord-text-normal hover:bg-discord-dark-500/20`}
        >
          <span className="w-6 flex-shrink-0 flex items-center justify-center">
            {icon}
          </span>
          <span className="font-medium truncate">{label}</span>
        </button>
      )}
      {isOpen && children}
    </div>
  );
};

export default InlineEntryRow;
