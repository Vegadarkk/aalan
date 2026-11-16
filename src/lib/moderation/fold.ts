// A copy of a text for the contact detectors (phones.ts, contacts.ts): Unicode format characters
// (zero-width spaces and joiners, soft hyphens, bidi marks: category Cf) removed and every other
// character folded by NFKC (fullwidth and other compatibility digits and letters become ASCII), so
// that a number, address or link a reader can use is found whatever invisible characters split it.
// Each folded UTF-16 unit remembers the input character it came from: spans found on the copy map
// back to the text as written. Pure, client-safe.

const FORMAT_CHARACTER = /^\p{Cf}$/u;

export interface FoldedText {
  text: string;
  /** Input index of the character each unit of `text` came from. */
  from: number[];
  /** Input index just past that character. */
  to: number[];
}

export function foldForDetection(input: string): FoldedText {
  let text = "";
  const from: number[] = [];
  const to: number[] = [];
  let index = 0;
  for (const character of input) {
    const next = index + character.length;
    if (!FORMAT_CHARACTER.test(character)) {
      const folded = character.normalize("NFKC");
      for (let unit = 0; unit < folded.length; unit += 1) {
        from.push(index);
        to.push(next);
      }
      text += folded;
    }
    index = next;
  }
  return { text, from, to };
}

/** The input span of the folded span [start, end) (end > start). */
export function inputSpan(folded: FoldedText, start: number, end: number): { start: number; end: number } {
  return { start: folded.from[start] ?? 0, end: folded.to[end - 1] ?? 0 };
}
