// Question/answer string keys: each tool's own questions first, then the
// ones that hold for every tool. Plain data, so scripts/seo.mjs can import
// it for the prerendered pages and FAQPage schema.
export const FAQ_GENERAL = [
  ["q2", "a2"],
  ["faqFreeQ", "faqFreeA"],
  ["q6", "a6"],
  ["faqOfflineQ", "faqOfflineA"],
] as const;
export const FAQ_BY_TOOL: Record<string, readonly (readonly [string, string])[]> = {
  compress: [
    ["q1", "a1"],
    ["q3", "a3"],
    ["q4", "a4"],
    ["q5", "a5"],
  ],
  merge: [
    ["mergeOrderQ", "mergeOrderA"],
    ["mergeKeptQ", "mergeKeptA"],
    ["mergeLockedQ", "mergeLockedA"],
    ["mergeLimitQ", "mergeLimitA"],
  ],
  markdown: [
    ["mdScanQ", "mdScanA"],
    ["mdTablesQ", "mdTablesA"],
    ["mdLayoutQ", "mdLayoutA"],
  ],
};
export function faqFor(toolId: string) {
  return [...(FAQ_BY_TOOL[toolId] ?? []), ...FAQ_GENERAL];
}
