import { setTimeout as delay } from "node:timers/promises";
import { launchPlacesOpen } from "@/config/pricing";
import { alert } from "@/lib/alert";
import { getPricing } from "@/lib/config/runtime";
import { serverEnv } from "@/lib/env";
import { isFirestoreConfigured } from "@/lib/firebase/admin";
import { parseOpensAt } from "@/lib/launch/gate";
import { logger } from "@/lib/logging/logger";
import { deliverMail, type DeliverOutcome } from "@/lib/mail/deliver";
import { ProviderError } from "@/lib/mail/transports/errors";
import type { TemplateData, TemplateMail } from "@/lib/mail/types";
import { closedCampaigns, dueCampaign, purgeDue, type CampaignWindow, type NewsletterCampaign } from "@/lib/newsletter/campaigns";
import { deleteSubscribers, listSubscribersAfter, readCampaignState, writeCampaignState, type CampaignCursor, type CampaignState } from "@/lib/newsletter/repository";
import { unsubscribeToken } from "@/lib/newsletter/token";
import { headroom, isDegraded } from "@/lib/quota";

// Every 10 minutes (owner, 2026-11-16: the opening list gets "J-7, J-1 et jour J"): the e-mail
// due now (src/lib/newsletter/campaigns.ts) goes to the confirmed subscribers not served yet, in
// confirmation order, so a run capped by the budget resumes where it stopped and a subscriber who
// confirms during the window is served by a later run. Delivered here (deliverMail, the mail
// worker's own call, bulk priority): the cursor (system/newsletterCampaigns) moves only past a
// mail that left or was refused for good (suppressed, rejected). Budget: what is left under
// NEWSLETTER_RESEND_SHARE of both Resend quotas (the transactional API: 100 a day on the free
// plan, 80 for the app), so sign-up confirmations and security mails keep their room; nothing
// leaves while a Resend quota is degraded. A window that closes with subscribers left over is
// never sent late: the next e-mail replaces it, and the owner hears it once (P2). The list is
// deleted 30 days after the opening (privacy policy §3.14), from the opening instant recorded
// with the cursors when OPENS_AT is no longer set by then.

/** Share of the Resend quotas the campaign may use up to (0.7 x 80 = 56 a day). */
export const NEWSLETTER_RESEND_SHARE = 0.7;
export const NEWSLETTER_PAGE_SIZE = 100;
/** Without a readable counter (no Valkey: local dev), mails per run at most. */
export const NEWSLETTER_FALLBACK_BUDGET = 20;
export const NEWSLETTER_PURGE_BATCH = 400;
const STOP_QUOTAS = ["resend.daily", "resend.monthly", "firestore.reads"] as const;

export interface NewsletterResult {
  campaign: NewsletterCampaign | null;
  mails: number;
  skipped: number;
  /** Every subscriber confirmed so far has been served for this campaign. */
  complete: boolean;
  stopped?: "quota" | "cap" | "mail" | "no-places";
  purged?: number;
}

/** Mails this run may send: what is left under the campaign's share of both Resend quotas. */
export async function newsletterBudget(): Promise<number> {
  const [daily, monthly] = await Promise.all([headroom("resend.daily", NEWSLETTER_RESEND_SHARE), headroom("resend.monthly", NEWSLETTER_RESEND_SHARE)]);
  if (daily === null && monthly === null) return NEWSLETTER_FALLBACK_BUDGET;
  return Math.min(daily ?? Number.POSITIVE_INFINITY, monthly ?? Number.POSITIVE_INFINITY);
}

async function quotaStop(): Promise<boolean> {
  return (await Promise.all(STOP_QUOTAS.map((id) => isDegraded(id)))).some(Boolean);
}

const ATTEMPTS = 3;

/** deliverMail with quick retries on a transient provider failure (same idempotency key). */
async function deliverWithRetries(mail: TemplateMail): Promise<DeliverOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await deliverMail(mail);
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.retryable || attempt >= ATTEMPTS) throw error;
      await delay(Math.min(error.retryAfterSeconds !== undefined ? error.retryAfterSeconds * 1000 : 2_000 * 4 ** (attempt - 1), 30_000));
    }
  }
}

/** The launch places as configured now, or null when none is given (the offer is off or over). */
async function placesNow(now: Date): Promise<TemplateData["newsletterCampaign"]["places"]> {
  const { launchOffer: offer } = await getPricing();
  if (!launchPlacesOpen(offer, now)) return null;
  return {
    seats: offer.seats,
    credits: offer.individual.credits,
    creditDays: offer.individual.days,
    months: offer.months,
    until: offer.grantsUntil,
    requirePhone: offer.individual.requirePhone,
  };
}

