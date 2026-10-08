/**
 * Utility functions for formatting IRC messages with colors and styling
 * Handles IRC formatting codes for bold, italic, underline, etc.
 */

import { ircColors } from "./ircUtils";

export type FormattingType =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "reverse"
  | "monospace";

export interface MessageFormatting {
  color?: string;
  formatting: FormattingType[];
}

/**
 * IRC formatting control codes
 */
export const IRC_FORMATTING_CODES = {
  bold: "\x02",
  italic: "\x1D",
  underline: "\x1F",
  strikethrough: "\x1E",
  reverse: "\x16",
  monospace: "\x11",
  color: "\x03",
  reset: "\x0F",
} as const;

/**
 * Gets the IRC color code for a given color name
 *
 * @param color - The color name or 'inherit' for no color
 * @returns IRC color code string (e.g., '\x0301' for black)
 *
 * @example
 * ```typescript
 * getIrcColorCode('red')     // Returns '\x0304'
 * getIrcColorCode('inherit') // Returns ''
 * ```
 */
export function getIrcColorCode(color: string): string {
  if (color === "inherit") return "";

  const index = ircColors.indexOf(color);
  if (index === -1 || index === 99) return "";

  // Format as two-digit number (e.g., 01, 02, 10)
  const formattedIndex = index < 10 ? `0${index}` : `${index}`;
  return `${IRC_FORMATTING_CODES.color}${formattedIndex}`;
}

/**
 * Applies IRC formatting codes to text
 *
 * @param text - The text to format
 * @param formatting - Array of formatting types to apply
 * @returns Text wrapped with IRC formatting codes
 *
 * @example
 * ```typescript
 * applyIrcFormatting('Hello', ['bold', 'italic'])
 * // Returns '\x02\x1DHello\x1D\x02'
 * ```
 */
export function applyIrcFormatting(
  text: string,
  formatting: FormattingType[],
): string {
  let formattedText = text;

  // Apply each formatting type
  for (const format of formatting) {
    const code = IRC_FORMATTING_CODES[format];
    if (code) {
      formattedText = `${code}${formattedText}${code}`;
    }
  }

  return formattedText;
}

/**
 * Formats a message with color and styling for IRC transmission
 *
 * @param text - The message text
 * @param options - Formatting options (color and styling)
 * @returns Formatted message ready for IRC transmission
 *
 * @example
 * ```typescript
 * formatMessageForIrc('Hello world', {
 *   color: 'red',
 *   formatting: ['bold', 'underline']
 * })
 * // Returns '\x0304\x02\x1FHello world\x1F\x02'
 * ```
 */
export function formatMessageForIrc(
  text: string,
  options: MessageFormatting,
): string {
  const { color, formatting } = options;

  // Apply formatting codes
  let formattedText = applyIrcFormatting(text, formatting);

  // Prepend color code if specified
  const colorCode = color ? getIrcColorCode(color) : "";
  if (colorCode) {
    formattedText = `${colorCode}${formattedText}`;
  }

  return formattedText;
}

/**
 * Gets CSS styles for preview based on formatting options
 *
 * @param options - Formatting options
 * @returns CSS style object
 */
export function getPreviewStyles(
  options: MessageFormatting,
): React.CSSProperties {
  const { color, formatting } = options;

  return {
    color: color && color !== "inherit" ? color : "inherit",
    fontWeight: formatting.includes("bold") ? "bold" : "normal",
    fontStyle: formatting.includes("italic") ? "italic" : "normal",
    textDecoration: formatting.includes("underline")
      ? "underline"
      : formatting.includes("strikethrough")
        ? "line-through"
        : "none",
    fontFamily: formatting.includes("monospace") ? "monospace" : "inherit",
  };
}

/**
 * Validates if a formatting type is supported
 *
 * @param format - The formatting type to validate
 * @returns true if the formatting type is supported
 */
export function isValidFormattingType(
  format: string,
): format is FormattingType {
  const validTypes: FormattingType[] = [
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "reverse",
    "monospace",
  ];
  return validTypes.includes(format as FormattingType);
}

/**
 * Strips IRC formatting codes from text
 *
 * @param text - The text with IRC formatting codes
 * @returns Plain text without formatting codes
 *
 * @example
 * ```typescript
 * stripIrcFormatting('\x0304\x02Hello\x02')
 * // Returns 'Hello'
 * ```
 */
export function stripIrcFormatting(text: string): string {
  return (
    text
      .replace(
        // biome-ignore lint/suspicious/noControlCharactersInRegex: IRC color control codes
        /\x04(?:[0-9A-Fa-f]{6}(?:,[0-9A-Fa-f]{6})?)?|\x03\d{0,2}(,\d{0,2})?/g,
        "",
      )
      // biome-ignore lint/suspicious/noControlCharactersInRegex: IRC formatting control codes
      .replace(/[\x02\x1D\x1F\x1E\x16\x11\x0F]/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: CTCP wrapper (\u0001WORD ...\u0001)
      .replace(/\u0001\w+ ?(.*?)\u0001/g, "$1")
  );
}
