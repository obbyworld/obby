import DOMPurify from "dompurify";
import { marked } from "marked";
import React from "react";
/* eslint-disable no-control-regex */
import type { Server, User } from "../types";
import { isTauri } from "./platformUtils";

// highlight.js core + a curated ~25-language subset (see ./hljs) instead of the
// full ~1.6MB build. Lazy-loaded as one chunk so it never blocks startup; the
// first code block render falls back to plain text until it resolves.
type HljsType = typeof import("./hljs").default;
let hljsModule: HljsType | null = null;
import("./hljs").then((m) => {
  hljsModule = m.default;
});

/** True when `target` is a channel name as opposed to a nick. Mirrors
 * the ircd's CHANTYPES -- standard text (`#`), local text (`&` per
 * RFC 1459/2811), voice (`^`), and stream (`$`) channels. The receive
 * path uses this to choose between the CHANMSG event (channel) and
 * USERMSG event (DM); a hardcoded `startsWith("#")` here was silently
 * routing every PRIVMSG to a $-channel as a DM-from-self, which is
 * why messages on stream channels echoed back to the input but never
 * appeared in the chat. */
export function isChannelTarget(name: string | undefined | null): boolean {
  if (!name) return false;
  const c = name[0];
  return c === "#" || c === "&" || c === "^" || c === "$";
}

/** Split an IRCv3 named-modes mode name into its vendor prefix and a
 * human-readable display label.
 *
 * Examples:
 *   "op"                            -> { vendor: undefined, display: "Op" }
 *   "topiclock"                     -> { vendor: undefined, display: "Topiclock" }
 *   "obsidianirc/this-mode-lol"     -> { vendor: "obsidianirc",
 *                                        display: "This Mode Lol" }
 *   "example.org/history"           -> { vendor: "example.org",
 *                                        display: "History" }
 *
 * The display string title-cases each hyphen/underscore-separated word.
 * The vendor (if any) is always lower-cased so the UI badge is uniform.
 */
export function humanizeNamedMode(name: string): {
  vendor?: string;
  display: string;
} {
  const slash = name.indexOf("/");
  let vendor: string | undefined;
  let raw: string;
  if (slash === -1) {
    raw = name;
  } else {
    vendor = name.slice(0, slash).toLowerCase();
    raw = name.slice(slash + 1);
  }
  const display = raw
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return { vendor, display: display || raw };
}

export function parseNamesResponse(namesResponse: string): User[] {
  const users: User[] = [];
  for (const name of namesResponse.split(" ")) {
    // Try to match with userhost format first (nick!user@host)
    let regex = /([~&@%+]*)([^\s!]+)!/;
    let match = regex.exec(name);

    if (!match) {
      // If no match, try without ! (just nickname)
      regex = /([~&@%+]*)([^\s!]+)/;
      match = regex.exec(name);
    }

    if (match) {
      const [_, prefix, username] = match;
      users.push({
        id: username,
        username,
        status: prefix,
        isOnline: true,
      });
    }
  }
  return users;
}

function parseStatus(
  prefix: string,
): "online" | "idle" | "dnd" | "offline" | undefined {
  if (prefix.includes("~")) return "online"; // Owner
  if (prefix.includes("@")) return "online"; // Admin
  if (prefix.includes("%")) return "idle"; // Half-op
  if (prefix.includes("+")) return "dnd"; // Voiced
  return "offline"; // Default
}

// Inverse of UnrealIRCd's `message_tag_escape`. Per IRCv3:
//   \:  -> ;
//   \s  -> space
//   \\  -> \
//   \r  -> CR
//   \n  -> LF
// A trailing lone backslash is dropped; a backslash followed by any
// other char is collapsed to that char (per spec, "drop the preceding
// backslash").
function unescapeTagValue(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = s[++i];
    if (next === undefined) break;
    switch (next) {
      case ":":
        out += ";";
        break;
      case "s":
        out += " ";
        break;
      case "\\":
        out += "\\";
        break;
      case "r":
        out += "\r";
        break;
      case "n":
        out += "\n";
        break;
      default:
        out += next;
        break;
    }
  }
  return out;
}

