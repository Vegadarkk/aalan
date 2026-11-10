import { z } from "@/lib/zod";

// Basic business verification of a Pro (KYBC, architecture §8 "Vérification", §5 `proProfiles.legal`).
// The identifiers asked depend on the legal form; the ICE (15 digits) is checked for its format
// here, then a moderator checks it by hand on OMPIC or DirectInfo. Other identifiers are only
// normalised and bounded: their exact formats are not checked automatically (no official source
// read yet), the moderator verifies them with the uploaded pieces.

export const LEGAL_FORMS = ["societe", "auto_entrepreneur", "commercant", "cooperative", "entreprise_ue"] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];
/** The Moroccan legal forms (an ICE each), in the order the application lists them. */
export const MOROCCAN_LEGAL_FORMS = ["societe", "auto_entrepreneur", "commercant", "cooperative"] as const satisfies readonly LegalForm[];

/**
 * A company registered in the European Union (carriers space, owner 2026-11-10): only a carrier
 * (sector "carrier") may apply with it, since the Europe–Morocco carriers are often French, Belgian
 * or Spanish businesses. The countries of the Moroccan diaspora the carriers serve.
 */
export const EU_COUNTRIES = ["FR", "BE", "NL", "ES", "IT", "DE", "PT"] as const;
export type EuCountry = (typeof EU_COUNTRIES)[number];

/** Identifier fields required per legal form; `commercant` needs `rc` or `tp` (one of them). */
export const REQUIRED_IDENTIFIERS: Record<LegalForm, readonly string[]> = {
  societe: ["ice", "rc", "if"],
  auto_entrepreneur: ["ice", "aeNumber"],
  commercant: ["ice"],
  // Law 112-12: registered at the local register of cooperatives (tribunal), mirrored by ODCo's central one.
  cooperative: ["ice", "coopNumber"],
  entreprise_ue: ["country", "registry"],
};

/** Removes spaces, dots and dashes users type in identifiers (ICE "001 234 567 000 089"). */
export function normalizeIdentifier(value: string): string {
  return value.replace(/[\s.\-_]/g, "").toUpperCase();
}

export const ICE_LENGTH = 15;

export function iceFormatOk(value: string): boolean {
  return /^\d{15}$/.test(normalizeIdentifier(value));
}

const ice = z
  .string()
  .transform(normalizeIdentifier)
  .refine((value) => /^\d{15}$/.test(value), { message: "ice_format" });

/** Registry numbers (RC, IF, AE number, taxe professionnelle, cooperative number): letters, digits and "/" only. */
const registryNumber = z
  .string()
  .transform((value) => normalizeIdentifier(value))
  .refine((value) => /^[A-Z0-9/]{1,30}$/.test(value), { message: "identifier_format" });

/** Luhn checksum (French SIREN and SIRET). */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * The company number of an EU business as its country's register writes it, normalised (no spaces,
 * dots or dashes, upper case, the country prefix of a Belgian number dropped). Checked where the
 * format carries a checksum (France: SIREN or SIRET, Luhn, La Poste's SIRET by its own rule;
 * Belgium: enterprise number, mod 97), bounded elsewhere; a moderator checks it on the register.
 */
export function euRegistryOk(country: EuCountry, value: string): boolean {
  const id = normalizeIdentifier(value);
  switch (country) {
    case "FR":
      if (!/^\d{9}$|^\d{14}$/.test(id)) return false;
      // La Poste (SIREN 356000000): its establishments' SIRET sum to a multiple of 5.
      if (id.length === 14 && id.startsWith("356000000")) return [...id].reduce((sum, digit) => sum + Number(digit), 0) % 5 === 0;
      return luhn(id);
    case "BE": {
      const digits = id.replace(/^BE/, "");
      if (!/^[01]\d{9}$/.test(digits)) return false;
      return 97 - (Number(digits.slice(0, 8)) % 97) === Number(digits.slice(8));
    }
    case "NL":
      // Kamer van Koophandel number.
      return /^\d{8}$/.test(id);
    case "ES":
      // NIF / CIF / NIE: nine characters, a letter or a digit at each end.
      return /^[A-Z0-9]\d{7}[A-Z0-9]$/.test(id);
    case "IT":
      // Partita IVA (11 digits) or a sole trader's codice fiscale (16 characters).
      return /^\d{11}$/.test(id) || /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(id);
    case "PT":
      // NIPC.
      return /^\d{9}$/.test(id);
    case "DE":
      // Handelsregister number (HRA/HRB with the court) or the Steuernummer of a sole trader.
      return /^[A-Z0-9/]{4,24}$/.test(id) && /\d{3}/.test(id);
  }
}

/** Normalised company number (`euRegistryOk`'s form): the stored and compared value. */
export function normalizeEuRegistry(country: EuCountry, value: string): string {
  const id = normalizeIdentifier(value);
  return country === "BE" ? id.replace(/^BE/, "") : id;
}

/** EU VAT number: the country's prefix (Greece "EL"), then 2 to 13 letters and digits. */
export const EU_VAT_PATTERN = /^(?:FR|BE|NL|ES|IT|DE|PT)[A-Z0-9]{2,13}$/;

