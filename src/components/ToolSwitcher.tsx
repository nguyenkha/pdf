import { Plus } from "lucide-react";
import type { Messages } from "../i18n";
import { availableTools, morePlanned, type Tool } from "../app/tools";
/** Built tools, plus one unnamed placeholder while more are planned. */
export function ToolSwitcher({
  t,
  locale,
  active,
}: {
  t: Messages;
  locale: string;
  active: Tool;
}) {
  if (availableTools.length < 2 && !morePlanned) return null;
  return (
    <nav className="tool-switcher" aria-label={t.tools}>
      <ul>
        {availableTools.map((tool) => {
          const Icon = tool.icon;
          return (
            <li key={tool.id}>
              <a
                href={`/${locale}/${tool.slug ? `${tool.slug}/` : ""}`}
                aria-current={tool.id === active.id ? "page" : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                {t[tool.nameKey]}
              </a>
            </li>
          );
        })}
        {morePlanned && (
          <li>
            <span className="soon">
              <Plus size={16} aria-hidden="true" />
              {t.coming}
            </span>
          </li>
        )}
      </ul>
    </nav>
  );
}
