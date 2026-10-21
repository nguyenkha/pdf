import { PDFArray, PDFContentStream, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from "pdf-lib";

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
  if (filters.length !== 1 || filters[0] !== name("FlateDecode") || stream.dict.has(name("DecodeParms")))
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

/** Isolate shared resource dictionaries and remove unused image/form streams
 * before dropping pages, including resources of nested Form XObjects.
 */
export async function prunePageResources(doc: PDFDocument): Promise<void> {
  const processed = new Set<PDFStream>();
  const trim = async (resources: PDFDict, streams: PDFStream[], depth = 0): Promise<PDFDict> => {
    if (depth > 64) throw new Error("unsupported");
    const local = resources.clone(doc.context);
    const objects = resources.lookup(name("XObject"));
    if (!(objects instanceof PDFDict)) return local;
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
  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    if (!resources) continue;
    const contents = page.node.Contents();
    const values = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const streams = values.map((value) => doc.context.lookup(value)).filter((value): value is PDFStream => value instanceof PDFStream);
    page.node.set(name("Resources"), await trim(resources, streams));
  }
}
