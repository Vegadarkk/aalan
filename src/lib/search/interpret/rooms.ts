import { phraseTokens, type Token } from "./tokens";

// Room counts of a real-estate search (audit zone 2 P3-5): "2 chambres", "3 pièces", "F3", "au moins
// 2 chambres", "entre 2 et 3 chambres", "3 غرف", "غرفتين", "juj byout". Read only once the target is
// real estate (the caller checks the filter exists), so "F3" or "3 pièces" elsewhere stay words. Pure.
//
// Meanings: « chambre », « غرفة/غرف », darija « bit/byout » (بيت/بيوت) are bedrooms (`bedrooms`), the way
// Moroccan listings count them ("2 chambres et salon", "جوج بيوت وصالون"); « pièce » and the F/T
// typology are all rooms (`rooms`). A count alone is that count exactly, like a year; a floor or a
// ceiling word turns it into a bound.

export type RoomCriterion = "rooms" | "bedrooms";

export interface RoomMatch {
  id: RoomCriterion;
  min?: number;
  max?: number;
  tokens: number[];
}

const words = (list: readonly string[]) => new Set(list.map((word) => phraseTokens(word).join(" ")));
const phrases = (list: readonly string[]) => list.map(phraseTokens);

const UNITS: ReadonlyMap<string, RoomCriterion> = new Map([
  ...[...words(["chambre", "chambres", "غرفة", "غرف", "غرفات", "ghorfa", "ghorfat", "بيت", "بيوت", "bit", "byout", "biout", "byoute"])].map((word) => [word, "bedrooms"] as const),
  ...[...words(["piece", "pieces"])].map((word) => [word, "rooms"] as const),
]);
/** Words that may follow a bedroom unit ("chambres à coucher", "غرف النوم"). */
const BEDROOM_TAILS = phrases(["a coucher", "de nuit", "نوم", "النوم", "dyal n3as", "dial n3as"]);
/** A count and its unit in one word (Arabic duals). */
const DUALS: ReadonlyMap<string, number> = new Map([...words(["غرفتين", "غرفتان", "بيتين"])].map((word) => [word, 2] as const));
/** F3 / T3: three rooms. */
const TYPOLOGY = /^[ft]([1-9])$/;

const NUMBER_WORDS: ReadonlyMap<string, number> = new Map(
  (
    [
      [1, ["un", "une", "wahed", "wa7ed", "واحد", "واحدة"]],
      [2, ["deux", "juj", "jouj", "zouj", "zuj", "جوج", "زوج", "اثنين", "اثنان", "إثنين"]],
      [3, ["trois", "tlata", "tlat", "تلاتة", "تلات", "ثلاث", "ثلاثة"]],
      [4, ["quatre", "rb3a", "reb3a", "rab3a", "ربعة", "أربع", "أربعة"]],
      [5, ["cinq", "khamsa", "خمسة", "خمس"]],
      [6, ["six", "stta", "setta", "ستة", "ست"]],
      [7, ["sept"]],
      [8, ["huit"]],
      [9, ["neuf"]],
      [10, ["dix"]],
    ] as const
  ).flatMap(([value, list]) => [...words(list)].map((word) => [word, value] as const)),
);

const FLOOR_BEFORE = phrases(["plus de", "au moins", "a partir de", "minimum", "min", "pas moins de", "اكثر من", "على الاقل", "kter mn", "ktar mn", "kter men"]);
const CEILING_BEFORE = phrases(["moins de", "max", "maxi", "maximum", "au plus", "au maximum", "pas plus de", "jusqu a", "اقل من", "a9al mn", "a9al men"]);
const FLOOR_AFTER = phrases(["et plus", "ou plus", "minimum", "min", "au moins", "او اكثر"]);
const CEILING_AFTER = phrases(["max", "maxi", "maximum", "au maximum", "ou moins", "et moins", "او اقل"]);
const RANGE_OPEN = words(["entre", "de", "بين", "من", "bin"]);
const RANGE_JOIN = words(["et", "a", "w", "و", "الى", "إلى", "l"]);

