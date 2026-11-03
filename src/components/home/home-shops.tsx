import { ArrowRight } from "lucide-react";
import { DirectoryCard, type DirectoryCardLabels } from "@/components/pro/directory-card";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import type { DirectoryShop } from "@/lib/pro/directory-view";
import { DIRECTORY_PATH } from "@/lib/search/shortcuts";
import { cn } from "@/lib/utils";
import { textLinkClassName } from "@/components/ui/text-link";

// « Boutiques et agences vérifiées » on the home page (UX audit of the Pro shops, 10): up to four
// shops of the directory, real ones with listings first, and the way to the whole directory. Only
// shown once there is a shop; the cards are the directory's own.

export function HomeShops({ shops, labels, locale, title, all }: { shops: readonly DirectoryShop[]; labels: (shop: DirectoryShop) => DirectoryCardLabels; locale: Locale; title: string; all: string }) {
  if (shops.length === 0) return null;
  return (
    <section aria-labelledby="home-shops-title" data-testid="home-shops-row" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="home-shops-title" className="text-xl font-semibold">
          {title}
        </h2>
        <Link href={DIRECTORY_PATH} prefetch={false} className={cn("inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-link", textLinkClassName)}>
          {all}
          <ArrowRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
        </Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {shops.map((shop) => (
          <li key={shop.proId} className="min-w-0">
            <DirectoryCard shop={shop} locale={locale} labels={labels(shop)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