export function parseMessageTags(tags: string): Record<string, string> {
  const parsedTags: Record<string, string> = {};
  const tagPairs = tags.substring(1).split(";");

  for (const tag of tagPairs) {
    const eq = tag.indexOf("=");
    if (eq < 0) {
      parsedTags[tag] = "";
    } else {
      const key = tag.substring(0, eq);
      parsedTags[key] = unescapeTagValue(tag.substring(eq + 1));
    }
  }

  return parsedTags;
}

/**
 * Check if a user is verified based on the account tag matching their nickname.
 * According to IRCv3 account-tag spec, if the account tag matches the sender's nick
 * (case-insensitively), the user is authenticated to that account.
 */
export function isUserVerified(
  senderNick: string,
  messageTags?: Record<string, string>,
): boolean {
  if (!messageTags?.account) {
    return false;
  }

  // Case-insensitive comparison as per the requirement
  return senderNick.toLowerCase() === messageTags.account.toLowerCase();
}

export function parseIsupport(tokens: string): Record<string, string> {
  const tokenMap: Record<string, string> = {};
  const tokenPairs = tokens.split(" ");

  for (const token of tokenPairs) {
    const [key, value] = token.split("=");
    if (value) {
      // Replace \x20 with actual space character
      tokenMap[key] = value.replace(/\\x20/g, " ");
    } else {
      tokenMap[key] = ""; // empty string fallback
    }
  }

  return tokenMap;
}

// Thanks to Talon

export const ircColors = [
  "#FFFFFF", // 0 - White
  "#000000", // 1 - Black
  "#00007F", // 2 - Blue (Navy)
  "#009300", // 3 - Green
  "#FF0000", // 4 - Red
  "#7F0000", // 5 - Brown (Maroon)
  "#9C009C", // 6 - Purple
  "#FC7F00", // 7 - Orange
  "#FFFF00", // 8 - Yellow
  "#00FC00", // 9 - Light Green
  "#009393", // 10 - Cyan
  "#00FFFF", // 11 - Light Cyan
  "#0000FC", // 12 - Light Blue
  "#FF00FF", // 13 - Pink
  "#7F7F7F", // 14 - Grey
  "#D2D2D2", // 15 - Light Grey
  "#470000", // 16
  "#472100", // 17
  "#474700", // 18
  "#324700", // 19
  "#004700", // 20
  "#00472C", // 21
  "#004747", // 22
  "#002747", // 23
  "#000047", // 24
  "#2E0047", // 25
  "#470047", // 26
  "#47002A", // 27
  "#740000", // 28
  "#743A00", // 29
  "#747400", // 30
  "#517400", // 31
  "#007400", // 32
  "#007449", // 33
  "#007474", // 34
  "#004074", // 35
  "#000074", // 36
  "#4B0074", // 37
  "#740074", // 38
  "#740045", // 39
  "#B50000", // 40
  "#B56300", // 41
  "#B5B500", // 42
  "#7DB500", // 43
  "#00B500", // 44
  "#00B571", // 45
  "#00B5B5", // 46
  "#0063B5", // 47
  "#0000B5", // 48
  "#7500B5", // 49
  "#B500B5", // 50
  "#B5006B", // 51
  "#FF000B", // 52
  "#FF8C00", // 53
  "#FFFF0B", // 54
  "#B2FF00", // 55
  "#00FF00", // 56
  "#00FFA0", // 57
  "#00FFFB", // 58
  "#008CFF", // 59
  "#0000FF", // 60
  "#A500FF", // 61
  "#FF00FB", // 62
  "#FF0098", // 63
  "#FF5959", // 64
  "#FFB459", // 65
  "#FFFF71", // 66
  "#CFFF60", // 67
  "#6FFF6F", // 68
  "#65FFC9", // 69
  "#6DFFFF", // 70
  "#59B4FF", // 71
  "#5959FF", // 72
  "#C459FF", // 73
  "#FF66FF", // 74
  "#FF59BC", // 75
  "#FF9C9C", // 76
  "#FFD39C", // 77
  "#FFFF9C", // 78
  "#E2FF9C", // 79
  "#9CFF9C", // 80
  "#9CFFDB", // 81
  "#9CFFFF", // 82
  "#9CD3FF", // 83
  "#9C9CFF", // 84
  "#DC9CFF", // 85
  "#FF9CFF", // 86
  "#FF94D3", // 87
  "#00000A", // 88
  "#131313", // 89
  "#282828", // 90
  "#363636", // 91
  "#4D4D4D", // 92
  "#656565", // 93
  "#818181", // 94
  "#9F9F9F", // 95
  "#BCBCBC", // 96
  "#E2E2E2", // 97
  "#FFFFFF", // 98
  "inherit", // 99 - Default (not universally supported)
];

