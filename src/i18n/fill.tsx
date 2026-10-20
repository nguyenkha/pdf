import { Fragment, type ReactNode } from "react";
/** Replaces {name} placeholders in a translated message. */
export function fill(message: string, values: Record<string, string | number>) {
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
/** Like fill, but a placeholder can be an element such as a link or icon. */
export function fillNodes(message: string, values: Record<string, ReactNode>) {
  return message
    .split(/(\{\w+\})/)
    .map((part, index) => (
      <Fragment key={index}>
        {/^\{\w+\}$/.test(part) ? (values[part.slice(1, -1)] ?? part) : part}
      </Fragment>
    ));
}
