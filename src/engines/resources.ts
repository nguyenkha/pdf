import { PDFArray, PDFContentStream, PDFDict, PDFDocument, PDFName, PDFNull, PDFNumber, PDFObject, PDFRawStream, PDFStream } from "pdf-lib";

const name = PDFName.of;
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
async function decoded(stream: PDFStream): Promise<Uint8Array> {
  if (stream instanceof PDFContentStream) return stream.getUnencodedContents();
  if (!(stream instanceof PDFRawStream)) throw new Error("unsupported");
  const filter = stream.dict.lookup(name("Filter"));
  const filters = filter instanceof PDFArray ? filter.asArray().map((value) => stream.dict.context.lookup(value)) : filter ? [filter] : [];
  if (!filters.length) {
    if (stream.contents.length > MAX_CONTENT_BYTES) throw new Error("memory");
    return stream.contents;
  }
  // Reject unfamiliar filter chains rather than perform an unbounded decode.
  if (filters.length !== 1 || filters[0] !== name("FlateDecode") || !defaultParms(stream.dict.lookup(name("DecodeParms"))))
    throw new Error("unsupported");
  const reader = new Blob([stream.contents as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_CONTENT_BYTES) throw new Error("memory");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}
/** Absent, null or an explicit Predictor 1 change nothing about a Flate decode. */
function defaultParms(parms: PDFObject | undefined): boolean {
  if (parms === undefined || parms === PDFNull) return true;
  if (parms instanceof PDFArray) return parms.size() === 1 && defaultParms(parms.lookup(0));
  if (!(parms instanceof PDFDict)) return false;
  return parms.entries().every(([key]) => {
    const value = parms.lookup(key);
    return key === name("Predictor") && value instanceof PDFNumber && value.asNumber() === 1;
  });
}
/** Resource names outside comments, strings and hex strings. Keeping every
 * name is conservative: only definitely unused XObjects are removed.
 */
function resourceNames(bytes: Uint8Array): Set<string> {
  let content = "";
  for (let i = 0; i < bytes.length; i += 32768)
    content += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const names = new Set<string>();
  const delimiter = /[\s()[\]<>/{%}]/;
  for (let i = 0; i < content.length;) {
    const ch = content[i++];
    if (ch === "%") { while (i < content.length && !/[\r\n]/.test(content[i])) i++; }
    else if (ch === "(") {
      let depth = 1;
      while (i < content.length && depth) {
        const next = content[i++];
        if (next === "\\") i++;
        else if (next === "(") depth++;
        else if (next === ")") depth--;
      }
      if (depth) throw new Error("unsupported");
    } else if (ch === "<" && content[i] !== "<") {
      while (i < content.length && content[i] !== ">") i++;
      if (i++ >= content.length) throw new Error("unsupported");
    } else if (ch === "<" && content[i] === "<") i++;
    else if (ch === "/") {
      const start = i;
      while (i < content.length && !delimiter.test(content[i])) i++;
      names.add(content.slice(start, i).replace(/#([0-9a-f]{2})/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16))));
    } else if (!delimiter.test(ch)) {
      const start = i - 1;
      while (i < content.length && !delimiter.test(content[i])) i++;
      // Inline image bytes have no unambiguous general-purpose terminator.
      // Refuse secure page removal rather than parse binary data as names.
      if (content.slice(start, i) === "BI") throw new Error("unsupported");
    }
  }
  return names;
}

/** Objects that can draw images, reachable from a resource dictionary: XObjects,
 * patterns, soft-mask graphics states and Type3 fonts, and their own resources.
 * The flag records whether the object sits inside a pattern, soft mask or
 * Type3 font, whose resource use the content scanner below does not follow.
 */
function imageGraph(doc: PDFDocument, resources: PDFDict | undefined): Map<PDFObject, boolean> {
  const reached = new Map<PDFObject, boolean>();
  const pending: [PDFObject | undefined, boolean][] = [[resources, false]];
  const visit = (value: PDFObject | undefined, opaque: boolean) => {
    const object = value && doc.context.lookup(value);
    if (!object || object instanceof PDFName || (reached.has(object) && (reached.get(object) || !opaque))) return;
    reached.set(object, opaque);
    const dict = object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : undefined;
    pending.push([dict?.get(name("Resources")), opaque]);
    if (object instanceof PDFStream && dict?.get(name("Subtype")) === name("Image")) {
      visit(dict.get(name("SMask")), opaque);
      visit(dict.get(name("Mask")), opaque);
    }
  };
  for (let guard = 0; pending.length; guard++) {
    if (guard > 100_000) throw new Error("unsupported");
    const [value, opaque] = pending.pop()!;
    const dict = value && doc.context.lookup(value);
    if (!(dict instanceof PDFDict)) continue;
    const entries = (key: string) => {
      const group = dict.lookup(name(key));
      return group instanceof PDFDict ? group.values() : [];
    };
    for (const value of entries("XObject")) visit(value, opaque);
    for (const value of entries("Pattern")) visit(value, true);
    for (const value of entries("ExtGState")) {
      const state = doc.context.lookup(value);
      const mask = state instanceof PDFDict ? state.lookup(name("SMask")) : undefined;
      if (mask instanceof PDFDict) { visit(state, true); visit(mask.get(name("G")), true); }
    }
    for (const value of entries("Font")) {
      const font = doc.context.lookup(value);
      if (!(font instanceof PDFDict) || font.get(name("Subtype")) !== name("Type3")) continue;
      visit(font, true);
      const procs = font.lookup(name("CharProcs"));
      if (procs instanceof PDFDict) for (const proc of procs.values()) visit(proc, true);
    }
  }
  return reached;
}

/** Which selected pages, in plan order, share image-capable resources with a
 * page that is left out. Only those need their resources trimmed. Sharing
 * through patterns, soft masks or Type3 fonts is refused rather than trimmed.
 */
export function sharedResourcePages(doc: PDFDocument, selected: number[]): boolean[] {
  const pages = doc.getPages();
  if (new Set(selected).size === pages.length) return selected.map(() => false);
  const graphs = new Map<number, Map<PDFObject, boolean>>();
  const graph = (index: number) => {
    if (!graphs.has(index)) graphs.set(index, imageGraph(doc, pages[index].node.Resources()));
    return graphs.get(index)!;
  };
  const keep = new Set(selected);
  const omitted = new Set<PDFObject>();
  pages.forEach((_, index) => { if (!keep.has(index)) for (const object of graph(index).keys()) omitted.add(object); });
  return selected.map((index) => {
    let shared = false;
    for (const [object, opaque] of graph(index)) {
      if (!omitted.has(object)) continue;
      if (opaque) throw new Error("unsupported");
      shared = true;
    }
    return shared;
  });
}

/** Isolate shared resource dictionaries and remove unused image/form streams
 * on the given output pages, including resources of nested Form XObjects.
 */
export async function prunePageResources(doc: PDFDocument, overlap: boolean[]): Promise<void> {
  const processed = new Set<PDFStream>();
  const trim = async (resources: PDFDict, streams: PDFStream[], depth = 0): Promise<PDFDict> => {
    if (depth > 64) throw new Error("unsupported");
    const local = resources.clone(doc.context);
    const objects = resources.lookup(name("XObject"));
    if (!(objects instanceof PDFDict)) return local;
    // Type3 glyphs without their own resources draw with these XObjects, which
    // the page's content stream does not name.
    const fonts = resources.lookup(name("Font"));
    if (fonts instanceof PDFDict && fonts.values().some((value) => {
      const font = doc.context.lookup(value);
      return font instanceof PDFDict && font.get(name("Subtype")) === name("Type3") && !font.has(name("Resources"));
    })) throw new Error("unsupported");
    const used = new Set<string>();
    const pending = [...streams];
    const seen = new Set<PDFStream>();
    while (pending.length) {
      const stream = pending.pop()!;
      if (seen.has(stream)) continue;
      seen.add(stream);
      for (const key of resourceNames(await decoded(stream))) used.add(key);
      // A form without its own resources uses its caller's dictionary.
      for (const [key] of objects.entries()) {
        if (!used.has(String.fromCharCode(...key.asBytes()))) continue;
        const child = objects.lookup(key);
        if (child instanceof PDFStream && child.dict.get(name("Subtype")) === name("Form") && !child.dict.has(name("Resources")))
          pending.push(child);
      }
    }
    const kept = objects.clone(doc.context);
    for (const [key] of objects.entries()) {
      if (!used.has(String.fromCharCode(...key.asBytes()))) { kept.delete(key); continue; }
      const child = objects.lookup(key);
      if (!(child instanceof PDFStream) || child.dict.get(name("Subtype")) !== name("Form") || processed.has(child)) continue;
      const nested = child.dict.lookup(name("Resources"));
      if (nested instanceof PDFDict) {
        processed.add(child);
        child.dict.set(name("Resources"), await trim(nested, [child], depth + 1));
      }
    }
    local.set(name("XObject"), kept);
    return local;
  };
  for (const [index, page] of doc.getPages().entries()) {
    if (!overlap[index]) continue;
    const resources = page.node.Resources();
    if (!resources) continue;
    const contents = page.node.Contents();
    const values = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const streams = values.map((value) => doc.context.lookup(value)).filter((value): value is PDFStream => value instanceof PDFStream);
    page.node.set(name("Resources"), await trim(resources, streams));
  }
}
