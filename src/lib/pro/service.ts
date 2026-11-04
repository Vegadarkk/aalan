import "server-only";
import { randomInt } from "node:crypto";
import { launchOfferOpen, listingQuotas } from "@/config/pricing";
import type { AuthContext } from "@/lib/auth/guards";
import { getAbuseRules, getFlags, getPricing } from "@/lib/config/runtime";
import type { PinsInput, PinsResponse, SectionsInput, SectionsResponse, ShopSection } from "@/lib/contracts/catalog";
import type { ProAgencyInput, ProAgencyResponse, ProApplyInput, ProHolidayInput, ProHolidayResponse, ProMeResponse, ProRentalInput, ProRentalResponse, ProShopCard, ProShopCardInput, ProShopCardResponse } from "@/lib/contracts/pro";
import { cityBySlug } from "@/config/regions";
import { DEFAULT_BANNER } from "@/config/storefront";
import { db } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { countActive, getListings } from "@/lib/db/repositories/listings";
import { getProProfile, proProfileFromSnapshot, proProfileRef, proProfileToFirestore, type ProProfileRecord } from "@/lib/db/repositories/pro-profiles";
import { COLLECTIONS, type UserDoc } from "@/lib/db/schemas";
import { getUploads } from "@/lib/db/repositories/uploads";
import { getUser } from "@/lib/db/repositories/users";
import { HttpError } from "@/lib/http/errors";
import { sendMail } from "@/lib/mail";
import { listingRecipient } from "@/lib/mail/recipients";
import { newListingId, slugify } from "@/lib/listings/ids";
import { revalidateListingPaths } from "@/lib/listings/revalidate";
import { displayNameContact } from "@/lib/moderation/display-name";
import { firstStrictIssue } from "@/lib/moderation/free-text";
import { isPhoneVerificationConfigured } from "@/lib/phone-verify/config";
import { normalizeMoroccanMobile } from "@/lib/phone/normalize";
import { consume } from "@/lib/quota";
import { COMMITMENTS_VERSION, sectorCommitmentScope } from "./commitments";
import { iceFormatOk, KYBC_NOTICE_VERSION } from "./kybc";
import { publishesAsPro, storefrontShown, transition } from "./lifecycle";
import { shopLogoUrl } from "./logo-url";
import type { ProProfileDoc } from "./profile-schema";
import { rentalCheckView } from "./rental-check-rules";
import { socialView } from "./social-links-rules";

// Pro accounts (architecture §5 lifecycle, §6 "Devenir Pro", phase 7 design §4). The application
// creates proProfiles/{proId} in `pending_verification`; the account stays `individual` and
// publishes nothing as a Pro until a moderator validates the KYBC (verifyApplication, admin).
// `users/{uid}.proId` links the account to its shop from the application on (one shop per account
// at the MVP); the role and the claims change only at the verification.

export interface ProActor {
  auth: AuthContext;
  ip: string;
}

/** Shop id: same alphabet and length as a listing id, so `/boutique/{slug}-{proId}` reuses the slug helpers. */
export const newProId = newListingId;

/**
 * Eligibility of an application (and of sending its pieces): applications open
 * (`config/flags.proSignupEnabled`), an account not Pro yet, active, with a verified e-mail, and
 * no application in progress for it (a rejected one may be resubmitted). The phone never gates the
 * application (decision of 19 Oct 2026, audit Z1-03): an unverified one is checked by a
 * moderator's call during the review, so the application then carries the number to call.
 * A shop whose validation was withdrawn (P2-10) sends its new KYBC through the same path, even
 * while new applications are closed: it is not a new shop.
 */
export async function assertCanApply(auth: AuthContext): Promise<{ user: UserDoc; existing: ProProfileRecord | null }> {
  const uid = auth.user.uid;
  if (auth.user.claims.role === "pro") throw new HttpError(409, "already_pro");

  const user = await getUser(uid);
  if (!user || user.status !== "active") throw new HttpError(403, "account_suspended");
  if (!user.badges.emailVerified) throw new HttpError(403, "email_not_verified");

  const existing = user.proId ? await getProProfile(user.proId) : null;
  if (existing && !canResubmit(existing)) throw new HttpError(409, "pro_application_exists");
  if (!(existing && awaitsRevalidation(existing)) && !(await getFlags()).proSignupEnabled) throw new HttpError(403, "pro_signup_closed");
  return { user, existing };
}