function phraseAt(tokens: readonly Token[], index: number, phrase: readonly string[], taken: ReadonlySet<number>): boolean {
  return index >= 0 && phrase.every((word, offset) => tokens[index + offset]?.norm === word && !taken.has(index + offset));
}

/** Length of the longest phrase starting at `index`. */
function longestAt(tokens: readonly Token[], index: number, list: readonly (readonly string[])[], taken: ReadonlySet<number>): number {
  return list.reduce((best, phrase) => (phrase.length > best && phraseAt(tokens, index, phrase, taken) ? phrase.length : best), 0);
}

/** Length of the longest phrase ending just before `index`. */
function longestBefore(tokens: readonly Token[], index: number, list: readonly (readonly string[])[], taken: ReadonlySet<number>): number {
  return list.reduce((best, phrase) => (phrase.length > best && phraseAt(tokens, index - phrase.length, phrase, taken) ? phrase.length : best), 0);
}

function countOf(token: Token | undefined): number | undefined {
  if (!token) return undefined;
  if (/^\d{1,2}$/.test(token.norm)) return Number(token.norm);
  return NUMBER_WORDS.get(token.norm);
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, offset) => from + offset);

/** Each room count not taken, left to right; a criterion read twice keeps its first count. */
export function findRoomCounts(tokens: readonly Token[], taken: ReadonlySet<number>): RoomMatch[] {
  const out: RoomMatch[] = [];
  const used = new Set(taken);
  const push = (match: RoomMatch) => {
    if (out.some((each) => each.id === match.id)) return;
    out.push(match);
    for (const at of match.tokens) used.add(at);
  };
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (!token || used.has(at)) continue;
    const typology = TYPOLOGY.exec(token.norm);
    if (typology) {
      push({ id: "rooms", min: Number(typology[1]), max: Number(typology[1]), tokens: [at] });
      continue;
    }
    // "<count> <unit>", or a dual ("غرفتين").
    let start = at;
    let unitAt = at;
    let value = DUALS.get(token.norm);
    if (value === undefined) {
      value = countOf(token);
      unitAt = at + 1;
      if (value === undefined || used.has(unitAt)) continue;
    }
    const id = UNITS.get(tokens[unitAt]?.norm ?? "") ?? (unitAt === at ? "bedrooms" : undefined);
    if (!id) continue;
    let end = unitAt + 1;
    if (id === "bedrooms") end += longestAt(tokens, end, BEDROOM_TAILS, used);
    let min: number | undefined = value;
    let max: number | undefined = value;
    // "entre 2 et 3 chambres", "2 à 3 pièces".
    const low = unitAt === at + 1 ? countOf(tokens[at - 2]) : undefined;
    if (low !== undefined && !used.has(at - 2) && !used.has(at - 1) && RANGE_JOIN.has(tokens[at - 1]?.norm ?? "") && low <= value) {
      start = at - 2;
      min = low;
      if (start > 0 && !used.has(start - 1) && RANGE_OPEN.has(tokens[start - 1]?.norm ?? "")) start -= 1;
    } else {
      const floor = longestBefore(tokens, at, FLOOR_BEFORE, used);
      const ceiling = floor ? 0 : longestBefore(tokens, at, CEILING_BEFORE, used);
      const floorAfter = floor || ceiling ? 0 : longestAt(tokens, end, FLOOR_AFTER, used);
      const ceilingAfter = floor || ceiling || floorAfter ? 0 : longestAt(tokens, end, CEILING_AFTER, used);
      if (floor || floorAfter) max = undefined;
      if (ceiling || ceilingAfter) min = undefined;
      start -= floor + ceiling;
      end += floorAfter + ceilingAfter;
    }
    push({ id, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), tokens: range(start, end) });
    at = end - 1;
  }
  return out;
}
