import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import { fill } from "../i18n/fill";
import type { Messages } from "../i18n";
import { availableTools, type Tool } from "../app/tools";
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
  // Still drawn while folding away, so closing animates like opening.
  const [shown, setShown] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const enter = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Opened from the keyboard: focus goes into the list, and back to + on close.
  const keyboard = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  const media = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;
  const hover = () => media("(hover: hover)");
  useEffect(() => {
    if (open) return setShown(true);
    const fold = setTimeout(
      () => {
        setShown(false);
        if (keyboard.current) requestAnimationFrame(() => button.current?.focus());
        keyboard.current = false;
      },
      media("(prefers-reduced-motion: reduce)") ? 0 : 170,
    );
    return () => clearTimeout(fold);
  }, [open]);
  // Once the list is drawn, a keyboard opening moves focus to its first tool.
  useEffect(() => {
    if (open && shown && keyboard.current) list.current?.querySelector("a")?.focus();
  }, [open, shown]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        clearTimeout(enter.current);
        keyboard.current = true;
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
  useEffect(
    () => () => {
      clearTimeout(leave.current);
      clearTimeout(enter.current);
    },
    [],
  );
  const others = availableTools.filter((tool) => tool.id !== active.id);
  if (!others.length) return null;
  const Icon = active.icon;
  const href = (tool: Tool) => `/${locale}/${tool.slug ? `${tool.slug}/` : ""}`;
  return (
    <nav
      className="tool-switcher"
      aria-label={t.tools}
      ref={nav}
      onMouseEnter={() => clearTimeout(leave.current)}
      // A short grace period, so moving the pointer across a gap keeps it open.
      onMouseLeave={() => {
        clearTimeout(enter.current);
        if (hover()) leave.current = setTimeout(() => setOpen(false), 250);
      }}
      // Close when focus moves elsewhere; hiding + drops focus to the body for
      // a moment before it moves into the list, which is not leaving.
      onBlur={() => {
        setTimeout(() => {
          const focused = document.activeElement;
          if (focused && focused !== document.body && !nav.current?.contains(focused)) setOpen(false);
        });
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
        // Once the others are out, + has done its job: they take its place.
        hidden={shown}
        // A brief pause, so a pointer just passing over does not unfold it.
        onMouseEnter={() => {
          if (hover()) enter.current = setTimeout(() => setOpen(true), 90);
        }}
        aria-controls="tool-more-list"
        onClick={(event) => {
          clearTimeout(enter.current);
          // detail is 0 for Enter or Space, which should move focus along.
          keyboard.current = event.detail === 0;
          setOpen(true);
        }}
      >
        <Plus size={16} aria-hidden="true" />
        {/* Says there is more, and how much, in the space of one chip. */}
        {fill(t.moreTools, { count: others.length })}
      </button>
      <ul
        id="tool-more-list"
        ref={list}
        className="tool-more-list"
        hidden={!shown}
        data-state={open ? "open" : "closing"}
      >
        {others.map((tool, index) => {
          const ToolIcon = tool.icon;
          return (
            <li key={tool.id} style={{ "--i": index } as CSSProperties}>
              <a href={href(tool)}>
                <ToolIcon size={16} aria-hidden="true" />
                {t[tool.nameKey]}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