// biome-ignore lint/suspicious/noControlCharactersInRegex: IRC formatting codes
const IRC_FORMAT_RE = /\x03\d{0,2}(,\d{0,2})?|[\x02\x1D\x1F\x1E\x11\x0F]/g;

/**
 * Build a map of line index → IRC color style for the original text.
 * Only tracks the dominant color per line (first color set on that line).
 * Returns the map and the text with all IRC formatting stripped.
 */
function extractIrcColorMap(text: string): {
  cleaned: string;
  lineColors: Map<number, string>;
} {
  let fg = -1;
  let bg = -1;
  let lineIdx = 0;
  const lineColors = new Map<number, string>();

  // biome-ignore lint/suspicious/noControlCharactersInRegex: IRC control codes
  const regex = /(\x03(?:\d{1,2}(?:,\d{1,2})?)?|[\x02\x1D\x1F\x1E\x11\x0F])/g;

  const parts = text.split(regex);
  let cleaned = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 0) {
      // Count newlines to track line index
      for (const ch of part) {
        if (ch === "\n") lineIdx++;
      }
      cleaned += part;
      continue;
    }
    if (part === "\x0F") {
      fg = -1;
      bg = -1;
    } else if (part.startsWith("\x03")) {
      const nums = part.slice(1);
      if (nums.length > 0) {
        const [fgStr, bgStr] = nums.split(",");
        fg = fgStr !== undefined ? Number(fgStr) : -1;
        bg = bgStr !== undefined ? Number(bgStr) : -1;
      } else {
        fg = -1;
        bg = -1;
      }
    }
    // Record color for current line (and future lines until changed)
    if (fg >= 0 && fg < ircColors.length) {
      const styles = [`color:${ircColors[fg]}`];
      if (bg >= 0 && bg < ircColors.length) {
        styles.push(`background-color:${ircColors[bg]}`);
      }
      if (!lineColors.has(lineIdx)) {
        lineColors.set(lineIdx, styles.join(";"));
      }
    }
  }

  return { cleaned, lineColors };
}

/**
 * Apply IRC color styles to HTML output from marked, skipping code blocks.
 * Only wraps content in <p>, <li>, <blockquote> tags — never code blocks.
 */
function applyIrcColorsToHtml(
  htmlStr: string,
  lineColors: Map<number, string>,
): string {
  if (lineColors.size === 0) return htmlStr;

  // Use first color as the dominant color for all prose
  const style = lineColors.values().next().value;
  if (!style) return htmlStr;

  // Match <p>...</p>, <li>...</li>, <blockquote>...</blockquote> that do NOT
  // contain code blocks. Uses [^<]* with inline tags to avoid matching across
  // block boundaries.
  return htmlStr.replace(
    /(<(?:p|li)(?:\s[^>]*)?>)((?:(?!<\/?(?:pre|div)\b)[\s\S])*?)(<\/(?:p|li)>)/g,
    (match, open, content, close) => {
      if (!content.trim()) return match;

      // Split on inline code containers so IRC colors don't bleed into them.
      // The capturing group in split() keeps the matched parts at odd indices.
      const parts = content.split(
        /(<span class="inline-code-container">[\s\S]*?<\/span>)/,
      );
      const colored = parts
        .map((part: string, i: number) => {
          if (i % 2 === 1) return part; // code container — leave as-is
          if (!part.trim()) return part;
          return `<span style="${style}">${part}</span>`;
        })
        .join("");

      return `${open}${colored}${close}`;
    },
  );
}

