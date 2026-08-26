/**
 * Minimal, defensive ZIP reader.
 *
 * ZIP is treated purely as a container: entries are listed from the central
 * directory, names are validated against traversal, and only `stored` (0) and
 * `deflate` (8) entries are expanded — through the platform's
 * `DecompressionStream`, so no third-party inflate implementation is trusted.
 *
 * Guards: entry count, per-entry and total uncompressed size, compression
 * ratio (zip-bomb), absolute paths, `..` segments, backslashes, and directories.
 */
import { LIMITS } from "./types";

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

function findEndOfCentralDirectory(view: DataView): number {
  const min = Math.max(0, view.byteLength - 66_000);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (u32(view, i) === 0x06054b50) return i;
  }
  throw new ZipError("Not a ZIP archive (no end-of-central-directory record).");
}

/** Rejects traversal, absolute paths, and drive letters. */
export function safeEntryName(name: string): string {
  const cleaned = name.replace(/\\/g, "/");
  if (cleaned.startsWith("/") || /^[a-zA-Z]:/.test(cleaned)) throw new ZipError(`Unsafe entry path: ${name}`);
  if (cleaned.split("/").some((part) => part === ".." )) throw new ZipError(`Unsafe entry path: ${name}`);
  if (cleaned.includes("\0")) throw new ZipError(`Unsafe entry path: ${name}`);
  return cleaned;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const Decompression = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!Decompression) throw new ZipError("This environment cannot expand deflate-compressed archive entries.");
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new Decompression("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function readZip(data: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const count = u16(view, eocd + 10);
  let offset = u32(view, eocd + 16);

  if (count > LIMITS.maxArchiveEntries) throw new ZipError(`Archive holds more than ${LIMITS.maxArchiveEntries} entries.`);

  const central: CentralEntry[] = [];
  let totalUncompressed = 0;
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i += 1) {
    if (u32(view, offset) !== 0x02014b50) throw new ZipError("Corrupt central directory.");
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    const nameLen = u16(view, offset + 28);
    const extraLen = u16(view, offset + 30);
    const commentLen = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLen));

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > LIMITS.maxArchiveUncompressedBytes) {
      throw new ZipError("Archive expands beyond the allowed uncompressed size.");
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > LIMITS.maxCompressionRatio) {
      throw new ZipError(`Entry "${name}" has a suspicious compression ratio and was refused.`);
    }

    if (!name.endsWith("/") && uncompressedSize > 0) {
      central.push({ name: safeEntryName(name), method, compressedSize, uncompressedSize, offset: localOffset });
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }

  const entries: ZipEntry[] = [];
  for (const entry of central) {
    if (u32(view, entry.offset) !== 0x04034b50) throw new ZipError(`Corrupt local header for "${entry.name}".`);
    const nameLen = u16(view, entry.offset + 26);
    const extraLen = u16(view, entry.offset + 28);
    const start = entry.offset + 30 + nameLen + extraLen;
    const raw = data.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) {
      entries.push({ name: entry.name, bytes: raw });
    } else if (entry.method === 8) {
      const out = await inflateRaw(raw);
      if (out.byteLength > LIMITS.maxArchiveUncompressedBytes) throw new ZipError("Entry expanded past the size limit.");
      entries.push({ name: entry.name, bytes: out });
    } else {
      throw new ZipError(`Entry "${entry.name}" uses unsupported compression method ${entry.method}.`);
    }
  }

  if (!entries.length) throw new ZipError("The archive contains no files.");
  return entries;
}
