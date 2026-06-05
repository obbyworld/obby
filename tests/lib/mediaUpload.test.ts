import { describe, expect, it } from "vitest";
import { parseFilehostUploadResponse } from "../../src/lib/mediaUpload";

describe("parseFilehostUploadResponse (draft/FILEHOST)", () => {
  it("prefers the Location header (spec 201 response)", () => {
    expect(
      parseFilehostUploadResponse(
        "https://files.example/abc.png",
        '{"url":"https://other.example/ignored.png"}',
      ),
    ).toBe("https://files.example/abc.png");
  });

  it("reads a JSON body with `url` (s.h4ks.com /api/ style)", () => {
    expect(
      parseFilehostUploadResponse(
        null,
        '{"status":"success","url":"https://s.h4ks.com/HqI.txt"}',
      ),
    ).toBe("https://s.h4ks.com/HqI.txt");
  });

  it("reads a JSON body with the legacy `saved_url`", () => {
    expect(
      parseFilehostUploadResponse(null, '{"saved_url":"https://x.example/y"}'),
    ).toBe("https://x.example/y");
  });

  it("reads a plain-text URL body (s.h4ks.com root style)", () => {
    expect(
      parseFilehostUploadResponse(null, "https://s.h4ks.com/HqK.txt\n"),
    ).toBe("https://s.h4ks.com/HqK.txt");
  });

  it("returns null when no URL is present", () => {
    expect(parseFilehostUploadResponse(null, "")).toBeNull();
    expect(parseFilehostUploadResponse(null, "not a url")).toBeNull();
    expect(parseFilehostUploadResponse(null, '{"status":"error"}')).toBeNull();
  });

  it("ignores a non-http(s) plain-text body", () => {
    expect(
      parseFilehostUploadResponse(null, "ftp://nope.example/x"),
    ).toBeNull();
  });
});
