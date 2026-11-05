import type { OpeningHours } from "@/lib/pro/profile-schema";
import type { Locale } from "@/config/site";
import { BANNER_KEYS, BIO_MAX, type BannerKey } from "@/config/storefront";
import { citySlugSchema } from "@/lib/contracts/listings";
import { PASSWORD_MAX } from "@/lib/contracts/endpoints";
import { z } from "@/lib/zod";

// Account closure and personal data export (phase 5 design D26, lot L7; AF §5 UserPrivate, §6
// "La clôture passe par l'API", §7 retention table). Client-safe: the settings page and the API
// share these shapes. Paths are in endpoints.ts (ACCOUNT_API).

/** A closure needs a sign-in younger than this (session auth_time); older: 403 `recent_auth_required`. */
export const RECENT_AUTH_SECONDS = 10 * 60;

/** POST /api/account/close body: an explicit confirmation, nothing else. */
export const closeAccountSchema = z.object({ confirm: z.literal(true) }).strict();
export type CloseAccountInput = z.infer<typeof closeAccountSchema>;

/** POST /api/account/close: the account is closed (also when it already was: idempotent). */
export interface CloseAccountResponse {
  status: "closed";
  /** ISO. */
  closedAt: string;
  /** ISO: e-mail, phone and pseudonym are deleted at this date (closure + 1 year). */
  purgeAt: string;
}

/**
 * POST /api/account/email (Z1-10): the new address and the current password (re-authentication).
 * Password accounts only: a Google-only account answers 409 `password_required`.
 */
export const emailChangeSchema = z
  .object({
    newEmail: z.string().trim().toLowerCase().email().max(254),
    currentPassword: z.string().min(1).max(PASSWORD_MAX),
  })
  .strict();
export type EmailChangeInput = z.infer<typeof emailChangeSchema>;

/** The confirmation link sent to the new address is valid this long (and once). */
export const EMAIL_CHANGE_TTL_HOURS = 24;

/**
 * POST answers "pending" whether or not the address is free (no enumeration: a link goes only to
 * an address no account uses); DELETE answers "cancelled".
 */
export type EmailChangeResponse = { status: "pending"; newEmail: string; expiresAt: string } | { status: "cancelled" };

export const ACCOUNT_EXPORT_FORMAT = "aalan.account-export";
export const ACCOUNT_EXPORT_VERSION = 1;

/** Lists of the export, each read up to its limit (Firestore Spark: 50 000 reads a day for the whole site). */
export const EXPORT_SECTIONS = ["listings", "favorites", "savedSearches", "conversations", "messages", "reportsFiled", "decisions", "blockedAccounts", "reviewsGiven", "reviewsReceived"] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export interface ExportListing {
  id: string;
  slugId: string | null;
  status: string;
  pausedReason: string | null;
  sellerName: string;
  sellerType: "individual" | "pro";
  title: string;
  description: string;
  categoryId: string | null;
  subcategoryId: string | null;
  attributes: Record<string, unknown>;
  condition: string | null;
  price: number | null;
  priceNegotiable: boolean;
  isDonation: boolean;
  location: { regionCode: string; citySlug: string; district: string | null } | null;
  photoIds: string[];
  contact: { messaging: boolean; showPhone: boolean; whatsapp: boolean };
  sensitiveDeclaration: { kind: string; at: string } | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  expiresAt: string | null;
}

export interface ExportMessage {
  mine: boolean;
  type: "text" | "system";
  /** As stored: links and contact details masked, `⟦hidden⟧` once hidden by moderation. */
  text: string;
  flags: string[];
  hidden: boolean;
  createdAt: string;
  readAt: string | null;
  /** A price offer step (Carte vivante lot 5): the marker in `text` names the event, this its amount (DH). */
  offer?: { event: string; amount: number };
}

export interface ExportConversation {
  cid: string;
  role: "buyer" | "seller";
  listing: { slugId: string; title: string; price: number | null; isDonation: boolean };
  counterpart: { publicId: string; displayName: string };
  archived: boolean;
  deletedForMe: boolean;
  blockedByMe: boolean;
  frozen: boolean;
  createdAt: string;
  updatedAt: string;
  /** Oldest first; the newest ones when the conversation is longer than the limit. */
  messages: ExportMessage[];
  messagesTruncated: boolean;
  /** The conversation's last price offer (Carte vivante lot 5), amounts in DH. */
  offer?: { status: string; amount: number; counter: number | null; price: number; createdAt: string; expiresAt: string };
}

export interface ExportReport {
  id: string;
  target: { type: string; listingId: string | null; publicId: string | null };
  reasonId: string;
  explanation: string;
  reporter: { name: string | null; email: string | null; locale: Locale };
  status: string;
  outcome: string | null;
  createdAt: string;
  closedAt: string | null;
  /** This notifier's own appeal against the outcome (art. 20 DSA), when there is one. */
  appeal: { status: string; text: string | null; openedAt: string; closedAt: string | null; note: string | null } | null;
}

export interface ExportDecision {
  decisionId: string;
  action: string;
  targetType: string;
  templateId: string;
  durationDays: number | null;
  origin: string;
  automated: { detection: boolean; decision: boolean };
  /** Statement of reasons as stored (French). */
  facts: string;
  ground: { type: string; ref: string; explanation: string };
  createdAt: string;
  notifiedAt: string | null;
  appealDeadline: string;
  appeal: { status: string; text: string | null; openedAt: string; closedAt: string | null; note: string | null } | null;
}