const euCompany = z
  .object({
    form: z.literal("entreprise_ue"),
    country: z.enum(EU_COUNTRIES),
    registry: z.string().max(40),
    vat: z.string().transform(normalizeIdentifier).refine((value) => EU_VAT_PATTERN.test(value), { message: "vat_format" }).optional(),
  })
  .strict()
  .transform((value) => ({ ...value, registry: normalizeEuRegistry(value.country, value.registry) }))
  .refine((value) => euRegistryOk(value.country, value.registry), { message: "registry_format", path: ["registry"] })
  .refine((value) => value.vat === undefined || value.vat.startsWith(value.country), { message: "vat_country", path: ["vat"] });

export const proLegalSchema = z.union([
  z.discriminatedUnion("form", [
    z.object({ form: z.literal("societe"), ice, rc: registryNumber, if: registryNumber }).strict(),
    z.object({ form: z.literal("auto_entrepreneur"), ice, aeNumber: registryNumber }).strict(),
    z
      .object({ form: z.literal("commercant"), ice, rc: registryNumber.optional(), tp: registryNumber.optional() })
      .strict()
      .refine((value) => value.rc !== undefined || value.tp !== undefined, { message: "rc_or_tp_required", path: ["rc"] }),
    z.object({ form: z.literal("cooperative"), ice, coopNumber: registryNumber }).strict(),
  ]),
  euCompany,
]);
export type ProLegal = z.infer<typeof proLegalSchema>;
export type MoroccanLegal = Exclude<ProLegal, { form: "entreprise_ue" }>;

/** The applicant's legal form is an EU company (no ICE). */
export const isEuCompany = (legal: ProLegal): legal is Extract<ProLegal, { form: "entreprise_ue" }> => legal.form === "entreprise_ue";

/** The shop's main identifier: its ICE, or an EU company's number in its country's register. */
export function primaryIdentifier(legal: ProLegal): { kind: "ice" | "eu_registry"; value: string; country: "MA" | EuCountry } {
  return isEuCompany(legal) ? { kind: "eu_registry", value: legal.registry, country: legal.country } : { kind: "ice", value: legal.ice, country: "MA" };
}

/** The main identifier's format is right (ICE: 15 digits; EU: the register's format). */
export function primaryIdentifierOk(legal: ProLegal): boolean {
  return isEuCompany(legal) ? euRegistryOk(legal.country, legal.registry) : iceFormatOk(legal.ice);
}

/** `withdrawn`: an admin withdrew the validation (P2-10); a new submission is awaited. */
export const KYBC_STATUSES = ["none", "submitted", "verified", "rejected", "withdrawn"] as const;
export type KybcStatus = (typeof KYBC_STATUSES)[number];

/** Pieces uploaded with an application (private bucket, purpose `kyb`). */
export const KYBC_MIN_PIECES = 1;
export const KYBC_MAX_PIECES = 6;

/** Upload documents an applicant may hold at once (pieces in flight, attached or refused, kept 7 days unless attached). */
export const KYBC_UPLOADS_PER_ACCOUNT = 3 * KYBC_MAX_PIECES;

/** Bytes read to check a piece's real type. */
export const KYBC_SNIFF_BYTES = 16;

/**
 * Real type of a KYBC piece from its first bytes: JPEG, PNG or PDF (`%PDF-` at offset 0, stricter
 * than readers that search the first kilobyte), null otherwise. Never the declared type.
 */
export function sniffKybcType(bytes: Uint8Array): "image/jpeg" | "image/png" | "application/pdf" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) return "image/png";
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length >= pdf.length && pdf.every((byte, index) => bytes[index] === byte)) return "application/pdf";
  return null;
}

/** Private bucket key of a piece (never served publicly; staff read it through the admin app). */
export function kybcObjectKey(uid: string, uploadId: string): string {
  return `kyb/${uid}/${uploadId}`;
}

/**
 * Version of the collection notice shown with the pieces (`Pro.form.piecesNotice`: purpose, who
 * sees them, retention, hosting outside Morocco, rights). Stored with the application
 * (`kybc.noticeVersion`, loi 09-08 art. 5); bump it when the text changes in substance.
 */
export const KYBC_NOTICE_VERSION = "2026-10-19";

/**
 * PDF name tokens that run code, open files or embed payloads (`/OpenAction` + `/JavaScript`,
 * `/Launch`, `/EmbeddedFile`, XFA forms...). A piece carrying one is refused at `complete`: staff
 * download the PDFs to a desktop reader. Raw bytes only: the server check also inflates the
 * compressed object streams (`pdfHasActiveContentDeep`, src/lib/pro/kybc-pdf.ts). Defence in
 * depth, not a sanitiser.
 */
const PDF_ACTIVE_TOKENS = /\/(?:JavaScript|JS|Launch|OpenAction|AA|EmbeddedFiles?|RichMedia|XFA|GoToR|SubmitForm|ImportData)(?![A-Za-z0-9_])/;

export function pdfHasActiveContent(bytes: Uint8Array): boolean {
  // `#xx` escapes in names (`/J#61vaScript`) are decoded before the match.
  const text = new TextDecoder("latin1").decode(bytes).replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return PDF_ACTIVE_TOKENS.test(text);
}
