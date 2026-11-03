import { TokenizedText, compileKeywords, tokenVariants, type CompiledKeyword } from "@/lib/moderation/keywords";
import { tokenize } from "@/lib/text/normalize";

// Scam signals of a listing text (audit zone 7 P2-1, synthesis B5): an "iPhone" sold through
// "Western Union avant envoi", the number spelled out to dodge the phone filter, scored 15 and went
// public. Two flags, both held for a moderator (risk.ts): `offsite_payment` (a cash-transfer
// network or a payment before shipping: the classic advance-fee scam; the site never takes a
// payment for a listing) and `phone_in_words` (a run of numbers written as words, the obvious way
// round the phone filter of step 3). Pure, client-safe, deterministic.

/**
 * Payment outside the platform before the buyer sees the item. Narrower than the messaging list
 * (src/config/payment-keywords.ts): "acompte", "avance" or "virement" alone are normal in a listing
 * (real estate, Pro sellers); the cash networks and "pay before shipping" phrases are not.
 */
export const OFFSITE_PAYMENT_TERMS: readonly string[] = [
  // French and English
  "western union", "westernunion", "moneygram", "money gram", "mandat cash", "mandat postal", "mandat express", "mandat minute",
  "cash plus", "cashplus", "wafacash", "wafa cash", "barid cash", "baridcash", "damane cash", "chaabi cash", "ria money", "transfert d'argent", "envoi d'argent",
  "payer avant", "paiement avant", "payez avant", "paye avant", "acompte avant", "avance avant", "avant envoi", "avant l'envoi", "avant expedition", "avant l'expedition",
  "frais de dedouanement", "frais de douane a payer", "payment before", "pay before",
  // Arabic and darija (Arabic script)
  "ويسترن يونيون", "وسترن يونيون", "موني غرام", "مونيغرام", "وفاكاش", "وفا كاش", "كاش بلوس", "بريد كاش", "حوالة مالية", "الدفع قبل", "الدفع مسبقا", "قبل الارسال",
  // Darija (arabizi)
  "ta7wil 9bel", "tsbi9 9bel", "khlas 9bel", "lkhlas 9bel",
];

let compiled: CompiledKeyword[] | undefined;

/** Terms of OFFSITE_PAYMENT_TERMS found in the text, in text order. */
export function findOffsitePayment(text: string): string[] {
  if (!text) return [];
  compiled ??= compileKeywords(OFFSITE_PAYMENT_TERMS);
  return [...new Set(new TokenizedText(text).find(compiled).map((hit) => hit.term))];
}

/** Number words (FR, EN, Arabic, darija in both scripts) that spell a phone number digit by digit or in pairs. */
const NUMBER_WORDS: ReadonlySet<string> = new Set(
  [
    // French
    "zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
    "vingt", "trente", "quarante", "cinquante", "soixante", "septante", "huitante", "octante", "nonante", "cent",
    // English
    "one", "two", "three", "four", "five", "seven", "eight", "nine", "ten",
    // Arabic and darija (Arabic script)
    "صفر", "واحد", "اثنان", "اثنين", "زوج", "جوج", "ثلاثه", "تلاته", "اربعه", "ربعه", "خمسه", "سته", "سبعه", "ثمانيه", "تمنيه", "تسعه", "عشره",
    // Darija (arabizi)
    "wahed", "wa7ed", "wahd", "wa7d", "jouj", "joj", "tlata", "tlatha", "rb3a", "reb3a", "arb3a", "khamsa", "khmsa", "setta", "stta", "sitta", "seb3a", "sb3a", "tmnya", "tmenya", "tmanya", "ts3oud", "tes3od", "ts3od", "3achra",
  ].flatMap((word) => tokenize(word)),
);
/** Joins a compound number ("soixante et un", "vingt-deux" is split already). */
const CONNECTORS: ReadonlySet<string> = new Set(["et", "and", "و"]);
const DIGITS = /^\d{1,4}$/;

/** A phone number has 9-10 digits: six number words or digit groups in a row, at least three of them words, spell one. */
export const SPELLED_RUN_MIN = 6;
const SPELLED_WORDS_MIN = 3;

function isNumberWord(token: string): boolean {
  return tokenVariants(token).some((variant) => NUMBER_WORDS.has(variant));
}

/** True when the text spells a phone number with words ("zéro six soixante et un 23 45 67", "صفر ستة ...", "zero sita..."). */
export function spellsPhoneNumber(text: string): boolean {
  if (!text) return false;
  let run = 0;
  let words = 0;
  for (const token of tokenize(text)) {
    if (isNumberWord(token)) {
      run += 1;
      words += 1;
    } else if (DIGITS.test(token)) {
      run += 1;
    } else if (run > 0 && CONNECTORS.has(token)) {
      continue;
    } else {
      run = 0;
      words = 0;
    }
    if (run >= SPELLED_RUN_MIN && words >= SPELLED_WORDS_MIN) return true;
  }
  return false;
}
