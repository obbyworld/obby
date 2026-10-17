import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OAuthSection } from "../../../src/components/ui/OAuthSection";
import type { ServerOAuthConfig } from "../../../src/types";

const githubConfig: ServerOAuthConfig = {
  enabled: true,
  providerLabel: "GitHub",
  issuer: "https://github.com",
  clientId: "abc",
  scopes: "read:user user:email",
  tokenKind: "opaque",
  serverProvider: "github",
  authorizeEndpoint: "https://github.com/login/oauth/authorize",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  accessToken: "tok",
  idToken: "id",
  refreshToken: "ref",
};

describe("OAuthSection", () => {
  it("keeps the manual endpoints when another field is edited", () => {
    const onChange = vi.fn();
    render(<OAuthSection initial={githubConfig} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("abc"), {
      target: { value: "abcd" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clientId: "abcd",
        authorizeEndpoint: githubConfig.authorizeEndpoint,
        tokenEndpoint: githubConfig.tokenEndpoint,
      }),
    );
  });

  it("emits every preset field in one change", () => {
    const onChange = vi.fn();
    render(
      <OAuthSection
        initial={{
          enabled: true,
          providerLabel: "",
          issuer: "",
          clientId: "abc",
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "github" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerLabel: "GitHub",
        issuer: "https://github.com",
        scopes: "read:user user:email",
        tokenKind: "opaque",
        serverProvider: "github",
        authorizeEndpoint: githubConfig.authorizeEndpoint,
        tokenEndpoint: githubConfig.tokenEndpoint,
      }),
    );
  });

  it("clears the tokens on sign out", () => {
    const onChange = vi.fn();
    render(<OAuthSection initial={githubConfig} onChange={onChange} />);
    fireEvent.click(screen.getByText("Sign out"));
    const saved = onChange.mock.lastCall?.[0] as ServerOAuthConfig;
    expect(saved.accessToken).toBeUndefined();
    expect(saved.idToken).toBeUndefined();
    expect(saved.refreshToken).toBeUndefined();
    expect(saved.clientId).toBe("abc");
  });
});
