// Plausibility of a listing's price (zone 3 audit P1-3 / B9: a rental car went live at
// 335 050 DH a day without a word). A price above the ceiling of its subcategory gets a
// non-blocking "check the price" note in the price step and the review; nothing is refused,
// since a rare item can be worth it. Ceilings are generous orders of magnitude, in dirhams, per
// the subcategory's unit (a day, a night, a month) or for the item.

const BY_SUBCATEGORY: Readonly<Record<string, number>> = {
  "voitures": 3_000_000,
  "location-voitures": 10_000,
  "motos-scooters": 500_000,
  "velos": 100_000,
  "utilitaires-camions": 3_000_000,
  "bateaux": 30_000_000,
  "pieces-accessoires": 200_000,
  "location": 300_000,
  "colocation": 30_000,
  "location-vacances": 50_000,
  "telephones-objets-connectes": 50_000,
  "ordinateurs": 100_000,
  "tablettes": 40_000,
  "accessoires-electronique": 20_000,
  "tv-photo-audio": 150_000,
  "consoles-jeux-video": 30_000,
  "montres-bijoux": 2_000_000,
  "betail-moutons": 500_000,
  "animaux-compagnie": 100_000,
  "offres-emploi": 100_000,
};

const BY_CATEGORY: Readonly<Record<string, number>> = {
  "maison-jardin": 300_000,
  "mode": 100_000,
  "terroir": 50_000,
  "agriculture": 5_000_000,
  "famille": 50_000,
  "loisirs": 300_000,
  "chasse-peche": 200_000,
  "animaux": 100_000,
  "materiel-pro": 10_000_000,
  "services": 200_000,
};

/** The ceiling above which the price deserves a second look, or null when none applies. */
export function priceCeiling(categoryId: string | null | undefined, subcategoryId: string | null | undefined): number | null {
  if (subcategoryId && BY_SUBCATEGORY[subcategoryId] !== undefined) return BY_SUBCATEGORY[subcategoryId]!;
  if (categoryId && BY_CATEGORY[categoryId] !== undefined) return BY_CATEGORY[categoryId]!;
  return null;
}

export function priceLooksHigh(price: number | null, categoryId: string | null | undefined, subcategoryId: string | null | undefined): boolean {
  if (price === null) return false;
  const ceiling = priceCeiling(categoryId, subcategoryId);
  return ceiling !== null && price > ceiling;
}

// ---- Amount in words (review step: "trois cent trente-cinq mille cinquante dirhams par jour").

const FR_UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
const FR_TENS = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante"];

function frBelow100(n: number): string {
  if (n < 17) return FR_UNITS[n]!;
  if (n < 20) return `dix-${FR_UNITS[n - 10]}`;
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (tens === 7) return n === 71 ? "soixante et onze" : `soixante-${frBelow100(n - 60)}`;
  if (tens === 8) return unit === 0 ? "quatre-vingts" : `quatre-vingt-${FR_UNITS[unit]}`;
  if (tens === 9) return `quatre-vingt-${frBelow100(n - 80)}`;
  if (unit === 0) return FR_TENS[tens]!;
  return unit === 1 ? `${FR_TENS[tens]} et un` : `${FR_TENS[tens]}-${FR_UNITS[unit]}`;
}

/** 0-999; `final`: the group ends the number (only then "cents" and "quatre-vingts" take an s). */
function frBelow1000(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let words = "";
  if (hundreds === 1) words = "cent";
  else if (hundreds > 1) words = `${FR_UNITS[hundreds]} cent${rest === 0 && final ? "s" : ""}`;
  if (rest > 0) {
    const tail = rest === 80 && !final ? "quatre-vingt" : frBelow100(rest);
    words = words ? `${words} ${tail}` : tail;
  }
  return words;
}

