import { MessagesSquare } from "lucide-react";
import { CARRIER_REVIEW_TAGS, CARRIER_TAGS_MIN_REVIEWS } from "@/config/reviews";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { useNumbersTranslations } from "@/i18n/numbers";
import type { RatingSummary, ReviewPage } from "@/lib/contracts/reviews";
import { isolate } from "@/lib/i18n/bidi";
import { intlLocale } from "@/lib/listings/client/format";
import { MoreReviews, type MoreReviewsLabels } from "./more-reviews";
import { ReviewItem, type ReviewReportContext } from "./review-item";
import { Stars } from "./stars";

// The reviews block of a storefront (/profil and /boutique, vitrine-avis §2): the average, the
// spread by stars, the newest published reviews and the rest on demand. Only buyers who exchanged
// with the seller in the messaging can write one; the block says so, reviews or not.

export function formatAverage(average: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(average);
}

export function SellerReviews({
  rating,
  page,
  publicId,
  sellerName,
  locale,
  report,
}: {
  rating: RatingSummary;
  page: ReviewPage;
  publicId: string;
  sellerName: string;
  locale: Locale;
  /** Each review offers "Signaler l'avis" when given. */
  report?: ReviewReportContext;
}) {
  const t = useNumbersTranslations("Reviews");
  const labels: MoreReviewsLabels = {
    stars: [1, 2, 3, 4, 5].map((count) => t("stars", { count })),
    verified: t("verified"),
    verifiedHint: t("verifiedHint"),
    listing: t("listing"),
    exchangeOn: t("exchangeOn"),
    reply: t("reply", { name: isolate(sellerName) }),
    formerMember: t("formerMember"),
    tags: { price: t("tags.price"), timing: t("tags.timing"), intact: t("tags.intact"), communication: t("tags.communication") },
    tagsLabel: t("tagsLabel"),
    more: t("more"),
    failed: t("failed"),
  };
  const max = Math.max(1, ...rating.histogram);
  // A carrier's tags as shares of its transport reviews, once there are enough to mean something.
  const shares = rating.tags && rating.tags.reviews >= CARRIER_TAGS_MIN_REVIEWS ? rating.tags : null;
  const percent = new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: 0 });

  return (
    <section id="avis" aria-labelledby="profile-reviews" data-testid="seller-reviews" className="flex scroll-mt-24 flex-col gap-6">
      <h2 id="profile-reviews" className="text-xl font-semibold">
        {rating.count > 0 ? t("titleCount", { count: rating.count }) : t("title")}
      </h2>
      {rating.count > 0 && rating.average !== null ? (
        <div className="grid gap-8 lg:grid-cols-[18rem_1fr] lg:gap-12">
          <div className="flex flex-col gap-5 self-start rounded-lg border border-border bg-surface p-5">
            <div className="flex items-end gap-3">
              <p className="text-5xl leading-none font-semibold tabular-nums" data-testid="rating-average">
                {formatAverage(rating.average, locale)}
              </p>
              <div className="flex flex-col gap-1 pb-0.5">
                <Stars value={rating.average} size="md" label={t("average", { average: formatAverage(rating.average, locale) })} />
                <p className="text-sm text-foreground-muted">{t("count", { count: rating.count })}</p>
              </div>
            </div>
            <ul className="flex flex-col gap-1.5" aria-label={t("spread")}>
              {[5, 4, 3, 2, 1].map((stars) => {
                const count = rating.histogram[stars - 1] ?? 0;
                return (
                  <li key={stars} className="flex items-center gap-3 text-sm">
                    <span className="sr-only">{t("spreadRow", { stars, count })}</span>
                    <span aria-hidden="true" className="w-3 text-end tabular-nums text-foreground-muted">
                      {stars}
                    </span>
                    <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                      <span className="block h-full rounded-full bg-featured" style={{ width: `${Math.round((count / max) * 100)}%` }} />
                    </span>
                    <span aria-hidden="true" className="w-6 tabular-nums text-foreground-muted">
                      {count}
                    </span>
                  </li>
                );
              })}
            </ul>
            {shares ? (
              <div className="flex flex-col gap-2 border-t border-border pt-4" data-testid="review-tag-shares">
                <p className="text-sm font-medium">{t("tagShares", { count: shares.reviews })}</p>
                <ul className="flex flex-col gap-1.5">
                  {CARRIER_REVIEW_TAGS.map((tag) => {
                    const share = shares.counts[tag] / shares.reviews;
                    return (
                      <li key={tag} className="flex flex-col gap-1 text-sm">
                        <span className="flex items-baseline justify-between gap-3">
                          <span>{t(`tags.${tag}`)}</span>
                          <span className="font-semibold tabular-nums">{percent.format(share)}</span>
                        </span>
                        <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                          <span className="block h-full rounded-full bg-success" style={{ width: `${Math.round(share * 100)}%` }} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-pretty text-foreground-muted">
              {t("verifiedHint")}{" "}
              <Link href="/legal/avis-utilisateurs#verification" prefetch={false} className="relative font-medium text-link underline underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-3">
                {t("rules")}
              </Link>
            </p>
          </div>
          <div className="flex min-w-0 flex-col divide-y divide-border">
            {page.reviews.map((review) => (
              <ReviewItem key={review.id} review={review} labels={labels} locale={locale} {...(report ? { report } : {})} />
            ))}
            {page.next ? <MoreReviews publicId={publicId} next={page.next} labels={labels} locale={locale} {...(report ? { report } : {})} /> : null}
          </div>
        </div>
      ) : (
        <div className="flex max-w-prose items-start gap-4 rounded-lg border border-dashed border-border-strong p-5">
          <MessagesSquare className="mt-0.5 size-5 shrink-0 text-foreground-muted" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t("emptyTitle")}</p>
            <p className="text-sm text-pretty text-foreground-muted">
              {t("emptyBody", { name: isolate(sellerName) })}{" "}
              <Link href="/legal/avis-utilisateurs#verification" prefetch={false} className="relative font-medium text-link underline underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-3">
                {t("rules")}
              </Link>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
