// The three e-mails of the opening list (owner, 2026-11-16: "J-7, J-1 et jour J"), timed from
// OPENS_AT: a teaser seven days before, the launch places the day before, the opening itself. Each
// one has a window: it goes to the subscribers not served yet until the next one is due, so a
// late subscriber still gets the latest news and nobody gets an e-mail that the next one already
// replaced. The opening e-mail stays due for OPENING_WINDOW_MS after the opening. The list itself
// is deleted PURGE_AFTER_MS after the opening (privacy policy §3.14).

export const NEWSLETTER_CAMPAIGNS = ["teaser", "places", "opening"] as const;
export type NewsletterCampaign = (typeof NEWSLETTER_CAMPAIGNS)[number];

const DAY_MS = 86_400_000;

/** How long before the opening each e-mail starts. */
export const CAMPAIGN_LEAD_MS: Record<NewsletterCampaign, number> = {
  teaser: 7 * DAY_MS,
  places: DAY_MS,
  opening: 0,
};

/** The opening e-mail is still sent to the subscribers the daily budget left out, for this long. */
export const OPENING_WINDOW_MS = 3 * DAY_MS;

/** The list is deleted this long after the opening (privacy policy §3.14: "au plus tard 30 jours"). */
export const PURGE_AFTER_MS = 30 * DAY_MS;

export interface CampaignWindow {
  campaign: NewsletterCampaign;
  /** First instant the e-mail may leave. */
  from: Date;
  /** First instant it may no longer leave (the next e-mail's start). */
  until: Date;
}

/** The three windows, in order, for an opening instant. */
export function campaignWindows(opensAt: Date): CampaignWindow[] {
  const at = opensAt.getTime();
  return NEWSLETTER_CAMPAIGNS.map((campaign, index) => {
    const next = NEWSLETTER_CAMPAIGNS[index + 1];
    return {
      campaign,
      from: new Date(at - CAMPAIGN_LEAD_MS[campaign]),
      until: new Date(next ? at - CAMPAIGN_LEAD_MS[next] : at + OPENING_WINDOW_MS),
    };
  });
}

/** The e-mail due at `now`, or null (before the teaser, after the opening window, or no opening set). */
export function dueCampaign(opensAt: Date | null, now: Date): CampaignWindow | null {
  if (!opensAt) return null;
  const t = now.getTime();
  return campaignWindows(opensAt).find((window) => window.from.getTime() <= t && t < window.until.getTime()) ?? null;
}

/** Windows that closed before `now` (their unsent subscribers are reported once, never mailed late). */
export function closedCampaigns(opensAt: Date | null, now: Date): CampaignWindow[] {
  if (!opensAt) return [];
  return campaignWindows(opensAt).filter((window) => window.until.getTime() <= now.getTime());
}

/** True once the list must be deleted. */
export function purgeDue(opensAt: Date | null, now: Date): boolean {
  return opensAt !== null && now.getTime() >= opensAt.getTime() + PURGE_AFTER_MS;
}