export function renderMarkdown(
  text: string,
  showExternalContent = true,
): React.ReactNode {
  // Basic input validation and sanitization
  if (!text || typeof text !== "string") {
    return <span>{text || ""}</span>;
  }

  // Limit input length to prevent DoS
  const maxLength = 10000;
  if (text.length > maxLength) {
    return <span>{text.substring(0, maxLength)}...</span>;
  }

  // Extract IRC colors and strip formatting before markdown parsing
  const { cleaned: markdownText, lineColors } = extractIrcColorMap(text);

  // Configure marked for safe rendering with custom renderer
  const renderer = new marked.Renderer();

  // Custom image renderer that respects external content settings
  renderer.image = ({ href, title, text }) => {
    // Sanitize URL to prevent javascript: and other malicious protocols
    const sanitizedHref = href.replace(/^(javascript|data|vbscript):/i, "#");

    if (!showExternalContent) {
      // Return a placeholder or link instead of the image
      const isExternalLink =
        sanitizedHref.startsWith("http://") ||
        sanitizedHref.startsWith("https://");
      const linkClass = isExternalLink
        ? "text-blue-500 hover:text-blue-700 underline external-link-security"
        : "text-blue-500 hover:text-blue-700 underline";
      return `<a href="${sanitizedHref}" target="_blank" rel="noopener noreferrer" class="${linkClass}">[Image: ${text || sanitizedHref}]</a>`;
    }
    // Allow the image to render normally, but make it clickable
    const titleAttr = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";
    const altAttr = ` alt="${(text || "").replace(/"/g, "&quot;")}"`;
    const imageHtml = `<img src="${sanitizedHref}"${altAttr}${titleAttr} class="max-w-full h-auto rounded-lg cursor-pointer" style="max-height: 150px;" />`;

    // Add special class for external links that need security warnings
    const isExternalLink =
      sanitizedHref.startsWith("http://") ||
      sanitizedHref.startsWith("https://");
    const linkClass = isExternalLink ? "external-link-security" : "";

    return `<a href="${sanitizedHref}" target="_blank" rel="noopener noreferrer" class="${linkClass}">${imageHtml}</a>`;
  };

  // Custom link renderer to sanitize URLs
  renderer.link = ({ href, title, text }) => {
    // Sanitize URL to prevent javascript: and other malicious protocols
    const sanitizedHref = href.replace(/^(javascript|data|vbscript):/i, "#");
    const titleAttr = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";

    // Add special class for external links that need security warnings
    const isExternalLink =
      sanitizedHref.startsWith("http://") ||
      sanitizedHref.startsWith("https://");
    const linkClass = isExternalLink
      ? "text-blue-500 hover:text-blue-700 underline external-link-security"
      : "text-blue-500 hover:text-blue-700 underline";

    return `<a href="${sanitizedHref}"${titleAttr} target="_blank" rel="noopener noreferrer" class="${linkClass}">${text}</a>`;
  };

  // Custom code renderer for inline code
  renderer.codespan = ({ text }) => {
    // Decode HTML entities back to characters for inline code
    let decodedText = text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");

    const hasActualNewlines = decodedText.includes("\n");
    const hasEscapedNewlines = decodedText.includes("\\n");

    if (hasActualNewlines || hasEscapedNewlines) {
      if (hasEscapedNewlines) {
        decodedText = decodedText.replace(/\\n/g, "\n");
      }

      const codeId = `multiline-inline-code-${Math.random().toString(36).substr(2, 9)}`;
      const escapedForHtml = decodedText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

      return `<div class="code-block-container">
        <div class="code-block-header">
          <span class="language-label">text</span>
          <button class="copy-button" data-code-id="${codeId}" title="Copy to clipboard">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
        <pre><code id="${codeId}">${escapedForHtml}</code></pre>
      </div>`;
    }

    const escapedForHtml = decodedText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    const codeId = `inline-code-${Math.random().toString(36).substr(2, 9)}`;
    return `<span class="inline-code-container"><code id="${codeId}" class="inline-code">${escapedForHtml}</code><button class="inline-copy-button" data-code-id="${codeId}" title="Copy to clipboard">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button></span>`;
  };

  // Custom code block renderer
  renderer.code = ({ text, lang }) => {
    // Trim trailing whitespace/newlines that might be part of markdown formatting
    const trimmedText = text.trimEnd();

    // Decode HTML entities back to characters for code blocks
    const decodedText = trimmedText
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");

    let highlightedCode = decodedText;
    let language = lang;

    if (hljsModule) {
      if (lang && hljsModule.getLanguage(lang)) {
        try {
          const result = hljsModule.highlight(decodedText, { language: lang });
          highlightedCode = result.value;
          language = result.language;
        } catch (err) {
          try {
            const result = hljsModule.highlightAuto(decodedText);
            highlightedCode = result.value;
            language = result.language;
          } catch (autoErr) {
            highlightedCode = decodedText;
          }
        }
      } else if (!lang) {
        try {
          const result = hljsModule.highlightAuto(decodedText);
          highlightedCode = result.value;
          language = result.language;
        } catch (autoErr) {
          highlightedCode = decodedText;
        }
      }
    }

    const languageClass = language ? ` class="language-${language}"` : "";
    return `<pre><code${languageClass}>${highlightedCode}</code></pre>`;
  };

  // Temporarily replace blockquote markers to preserve them during HTML escaping
  const blockquotePlaceholder = "__BLOCKQUOTE_MARKER__";
  const textWithPlaceholders = markdownText.replace(
    /^> /gm,
    `${blockquotePlaceholder} `,
  );

  // Escape single-line tilde fenced code blocks (~~~lang code~~~) so they don't render as code
  const processedText = textWithPlaceholders.replace(
    /^~~~.*~~~$/gm,
    (match) => {
      // Escape the tildes so they render as literal text
      return match.replace(/~/g, "\\~");
    },
  );

  // Escape HTML tags in input so they render as text
  const escapedText = processedText.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Restore blockquote markers
  const finalText = escapedText.replace(
    new RegExp(blockquotePlaceholder, "g"),
    ">",
  );

  marked.setOptions({
    breaks: true,
    gfm: true,
    renderer: renderer,
  });

  // Parse markdown to HTML
  const html = marked.parse(finalText) as string;

  // Post-process HTML to add copy buttons to code blocks
  let processedHtml = html.replace(
    /<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
    (match, attrs, content) => {
      const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;

      // Extract language from class attribute (e.g., class="language-javascript")
      const languageMatch = attrs.match(/class="[^"]*language-([^"\s]+)/);
      const language = languageMatch ? languageMatch[1] : "text";
      const displayLanguage = language === "text" ? "plain text" : language;

      return `<div class="code-block-container"><div class="code-block-header">${displayLanguage}<button class="copy-button" data-code-id="${codeId}" title="Copy to clipboard"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div><pre><code id="${codeId}"${attrs}>${content}</code></pre></div>`;
    },
  );

  // Apply IRC colors to prose (after code blocks are wrapped, so we can skip them)
  processedHtml = applyIrcColorsToHtml(processedHtml, lineColors);

  const safeHtml = DOMPurify.sanitize(processedHtml, {
    ADD_ATTR: ["style", "data-code-id", "viewBox", "stroke-width", "rx", "ry"],
    ADD_TAGS: ["button"],
  });

  return (
    <div
      className="markdown-content"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify above
      dangerouslySetInnerHTML={{ __html: safeHtml }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const button =
          (target.closest(".copy-button") as HTMLButtonElement) ||
          (target.closest(".inline-copy-button") as HTMLButtonElement);
        if (button) {
          const codeId = button.getAttribute("data-code-id");
          if (codeId) {
            const codeElement = document.getElementById(codeId);
            if (codeElement) {
              const textToCopy = codeElement.textContent || "";
              navigator.clipboard
                .writeText(textToCopy)
                .then(() => {
                  // Show success feedback
                  const originalText = button.innerHTML;
                  button.innerHTML = `
                  <svg width="${button.classList.contains("inline-copy-button") ? "12" : "16"}" height="${button.classList.contains("inline-copy-button") ? "12" : "16"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20,6 9,17 4,12"></polyline>
                  </svg>
                `;
                  button.style.color = "#10b981";
                  setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.color = "";
                  }, 2000);
                })
                .catch((err) => {
                  console.error("Failed to copy text: ", err);
                  // Show error feedback
                  const originalText = button.innerHTML;
                  button.innerHTML = `
                  <svg width="${button.classList.contains("inline-copy-button") ? "12" : "16"}" height="${button.classList.contains("inline-copy-button") ? "12" : "16"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                `;
                  button.style.color = "#ef4444";
                  setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.color = "";
                  }, 2000);
                });
            }
          }
        }
      }}
    />
  );
}

