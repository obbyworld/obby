import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { FaCheck, FaTimes, FaTrash } from "react-icons/fa";
import { BOUNCER_READ_ONLY_ATTRIBUTES } from "../../lib/bouncerAttrs";
import { TextInput } from "./TextInput";

export interface BouncerFormValues {
  name: string;
  host: string;
  port: string;
  tls: boolean;
  nickname: string;
  username: string;
  realname: string;
  pass: string;
}

const EMPTY: BouncerFormValues = {
  name: "",
  host: "",
  port: "",
  tls: true,
  nickname: "",
  username: "",
  realname: "",
  pass: "",
};

export function attrsToValues(
  attrs: Record<string, string>,
): BouncerFormValues {
  return {
    name: attrs.name ?? "",
    host: attrs.host ?? "",
    port: attrs.port ?? "",
    tls: attrs.tls !== "0", // default: enabled
    nickname: attrs.nickname ?? "",
    username: attrs.username ?? "",
    realname: attrs.realname ?? "",
    pass: attrs.pass ?? "",
  };
}

// Reduce form state down to only attributes that differ from the
// originals. Empty strings are sent so server can clear values.
export function valuesToAttrs(
  values: BouncerFormValues,
  original?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const setIfChanged = (key: keyof BouncerFormValues, wireKey: string) => {
    if (BOUNCER_READ_ONLY_ATTRIBUTES.has(wireKey)) return;
    const v = values[key];
    const cur = typeof v === "boolean" ? (v ? "1" : "0") : v;
    if (original) {
      const origCur = original[wireKey] ?? "";
      const norm = wireKey === "tls" && origCur === "" ? "1" : origCur;
      if (norm === cur) return;
    }
    out[wireKey] = cur;
  };
  setIfChanged("name", "name");
  setIfChanged("host", "host");
  setIfChanged("port", "port");
  setIfChanged("tls", "tls");
  setIfChanged("nickname", "nickname");
  setIfChanged("username", "username");
  setIfChanged("realname", "realname");
  setIfChanged("pass", "pass");
  return out;
}

interface BouncerNetworkFormProps {
  initial?: Record<string, string>;
  errorAttribute?: string;
  errorMessage?: string;
  isSaving?: boolean;
  isDeleting?: boolean;
  onSave: (attrs: Record<string, string>) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

const Field: React.FC<{
  label: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  span?: 1 | 2;
}> = ({ label, error, children, span = 1 }) => (
  <label
    className={`flex flex-col text-xs text-discord-text-muted ${
      span === 2 ? "col-span-2" : ""
    }`}
  >
    <span className="mb-1">{label}</span>
    {children}
    {error && <span className="mt-1 text-red-400">{error}</span>}
  </label>
);

const inputClass = (hasError: boolean) =>
  `w-full px-2.5 py-1.5 rounded bg-discord-dark-400 text-discord-text-normal text-sm outline-none transition-colors border ${
    hasError
      ? "border-red-500 focus:border-red-400"
      : "border-transparent focus:border-primary"
  }`;

export const BouncerNetworkForm: React.FC<BouncerNetworkFormProps> = ({
  initial,
  errorAttribute,
  errorMessage,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
  onCancel,
}) => {
  const { t } = useLingui();
  const [values, setValues] = useState<BouncerFormValues>(() =>
    initial ? attrsToValues(initial) : EMPTY,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setValues(initial ? attrsToValues(initial) : EMPTY);
    setConfirmDelete(false);
  }, [initial]);

