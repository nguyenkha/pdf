import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import type { Messages } from "../i18n";
export function PasswordPrompt({
  t,
  busy,
  onSubmit,
  error,
  label,
  autoFocus = true,
}: {
  t: Messages;
  busy: boolean;
  onSubmit: (password: string) => void;
  /** Shown inside the prompt, next to the field it is about. */
  error?: string;
  /** Overrides the explanation, e.g. to name the file in a list. */
  label?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="password"
      onSubmit={(event) => {
        event.preventDefault();
        if (value) onSubmit(value);
      }}
    >
      <p>
        <LockKeyhole size={16} aria-hidden="true" />
        {label ?? t.password}
      </p>
      <div className="password-row">
        <input
          type="password"
          autoComplete="off"
          aria-label={t.passwordLabel}
          placeholder={t.passwordLabel}
          value={value}
          autoFocus={autoFocus}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className="primary" disabled={!value || busy}>
          {t.unlock}
        </button>
      </div>
      {error && (
        <small className="password-error" role="alert">
          {error}
        </small>
      )}
      <small>{t.passwordLocal}</small>
    </form>
  );
}
