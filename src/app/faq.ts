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
  organize: [
    ["organizeRotateQ", "organizeRotateA"],
    ["organizeDeleteQ", "organizeDeleteA"],
    ["organizeKeptQ", "organizeKeptA"],
    ["organizeLockedQ", "organizeLockedA"],
  ],
  "images-to-pdf": [
    ["fromImagesFormatsQ", "fromImagesFormatsA"],
    ["fromImagesQualityQ", "fromImagesQualityA"],
    ["fromImagesMetadataQ", "fromImagesMetadataA"],
    ["fromImagesOrderQ", "fromImagesOrderA"],
    ["fromImagesSizeQ", "fromImagesSizeA"],
  ],
  "pdf-to-images": [
    ["toImagesQualityQ", "toImagesQualityA"],
    ["toImagesPagesQ", "toImagesPagesA"],
    ["toImagesPhoneQ", "toImagesPhoneA"],
    ["toImagesLockedQ", "toImagesLockedA"],
  ],
  "png-to-pdf": [
    ["fromImagesFormatsQ", "fromImagesFormatsA"],
    ["fromImagesQualityQ", "fromImagesQualityA"],
    ["fromImagesSizeQ", "fromImagesSizeA"],
  ],
  "image-to-pdf": [
    ["fromImagesFormatsQ", "fromImagesFormatsA"],
    ["fromImagesMetadataQ", "fromImagesMetadataA"],
    ["fromImagesOrderQ", "fromImagesOrderA"],
  ],
  "pdf-to-png": [
    ["toImagesQualityQ", "toImagesQualityA"],
    ["toImagesPagesQ", "toImagesPagesA"],
    ["toImagesLockedQ", "toImagesLockedA"],
  ],
  "pdf-to-image": [
    ["toImagesQualityQ", "toImagesQualityA"],
    ["toImagesPhoneQ", "toImagesPhoneA"],
    ["toImagesPagesQ", "toImagesPagesA"],
  ],
  "pdf-to-text": [
    ["textFormatQ", "textFormatA"],
    ["mdScanQ", "mdScanA"],
    ["mdLayoutQ", "mdLayoutA"],
  ],
  "ocr-pdf": [
    ["mdScanQ", "mdScanA"],
    ["ocrLanguagesQ", "ocrLanguagesA"],
    ["ocrLocalQ", "ocrLocalA"],
    ["textFormatQ", "textFormatA"],
  ],
  // Landing pages lead with the question their search asks.
  "rotate-pdf": [
    ["organizeRotateQ", "organizeRotateA"],
    ["organizeKeptQ", "organizeKeptA"],
    ["organizeLockedQ", "organizeLockedA"],
  ],
  "delete-pdf-pages": [
    ["organizeDeleteQ", "organizeDeleteA"],
    ["organizeKeptQ", "organizeKeptA"],
    ["organizeLockedQ", "organizeLockedA"],
  ],
};
export function faqFor(toolId: string) {
  return [...(FAQ_BY_TOOL[toolId] ?? []), ...FAQ_GENERAL];
}