/** A shop sent back to a KYBC review (P2-10) that has no submission under review. */
export function awaitsRevalidation(profile: Pick<ProProfileRecord, "lifecycle" | "kybc">): boolean {
  return profile.lifecycle === "revalidation_required" && profile.kybc.status !== "submitted";
}

/** A refused application, or a shop awaiting its new KYBC, may be submitted again. */
export function canResubmit(profile: Pick<ProProfileRecord, "lifecycle" | "kybc">): boolean {
  return profile.lifecycle === "rejected" || awaitsRevalidation(profile);
}

/**
 * Submits (or, after a rejection, resubmits) the application. Refuses what `assertCanApply`
 * refuses, and pieces that are not the applicant's `kyb` uploads.
 */
export async function submitApplication(actor: ProActor, input: ProApplyInput, now = new Date()): Promise<{ proId: string }> {
  const uid = actor.auth.user.uid;
  const { user, existing } = await assertCanApply(actor.auth);
  // The name and presentation become the public storefront: same text screen as its later edits
  // (updateShopCard), and no number or link in the name (audit B6, Z1-27).
  const { prohibited } = await getAbuseRules();
  if (displayNameContact(input.name)) throw new HttpError(422, "invalid_text", "shop name holds a contact detail", { details: { field: "name", issue: "contact" } });
  const descriptionIssue = input.description ? firstStrictIssue(input.description, prohibited) : null;
  if (descriptionIssue) throw new HttpError(422, "invalid_text", "presentation refused by the text screen", { details: { field: "description", issue: descriptionIssue } });
  // An agency applies as such (journey review 2026-10-29): its trade's commitments come with the shop's.
  const agencyScope = sectorCommitmentScope(input.sector);
  if (agencyScope && !input.sectorCommitment) throw new HttpError(400, "commitments_required", "the agency commitments must be accepted");
  // Without the badge the number to call is part of the application (checked by the moderator at the KYBC).
  let phoneToCheck: string | undefined;
  if (!user.badges.phoneVerified) {
    if (!input.phone) throw new HttpError(400, "phone_required");
    phoneToCheck = normalizeMoroccanMobile(input.phone).e164;
  }

  const pieces = await getUploads(input.uploadIds);
  const valid = pieces.filter((upload) => upload.ownerUid === uid && upload.purpose === "kyb" && upload.status === "ready");
  if (valid.length !== new Set(input.uploadIds).size) throw new HttpError(400, "invalid_pieces");

  const proId = existing?.proId ?? newProId();
  const pricing = await getPricing();

  const slug = slugify(`${input.name} ${input.citySlug.replace(/-/g, " ")}`) || "boutique";
  const doc: ProProfileDoc = {
    ownerUid: uid,
    members: { [uid]: "owner" },
    name: input.name,
    slug,
    description: input.description,
    whatsapp: false,
    regionCode: input.regionCode,
    citySlug: input.citySlug,
    legal: input.legal,
    kybc: {
      status: "submitted",
      iceFormatOk: iceFormatOk(input.legal.ice),
      uploadIds: [...new Set(input.uploadIds)],
      complianceCommitmentAt: now,
      commitmentsVersion: COMMITMENTS_VERSION,
      noticeVersion: KYBC_NOTICE_VERSION,
      ...(phoneToCheck ? { phoneToCheck } : {}),
      submittedAt: now,
    },
    lifecycle: "pending_verification",
    plan: "none",
    planSource: "none",
    quotas: listingQuotas({ type: "pro", plan: "none" }, pricing),
    // The sector is kept for every activity but a general shop (a dealership was lost before, B13).
    ...(input.sector !== "general" ? { sector: input.sector } : {}),
    ...(agencyScope ? { sectorCommitment: { sector: input.sector, version: COMMITMENTS_VERSION, at: now } } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // A shop under revalidation keeps all it has (plan, storefront settings, notes): only the
  // application's own fields are replaced, and it stays `revalidation_required` until the decision.
  const revalidation = existing !== null && awaitsRevalidation(existing);
  if (existing && !revalidation) transition(existing, { type: "reapplied" }, { now, graceDays: pricing.graceDays });
  const written = revalidation && existing ? revalidationSubmission(existing, doc, now) : doc;

  const ref = proProfileRef(proId);
  const userRef = db().collection(COLLECTIONS.users).doc(uid);
  // Two concurrent applications both read and write users/{uid}: Firestore serialises them and
  // the second one sees the first one's proId.
  await db().runTransaction(async (tx) => {
    const [userSnapshot, profileSnapshot] = await Promise.all([tx.get(userRef), tx.get(ref)]);
    const linked: unknown = userSnapshot.get("proId");
    if (linked !== undefined && linked !== proId) throw new HttpError(409, "pro_application_exists");
    const current = proProfileFromSnapshot(profileSnapshot);
    if (current && (!canResubmit(current) || awaitsRevalidation(current) !== revalidation)) throw new HttpError(409, "pro_application_exists");
    tx.set(ref, proProfileToFirestore(written));
    tx.update(userRef, { proId, updatedAt: Timestamp.fromDate(now) });
  });
  void consume("firestore.reads", 2);
  void consume("firestore.writes", 2);
  // The application's acknowledgement (audit L4-16); sendMail logs a failure, never throws.
  const to = await listingRecipient(uid).catch(() => null);
  if (to) await sendMail({ locale: to.locale, to: to.email, priority: "transactional", template: "proApplicationReceived", idempotencyKey: `proApplicationReceived-${proId}-${now.getTime()}`, data: { displayName: to.displayName, shopName: input.name } });
  return { proId };
}

/**
 * The new KYBC of a shop under revalidation (P2-10): the application's fields of `submitted`
 * replace the profile's, everything else (plan, storefront settings, notes, the state to restore)
 * is kept. Pure, for the unit tests.
 */
export function revalidationSubmission(existing: ProProfileRecord, submitted: ProProfileDoc, now: Date): ProProfileDoc {
  const { proId: _proId, sector: _sector, sectorCommitment, ...kept } = existing;
  const commitment = submitted.sectorCommitment ?? (sectorCommitment && sectorCommitment.sector === submitted.sector ? sectorCommitment : undefined);
  return {
    ...kept,
    name: submitted.name,
    slug: submitted.slug,
    description: submitted.description,
    regionCode: submitted.regionCode,
    citySlug: submitted.citySlug,
    legal: submitted.legal,
    kybc: { ...submitted.kybc, ...(existing.kybc.withdrawnAt ? { withdrawnAt: existing.kybc.withdrawnAt } : {}), ...(existing.kybc.withdrawReason ? { withdrawReason: existing.kybc.withdrawReason } : {}) },
    ...(submitted.sector ? { sector: submitted.sector } : {}),
    ...(commitment ? { sectorCommitment: commitment } : {}),
    updatedAt: now,
  };
}

/** GET /api/pro/me: the account's shop or application, the switches and the eligibility checks. */
export async function proSelf(auth: AuthContext): Promise<ProMeResponse> {
  const uid = auth.user.uid;
  const [flags, user, pricing] = await Promise.all([getFlags(), getUser(uid), getPricing()]);
  const eligibility = { emailVerified: user?.badges.emailVerified ?? false, phoneVerified: user?.badges.phoneVerified ?? false, accountActive: user?.status === "active" };
  // The offer a shop verified today receives (as decideApplication grants it).
  const launchOffer = !flags.salesEnabled && launchOfferOpen(pricing.launchOffer, new Date()) ? { noticeDays: pricing.launchOffer.noticeDays } : null;
  const base = { signupOpen: flags.proSignupEnabled, salesOpen: flags.salesEnabled, phoneVerification: isPhoneVerificationConfigured() ? ("whatsapp" as const) : ("call" as const), launchOffer, eligibility };
  const profile = user?.proId ? await getProProfile(user.proId) : null;
  if (!profile || profile.ownerUid !== uid) return { ...base, shop: null };
  const active = profile.lifecycle === "pending_verification" || profile.lifecycle === "rejected" || profile.lifecycle === "revalidation_required" ? 0 : await countActive(uid);
  return {
    ...base,
    shop: {
      proId: profile.proId,
      name: profile.name,
      slug: profile.slug,
      description: profile.description,
      regionCode: profile.regionCode,
      citySlug: profile.citySlug,
      legalForm: profile.legal.form,
      ice: profile.legal.ice,
      lifecycle: profile.lifecycle,
      plan: profile.plan,
      planSource: profile.planSource,
      kybcStatus: profile.kybc.status,
      rejectReason: profile.kybc.rejectReason ?? null,
      withdrawReason: profile.kybc.withdrawReason ?? null,
      withdrawnAt: profile.kybc.withdrawnAt?.toISOString() ?? null,
      submittedAt: profile.kybc.submittedAt?.toISOString() ?? null,
      quotas: profile.quotas,
      activeListings: active,
      launchOffer: profile.planSource === "launch_offer" ? { endsAt: pricing.launchOffer.endsAt, noticeDays: pricing.launchOffer.noticeDays } : null,
      storefront: storefrontShown(profile.lifecycle, profile.plan) ? `${profile.slug}-${profile.proId}` : null,
      sector: profile.sector ?? "general",
      feeSchedule: profile.agency?.feeSchedule ?? "",
      sections: profile.sections ?? [],
      rental: profile.rental ?? null,
      holiday: profile.holiday ?? null,
      rentalCheck: profile.rentalCheck ? rentalCheckView(profile.rentalCheck) : null,
      social: socialView(profile.social),
      card: shopCard(profile, user?.badges.phoneVerified ?? false),
    },
  };
}

/** The shop card as its owner edits it (UX audit of the Pro shops, lot 1). */
export function shopCard(profile: ProProfileRecord, phoneVerified: boolean): ProShopCard {
  return {
    description: profile.description,
    descriptionAr: profile.descriptionAr ?? "",
    citySlug: profile.citySlug,
    address: profile.address ?? "",
    hours: profile.hours ?? null,
    showPhone: profile.showPhone === true,
    whatsapp: profile.whatsapp,
    website: profile.website ?? "",
    bannerKey: profile.bannerKey ?? DEFAULT_BANNER,
    logo: shopLogoUrl(profile.logoKey, "l"),
    phoneVerified,
  };
}

/**
 * PUT /api/pro/me (UX audit of the Pro shops, lot 1): the shop card, replaced whole, by the owner
 * of a verified shop that publishes. Every free text passes the storefront text screen (no contact
 * detail, prohibited term or sensitive data): the number and WhatsApp are switches over the
 * verified number, never typed. A number can be shown only once verified; the city moves the region.
 */
export async function updateShopCard(auth: AuthContext, input: ProShopCardInput, now = new Date()): Promise<ProShopCardResponse> {
  const [profile, { prohibited }, user] = await Promise.all([ownedPublishingShop(auth), getAbuseRules(), getUser(auth.user.uid)]);
  const texts: [string, string][] = [
    ["description", input.description],
    ["descriptionAr", input.descriptionAr],
    ["address", input.address],
    ["hours.note", input.hours?.note ?? ""],
  ];
  for (const [field, text] of texts) {
    const issue = text ? firstStrictIssue(text, prohibited) : null;
    if (issue) throw new HttpError(422, "invalid_text", "shop card refused by the text screen", { details: { field, issue } });
  }
  const city = cityBySlug(input.citySlug);
  if (!city) throw new HttpError(400, "invalid_body", "unknown city", { details: [{ path: ["citySlug"], code: "invalid" }] });
  const phoneVerified = user?.badges.phoneVerified ?? false;
  if ((input.showPhone || input.whatsapp) && !phoneVerified) throw new HttpError(409, "phone_required");
  const hours = input.hours && (input.hours.days.length > 0 || input.hours.note) ? input.hours : null;
  await proProfileRef(profile.proId).update({
    description: input.description,
    descriptionAr: input.descriptionAr || FieldValue.delete(),
    citySlug: city.slug,
    regionCode: city.regionCode,
    address: input.address || FieldValue.delete(),
    hours: hours ?? FieldValue.delete(),
    showPhone: input.showPhone,
    whatsapp: input.whatsapp,
    website: input.website || FieldValue.delete(),
    bannerKey: input.bannerKey,
    updatedAt: Timestamp.fromDate(now),
  });
  void consume("firestore.reads", 2);
  void consume("firestore.writes", 1);
  if (storefrontShown(profile.lifecycle, profile.plan)) revalidateListingPaths({ shopSegment: `${profile.slug}-${profile.proId}` });
  const next: ProProfileRecord = {
    ...profile,
    description: input.description,
    ...(input.descriptionAr ? { descriptionAr: input.descriptionAr } : { descriptionAr: undefined }),
    citySlug: city.slug,
    address: input.address || undefined,
    hours: hours ?? undefined,
    showPhone: input.showPhone,
    whatsapp: input.whatsapp,
    website: input.website || undefined,
    bannerKey: input.bannerKey,
  };
  return { card: shopCard(next, phoneVerified) };
}

/**
 * PUT /api/pro/me/agency (Agence pack design §3): the owner sets the shop's sector and, for a
 * real-estate agency, its fee schedule. The owner of a verified shop that publishes (not
 * suspended), from the session claims; the storefront is revalidated when shown.
 */
export async function updateAgency(auth: AuthContext, input: ProAgencyInput, now = new Date()): Promise<ProAgencyResponse> {
  const [profile, { prohibited }] = await Promise.all([ownedPublishingShop(auth), getAbuseRules()]);
  // Becoming an agency takes the trade's legal commitments, ticked by the owner (owner ask 2026-10-29).
  const becomesAgency = sectorCommitmentScope(input.sector) !== null && input.sector !== (profile.sector ?? "general");
  if (becomesAgency && !input.acceptCommitments) throw new HttpError(400, "commitments_required", "the agency commitments must be accepted");
  const feeSchedule = input.sector === "real_estate" ? input.feeSchedule : "";
  // The listing text rules, sensitive data refused outright (as a member's storefront bio).
  const issue = feeSchedule ? firstStrictIssue(feeSchedule, prohibited) : null;
  if (issue) throw new HttpError(422, "invalid_text", "fee schedule refused by the text screen", { details: { field: "feeSchedule", issue } });
  await proProfileRef(profile.proId).update({
    sector: input.sector,
    agency: feeSchedule ? { feeSchedule } : FieldValue.delete(),
    ...(becomesAgency ? { sectorCommitment: { sector: input.sector, version: COMMITMENTS_VERSION, at: Timestamp.fromDate(now) } } : {}),
    updatedAt: Timestamp.fromDate(now),
  });
  void consume("firestore.reads", 1);
  void consume("firestore.writes", 1);
  if (storefrontShown(profile.lifecycle, profile.plan)) revalidateListingPaths({ shopSegment: `${profile.slug}-${profile.proId}` });
  return { sector: input.sector, feeSchedule };
}

const SECTION_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const newSectionId = () => Array.from({ length: 6 }, () => SECTION_ID_ALPHABET[randomInt(SECTION_ID_ALPHABET.length)]).join("");

/**
 * PUT /api/pro/me/sections (catalogue §5): the storefront's sections, replaced whole in display
 * order. A section keeps its id (its listings stay in it); an unknown id is a new section; a
 * removed one leaves its listings' `sectionId` behind, ignored by every reader. Names pass the
 * storefront text screen.
 */
export async function updateSections(auth: AuthContext, input: SectionsInput, now = new Date()): Promise<SectionsResponse> {
  const [profile, { prohibited }] = await Promise.all([ownedPublishingShop(auth), getAbuseRules()]);
  const known = new Set((profile.sections ?? []).map((section) => section.id));
  const used = new Set<string>();
  const sections: ShopSection[] = input.sections.map((section, index) => {
    const issue = firstStrictIssue(section.name, prohibited);
    if (issue) throw new HttpError(422, "invalid_text", "section name refused by the text screen", { details: { field: `sections.${index}.name`, issue } });
    let id = section.id && known.has(section.id) && !used.has(section.id) ? section.id : newSectionId();
    while (used.has(id) || (id !== section.id && known.has(id))) id = newSectionId();
    used.add(id);
    return { id, name: section.name };
  });
  await proProfileRef(profile.proId).update({ sections: sections.length > 0 ? sections : FieldValue.delete(), updatedAt: Timestamp.fromDate(now) });
  void consume("firestore.reads", 1);
  void consume("firestore.writes", 1);
  if (storefrontShown(profile.lifecycle, profile.plan)) revalidateListingPaths({ shopSegment: `${profile.slug}-${profile.proId}` });
  return { sections };
}

/**
 * PUT /api/pro/me/pins (UX audit of the Pro shops, lot 3): the listings pinned above the storefront
 * grid, replaced whole in display order. Each must be one of the shop's published listings (one
 * read each, at most 4); the storefront drops any that later stops being published.
 */
export async function updatePins(auth: AuthContext, input: PinsInput, now = new Date()): Promise<PinsResponse> {
  const profile = await ownedPublishingShop(auth);
  const listings = new Map((await getListings(input.listingIds)).map((listing) => [listing.id, listing]));
  input.listingIds.forEach((id, index) => {
    const listing = listings.get(id);
    if (!listing || listing.proId !== profile.proId || listing.status !== "published") {
      throw new HttpError(422, "invalid_body", "pinned listing is not a published listing of the shop", { details: [{ path: `listingIds.${index}`, code: "pin_unavailable" }] });
    }
  });
  await proProfileRef(profile.proId).update({ pinned: input.listingIds.length > 0 ? input.listingIds : FieldValue.delete(), updatedAt: Timestamp.fromDate(now) });
  void consume("firestore.reads", 1);
  void consume("firestore.writes", 1);
  if (storefrontShown(profile.lifecycle, profile.plan)) revalidateListingPaths({ shopSegment: `${profile.slug}-${profile.proId}` });
  return { pinned: input.listingIds };
}

/** The owner's shop, verified and publishing (not suspended), from the session claims; else 409/403. */
export async function ownedPublishingShop(auth: AuthContext): Promise<ProProfileRecord> {
  const { proId, proRole } = auth.user.claims;
  if (!proId) throw new HttpError(409, "pro_not_verified");
  if (proRole !== "owner") throw new HttpError(403, "forbidden");
  const profile = await getProProfile(proId);
  if (!profile || profile.ownerUid !== auth.user.uid || !publishesAsPro(profile.lifecycle)) throw new HttpError(409, "pro_not_verified");
  return profile;
}

/** PUT /api/pro/me/holiday: a holiday rental agency's settings (audit L4-02). */
export async function updateHolidayAgency(auth: AuthContext, input: ProHolidayInput, now = new Date()): Promise<ProHolidayResponse> {
  const profile = await ownedPublishingShop(auth);
  await proProfileRef(profile.proId).update({ holiday: input, updatedAt: Timestamp.fromDate(now) });
  void consume("firestore.reads", 1);
  void consume("firestore.writes", 1);
  if (storefrontShown(profile.lifecycle, profile.plan)) revalidateListingPaths({ shopSegment: `${profile.slug}-${profile.proId}` });
  return { holiday: input };
}

/**
 * PUT /api/pro/me/rental (rental pack §5): the car rental agency's settings, replaced whole. The
 * branch addresses and the hours pass the storefront text screen (no contact detail, prohibited
 * term or sensitive data); the storefront is revalidated when shown. A new licence reference drops
 * the document check made against the previous one (decision 5).
 */
export async function updateRentalAgency(auth: AuthContext, input: ProRentalInput, now = new Date()): Promise<ProRentalResponse> {
  const [profile, { prohibited }] = await Promise.all([ownedPublishingShop(auth), getAbuseRules()]);
  const texts: [string, string][] = [["hours", input.hours], ...input.branches.map((branch, index): [string, string] => [`branches.${index}.address`, branch.address])];
  for (const [field, text] of texts) {
    const issue = text ? firstStrictIssue(text, prohibited) : null;
    if (issue) throw new HttpError(422, "invalid_text", "rental settings refused by the text screen", { details: { field, issue } });
  }
  // The licence check was made against the previous reference: a new one needs a new document.
  const dropCheck = profile.rentalCheck !== undefined && profile.rentalCheck.agrementRef !== input.agrementRef;
  await proProfileRef(profile.proId).update({ rental: input, ...(dropCheck ? { rentalCheck: FieldValue.delete() } : {}), updatedAt: Timestamp.fromDate(now) });
  void consume("firestore.reads", 1);
  void consume("firestore.writes", 1);
  if (storefrontShown(profile.lifecycle, profile.plan)) revalidateListingPaths({ shopSegment: `${profile.slug}-${profile.proId}` });
  return { rental: input };
}
