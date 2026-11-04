import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BadgeCheck, Check, Clock, Coins, Gift, Minus, Rocket, Sparkles, Store, User } from "lucide-react";
import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import { launchOfferOpen } from "@/config/pricing";
import { Link } from "@/i18n/navigation";
import { localeParams, numbersLocale, pageLocale } from "@/i18n/params";
import { getFlags, getPricing } from "@/lib/config/runtime";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";
import { importsStock } from "@/lib/contracts/stock-import";
import { alternates } from "@/lib/i18n/metadata";
import { PRICING_PATH, PRO_LANDING_PATH, PRO_SPACE_PATH } from "@/lib/search/shortcuts";
import { cn } from "@/lib/utils";
import { getNumbersTranslations } from "@/i18n/numbers-server";

const WALLET_PATH = "/porte-monnaie";

// Public price list (owner, 2026-10-30: the offers must be visible): what an individual and a
// Pro pay, read from the pricing config (Firestore config/pricing, cached) so the page never
// drifts from what checkout charges. Packs are in MAD VAT included; Pro plans and the pass are
// excluding VAT. Sales open at launch: the page says so while they are closed. ISR, one hour.
export const revalidate = 3600;

export function generateStaticParams() {
  return localeParams();
}

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Pricing" });
  return { title: t("metaTitle"), description: t("metaDescription"), alternates: alternates(locale, PRICING_PATH) };
}

const mad = (minor: number) => Math.round(minor / 100);

function Card({ title, price, note, items, Icon, highlight, action }: { title: string; price: string; note?: string; items: string[]; Icon: typeof Store; highlight?: string; action?: ReactNode }) {
  return (
    <article className={cn("relative flex flex-col gap-4 rounded-lg border bg-surface p-6", highlight ? "border-featured shadow-md" : "border-border")}>
      {highlight ? <span className="absolute -top-3 start-6 whitespace-nowrap rounded-full bg-featured px-3 py-0.5 text-xs font-semibold text-featured-foreground shadow-sm">{highlight}</span> : null}
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-structure text-structure-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <p className="text-2xl font-semibold">{price}</p>
      {note ? <p className="-mt-3 text-sm text-foreground-muted">{note}</p> : null}
      <ul className="flex flex-col gap-2 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {action ? <div className="mt-auto pt-2">{action}</div> : null}
    </article>
  );
}

type Cell = string | boolean | "soon";

/** One mark of the comparison: a value, included, not included, or « bientôt ». */
function Mark({ value, labels }: { value: Cell; labels: { yes: string; no: string; soon: string } }) {
  if (value === "soon") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-1.5 py-0.5 text-xs font-medium sm:px-2 text-foreground-muted">
        <Clock className="size-3.5 max-sm:hidden" aria-hidden="true" />
        {labels.soon}
      </span>
    );
  }
  if (value === true) return <Check className="mx-auto size-5 text-success" role="img" aria-label={labels.yes} />;
  if (value === false) return <Minus className="mx-auto size-5 text-foreground-muted" role="img" aria-label={labels.no} />;
  return <span className="font-medium tabular-nums">{value}</span>;
}

