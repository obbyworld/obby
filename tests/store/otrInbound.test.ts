import { describe, expect, test } from "vitest";
import { handleInboundOtr } from "../../src/store/handlers/otr";

// handleInboundOtr returns true when it consumes a frame (so the USERMSG handler
// stops and never renders it as a chat row). `skipProcessing` (set for our own
// echoed sends and for CHATHISTORY replays) must swallow without feeding the
// session — and both that path and the non-OTR path return before any
// store/backend work, so these stay fast and need no crypto setup.
describe("handleInboundOtr", () => {
  test("passes plaintext through (returns false → renders normally)", () => {
    expect(handleInboundOtr("srv", "bob", "hello there")).toBe(false);
    expect(handleInboundOtr("srv", "bob", "not ?OTR in the middle")).toBe(
      false,
    );
  });

  test("swallows every OTR body shape when skipProcessing is set", () => {
    for (const body of [
      "?OTR:abc.",
      "?OTRv23?",
      "?OTR Error: x",
      "?OTR,1,2,p,",
    ]) {
      expect(handleInboundOtr("srv", "bob", body, true)).toBe(true);
    }
  });
});