  const isEdit = !!initial;
  const canSave = useMemo(() => {
    if (!values.host.trim()) return false;
    if (isEdit) {
      const diff = valuesToAttrs(values, initial);
      return Object.keys(diff).length > 0;
    }
    return true;
  }, [values, initial, isEdit]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || isSaving) return;
    onSave(valuesToAttrs(values, initial));
  };

  const fieldError = (attr: string) =>
    errorAttribute === attr ? errorMessage : undefined;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={<Trans>Network Name</Trans>}
          error={fieldError("name")}
          span={2}
        >
          <TextInput
            type="text"
            value={values.name}
            onChange={(e) => setValues((s) => ({ ...s, name: e.target.value }))}
            placeholder={t`Libera Chat`}
            className={inputClass(!!fieldError("name"))}
            data-testid="bouncer-form-name"
          />
        </Field>
        <Field label={<Trans>Host</Trans>} error={fieldError("host")} span={2}>
          <TextInput
            type="text"
            value={values.host}
            onChange={(e) => setValues((s) => ({ ...s, host: e.target.value }))}
            placeholder="irc.libera.chat"
            required
            className={inputClass(!!fieldError("host"))}
            data-testid="bouncer-form-host"
          />
        </Field>
        <Field label={<Trans>Port</Trans>} error={fieldError("port")}>
          <TextInput
            type="text"
            inputMode="numeric"
            value={values.port}
            onChange={(e) => setValues((s) => ({ ...s, port: e.target.value }))}
            placeholder={values.tls ? "6697" : "6667"}
            className={inputClass(!!fieldError("port"))}
            data-testid="bouncer-form-port"
          />
        </Field>
        <Field label={<Trans>Transport</Trans>}>
          <button
            type="button"
            onClick={() => setValues((s) => ({ ...s, tls: !s.tls }))}
            className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors border ${
              values.tls
                ? "bg-green-600/20 text-green-300 border-green-600/50"
                : "bg-discord-dark-400 text-discord-text-normal border-transparent"
            }`}
            data-testid="bouncer-form-tls"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                values.tls ? "bg-green-400" : "bg-discord-text-muted"
              }`}
            />
            {values.tls ? <Trans>TLS</Trans> : <Trans>Plaintext</Trans>}
          </button>
        </Field>
        <Field label={<Trans>Nickname</Trans>} error={fieldError("nickname")}>
          <TextInput
            type="text"
            value={values.nickname}
            onChange={(e) =>
              setValues((s) => ({ ...s, nickname: e.target.value }))
            }
            placeholder={t`(inherit)`}
            className={inputClass(!!fieldError("nickname"))}
          />
        </Field>
        <Field label={<Trans>Username</Trans>} error={fieldError("username")}>
          <TextInput
            type="text"
            value={values.username}
            onChange={(e) =>
              setValues((s) => ({ ...s, username: e.target.value }))
            }
            placeholder={t`(inherit)`}
            className={inputClass(!!fieldError("username"))}
          />
        </Field>
        <Field
          label={<Trans>Real Name</Trans>}
          error={fieldError("realname")}
          span={2}
        >
          <TextInput
            type="text"
            value={values.realname}
            onChange={(e) =>
              setValues((s) => ({ ...s, realname: e.target.value }))
            }
            placeholder={t`(inherit)`}
            className={inputClass(!!fieldError("realname"))}
          />
        </Field>
        <Field
          label={<Trans>Server Password (PASS)</Trans>}
          error={fieldError("pass")}
          span={2}
        >
          <TextInput
            type="password"
            value={values.pass}
            onChange={(e) => setValues((s) => ({ ...s, pass: e.target.value }))}
            placeholder={isEdit ? t`(unchanged)` : ""}
            className={inputClass(!!fieldError("pass"))}
          />
        </Field>
      </div>

      {errorMessage && !errorAttribute && (
        <div className="rounded bg-red-600/10 border border-red-600/40 text-red-300 px-3 py-2 text-sm">
          {errorMessage}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div>
          {isEdit &&
            onDelete &&
            (confirmDelete ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-discord-text-muted">
                  <Trans>Delete this network?</Trans>
                </span>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
                  data-testid="bouncer-form-confirm-delete"
                >
                  <Trans>Yes, delete</Trans>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 rounded bg-discord-dark-400 hover:bg-discord-dark-300 text-discord-text-normal text-xs"
                >
                  <Trans>Cancel</Trans>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1 text-xs text-discord-text-muted hover:text-red-400 transition-colors"
                data-testid="bouncer-form-delete"
              >
                <FaTrash />
                <Trans>Delete network</Trans>
              </button>
            ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-discord-dark-400 hover:bg-discord-dark-300 text-discord-text-normal text-sm flex items-center gap-1"
          >
            <FaTimes />
            <Trans>Cancel</Trans>
          </button>
          <button
            type="submit"
            disabled={!canSave || isSaving}
            className="px-3 py-1.5 rounded bg-primary hover:bg-primary-hover text-white text-sm font-semibold flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            data-testid="bouncer-form-save"
          >
            <FaCheck />
            {isEdit ? <Trans>Save</Trans> : <Trans>Add Network</Trans>}
          </button>
        </div>
      </div>
    </form>
  );
};
