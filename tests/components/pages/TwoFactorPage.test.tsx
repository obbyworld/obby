import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TwoFactorPage from "../../../src/components/pages/TwoFactorPage";

const state = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("../../../src/store", () => {
  const useStore = vi.fn((selector?: (s: unknown) => unknown) =>
    selector ? selector(state.current) : state.current,
  );
  return {
    default: useStore,
    loadSavedServers: vi.fn(() => []),
  };
});

const webauthnRegister = vi.hoisted(() => vi.fn());
vi.mock("../../../src/lib/sasl/webauthn", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebAuthnAvailable: () => true,
  webauthnRegister,
}));

const challengeBlob = (n: number) =>
  btoa(JSON.stringify({ publicKey: { challenge: `c${n}` } }));

const makeState = () => ({
  ui: { isNarrowView: false, perServerSelections: {} },
  servers: [
    { id: "server1", capabilities: ["draft/account-2fa"], channels: [] },
  ],
  twofaStatus: { server1: "disabled" },
  twofaCredentials: {},
  pendingTwofaChallenge: {
    serverId: "server1",
    type: "webauthn",
    blob: challengeBlob(1),
  },
  openPage: vi.fn(),
  twofaStatusQuery: vi.fn(),
  twofaListQuery: vi.fn(),
  twofaChallenge: vi.fn(),
  twofaAdd: vi.fn(),
  twofaRemove: vi.fn(),
  twofaEnable: vi.fn(),
  twofaDisable: vi.fn(),
  linkOauthCredential: vi.fn(),
});

const page = { kind: "twoFactor", serverId: "server1" } as const;

describe("TwoFactorPage", () => {
  beforeEach(() => {
    state.current = makeState();
    webauthnRegister.mockReset();
    webauthnRegister.mockResolvedValue({ id: "cred" });
  });

  it("ignores a webauthn challenge left over from an earlier attempt", async () => {
    await act(async () => {
      render(<TwoFactorPage page={page} />);
    });
    expect(webauthnRegister).not.toHaveBeenCalled();
    expect(state.current.twofaAdd).not.toHaveBeenCalled();
  });

  it("registers the challenge that answers the click", async () => {
    const { rerender } = render(<TwoFactorPage page={page} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[1]);
    expect(state.current.twofaChallenge).toHaveBeenCalledWith(
      "server1",
      "webauthn",
    );

    state.current = {
      ...state.current,
      pendingTwofaChallenge: {
        serverId: "server1",
        type: "webauthn",
        blob: challengeBlob(2),
      },
    };
    await act(async () => {
      rerender(<TwoFactorPage page={page} />);
    });
    expect(webauthnRegister).toHaveBeenCalledTimes(1);
    expect(state.current.twofaAdd).toHaveBeenCalledWith(
      "server1",
      "webauthn",
      expect.any(String),
      expect.any(String),
    );
  });
});