export function processMarkdownInText(
  text: string,
  showExternalContent = true,
  enableMarkdown = false,
  keyPrefix = "",
): React.ReactNode {
  // Check if text contains markdown syntax patterns
  const markdownPatterns = [
    /^#{1,6}/m, // Headers (# ## ### etc.)
    /\*\*.*?\*\*/, // Bold (**text**)
    /\*.*?\*/, // Italic (*text*) or (*text*) but not single * at word boundaries
    /_.*?_/, // Italic (_text_)
    /`.*?`/, // Inline code
    /```[\s\S]*?```/, // Code blocks
    /~~~[\s\S]*?~~~/, // Tilde fenced code blocks
    /~~.*?~~/, // Strikethrough (~~text~~)
    /^\* /m, // Unordered lists
    /^\d+\. /m, // Ordered lists
    /^> /m, // Blockquotes
    /\[.*?\]\(.*?\)/, // Links [text](url)
    /!\[.*?\]\(.*?\)/, // Images ![alt](url)
    /^\|.*\|.*$/m, // Table rows
    /^[\s]*\|[\s]*:?-+:?[\s]*\|.*$/m, // Table separators
  ];

  const hasMarkdown = markdownPatterns.some((pattern) => pattern.test(text));

  if (hasMarkdown && enableMarkdown) {
    // If markdown syntax is detected and markdown is enabled, render the entire text as markdown
    return renderMarkdown(text, showExternalContent);
  }
  // Otherwise, use the existing IRC formatting
  return mircToHtml(text, keyPrefix);
}

