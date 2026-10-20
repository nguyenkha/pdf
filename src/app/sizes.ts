// Landing pages for "compress PDF to N KB/MB" searches. Each preselects the
// size limit; the slug is the same in every locale so hreflang pairs match.
export const SIZE_PAGES = ["100kb", "200kb", "300kb", "500kb", "1mb", "2mb", "5mb"] as const;
export type SizeSlug = (typeof SIZE_PAGES)[number];
export const sizePath = (slug: SizeSlug) => `compress-pdf-to-${slug}/`;
export function sizeFromSlug(slug: string) {
  const match = /^(\d+)(kb|mb)$/.exec(slug);
  if (!match || !SIZE_PAGES.includes(slug as SizeSlug)) return undefined;
  const unit = match[2] === "mb" ? ("MB" as const) : ("KB" as const);
  return { slug: slug as SizeSlug, value: match[1], unit, label: `${match[1]} ${unit}` };
}
/** The size page this URL path points at, if any. */
export function sizeFromPath(pathname: string) {
  const match = /\/compress-pdf-to-([a-z0-9]+)\/$/.exec(pathname);
  return match ? sizeFromSlug(match[1]) : undefined;
}
export type SizePreset = NonNullable<ReturnType<typeof sizeFromSlug>>;
