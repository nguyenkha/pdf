import type { ComponentType } from "react";
import { FileArchive, FileCode, LayoutGrid, Merge, type LucideIcon } from "lucide-react";
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
  /**
   * Landing pages for narrower searches ("rotate PDF") that open this same
   * tool with their own title, hero, intro, how-to text and FAQ. They are
   * not separate tools: the switcher shows the tool itself.
   */
  pages?: ToolPage[];
};
/** nameKey is the prefix of its strings: <nameKey>Title, Hero, Intro, HowText. */
export type ToolPage = { id: string; slug: string; nameKey: string };
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
  {
    id: "organize",
    slug: "organize",
    nameKey: "toolOrganize",
    icon: LayoutGrid,
    load: () => import("../tools/organize/OrganizeTool"),
    pages: [
      { id: "rotate-pdf", slug: "rotate-pdf", nameKey: "toolRotate" },
      { id: "delete-pdf-pages", slug: "delete-pdf-pages", nameKey: "toolDeletePages" },
    ],
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
  return (
    availableTools.find(
      (tool) => tool.slug === segment || tool.pages?.some((page) => page.slug === segment),
    ) ?? tools[0]
  );
}
/** The page a URL path shows: a tool's landing page, or the tool itself. */
export function pageFromPath(pathname: string): ToolPage {
  const tool = toolFromPath(pathname);
  const segment = pathname.split("/")[2] ?? "";
  return tool.pages?.find((page) => page.slug === segment) ?? tool;
}