export function mircToHtml(text: string, keyPrefix = ""): React.ReactNode {
  const state = {
    bold: false,
    underline: false,
    italic: false,
    strikethrough: false,
    monospace: false,
    fg: ircColors.length, // Default foreground (no color set)
    bg: ircColors.length, // Default background (no color set)
  };

  function buildStyle(): React.CSSProperties {
    return {
      fontWeight: state.bold ? "bold" : undefined,
      textDecoration: state.underline
        ? "underline"
        : state.strikethrough
          ? "line-through"
          : undefined,
      fontStyle: state.italic ? "italic" : undefined,
      fontFamily: state.monospace ? "monospace" : undefined,
      backgroundColor:
        state.bg < ircColors.length ? ircColors[state.bg] : undefined,
      color: state.fg < ircColors.length ? ircColors[state.fg] : undefined,
    };
  }

  const result: React.ReactNode[] = [];
  let currentStyle = buildStyle();
  let currentText = "";

  const controlChars = [
    String.fromCharCode(2), // \x02
    String.fromCharCode(31), // \x1f
    String.fromCharCode(29), // \x1d
    String.fromCharCode(30), // \x1e
    String.fromCharCode(17), // \x11
    String.fromCharCode(15), // \x0f
  ].join("");

  const regex = new RegExp(
    `(\\x03(?:\\d{1,2}(?:,\\d{1,2})?)?|[${controlChars}])`,
    "gu",
  );

  text.split(regex).forEach((part, index) => {
    if (index % 2 === 0) {
      // Regular text
      currentText += part;
    } else {
      // Control codes
      if (currentText) {
        // Push the accumulated text with the current style
        result.push(
          <span key={result.length} style={currentStyle}>
            {currentText}
          </span>,
        );
        currentText = "";
      }

      switch (part) {
        case "\x02":
          state.bold = !state.bold;
          break;
        case "\x1f":
          state.underline = !state.underline;
          break;
        case "\x1d":
          state.italic = !state.italic;
          break;
        case "\x1e":
          state.strikethrough = !state.strikethrough;
          break;
        case "\x11":
          state.monospace = !state.monospace;
          break;
        case "\x0f":
          Object.assign(state, {
            bold: false,
            underline: false,
            italic: false,
            strikethrough: false,
            monospace: false,
            fg: ircColors.length,
            bg: ircColors.length,
          });
          break;
        default:
          if (part.startsWith("\x03")) {
            const [fg, bg] = part.slice(1).split(",").map(Number);
            state.fg = fg >= 0 && fg < ircColors.length ? fg : ircColors.length;
            state.bg = bg >= 0 && bg < ircColors.length ? bg : ircColors.length;
          }
          break;
      }

      // Update the current style
      currentStyle = buildStyle();
    }
  });

  // Push any remaining text
  if (currentText) {
    result.push(
      <span key={result.length} style={currentStyle}>
        {currentText}
      </span>,
    );
  }

  // Process URLs in the result
  const processedResult: React.ReactNode[] = [];
  const elementIndexRef = { current: 0 };
  result.forEach((node, index) => {
    if (React.isValidElement(node) && node.type === "span") {
      const props = node.props as {
        children?: React.ReactNode;
        style?: React.CSSProperties;
      };
      const textContent = props.children;
      if (typeof textContent === "string") {
        const urlProcessed = processUrlsInText(
          textContent,
          props.style,
          keyPrefix,
          elementIndexRef,
        );
        processedResult.push(...urlProcessed);
      } else {
        processedResult.push(node);
      }
    } else {
      processedResult.push(node);
    }
  });

  return <>{processedResult}</>;
}

