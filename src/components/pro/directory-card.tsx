import { BadgeCheck, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ShopBand, ShopEmblem } from "@/components/pro/shop-emblem";
import { StorefrontBanner } from "@/components/profile/storefront-banner";
import { cityBySlug, cityName } from "@/config/regions";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import type { getNumbersTranslations } from "@/i18n/numbers-server";
import type { DirectoryShop } from "@/lib/pro/directory-view";

// A shop's card in the directory (/boutiques) and the home page's row (UX audit of the Pro shops,
// 10): its house banner (or the band of its name's hue), emblem, name, trade, city, excerpt, badge
// and listing count. The whole card leads to the storefront: the name's link stretches over it.
// Labels come from the caller (the Directory namespace, with the page's digits).

export interface DirectoryCardLabels {
  sector: string;
  badge: string;
  listings: string;
}

type DirectoryTranslator = Awaited<ReturnType<typeof getNumbersTranslations<"Directory">>>;

/** A card's labels in the page's language and digits (shared with the home page's row). */
export function cardLabels(t: DirectoryTranslator, shop: DirectoryShop): DirectoryCardLabels {
  return {
    sector: t(`sectorOne.${shop.sector}`),
    badge: shop.example ? t("badges.example") : shop.certified ? t("badges.certified") : t("badges.verified"),
    listings: shop.listings > 0 ? t("listings", { count: shop.listings }) : t("listingsNone"),
  };
}

export function DirectoryCard({ shop, locale, labels, headingLevel = 3 }: { shop: DirectoryShop; locale: Locale; labels: DirectoryCardLabels; headingLevel?: 2 | 3 }) {
  const city = cityBySlug(shop.citySlug);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="relative flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-border bg-surface px-5 pb-5 transition-[border-color,box-shadow] duration-150 ease-door focus-within:border-foreground/40 hover:border-foreground/40 hover:shadow-sm">
      {shop.bannerKey ? (
        <span aria-hidden="true" className="-mx-5 block h-16 overflow-hidden">
          <StorefrontBanner bannerKey={shop.bannerKey} id={`card-${shop.proId}`} />
        </span>
      ) : (
        <ShopBand name={shop.name} className="-mx-5 w-auto" />
      )}
      <div className="-mt-9 flex items-end gap-4">
        <ShopEmblem name={shop.name} sector={shop.sector} />
        <div className="flex min-w-0 flex-col gap-1 pb-0.5">
          <Heading className="text-lg leading-tight font-semibold">
            <Link href={`/boutique/${shop.segment}`} prefetch={false} dir="auto" className="break-words after:absolute after:inset-0 after:rounded-lg">
              {shop.name}
            </Link>
          </Heading>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-foreground-muted">
            <span>{labels.sector}</span>
            {city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                {cityName(city, locale)}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      {shop.excerpt ? (
        <p dir="auto" className="line-clamp-3 text-sm text-pretty text-foreground-muted">
          {shop.excerpt}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-sm">
        {shop.example ? (
          <Badge variant="neutral">{labels.badge}</Badge>
        ) : (
          <Badge variant="featured">
            <BadgeCheck className="size-3.5" aria-hidden="true" />
            {labels.badge}
          </Badge>
        )}
        <span className="text-foreground-muted">{labels.listings}</span>
      </div>
    </article>
  );
}
