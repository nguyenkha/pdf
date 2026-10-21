import type { ComponentType } from "react";
import { FileArchive, FileCode, FileImage, Images, LayoutGrid, Merge, type LucideIcon } from "lucide-react";
import type { Messages } from "../i18n";
import type { Locale } from "../i18n/config";
import type { SizePreset } from "./sizes";

export type ToolProps = {
  t: Messages;
  locale: Locale;
  preset?: SizePreset;
  shared?: boolean;
  /** The landing page this tool runs on ("pdf-to-png"), when it is one. */
  page?: string;
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
  /** Other tools whose pages the "related" links also list (the reverse conversion). */
  related?: string[];
};
/** nameKey is the prefix of its strings: <nameKey>Title, Hero, Intro, HowText. */
export type ToolPage = { id: string; slug: string; nameKey: string };
/** A link to every page of this tool (itself first) and of its related tools. */
export function relatedPages(tool: Tool): ToolPage[] {
  const family = (item: Tool): ToolPage[] => [item, ...(item.pages ?? [])];
  const others = (tool.related ?? []).flatMap((id) => availableTools.filter((item) => item.id === id));
  return family(tool).length > 1 || others.length ? [...family(tool), ...others.flatMap(family)] : [];
}
// Adding a tool: build it under src/tools/<id>/, give it `load` and its
// strings; the switcher, routes, SEO pages and sitemap pick it up. Planned
// tools (no `load`) never show.
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
    // Both answer with plain text (.txt) rather than Markdown.
    pages: [
      { id: "pdf-to-text", slug: "pdf-to-text", nameKey: "toolPdfToText" },
      { id: "ocr-pdf", slug: "ocr-pdf", nameKey: "toolOcrPdf" },
    ],
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
  {
    id: "images-to-pdf",
    slug: "jpg-to-pdf",
    nameKey: "toolFromImages",
    icon: Images,
    load: () => import("../tools/images-to-pdf/ImagesToPdfTool"),
    pages: [
      { id: "png-to-pdf", slug: "png-to-pdf", nameKey: "toolPngToPdf" },
      { id: "image-to-pdf", slug: "image-to-pdf", nameKey: "toolImageToPdf" },
    ],
    related: ["pdf-to-images"],
  },
  {
    id: "pdf-to-images",
    slug: "pdf-to-jpg",
    nameKey: "toolToImages",
    icon: FileImage,
    load: () => import("../tools/pdf-to-images/PdfToImagesTool"),
    pages: [
      { id: "pdf-to-png", slug: "pdf-to-png", nameKey: "toolPdfToPng" },
      { id: "pdf-to-image", slug: "pdf-to-image", nameKey: "toolPdfToImage" },
    ],
    related: ["images-to-pdf"],
  },
];
export const availableTools = tools.filter((tool) => tool.load);
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