export default async function PricingPage({ params }: { params: Params }) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  const [t, n, pricing, flags] = await Promise.all([
    getTranslations({ locale, namespace: "Pricing" }),
    getNumbersTranslations({ locale, namespace: "Pricing" }),
    getPricing(),
    getFlags(),
  ]);
  const offer = launchOfferOpen(pricing.launchOffer, new Date()) ? pricing.launchOffer : null;
  // Texts of the closed sales only while they are closed (zone 6 audit 6-05): once open, the
  // launch offer is told by its end date, and the « ventes ouvrent avec le lancement » note goes.
  const salesOpen = flags.salesEnabled;
  const offerEnd = offer?.endsAt ? new Intl.DateTimeFormat(numbersLocale(locale), { dateStyle: "long", timeZone: moroccoTimeZone(Date.parse(offer.endsAt)) }).format(new Date(offer.endsAt)) : null;
  const { essentiel, business } = pricing.plans;
  const pass = pricing.passes[0] ?? null;
  const listings = (value: number | null) => (value === null ? t("pros.unlimitedListings") : `${n("count", { count: value })} ${t("pros.activeListings")}`);
  // The comparison table: Essentiel, the pass (when sold), Business; values from the same config.
  const count = (value: number | null) => (value === null ? t("compare.unlimited") : n("count", { count: value }));
  const columns = [
    { key: "essentiel", title: t("pros.essentiel"), plan: "essentiel" as const, credits: essentiel.credits, featured: 0, commitment: t("compare.monthlyOrYearly") },
    ...(pass ? [{ key: "pass", title: t("pros.pass.title"), plan: pass.plan, credits: pass.credits, featured: 0, commitment: n("compare.days", { days: pass.days }) }] : []),
    { key: "business", title: t("pros.business"), plan: "business" as const, credits: business.credits, featured: business.featured, commitment: t("compare.monthlyOrYearly") },
  ];
  const every = (value: Cell): Cell[] => columns.map(() => value);
  const rows: { key: string; label: string; cells: Cell[] }[] = [
    { key: "listings", label: t("compare.rows.listings"), cells: columns.map((column) => count(pricing.pro[column.plan].activeListings)) },
    { key: "photos", label: t("compare.rows.photos"), cells: columns.map((column) => count(pricing.pro[column.plan].photosPerListing)) },
    { key: "credits", label: t("compare.rows.credits"), cells: columns.map((column) => count(column.credits)) },
    { key: "featured", label: t("compare.rows.featured"), cells: columns.map((column) => (column.featured > 0 ? count(column.featured) : false)) },
    { key: "storefront", label: t("compare.rows.storefront"), cells: every(true) },
    { key: "contact", label: t("compare.rows.contact"), cells: every(true) },
    { key: "stats", label: t("compare.rows.stats"), cells: every(true) },
    { key: "stock", label: t("compare.rows.stock"), cells: columns.map((column) => importsStock(column.plan)) },
    { key: "commitment", label: t("compare.rows.commitment"), cells: columns.map((column) => column.commitment) },
    { key: "logo", label: t("compare.rows.logo"), cells: every(true) },
  ];
  const marks = { yes: t("compare.yes"), no: t("compare.no"), soon: t("compare.soon") };
  return (
    <Container className="flex flex-col gap-12 py-8 md:py-12">
      <section className="arch threshold flex flex-col gap-3 rounded-b-lg bg-structure px-6 pt-12 pb-8 text-center text-structure-foreground sm:px-10 sm:text-start">
        <p className="text-sm font-semibold tracking-wide text-gold-300 uppercase">{t("eyebrow")}</p>
        <h1 className="text-3xl font-semibold text-balance md:text-4xl">{t("title")}</h1>
        <p className="max-w-prose text-structure-foreground/85 text-pretty md:text-lg">{t("lead")}</p>
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="pricing-individuals">
        <h2 id="pricing-individuals" className="text-2xl font-semibold">{t("individuals.title")}</h2>
        <div className="grid gap-5 md:grid-cols-3">
          <Card
            Icon={User}
            title={t("individuals.free.title")}
            price={t("free")}
            items={[
              n("individuals.free.listings", { count: pricing.individual.activeListings ?? 0 }),
              n("individuals.free.photos", { count: pricing.individual.photosPerListing }),
              t("individuals.free.messaging"),
            ]}
          />
          <Card
            Icon={Rocket}
            title={t("individuals.options.title")}
            price={n("fromCredits", { count: pricing.options.bump.standard })}
            note={t("individuals.options.note")}
            items={[
              n("individuals.options.bump", { standard: pricing.options.bump.standard, premium: pricing.options.bump.premiumCat }),
              n("individuals.options.featured7", { standard: pricing.options.featured7.standard, premium: pricing.options.featured7.premiumCat }),
              n("individuals.options.featured30", { standard: pricing.options.featured30.standard, premium: pricing.options.featured30.premiumCat }),
            ]}
          />
          <Card
            Icon={Coins}
            title={t("individuals.packs.title")}
            price={n("fromMad", { amount: Math.min(...pricing.packs.filter((pack) => pack.currency === "MAD").map((pack) => mad(pack.priceMinor))) })}
            note={t("individuals.packs.note")}
            items={pricing.packs
              .filter((pack) => pack.currency === "MAD")
              .map((pack) => (pack.bonus > 0 ? n("individuals.packs.packBonus", { amount: mad(pack.priceMinor), credits: pack.paid, bonus: pack.bonus }) : n("individuals.packs.pack", { amount: mad(pack.priceMinor), credits: pack.paid })))}
          />
        </div>
        {/* Buying happens in the wallet, behind sign-in (owner, 2026-10-31); not offered while sales are
            closed: it led to a page saying only that buying was not open (zone 6 audit 6-10). */}
        {salesOpen ? (
          <div className="flex flex-wrap gap-3">
            <Link href={WALLET_PATH} prefetch={false} className={buttonVariants({ variant: "primary", size: "md" })}>
              {t("individuals.packs.cta")}
            </Link>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="pricing-pros">
        <h2 id="pricing-pros" className="text-2xl font-semibold">{t("pros.title")}</h2>
        {offer && (offerEnd || !salesOpen) ? (
          <p className="flex items-start gap-2 rounded-lg bg-featured/15 px-4 py-3 text-sm">
            <Gift className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {offerEnd ? t("pros.launchOfferUntil", { date: offerEnd }) : n("pros.launchOffer", { days: offer.noticeDays })}
          </p>
        ) : null}
        {/* Rows 2 rem apart: the « Recommandé » badge rides 0.75 rem above its card (zone 6 audit 6-25). */}
        <div className="grid gap-x-5 gap-y-8 md:grid-cols-2 lg:grid-cols-4">
          <Card
            Icon={Store}
            title={t("pros.essentiel")}
            price={n("perMonth", { amount: mad(essentiel.priceMinor.monthly) })}
            note={n("perYear", { amount: mad(essentiel.priceMinor.yearly) })}
            items={[listings(pricing.pro.essentiel.activeListings), n("pros.credits", { count: essentiel.credits }), t("pros.storefront")]}
          />
          {/* The pass after Essentiel (UX audit of the Pro shops, §6.3): listed first, 299 read as the cheaper choice. */}
          {pass ? (
            <Card
              Icon={Store}
              title={t("pros.pass.title")}
              price={n("perDays", { amount: mad(pass.priceMinor), days: pass.days })}
              note={t("exclVat")}
              items={[t("pros.pass.noCommitment"), n("pros.passCredits", { count: pass.credits }), n("pros.listings", { count: pricing.pro[pass.plan].activeListings ?? 0 })]}
            />
          ) : null}
          <Card
            Icon={Sparkles}
            highlight={t("pros.recommended")}
            title={t("pros.business")}
            price={n("perMonth", { amount: mad(business.priceMinor.monthly) })}
            note={n("perYear", { amount: mad(business.priceMinor.yearly) })}
            items={[listings(pricing.pro.business.activeListings), n("pros.credits", { count: business.credits }), n("pros.featured", { count: business.featured }), t("pros.stockImport"), t("pros.storefront")]}
          />
          {/* « Sur devis » with the way to ask for one (zone 6 audit 6-11). */}
          <Card
            Icon={BadgeCheck}
            title={t("pros.premium")}
            price={t("pros.onQuote")}
            items={[listings(null), t("pros.premiumSupport"), t("pros.storefront")]}
            action={
              <Link href="/aide/contact" prefetch={false} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("pros.askQuote")}
              </Link>
            }
          />
        </div>
        {/* The VAT treatment of the Pro offers (owner, 3 Nov 2026): the HT price is the price paid. */}
        <p className="text-sm text-foreground-muted text-pretty" data-testid="pricing-vat">
          {t("pros.vatNote")}
        </p>
        {/* What each offer gives on day 1, and what is announced as coming (UX audit of the Pro shops,
            §7 lot 3): nothing promised that is not delivered. */}
        <div className="flex flex-col gap-3">
          <h3 id="pricing-compare" className="text-lg font-semibold">
            {t("compare.title")}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table aria-labelledby="pricing-compare" data-testid="pricing-compare" className="w-full min-w-[21rem] border-collapse text-xs sm:text-sm">
              <thead className="bg-surface-muted">
                <tr>
                  <th scope="col" className="w-2/5 px-2 py-3 text-start font-medium text-foreground-muted sm:w-auto sm:px-4">
                    {t("compare.feature")}
                  </th>
                  {columns.map((column) => (
                    <th key={column.key} scope="col" className="px-1.5 py-3 text-center font-semibold sm:px-4">
                      {column.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className="px-2 py-3 text-start font-normal sm:px-4">
                      {row.label}
                    </th>
                    {row.cells.map((cell, index) => (
                      <td key={columns[index]?.key ?? index} className="px-1.5 py-3 text-center sm:px-4">
                        <Mark value={cell} labels={marks} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-foreground-muted text-pretty">{t("compare.note")}</p>
        </div>
        <p className="text-sm text-foreground-muted">{t("pros.payAtSeller")}</p>
        <div className="flex flex-wrap gap-3">
          <Link href={PRO_SPACE_PATH} prefetch={false} className={buttonVariants({ variant: "primary", size: "md" })}>
            {t("pros.cta")}
          </Link>
          <Link href={PRO_LANDING_PATH} prefetch={false} className={buttonVariants({ variant: "outline", size: "md" })}>
            {t("pros.more")}
          </Link>
        </div>
      </section>
      {salesOpen ? null : <p className="text-sm text-foreground-muted">{t("footnote")}</p>}
    </Container>
  );
}
