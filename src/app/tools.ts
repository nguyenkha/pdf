import type { ComponentType } from "react";
import { FileArchive, FileCode, Merge, type LucideIcon } from "lucide-react";
import type { Messages } from "../i18n";
import type { Locale } from "../i18n/config";
import type { SizePreset } from "./sizes";

export type ToolProps = {
  t: Messages;
  locale: Locale;
  preset?: SizePreset;
  shared?: boolean;
};
export type Tool = {
  id: string;
  /** Path segment under /{locale}/; the locale home redirects to compress. */
  slug: string;
  nameKey: keyof Messages;
  icon: LucideIcon;
  /** Absent while a tool is planned; planned tools never show by name. */
  load?: () => Promise<{ default: ComponentType<ToolProps> }>;
};
// Adding a tool: build it under src/tools/<id>/, give it `load` and its
// strings; the switcher, routes, SEO pages and sitemap pick it up. While
// any tool is still planned, the switcher shows one unnamed "more tools
// coming" placeholder.
export const tools: Tool[] = [
  {
    id: "compress",
    slug: "compress",
    nameKey: "compress",
    icon: FileArchive,
    load: () => import("../tools/compress/CompressTool"),
  },
  {
    id: "merge",
    slug: "merge",
    nameKey: "toolMerge",
    icon: Merge,
    load: () => import("../tools/merge/MergeTool"),
  },
  {
    id: "markdown",
    slug: "markdown",
    nameKey: "toolMarkdown",
    icon: FileCode,
    load: () => import("../tools/pdf-to-md/MarkdownTool"),
  },
  // Planned, in this order; names stay out of the interface until built.
  { id: "images-to-pdf", slug: "jpg-to-pdf", nameKey: "compress", icon: FileArchive },
  { id: "pdf-to-images", slug: "pdf-to-jpg", nameKey: "compress", icon: FileArchive },
];
export const availableTools = tools.filter((tool) => tool.load);
export const morePlanned = availableTools.length < tools.length;
/** The tool a URL path points at; size pages belong to compress. */
export function toolFromPath(pathname: string): Tool {
  const segment = pathname.split("/")[2] ?? "";
  return availableTools.find((tool) => tool.slug && tool.slug === segment) ?? tools[0];
}
