import type { Messages } from "../../i18n";
/** Maps a worker error code to a message the user can act on. */
export function errorMessage(t: Messages, failure: unknown) {
  const message = failure instanceof Error ? failure.message.toLowerCase() : "";
  if (message === "password-incorrect") return t.passwordWrong;
  if (message.includes("password")) return t.password;
  if (["unsupported", "preservation"].includes(message)) return t.unsupported;
  if (message === "corrupt" || message.includes("invalid pdf"))
    return t.corrupt;
  if (/memory|allocation/.test(message)) return t.memory;
  return t.failed;
}