// Helper function to detect and render URLs in text
function processUrlsInText(
  text: string,
  style?: React.CSSProperties,
  keyPrefix = "",
  elementIndexRef?: { current: number },
): React.ReactNode[] {
  // Check if running in Tauri native environment
  const isTauriEnv = isTauri();

  // URL regex pattern - matches http://, https://, irc://, ircs://, and www. URLs
  const urlRegex =
    /((?:https?|ircs?):\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+)/gi;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let elementIndex = elementIndexRef ? elementIndexRef.current : 0;
  let match: RegExpExecArray | null = urlRegex.exec(text);

  while (match !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      parts.push(
        <span key={`${keyPrefix}text-${elementIndex++}`} style={style}>
          {text.slice(lastIndex, match.index)}
        </span>,
      );
    }

    const url = match[0];
    const isIrcLink = url.startsWith("irc://") || url.startsWith("ircs://");

    // Ensure URL has protocol
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;

    // IRC links: only make clickable on Tauri, otherwise show as plain text
    if (isIrcLink && !isTauriEnv) {
      parts.push(
        <span
          key={`${keyPrefix}text-${elementIndex++}`}
          style={style}
          className="text-discord-text-muted"
        >
          {url}
        </span>,
      );
    } else {
      // Add appropriate class based on link type
      const isExternalLink =
        fullUrl.startsWith("http://") || fullUrl.startsWith("https://");
      const linkClass = isIrcLink
        ? "text-blue-500 hover:text-blue-700 underline irc-link"
        : isExternalLink
          ? "text-blue-500 hover:text-blue-700 underline external-link-security"
          : "text-blue-500 hover:text-blue-700 underline";

      parts.push(
        // inline-block + max-w + truncate: CSS ellipsis so the full URL text is in the
        // DOM (copy-paste works) while long URLs don't overflow the message bubble.
        <a
          key={`${keyPrefix}url-${elementIndex++}`}
          href={isIrcLink ? url : fullUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${linkClass} inline-block max-w-[40ch] truncate align-bottom`}
          style={style}
          title={url}
        >
          {url}
        </a>,
      );
    }

    lastIndex = match.index + match[0].length;
    match = urlRegex.exec(text);
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={`${keyPrefix}text-${elementIndex++}`} style={style}>
        {text.slice(lastIndex)}
      </span>,
    );
  }

  // Update the shared elementIndex if provided
  if (elementIndexRef) {
    elementIndexRef.current = elementIndex;
  }

  return parts.length > 0
    ? parts
    : [
        <span
          key={`${keyPrefix}text-${elementIndexRef ? elementIndexRef.current++ : 0}`}
          style={style}
        >
          {text}
        </span>,
      ];
}

// Utility function to get color style from metadata color value
export function getColorStyle(colorValue?: string): React.CSSProperties {
  if (!colorValue) return {};

  // If it's a hex color
  if (colorValue.startsWith("#")) {
    return { color: colorValue };
  }

  // If it's a named color
  if (colorValue.match(/^[a-zA-Z]+$/)) {
    return { color: colorValue };
  }

  // If it's an RGB/RGBA value
  if (colorValue.startsWith("rgb")) {
    return { color: colorValue };
  }

  // Default fallback
  return {};
}

/**
 * Get the display name for a channel, using metadata display-name if available
 * or falling back to the channel name with # prefix removed.
 */
export function getChannelDisplayName(
  channelName: string,
  metadata?: Record<string, { value: string | undefined; visibility: string }>,
): string {
  const displayName = metadata?.["display-name"]?.value;
  if (displayName) {
    return displayName;
  }
  // Strip the leading channel-type prefix for display (e.g. "#foo", "^bar",
  // "$baz", "&local" all render as the bare name). The prefix is shown by
  // the channel-type icon next to the title, so leaving it in the text
  // would be redundant.
  return channelName.replace(/^[#&^$]/, "");
}

/**
 * Get the avatar URL for a channel from metadata, with optional size substitution
 */
export function getChannelAvatarUrl(
  metadata?: Record<string, { value: string | undefined; visibility: string }>,
  size?: number,
): string | undefined {
  const avatarUrl = metadata?.avatar?.value;
  if (!avatarUrl) {
    return undefined;
  }

  // If size is provided and URL contains {size} placeholder, substitute it
  if (size && avatarUrl.includes("{size}")) {
    return avatarUrl.replace("{size}", size.toString());
  }

  return avatarUrl;
}

/**
 * Check if a user has operator (or higher) permissions in a channel
 * Operator status is indicated by @ or higher (~, &, etc.) in the user's status string
 */
export function hasOpPermission(userStatus?: string): boolean {
  if (!userStatus) return false;

  // Check for op (@), admin (&), or owner (~) status
  // These are higher permissions than halfop (%) or voice (+)
  return (
    userStatus.includes("@") ||
    userStatus.includes("&") ||
    userStatus.includes("~")
  );
}

/** Blocks relative paths, protocol-relative URLs, and non-http schemes that would
 * resolve against the app origin or trigger unexpected fetches. Browsers strip
 * leading whitespace and are scheme-case-insensitive, so we normalize the same way. */
export function isAbsoluteHttpUrl(url: string): boolean {
  const u = url.trimStart().toLowerCase();
  return u.startsWith("https://") || u.startsWith("http://");
}

/**
 * Check if a URL is from a specific filehost using proper URL parsing
 * This is safer than using string.startsWith() as it properly handles URL components
 */
export function isUrlFromFilehost(
  avatarUrl: string,
  filehost: string,
): boolean {
  if (!avatarUrl || !filehost) return false;

  try {
    const avatarUrlObj = new URL(avatarUrl);
    const filehostUrl = new URL(filehost);

    // Check if origins match (protocol + host + port)
    if (avatarUrlObj.origin !== filehostUrl.origin) {
      return false;
    }

    // Check if the pathname starts with the filehost pathname
    // This handles cases where filehost might be a subdirectory
    return avatarUrlObj.pathname.startsWith(filehostUrl.pathname);
  } catch {
    // If URL parsing fails, fall back to false
    return false;
  }
}

/**
 * Check if a URL is from any of the trusted media sources
 * This includes both the server's filehost and globally configured trusted URLs
 */
export function isUrlFromTrustedSource(
  url: string,
  serverFilehost?: string,
): boolean {
  if (!url) return false;

  // Check against server filehost
  if (serverFilehost && isUrlFromFilehost(url, serverFilehost)) {
    return true;
  }

  // Check against globally configured trusted media URLs
  const trustedUrls = __TRUSTED_MEDIA_URLS__;
  if (!trustedUrls || trustedUrls.length === 0) {
    return false;
  }

  for (const trustedUrl of trustedUrls) {
    if (trustedUrl && isUrlFromFilehost(url, trustedUrl)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a server is running UnrealIRCd based on the RPL_YOURHOST response
 * @param server The server object to check
 * @returns true if the server is running UnrealIRCd, false otherwise
 */
export function isUnrealIRCd(server: Server): boolean {
  return server.isUnrealIRCd === true;
}
