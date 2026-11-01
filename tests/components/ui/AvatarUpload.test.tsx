import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AvatarUpload from "../../../src/components/ui/AvatarUpload";
import useStore from "../../../src/store";

vi.mock("../../../src/lib/ircClient", () => ({
  default: { requestToken: vi.fn(), on: vi.fn(), getNick: vi.fn() },
}));
vi.mock("../../../src/lib/authToken", () => ({
  waitForAuthToken: vi.fn(async () => "token"),
}));

const pickImage = (size = 10) => {
  const file = new File([new Uint8Array(size)], "a.png", { type: "image/png" });
  const input = document.querySelector('input[type="file"]') as HTMLElement;
  fireEvent.change(input, {
    target: { files: [file] },
  });
};

const renderUpload = (channelName?: string) =>
  render(
    <AvatarUpload
      serverId="s1"
      channelName={channelName}
      onAvatarUrlChange={vi.fn()}
    />,
  );

describe("AvatarUpload errors", () => {
  beforeEach(() => {
    useStore.setState({
      servers: [
        {
          id: "s1",
          name: "s1",
          host: "irc.example.com",
          port: 6697,
          channels: [],
          privateChats: [],
          users: [],
          isConnected: true,
          filehost: "https://files.example.com",
        },
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("names an unreachable upload server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Load failed")),
    );
    renderUpload("#a/b");
    pickImage();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Can't reach the upload server. Try again",
      ),
    );
  });

  it("tells a non-op who can change a channel avatar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("server detail", { status: 403 })),
    );
    renderUpload("#a/b");
    pickImage();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Only channel ops can change this",
      ),
    );
    expect(screen.queryByText(/server detail/)).toBeNull();
  });

  it("asks for a smaller image before uploading", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderUpload();
    pickImage(6 * 1024 * 1024);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose an image under 5 MB",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
