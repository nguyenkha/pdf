import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutGrid } from "lucide-react";
import type { Messages } from "../i18n";
import { availableTools, type Tool } from "../app/tools";
/** Header menu of all built tools, reachable from every page. */
export function ToolsMenu({
  t,
  locale,
  active,
}: {
  t: Messages;
  locale: string;
  active?: Tool;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="tools-menu" ref={root}>
      <button
        type="button"
        className="tools-menu-button"
        aria-label={t.tools}
        aria-expanded={open}
        aria-controls="tools-menu-list"
        onClick={() => setOpen(!open)}
      >
        <LayoutGrid size={16} aria-hidden="true" />
        <span>{t.tools}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul id="tools-menu-list">
          {availableTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <li key={tool.id}>
                <a
                  href={`/${locale}/${tool.slug ? `${tool.slug}/` : ""}`}
                  aria-current={tool.id === active?.id ? "page" : undefined}
                >
                  <Icon size={16} aria-hidden="true" />
                  {t[tool.nameKey]}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
