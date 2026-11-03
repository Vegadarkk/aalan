import { ArrowUpRight, Clock, Globe, MapPin, Navigation } from "lucide-react";
import { useTranslations } from "next-intl";
import { cityBySlug, cityName } from "@/config/regions";
import type { Locale } from "@/config/site";
import { weekRows } from "@/lib/pro/hours";
import type { OpeningHours } from "@/lib/pro/profile-schema";
import { cn } from "@/lib/utils";
import { OpenNow } from "./open-now";

// « Infos pratiques » of a shop's storefront (UX audit of the Pro shops, lot 1): its address with
// a route link, its weekly hours with the open state (computed in the browser: the page is ISR),
// its website. Everything here is what the shop declared; nothing when it declared nothing. The
// route link opens a map search of the address: nothing is sent to a third party from this page.

export function ShopPracticalInfo({ address, citySlug, hours, website, locale, className }: { address: string; citySlug: string; hours: OpeningHours | null; website: string | null; locale: Locale; className?: string }) {
  const t = useTranslations("Storefront.info");
  const city = cityBySlug(citySlug);
  const rows = hours && hours.days.length > 0 ? weekRows(hours) : null;
  if (!address && !rows && !hours?.note && !website) return null;
  const where = [address, city ? cityName(city, "fr") : ""].filter(Boolean).join(", ");
  const host = website ? new URL(website).hostname.replace(/^www\./, "") : null;

  return (
    <section aria-labelledby="storefront-info" data-testid="storefront-info" className={cn("flex flex-col gap-4 rounded-lg border border-border bg-surface p-5", className)}>
      <h2 id="storefront-info" className="text-base font-semibold">
        {t("title")}
      </h2>
      {address ? (
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 size-5 shrink-0 text-gold-500 dark:text-gold-300" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <p dir="auto" className="text-sm text-pretty break-words">
              {address}
              {city ? <span className="text-foreground-muted"> · {cityName(city, locale)}</span> : null}
            </p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`}
              target="_blank"
              rel="nofollow noopener noreferrer"
              referrerPolicy="no-referrer"
              className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-link underline-offset-4 hover:underline"
            >
              <Navigation className="size-4 shrink-0" aria-hidden="true" />
              {t("route")}
              <span className="sr-only">{t("newTab")}</span>
            </a>
          </div>
        </div>
      ) : null}
      {rows || hours?.note ? (
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-gold-500 dark:text-gold-300" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {hours && rows ? <OpenNow hours={hours} /> : null}
            {rows ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-testid="storefront-hours">
                {rows.map((row) => (
                  <div key={row.day} data-day={row.day} className="contents">
                    <dt className="text-foreground-muted">{t(`days.${row.day}`)}</dt>
                    <dd className="tabular-nums">{row.slots.length > 0 ? row.slots.map((slot) => t("slot", { from: slot.from, to: slot.to })).join(" · ") : <span className="text-foreground-muted">{t("closed")}</span>}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {hours?.note ? (
              <p dir="auto" className="text-sm text-foreground-muted text-pretty">
                {hours.note}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {website && host ? (
        <a
          href={website}
          target="_blank"
          rel="nofollow ugc noopener noreferrer"
          referrerPolicy="no-referrer"
          className="group -mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-surface-muted"
        >
          <Globe className="size-5 shrink-0 text-gold-500 dark:text-gold-300" aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{t("website")}</span>
            <span dir="ltr" className="truncate text-start text-xs text-foreground-muted">
              {host}
            </span>
          </span>
          <ArrowUpRight className="ms-auto size-4 shrink-0 text-foreground-muted rtl:-scale-x-100" aria-hidden="true" />
          <span className="sr-only">{t("newTab")}</span>
        </a>
      ) : null}
      <p className="text-xs text-foreground-muted text-pretty">{t("note")}</p>
    </section>
  );
}
