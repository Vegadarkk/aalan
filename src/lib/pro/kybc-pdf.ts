import "server-only";
import { constants, inflateSync } from "node:zlib";
import { pdfHasActiveContent } from "./kybc";

// Active-content check of a KYBC PDF, object streams included. PDF 1.5 can store dictionaries in
// compressed object streams (/Type /ObjStm), where the raw-byte scan of pdfHasActiveContent sees
// nothing: each one is inflated and scanned too. Staff download the pieces to a desktop reader
// (src/app/admin/kybc/[proId]/[pieceId]/route.ts), so an /OpenAction hidden there would run.

/** Inflated size allowed per object stream; past it the piece is refused (a real one is far smaller). */
export const MAX_OBJECT_STREAM_BYTES = 4 * 1024 * 1024;
/** Object streams inflated per piece; past it the piece is refused. */
export const MAX_OBJECT_STREAMS = 256;
/** `stream` keywords looked at per piece; past it the piece is refused (a real piece has far fewer). */
export const MAX_STREAM_KEYWORDS = 10_000;
/** Where a stream's object header must be, before its keyword; farther, the piece is refused. */
export const DICTIONARY_WINDOW = 8 * 1024;

const STREAM_KEYWORD = /\bstream(?:\r\n|\n|\r)/g;

function decodeNames(text: string): string {
  return text.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * True when the PDF names active content in its raw bytes or in any object stream, or carries an
 * object stream it cannot inspect (another filter, corrupt, too large, too many).
 */
export function pdfHasActiveContentDeep(bytes: Uint8Array): boolean {
  if (pdfHasActiveContent(bytes)) return true;
  const text = new TextDecoder("latin1").decode(bytes);
  let streams = 0;
  let keywords = 0;
  // Linear in the piece: each keyword looks back at most DICTIONARY_WINDOW bytes, and their number
  // is capped, so a crafted piece costs no more than a real one of the same size.
  for (const match of text.matchAll(STREAM_KEYWORD)) {
    keywords += 1;
    if (keywords > MAX_STREAM_KEYWORDS) return true;
    const start = match.index + match[0].length;
    // The stream's dictionary: from its object header ("n g obj") to the keyword. No header close
    // enough: the dictionary cannot be read, the piece is not inspectable.
    const header = text.lastIndexOf(" obj", match.index);
    if (header < 0 || match.index - header > DICTIONARY_WINDOW) return true;
    const dictionary = decodeNames(text.slice(header, match.index));
    if (!/\/ObjStm(?![A-Za-z0-9_])/.test(dictionary)) continue;
    streams += 1;
    if (streams > MAX_OBJECT_STREAMS) return true;
    if (!/\/FlateDecode(?![A-Za-z0-9_])/.test(dictionary) || /\/(?:ASCII85Decode|ASCIIHexDecode|LZWDecode|RunLengthDecode|Crypt)(?![A-Za-z0-9_])/.test(dictionary)) return true;
    const end = text.indexOf("endstream", start);
    if (end < 0) return true;
    let inflated: Buffer;
    try {
      inflated = inflateSync(bytes.subarray(start, end), { maxOutputLength: MAX_OBJECT_STREAM_BYTES, finishFlush: constants.Z_SYNC_FLUSH });
    } catch {
      return true;
    }
    if (pdfHasActiveContent(inflated)) return true;
  }
  return false;
}
