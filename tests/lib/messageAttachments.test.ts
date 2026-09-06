import { describe, expect, test } from "vitest";
import { encodeMediaDescriptor } from "../../src/lib/e2ee/media";
import { E2EE_MEDIA_TAG } from "../../src/lib/e2ee/messageFlags";
import {
  bodyWithoutAttachmentLinks,
  describeAttachment,
} from "../../src/lib/messageAttachments";
import type { Message } from "../../src/types";

function message(content: string, tags?: Record<string, string>): Message {
  return {
    id: "m1",
    type: "message",
    content,
    timestamp: new Date(),
    userId: "someone",
    channelId: "c1",
    serverId: "s1",
    reactions: [],
    replyMessage: null,
    mentioned: [],
    tags,
    // biome-ignore lint/suspicious/noExplicitAny: only the read fields matter
  } as any;
}

const descriptor = (mime: string, name: string) =>
  encodeMediaDescriptor({
    url: "https://files.example.org/ab12.obb",
    k: "aaaa",
    n: "bbbb",
    mime,
    name,
    size: 4242,
  });

describe("describeAttachment", () => {
  test("a message with no attachment reports none", () => {
    expect(describeAttachment(message("just talking"))).toBeNull();
  });

  // The reason the reply preview showed a bare nick: an encrypted attachment
  // puts nothing in the body, so a body-only scan finds nothing.
  test("an encrypted attachment is found on its tag", () => {
    const found = describeAttachment(
      message("", { [E2EE_MEDIA_TAG]: descriptor("audio/ogg", "voice.ogg") }),
    );
    expect(found).toMatchObject({
      kind: "audio",
      name: "voice.ogg",
      encrypted: true,
    });
  });

  test("an encrypted attachment has no readable thumbnail", () => {
    const found = describeAttachment(
      message("", { [E2EE_MEDIA_TAG]: descriptor("image/png", "shot.png") }),
    );
    expect(found?.kind).toBe("image");
    expect(found?.thumbnailUrl).toBeUndefined();
  });

  test("an unknown mime is a plain file", () => {
    const found = describeAttachment(
      message("", {
        [E2EE_MEDIA_TAG]: descriptor("application/octet-stream", "a.blend"),
      }),
    );
    expect(found).toMatchObject({ kind: "file", name: "a.blend" });
  });

  test("a pdf is its own kind", () => {
    const found = describeAttachment(
      message("", {
        [E2EE_MEDIA_TAG]: descriptor("application/pdf", "spec.pdf"),
      }),
    );
    expect(found?.kind).toBe("pdf");
  });

  test("a plain image url gives a thumbnail and a filename", () => {
    const found = describeAttachment(
      message("https://files.example.org/photo.jpg"),
    );
    expect(found).toMatchObject({
      kind: "image",
      name: "photo.jpg",
      encrypted: false,
      thumbnailUrl: "https://files.example.org/photo.jpg",
    });
  });

  // A link to somebody's page is not an attachment, which is what kept the
  // unencrypted-file warning firing on ordinary conversation.
  test("a bare link is not an attachment", () => {
    expect(
      describeAttachment(message("look at https://s.t3ks.com/")),
    ).toBeNull();
  });

  test("an embed link is not an attachment", () => {
    expect(
      describeAttachment(
        message("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      ),
    ).toBeNull();
  });

  test("the encrypted tag wins over a url in the body", () => {
    const found = describeAttachment(
      message("https://files.example.org/photo.jpg", {
        [E2EE_MEDIA_TAG]: descriptor("audio/ogg", "voice.ogg"),
      }),
    );
    expect(found).toMatchObject({ name: "voice.ogg", encrypted: true });
  });
});

describe("bodyWithoutAttachmentLinks", () => {
  // A reply preview names the file and shows its thumbnail, so the raw link
  // in the body is a wasted line.
  test("a body that is only a link comes back empty", () => {
    expect(
      bodyWithoutAttachmentLinks(
        message("https://files.example.org/photo.jpg"),
      ),
    ).toBe("");
  });

  test("what the sender actually wrote survives", () => {
    expect(
      bodyWithoutAttachmentLinks(
        message("look at this https://files.example.org/photo.jpg please"),
      ),
    ).toBe("look at this please");
  });

  test("a link that is not an attachment stays", () => {
    const text = "read https://s.t3ks.com/ first";
    expect(bodyWithoutAttachmentLinks(message(text))).toBe(text);
  });

  test("every attachment link goes, not just the first", () => {
    expect(
      bodyWithoutAttachmentLinks(
        message(
          "https://files.example.org/a.jpg and https://files.example.org/b.png",
        ),
      ),
    ).toBe("and");
  });
});
