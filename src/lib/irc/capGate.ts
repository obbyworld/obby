const COMMAND_CAPS: Record<string, string> = {
  CHATHISTORY: "draft/chathistory",
  MARKREAD: "draft/read-marker",
  METADATA: "draft/metadata-2",
  REDACT: "draft/message-redaction",
  SETNAME: "setname",
};

const TAG_CAPS: Record<string, string> = {
  "+draft/bot-cmd": "draft/bot-cmds",
  "+draft/bot-cmds-query": "draft/bot-cmds",
  "+draft/bot-tools": "draft/bot-tools",
};

/** Capabilities the server must have ACKed before we may send a raw line. */
export function capsRequiredFor(line: string): string[] {
  const required: string[] = [];
  let rest = line;
  if (line.startsWith("@")) {
    const space = line.indexOf(" ");
    const tags = line.slice(1, space === -1 ? undefined : space);
    rest = space === -1 ? "" : line.slice(space + 1);
    required.push("message-tags");
    for (const tag of tags.split(";")) {
      const cap = TAG_CAPS[tag.split("=", 1)[0]];
      if (cap) required.push(cap);
    }
  }
  const cap = COMMAND_CAPS[rest.split(" ", 1)[0].toUpperCase()];
  if (cap) required.push(cap);
  return required;
}
