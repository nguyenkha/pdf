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
  // Pending return of focus to + after a close; must not outlive a reopening.
  const refocus = useRef(false);
  const cancelRefocus = () => {
    refocus.current = false;
  };
  const list = useRef<HTMLUListElement>(null);
  const media = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;
  const hover = () => media("(hover: hover)");
  useEffect(() => {
    if (open) {
      cancelRefocus();
      return setShown(true);
    }
    const fold = setTimeout(
      () => {
        setShown(false);
        // Stays set until focus has moved back, so a pointer resting where +
        // reappears does not reopen the list in between.
        if (keyboard.current) refocus.current = true;
      },
      media("(prefers-reduced-motion: reduce)") ? 0 : 170,
    );
    return () => clearTimeout(fold);
  }, [open]);
  // Once the list is drawn, a keyboard opening moves focus to its first tool.
  useEffect(() => {
    if (open && shown && keyboard.current) list.current?.querySelector("a")?.focus();
  }, [open, shown]);
  // + is only focusable once the commit that un-hides it has landed, so the
  // return of focus follows the DOM rather than a timer.
  useEffect(() => {
    if (open || shown || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
    keyboard.current = false;
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
      cancelRefocus();
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
          if (hover() && !keyboard.current) enter.current = setTimeout(() => setOpen(true), 90);
        }}
        aria-controls="tool-more-list"
        // Enter and Space open it here, and the key's own activation is
        // cancelled so it cannot land on the first link once focus moves.
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          clearTimeout(enter.current);
          cancelRefocus();
          keyboard.current = true;
          setOpen(true);
        }}
        onKeyUp={(event) => {
          if (event.key === " ") event.preventDefault();
        }}
        onClick={(event) => {
          clearTimeout(enter.current);
          // detail is 0 for clicks synthesised by assistive technology.
          if (event.detail === 0) keyboard.current = true;
          setOpen(true);
        }}
      >
        <Plus size={16} aria-hidden="true" />
        {/* Says there is more, and how much, in the space of one chip. */}
        {fill(t.moreTools, { count: others.length })}
      </button>
      {/* On phones this is a sheet from the bottom over a dimmed page; with a
          mouse the tools simply continue the row. */}
      <div className="tool-more-panel" hidden={!shown} data-state={open ? "open" : "closing"}>
        <div className="tool-more-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
        <div className="tool-more-sheet">
          <p className="tool-more-title" aria-hidden="true">
            {t.tools}
          </p>
          <ul id="tool-more-list" ref={list} className="tool-more-list">
            {others.map((tool, index) => {
              const ToolIcon = tool.icon;
              return (
                <li key={tool.id} style={{ "--i": index } as CSSProperties}>
                  <a href={href(tool)}>
                    <ToolIcon size={18} aria-hidden="true" />
                    {t[tool.nameKey]}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
