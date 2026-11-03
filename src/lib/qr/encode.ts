// A QR Code encoder (ISO/IEC 18004), reduced to what the shop QR codes need: byte mode, error
// correction level M, versions 1 to 10 (up to 213 bytes, a storefront URL is under 100). Pure, no
// dependency. Adapted from Project Nayuki's QR Code generator (MIT License, Copyright (c) Project
// Nayuki, https://www.nayuki.io/page/qr-code-generator-library). tests/unit/qr-encode.test.ts
// checks the output against reference matrices.

/** Error correction codewords per block and number of blocks at level M, by version (index 0 unused). */
const ECC_CODEWORDS_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26] as const;
const ERROR_CORRECTION_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] as const;
/** Format bits of level M (00). */
const FORMAT_BITS_M = 0;
export const QR_MAX_VERSION = 10;

export interface QrMatrix {
  size: number;
  /** modules[y][x], true = dark. */
  modules: boolean[][];
  version: number;
  mask: number;
}

const bit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0;

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK_M[version]! * ERROR_CORRECTION_BLOCKS_M[version]!;
}

function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = multiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] = result[index]! ^ multiply(coefficient, factor);
    });
  }
  return result;
}

/** Data codewords of one byte-mode segment, padded to the version's capacity. */
function dataOf(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((acc, value) => (acc << 1) | value, 0));
  return out;
}

function withEcc(data: readonly number[], version: number): number[] {
  const blocks = ERROR_CORRECTION_BLOCKS_M[version]!;
  const eccLength = ECC_CODEWORDS_PER_BLOCK_M[version]!;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLength);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i += 1) {
    const chunk = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += chunk.length;
    const ecc = rsRemainder(chunk, divisor);
    if (i < shortBlocks) chunk.push(0);
    all.push([...chunk, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < all[0]!.length; i += 1) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  readonly functional: boolean[][];
  readonly version: number;

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.functional = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  set(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.functional[y]![x] = true;
  }

  alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const result = [6];
    for (let position = this.size - 7; result.length < count; position -= step) result.splice(1, 0, position);
    return result;
  }

  finder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, distance !== 2 && distance !== 4);
      }
    }
  }

  alignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  format(mask: number): void {
    const data = (FORMAT_BITS_M << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    for (let i = 0; i <= 5; i += 1) this.set(8, i, bit(bits, i));
    this.set(8, 7, bit(bits, 6));
    this.set(8, 8, bit(bits, 7));
    this.set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i += 1) this.set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i += 1) this.set(this.size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i += 1) this.set(8, this.size - 15 + i, bit(bits, i));
    this.set(8, this.size - 8, true);
  }

  versionInfo(): void {
    if (this.version < 7) return;
    let remainder = this.version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (this.version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const dark = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  functionPatterns(): void {
    for (let i = 0; i < this.size; i += 1) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);
    const positions = this.alignmentPositions();
    const last = positions.length - 1;
    positions.forEach((py, i) =>
      positions.forEach((px, j) => {
        if (!((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0))) this.alignment(px, py);
      }),
    );
    this.format(0);
    this.versionInfo();
  }

  codewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.functional[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = bit(data[i >>> 3]!, 7 - (i & 7));
            i += 1;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        if (this.functional[y]![x]) continue;
        const invert = [
          (x + y) % 2 === 0,
          y % 2 === 0,
          x % 3 === 0,
          (x + y) % 3 === 0,
          (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0,
          (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
          (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ][mask];
        if (invert) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }

  private addHistory(length: number, history: number[]): void {
    if (history[0] === 0) length += this.size;
    history.pop();
    history.unshift(length);
  }

  private countFinderLike(history: readonly number[]): number {
    const n = history[1]!;
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (core && history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) + (core && history[6]! >= n * 4 && history[0]! >= n ? 1 : 0);
  }

  private lineScore(at: (i: number) => boolean): number {
    let score = 0;
    let color = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < this.size; i += 1) {
      if (at(i) === color) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        this.addHistory(run, history);
        if (!color) score += this.countFinderLike(history) * 40;
        color = at(i);
        run = 1;
      }
    }
    if (color) {
      this.addHistory(run, history);
      run = 0;
    }
    run += this.size;
    this.addHistory(run, history);
    return score + this.countFinderLike(history) * 40;
  }

  penalty(): number {
    let score = 0;
    for (let y = 0; y < this.size; y += 1) score += this.lineScore((x) => this.modules[y]![x]!);
    for (let x = 0; x < this.size; x += 1) score += this.lineScore((y) => this.modules[y]![x]!);
    for (let y = 0; y < this.size - 1; y += 1) {
      for (let x = 0; x < this.size - 1; x += 1) {
        const color = this.modules[y]![x];
        if (color === this.modules[y]![x + 1] && color === this.modules[y + 1]![x] && color === this.modules[y + 1]![x + 1]) score += 3;
      }
    }
    const dark = this.modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    const total = this.size * this.size;
    return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  }
}

/**
 * The QR Code of `text` (UTF-8, byte mode, level M), smallest version that fits; `mask` forces a
 * mask pattern (tests), else the one with the lowest penalty. Throws past version 10.
 */
export function encodeQr(text: string, options: { mask?: number } = {}): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= QR_MAX_VERSION && 4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8) version += 1;
  if (version > QR_MAX_VERSION) throw new RangeError("text too long for a QR code up to version 10");
  const grid = new Grid(version);
  grid.functionPatterns();
  grid.codewords(withEcc(dataOf(bytes, version), version));
  let mask = options.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate += 1) {
      grid.applyMask(candidate);
      grid.format(candidate);
      const score = grid.penalty();
      if (score < best) {
        best = score;
        mask = candidate;
      }
      grid.applyMask(candidate);
    }
  }
  grid.applyMask(mask);
  grid.format(mask);
  return { size: grid.size, modules: grid.modules, version, mask };
}

/** The code as an SVG document (one path, quiet zone of 4 modules), dark modules in `color`. */
export function qrSvg(matrix: QrMatrix, options: { color?: string; background?: string } = {}): string {
  const border = 4;
  const side = matrix.size + border * 2;
  const parts: string[] = [];
  matrix.modules.forEach((row, y) => row.forEach((dark, x) => dark && parts.push(`M${x + border},${y + border}h1v1h-1z`)));
  const hex = (value: string | undefined, fallback: string) => (value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback);
  const background = hex(options.background, "#ffffff");
  const color = hex(options.color, "#000000");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${background}"/><path fill="${color}" d="${parts.join("")}"/></svg>`;
}
