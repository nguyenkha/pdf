import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { fill } from "../i18n/fill";
import type { Messages } from "../i18n";
import { availableTools, morePlanned, type Tool } from "../app/tools";
/**
 * The tool in use, then a "+" that unfolds the others in the same row: on
 * hover where there is a mouse, on tap or keyboard everywhere. One choice in
 * view until someone looks for more.
 */
export function ToolSwitcher({
  t,
  locale,
  active,
}: {
  t: Messages;
  locale: string;
  active: Tool;
}) {
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hover = () => typeof matchMedia === "function" && matchMedia("(hover: hover)").matches;
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        button.current?.focus();
      } else if (nav.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(leave.current), []);
  const others = availableTools.filter((tool) => tool.id !== active.id);
  if (!others.length && !morePlanned) return null;
  const Icon = active.icon;
  const href = (tool: Tool) => `/${locale}/${tool.slug ? `${tool.slug}/` : ""}`;
  return (
    <nav
      className="tool-switcher"
      aria-label={t.tools}
      ref={nav}
      onMouseEnter={() => {
        clearTimeout(leave.current);
        if (hover()) setOpen(true);
      }}
      // A short grace period, so moving the pointer across a gap keeps it open.
      onMouseLeave={() => {
        if (hover()) leave.current = setTimeout(() => setOpen(false), 250);
      }}
      onBlur={(event) => {
        if (!nav.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <a href={href(active)} aria-current="page">
        <Icon size={16} aria-hidden="true" />
        {t[active.nameKey]}
      </a>
      <button
        type="button"
        ref={button}
        className="tool-more-button"
        aria-expanded={open}
        aria-controls="tool-more-list"
        onClick={() => setOpen(!open)}
      >
        <Plus size={16} aria-hidden="true" />
        {/* Says there is more, and how much, in the space of one chip. */}
        {fill(t.moreTools, { count: others.length })}
      </button>
      <ul id="tool-more-list" className="tool-more-list" hidden={!open}>
        {others.map((tool) => {
          const ToolIcon = tool.icon;
          return (
            <li key={tool.id}>
              <a href={href(tool)}>
                <ToolIcon size={16} aria-hidden="true" />
                {t[tool.nameKey]}
              </a>
            </li>
          );
        })}
        {morePlanned && <li className="soon">{t.coming}</li>}
      </ul>
    </nav>
  );
}
