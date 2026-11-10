import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { HttpError } from "@/lib/http/errors";
import { EU_MOBILE_E164, MOBILE_E164, MOROCCAN_MOBILE_E164 } from "./patterns";

// Moroccan mobile numbers (§6 "Vérification WhatsApp": 06 and 07 only). The "max" metadata is
// required: the default bundle carries no number types, so landlines could not be told apart.
// Pure module: usable by the API routes, the webhook and the browser forms alike.

export { EU_MOBILE_E164, MOBILE_E164, MOROCCAN_MOBILE_E164 };

/** Non-mobile ranges of the Moroccan plan: 05 landlines, 08 special numbers (toll-free, premium). */
const MOROCCAN_NON_MOBILE = /^\+212[58]\d{8}$/;

/** Characters a typed number may contain: digits, one leading "+", spaces, dots, dashes, parentheses. */
const ALLOWED_INPUT = /^\+?[\d\s().-]+$/;

export interface NormalizedPhone {
  /** +212612345678 */
  e164: string;
  /** 06 12 34 56 78 */
  national: string;
}

/**
 * Validates a Moroccan mobile typed by the user: national 06/07 forms, +212 6/7, 00212 6/7, with
 * spaces, dots or dashes. `phone_invalid` when it is not a valid Moroccan number, `phone_not_mobile`
 * when it is a landline or another non-mobile range.
 */
export function normalizeMoroccanMobile(input: string): NormalizedPhone {
  const text = input.trim();
  if (text === "" || text.length > 32 || !ALLOWED_INPUT.test(text)) throw new HttpError(400, "phone_invalid");
  const parsed = parsePhoneNumberFromString(text, "MA");
  if (!parsed || parsed.countryCallingCode !== "212") throw new HttpError(400, "phone_invalid");
  // A landline or special number is refused as "not mobile" even when the exact range is
  // unassigned in the metadata: "mobile only" is the message that helps the user.
  if (MOROCCAN_NON_MOBILE.test(parsed.number)) throw new HttpError(400, "phone_not_mobile");
  if (!parsed.isValid()) throw new HttpError(400, "phone_invalid");
  const type = parsed.getType();
  if ((type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") || !MOROCCAN_MOBILE_E164.test(parsed.number)) {
    throw new HttpError(400, "phone_not_mobile");
  }
  return { e164: parsed.number, national: displayPhone(parsed.number) };
}

/**
 * Calling codes of the EU countries a carrier registered there may give a mobile of (carriers
 * space, owner 2026-11-10: KYBC form "entreprise_ue"): FR, BE, NL, ES, IT, DE, PT.
 */
const EU_CALLING_CODES: ReadonlySet<string> = new Set(["33", "32", "31", "34", "39", "49", "351"]);

/**
 * A Moroccan mobile, or with `eu` an EU mobile typed in its international form (+33 6…, 0033 6…):
 * a national "06…" stays Moroccan, the form's hint says so. Same errors as `normalizeMoroccanMobile`.
 */
export function normalizeMobile(input: string, options: { eu: boolean }): NormalizedPhone {
  const text = input.trim();
  const international = text.replace(/^00/, "+");
  if (options.eu && international.startsWith("+") && !/^\+\s*2\s*1\s*2/.test(international)) {
    if (text.length > 32 || !ALLOWED_INPUT.test(international)) throw new HttpError(400, "phone_invalid");
    const parsed = parsePhoneNumberFromString(international);
    if (!parsed || !EU_CALLING_CODES.has(parsed.countryCallingCode) || !parsed.isValid()) throw new HttpError(400, "phone_invalid");
    const type = parsed.getType();
    if ((type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") || !EU_MOBILE_E164.test(parsed.number)) throw new HttpError(400, "phone_not_mobile");
    return { e164: parsed.number, national: displayPhone(parsed.number) };
  }
  return normalizeMoroccanMobile(input);
}

/** National display form of a Moroccan E.164 number ("06 12 34 56 78"); an EU mobile in its international form; other values as is. */
export function displayPhone(e164: string): string {
  if (EU_MOBILE_E164.test(e164)) return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
  const match = /^\+212(\d{9})$/.exec(e164);
  if (!match?.[1]) return e164;
  const national = `0${match[1]}`;
  return national.replace(/(\d{2})(?=\d)/g, "$1 ");
}
