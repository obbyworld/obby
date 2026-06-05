import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  attrsToValues,
  BouncerNetworkForm,
  valuesToAttrs,
} from "../../src/components/ui/BouncerNetworkForm";

describe("attrsToValues", () => {
  test("maps standard attributes through", () => {
    const v = attrsToValues({
      name: "Libera",
      host: "irc.libera.chat",
      port: "6697",
      tls: "1",
      nickname: "nick",
      username: "user",
      realname: "real",
      pass: "p",
    });
    expect(v).toEqual({
      name: "Libera",
      host: "irc.libera.chat",
      port: "6697",
      tls: true,
      nickname: "nick",
      username: "user",
      realname: "real",
      pass: "p",
    });
  });

  test("defaults missing attributes to empty/TLS=on", () => {
    const v = attrsToValues({});
    expect(v.tls).toBe(true);
    expect(v.name).toBe("");
    expect(v.host).toBe("");
  });

  test("tls=0 disables TLS", () => {
    expect(attrsToValues({ tls: "0" }).tls).toBe(false);
  });
});

describe("valuesToAttrs", () => {
  const base = {
    name: "",
    host: "",
    port: "",
    tls: true,
    nickname: "",
    username: "",
    realname: "",
    pass: "",
  };

  test("emits all set values when no original provided (add)", () => {
    const out = valuesToAttrs({
      ...base,
      name: "Libera",
      host: "irc.libera.chat",
      port: "6697",
    });
    expect(out).toEqual({
      name: "Libera",
      host: "irc.libera.chat",
      port: "6697",
      tls: "1",
      nickname: "",
      username: "",
      realname: "",
      pass: "",
    });
  });

  test("emits only diffs when original provided (edit)", () => {
    const original = {
      name: "Libera",
      host: "irc.libera.chat",
      port: "6697",
      tls: "1",
      nickname: "old",
      username: "",
      realname: "",
      pass: "",
    };
    const out = valuesToAttrs(
      { ...base, ...{ ...attrsToValues(original), nickname: "new" } },
      original,
    );
    expect(out).toEqual({ nickname: "new" });
  });

  test("treats unset original tls as enabled (1) for diffing", () => {
    const original = { host: "x" };
    const values = { ...base, host: "x", tls: true };
    const out = valuesToAttrs(values, original);
    expect(out).toEqual({});
  });

  test("emits tls=0 when toggled off from enabled-default original", () => {
    const original = { host: "x" };
    const values = { ...base, host: "x", tls: false };
    const out = valuesToAttrs(values, original);
    expect(out).toEqual({ tls: "0" });
  });

  test("does not emit read-only attributes", () => {
    const out = valuesToAttrs({ ...base, host: "x" });
    expect(out).not.toHaveProperty("state");
    expect(out).not.toHaveProperty("error");
  });
});

describe("<BouncerNetworkForm/>", () => {
  test("renders empty fields in add mode", () => {
    render(<BouncerNetworkForm onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId("bouncer-form-host")).toHaveValue("");
    expect(screen.getByTestId("bouncer-form-name")).toHaveValue("");
  });

  test("save is disabled with empty host", () => {
    render(<BouncerNetworkForm onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId("bouncer-form-save")).toBeDisabled();
  });

  test("enables save once host is set (add mode)", () => {
    const onSave = vi.fn();
    render(<BouncerNetworkForm onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId("bouncer-form-host"), {
      target: { value: "irc.libera.chat" },
    });
    const btn = screen.getByTestId("bouncer-form-save");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0]).toMatchObject({ host: "irc.libera.chat" });
  });

  test("edit mode disables save until a change is made", () => {
    const initial = { name: "Libera", host: "irc.libera.chat", tls: "1" };
    render(
      <BouncerNetworkForm
        initial={initial}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bouncer-form-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("bouncer-form-name"), {
      target: { value: "Libera Renamed" },
    });
    expect(screen.getByTestId("bouncer-form-save")).not.toBeDisabled();
  });

  test("renders field-level error from props", () => {
    render(
      <BouncerNetworkForm
        errorAttribute="host"
        errorMessage="bad host"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("bad host")).toBeInTheDocument();
  });

  test("delete confirmation flow only in edit mode", () => {
    const onDelete = vi.fn();
    render(
      <BouncerNetworkForm
        initial={{ host: "x" }}
        onDelete={onDelete}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("bouncer-form-delete"));
    fireEvent.click(screen.getByTestId("bouncer-form-confirm-delete"));
    expect(onDelete).toHaveBeenCalled();
  });
});