async function sendCampaign(window: CampaignWindow, opensAt: Date, state: CampaignState, now: Date, result: NewsletterResult): Promise<void> {
  const cursor: CampaignCursor = state.campaigns[window.campaign] ?? {
    afterAt: null,
    afterId: null,
    sent: 0,
  };
  state.campaigns[window.campaign] = cursor;
  // The J-1 e-mail announces the places: without them it is not sent (the opening one leaves them out).
  const places = await placesNow(window.campaign === "places" ? opensAt : now);
  if (window.campaign === "places" && !places) {
    result.stopped = "no-places";
    return;
  }
  if (await quotaStop()) {
    result.stopped = "quota";
    return;
  }
  const budget = await newsletterBudget();
  for (;;) {
    if (result.mails >= budget) {
      result.stopped = "cap";
      return;
    }
    const page = await listSubscribersAfter(cursor, NEWSLETTER_PAGE_SIZE);
    for (const subscriber of page.subscribers) {
      if (result.mails >= budget) {
        result.stopped = "cap";
        return;
      }
      let delivered: DeliverOutcome;
      try {
        delivered = await deliverWithRetries({
          template: "newsletterCampaign",
          locale: subscriber.lang,
          to: subscriber.email,
          data: {
            campaign: window.campaign,
            opensAt: opensAt.toISOString(),
            unsubscribeToken: unsubscribeToken(subscriber.email),
            places,
          },
          priority: "bulk",
          idempotencyKey: `newsletter-${window.campaign}-${subscriber.id}`,
        });
      } catch (error) {
        logger.warn({ campaign: window.campaign, err: (error as Error).message }, "newsletter mail not delivered");
        result.stopped = "mail";
        return;
      }
      if ("skipped" in delivered && delivered.skipped === "quota") {
        result.stopped = "quota";
        return;
      }
      // Suppressed or rejected addresses are passed over for good.
      if ("skipped" in delivered) result.skipped += 1;
      else {
        result.mails += 1;
        cursor.sent += 1;
      }
      cursor.afterAt = subscriber.confirmedAt.toDate();
      cursor.afterId = subscriber.id;
    }
    // Malformed documents are skipped but still move the cursor.
    if (page.last) {
      cursor.afterAt = page.last.at;
      cursor.afterId = page.last.id;
    }
    if (page.read < NEWSLETTER_PAGE_SIZE) {
      result.complete = true;
      return;
    }
  }
}

/** A window that closed with subscribers left: reported once, never sent late. */
async function closeWindows(opensAt: Date, state: CampaignState, now: Date): Promise<boolean> {
  let changed = false;
  for (const window of closedCampaigns(opensAt, now)) {
    const cursor = state.campaigns[window.campaign] ?? {
      afterAt: null,
      afterId: null,
      sent: 0,
    };
    if (cursor.closed) continue;
    const left = await listSubscribersAfter(cursor, 1);
    if (left.read > 0) {
      await alert({
        severity: "P2",
        title: `Liste d'ouverture : e-mail « ${window.campaign} » pas envoyé à tous`,
        body: `${cursor.sent} envoyés avant la fin de sa fenêtre ; les inscrits restants ne le recevront pas (quota Resend). Voir src/worker/jobs/newsletter-campaigns.ts.`,
      });
    }
    state.campaigns[window.campaign] = { ...cursor, closed: true };
    changed = true;
  }
  return changed;
}

export async function sendNewsletterCampaigns(now = new Date()): Promise<NewsletterResult> {
  const result: NewsletterResult = {
    campaign: null,
    mails: 0,
    skipped: 0,
    complete: false,
  };
  if (!isFirestoreConfigured()) {
    logger.warn("newsletter-campaigns skipped: Firebase not configured");
    return result;
  }
  const fromEnv = parseOpensAt(serverEnv().OPENS_AT);
  const window = dueCampaign(fromEnv, now);
  const state = await readCampaignState();
  const opensAt = fromEnv ?? state.opensAt;

  if (purgeDue(opensAt, now)) {
    if (state.purgedAt) return { ...result, complete: true };
    let purged = 0;
    for (;;) {
      const deleted = await deleteSubscribers(NEWSLETTER_PURGE_BATCH);
      purged += deleted;
      if (deleted < NEWSLETTER_PURGE_BATCH) break;
    }
    await writeCampaignState({ ...state, opensAt, purgedAt: now }, now);
    logger.info({ purged }, "newsletter list deleted 30 days after the opening");
    return { ...result, complete: true, purged };
  }

  let changed = fromEnv !== null && fromEnv.getTime() !== state.opensAt?.getTime();
  if (fromEnv) state.opensAt = fromEnv;
  if (fromEnv && (await closeWindows(fromEnv, state, now))) changed = true;
  if (window && fromEnv) {
    result.campaign = window.campaign;
    const before = JSON.stringify(state.campaigns[window.campaign] ?? null);
    await sendCampaign(window, fromEnv, state, now, result);
    if (JSON.stringify(state.campaigns[window.campaign]) !== before) changed = true;
  }
  if (changed) await writeCampaignState(state, now);
  if (result.mails > 0 || result.skipped > 0 || (result.stopped && result.stopped !== "cap")) logger.info({ ...result }, "newsletter-campaigns");
  return result;
}
