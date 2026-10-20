import { createContext } from "react";

/** Interface words of the preview and comparison; {page}, {note} placeholders. */
export type PreviewLabels = {
  preview: string;
  table: string;
  footnote: string;
  pdfFailed: string;
  pdfOpening: string;
  pdfRendering: string;
  pdfPage: string;
};
export const PreviewLabelsContext = createContext<PreviewLabels>({
  preview: "Xem trước Markdown",
  table: "Bảng dữ liệu nhận diện",
  footnote: "Chú thích {note}",
  pdfFailed: "Không mở được bản xem PDF. File gốc không bị thay đổi.",
  pdfOpening: "Đang mở trang PDF…",
  pdfRendering: "Đang vẽ trang PDF…",
  pdfPage: "PDF gốc, trang {page}",
});
export const fillLabel = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
