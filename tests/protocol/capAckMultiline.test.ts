import { describe, expect, test, vi } from "vitest";
import { handleCap } from "../../src/lib/irc/handlers/connection";
import type { IRCClientContext } from "../../src/lib/irc/IRCClientContext";

function ctxWithSpy() {
  const onCapAck = vi.fn();
  return {
    ctx: { onCapAck } as unknown as IRCClientContext,
    onCapAck,
  };
}

// Reproduces the h4ks transcript: one CAP REQ answered across two lines, the
// first carrying the `*` continuation marker.
describe("CAP ACK continuation", () => {
  test("a continuation line is not a completed request", () => {
    const { ctx, onCapAck } = ctxWithSpy();
    handleCap(ctx, "s1", "irc.h4ks.com", ["*", "ACK", "*"], undefined, "sasl");
    expect(onCapAck).toHaveBeenCalledWith("s1", "sasl", false);
  });

  test("a line without the marker completes the request", () => {
    const { ctx, onCapAck } = ctxWithSpy();
    handleCap(
      ctx,
      "s1",
      "irc.h4ks.com",
      ["*", "ACK"],
      undefined,
      "draft/bot-cmds",
    );
    expect(onCapAck).toHaveBeenCalledWith("s1", "draft/bot-cmds", true);
  });

  test("two requests split over three lines count as two answers", () => {
    const { ctx, onCapAck } = ctxWithSpy();
    handleCap(ctx, "s1", "irc.h4ks.com", ["*", "ACK", "*"], undefined, "sasl");
    handleCap(
      ctx,
      "s1",
      "irc.h4ks.com",
      ["*", "ACK"],
      undefined,
      "draft/bot-cmds",
    );
    handleCap(
      ctx,
      "s1",
      "irc.h4ks.com",
      ["*", "ACK"],
      undefined,
      "obby.world/channel-bots",
    );

    const finals = onCapAck.mock.calls.filter((call) => call[2] === true);
    expect(finals).toHaveLength(2);
  });

  test("the caps on a continuation line still reach the client", () => {
    const { ctx, onCapAck } = ctxWithSpy();
    handleCap(
      ctx,
      "s1",
      "irc.h4ks.com",
      ["*", "ACK", "*"],
      undefined,
      "sasl away-notify",
    );
    expect(onCapAck.mock.calls[0][1]).toBe("sasl away-notify");
  });
});
