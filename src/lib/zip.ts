// A minimal store-only ZIP writer: compressed PDFs gain nothing from
// deflate, and this avoids a dependency. Entries stay Blobs, so the archive
// is assembled without copying files into one buffer.
const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function header(size: number, write: (view: DataView) => void) {
  const buffer = new ArrayBuffer(size);
  write(new DataView(buffer));
  return new Uint8Array(buffer) as Uint8Array<ArrayBuffer>;
}
export async function zipBlobs(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  for (const { name, blob } of entries) {
    // One file in memory at a time while its checksum is computed.
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const path = encoder.encode(name) as Uint8Array<ArrayBuffer>;
    const local = header(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x0800, true); // UTF-8 names
      v.setUint32(14, crc, true);
      v.setUint32(18, blob.size, true);
      v.setUint32(22, blob.size, true);
      v.setUint16(26, path.length, true);
    });
    parts.push(local, path, blob);
    central.push(
      header(46, (v) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 20, true);
        v.setUint16(8, 0x0800, true);
        v.setUint32(16, crc, true);
        v.setUint32(20, blob.size, true);
        v.setUint32(24, blob.size, true);
        v.setUint16(28, path.length, true);
        v.setUint32(42, offset, true);
      }),
      path,
    );
    offset += local.length + path.length + blob.size;
  }
  const size = new Blob(central).size;
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);
  });
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
/** Makes names unique inside one archive: a.pdf, a (2).pdf, ... */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : name.replace(/(\.pdf)?$/i, ` (${count})$1`);
  });
}