/** French words of a whole number below one billion ("trois cent trente-cinq mille cinquante"). */
export function frenchNumberWords(value: number): string {
  const n = Math.trunc(Math.abs(value));
  if (n === 0) return "zéro";
  const millions = Math.floor(n / 1_000_000) % 1000;
  const thousands = Math.floor(n / 1000) % 1000;
  const rest = n % 1000;
  const parts: string[] = [];
  // "deux cents millions": million is a noun, the s stays.
  if (millions > 0) parts.push(`${frBelow1000(millions, true)} million${millions > 1 ? "s" : ""}`);
  if (thousands > 0) parts.push(thousands === 1 ? "mille" : `${frBelow1000(thousands, false)} mille`);
  if (rest > 0) parts.push(frBelow1000(rest, true));
  return parts.join(" ");
}

/** "trois cent trente-cinq mille cinquante dirhams"; "un million de dirhams". */
export function frenchAmountWords(value: number): string {
  const n = Math.trunc(Math.abs(value));
  const words = frenchNumberWords(n);
  if (n <= 1) return `${words} dirham`;
  return n % 1_000_000 === 0 ? `${words} de dirhams` : `${words} dirhams`;
}

const AR_UNITS = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة"];
const AR_TENS = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const AR_HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function arBelow100(n: number): string {
  if (n <= 10) return AR_UNITS[n]!;
  if (n === 11) return "أحد عشر";
  if (n === 12) return "اثنا عشر";
  if (n < 20) return `${AR_UNITS[n - 10]} عشر`;
  const unit = n % 10;
  const tens = AR_TENS[Math.floor(n / 10)]!;
  return unit === 0 ? tens : `${AR_UNITS[unit]} و${tens}`;
}

function arBelow1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return arBelow100(rest);
  return rest === 0 ? AR_HUNDREDS[hundreds]! : `${AR_HUNDREDS[hundreds]} و${arBelow100(rest)}`;
}

/** A counted group ("ثلاثة آلاف", "خمسة وثلاثون ألفًا", "ألفان") with the noun's number agreement. */
function arCounted(count: number, forms: { one: string; two: string; plural: string; accusative: string }): string {
  if (count === 1) return forms.one;
  if (count === 2) return forms.two;
  const lastTwo = count % 100;
  if (count > 100 && (lastTwo === 1 || lastTwo === 2)) return `${AR_HUNDREDS[Math.floor(count / 100) % 10]!} و${lastTwo === 1 ? forms.one : forms.two}`;
  const words = arBelow1000(count);
  if (lastTwo >= 3 && lastTwo <= 10) return `${words} ${forms.plural}`;
  if (lastTwo >= 11) return `${words} ${forms.accusative}`;
  return `${words} ${forms.one}`;
}

/** Arabic words of a whole number below one billion, read on its own (no counted noun). */
export function arabicNumberWords(value: number): string {
  const n = Math.trunc(Math.abs(value));
  if (n === 0) return "صفر";
  const millions = Math.floor(n / 1_000_000) % 1000;
  const thousands = Math.floor(n / 1000) % 1000;
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(arCounted(millions, { one: "مليون", two: "مليونان", plural: "ملايين", accusative: "مليونًا" }));
  if (thousands > 0) parts.push(arCounted(thousands, { one: "ألف", two: "ألفان", plural: "آلاف", accusative: "ألفًا" }));
  if (rest > 0) parts.push(arBelow1000(rest));
  return parts.join(" و");
}

/** "ثلاثمائة وخمسة وثلاثون ألفًا وخمسون درهمًا": the dirham agrees with the last two digits. */
export function arabicAmountWords(value: number): string {
  const n = Math.trunc(Math.abs(value));
  if (n === 0) return "صفر درهم";
  if (n === 1) return "درهم واحد";
  if (n === 2) return "درهمان";
  const lastTwo = n % 100;
  const noun = lastTwo >= 3 && lastTwo <= 10 ? "دراهم" : lastTwo >= 11 ? "درهمًا" : "درهم";
  return `${arabicNumberWords(n)} ${noun}`;
}
