import type { ComponentType } from "react";
import type { Messages } from "../i18n";
import type { Locale } from "../i18n/config";
import type { SizePreset } from "./sizes";
export type Tool = {
  id: string;
  route: string;
  nameKey: keyof Messages;
  descriptionKey: keyof Messages;
  icon: string;
  load: () => Promise<{
    default: ComponentType<{
      t: Messages;
      locale: Locale;
      preset?: SizePreset;
      shared?: boolean;
    }>;
  }>;
  engineDependencies: string[];
};
export const tools: Tool[] = [
  {
    id: "compress",
    route: "/",
    nameKey: "compress",
    descriptionKey: "sub",
    icon: "file-archive",
    load: () => import("../tools/compress/CompressTool"),
    engineDependencies: ["@wasm-zoo/ghostscript"],
  },
];