export interface AccountExport {
  format: typeof ACCOUNT_EXPORT_FORMAT;
  version: typeof ACCOUNT_EXPORT_VERSION;
  /** ISO. */
  generatedAt: string;
  /** What the file is and what it leaves out, in the account's language (French for Tarifit). */
  about: string[];
  /** Lists cut at their limit for this download (the newest kept). */
  truncated: Partial<Record<ExportSection, { limit: number }>>;
  profile: {
    publicId: string;
    displayName: string;
    type: "individual" | "pro";
    regionCode: string | null;
    citySlug: string | null;
    storefront: { bio: string | null; bannerKey: string | null };
    /** URL of the profile photo, null while none. */
    avatar: string | null;
    locale: Locale;
    status: string;
    badges: { emailVerified: boolean; phoneVerified: boolean; proCertified: boolean };
    stats: { activeListings: number; responseRate: number; medianReplyMin: number; ratingAvg: number | null; ratingCount: number };
    createdAt: string;
    updatedAt: string;
  } | null;
  account: {
    email: string;
    phone: string | null;
    phoneVerifiedAt: string | null;
    legalName: string | null;
    providers: string[];
    consents: { cgu: { version: string; at: string }; transfers: { version: string; at: string } | null; marketing: boolean; marketingConsent: { version: string; at: string } | null };
    notifications: { messagesEmail: boolean };
    sanctions: { strikeLevel: number; lastAt: string | null; suspendedUntil: string | null };
    reporting: { abusiveUntil: string | null; warnedAt: string | null };
  } | null;
  pro: {
    name: string;
    slug: string;
    description: string;
    /** Shop card (UX audit of the Pro shops, lot 1). */
    descriptionAr: string | null;
    address: string | null;
    hours: OpeningHours | null;
    showPhone: boolean;
    website: string | null;
    /** Social links of the storefront (handles). */
    social: { network: string; handle: string }[];
    regionCode: string;
    citySlug: string;
    whatsapp: boolean;
    phonePublic: string | null;
    legal: Record<string, string>;
    verification: { status: string; submittedAt: string | null; pieces: number; rejectReason: string | null; phoneCheck: { at: string; outcome: string; phone: string } | null };
    certifiedAt: string | null;
    lifecycle: string;
    plan: string;
    planSource: string;
    createdAt: string;
  } | null;
  listings: ExportListing[];
  favorites: { listingId: string; slugId: string; title: string; price: number | null; isDonation: boolean; savedAt: string }[];
  savedSearches: { name: string; params: Record<string, unknown>; alert: string; createdAt: string; updatedAt: string; lastAlertAt: string | null }[];
  conversations: ExportConversation[];
  reportsFiled: ExportReport[];
  decisions: ExportDecision[];
  blockedAccounts: { publicId: string; displayName: string }[];
  /** Verified reviews (vitrine-avis §2): the ones the account wrote, and the ones about it (published or hidden). */
  reviewsGiven: ExportReview[];
  reviewsReceived: ExportReview[];
}

export interface ExportReview {
  listingId: string;
  listingTitle: string;
  /** The seller for a review given, the buyer's display name (empty once closed) for one received. */
  counterpartName: string;
  rating: number;
  text: string;
  status: string;
  reply: { text: string; at: string } | null;
  experienceAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST /api/account/storefront (vitrine-avis §1): each field optional, null (or an empty bio)
 * clears it. The bio is screened again on the server (src/lib/moderation/free-text.ts).
 */
export const storefrontSchema = z
  .object({
    bio: z.string().trim().max(BIO_MAX).nullable().optional(),
    bannerKey: z.enum(BANNER_KEYS).nullable().optional(),
    citySlug: citySlugSchema.nullable().optional(),
  })
  .strict();
export type StorefrontInput = z.infer<typeof storefrontSchema>;

/** The profile photo's upper bound as sent (audit §7): re-encoded to a few dozen KB. */
export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** PUT / DELETE /api/account/avatar: the large variant's URL, null once removed. */
export type AvatarResponse = { avatar: string | null };

/** DELETE /api/admin/users/{uid}/avatar: why the moderator removes the photo (statement of reasons). */
export const adminAvatarRemoveSchema = z.object({ details: z.string().trim().min(10).max(1000) }).strict();

/** What the storefront settings show and the profile page renders. */
export interface StorefrontSettings {
  publicId: string;
  /** URL of the profile photo (large variant), null while none (the initial stands in). */
  avatar: string | null;
  bio: string;
  bannerKey: BannerKey;
  citySlug: string | null;
}

/**
 * POST /api/account/notifications (audit B2: Z1-02, zone 5 n°4): each switch optional. `marketing`
 * is the opt-in to Aalan's news and offers given (or not) at sign-up, withdrawn or given again here;
 * `messagesEmail` covers the e-mails of the messaging (grouped new messages, meeting reminders,
 * reviews). Saved-search alerts keep their own switch per search (/recherches).
 */
export const notificationSettingsSchema = z
  .object({
    marketing: z.boolean().optional(),
    messagesEmail: z.boolean().optional(),
  })
  .strict();
export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;

/** What the settings section shows. */
export interface NotificationSettings {
  marketing: boolean;
  /** ISO date of the opt-in in force, null when none. */
  marketingSince: string | null;
  messagesEmail: boolean;
}
