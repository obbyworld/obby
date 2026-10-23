import { describe, expect, it } from "vitest";
import {
  ArgsError,
  buildWsUrl,
  parseArgs,
} from "../../scripts/lib/cliArgs.mjs";

describe("parseArgs", () => {
  it("parses host, port, room with the default delay", () => {
    const args = parseArgs(["irc.h4ks.com", "6608", "^test"]);
    expect(args).toEqual({
      host: "irc.h4ks.com",
      port: 6608,
      room: "^test",
      delayMs: 1000,
    });
  });

  it("accepts a $ stream room", () => {
    const args = parseArgs(["host", "6667", "$mystream"]);
    expect(args.room).toBe("$mystream");
  });

  it("accepts --delay as a separate argument", () => {
    const args = parseArgs(["host", "6667", "^test", "--delay", "3.5"]);
    expect(args.delayMs).toBe(3500);
  });

  it("accepts --delay=value", () => {
    const args = parseArgs(["host", "6667", "^test", "--delay=0.5"]);
    expect(args.delayMs).toBe(500);
  });

  it("rejects a room without ^ or $", () => {
    expect(() => parseArgs(["host", "6667", "test"])).toThrow(ArgsError);
  });

  it("rejects a non-numeric port", () => {
    expect(() => parseArgs(["host", "not-a-port", "^test"])).toThrow(ArgsError);
  });

  it("rejects a port out of range", () => {
    expect(() => parseArgs(["host", "70000", "^test"])).toThrow(ArgsError);
  });

  it("rejects the wrong number of positional arguments", () => {
    expect(() => parseArgs(["host", "6667"])).toThrow(ArgsError);
    expect(() => parseArgs(["host", "6667", "^test", "extra"])).toThrow(
      ArgsError,
    );
  });

  it("rejects a negative delay", () => {
    expect(() => parseArgs(["host", "6667", "^test", "--delay=-1"])).toThrow(
      ArgsError,
    );
  });

  it("throws the usage text for --help", () => {
    expect(() => parseArgs(["--help"])).toThrow(ArgsError);
  });
});

describe("buildWsUrl", () => {
  it("defaults to wss://", () => {
    expect(buildWsUrl("irc.h4ks.com", 6608)).toBe("wss://irc.h4ks.com:6608");
  });

  it("honors an explicit ws:// prefix", () => {
    expect(buildWsUrl("ws://localhost", 8097)).toBe("ws://localhost:8097");
  });

  it("honors an explicit wss:// prefix", () => {
    expect(buildWsUrl("wss://localhost", 443)).toBe("wss://localhost:443");
  });
});
