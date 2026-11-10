"use client";

import { CircleCheck, Truck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { ProSelfView } from "@/lib/contracts/pro";

// The carrier's prompt in the Pro space (transporteurs/spec.md §4): publish the price list first,
// then a summary of it with « Mes départs » and the way back to its settings.

export function CarrierSetup({ shop }: { shop: Pick<ProSelfView, "carrier" | "carrierUpdatedAt"> }) {
  const t = useTranslations("CarrierSettings.setup");
  const format = useFormatter();
  const carrier = shop.carrier;
  const lowest = carrier ? Math.min(carrier.tariff.perKg, ...carrier.tariff.bands.map((band) => band.perKg)) : 0;
  return (
    <section aria-labelledby="carrier-setup" data-testid="carrier-setup" data-done={carrier ? "" : undefined} className="flex flex-col gap-4 rounded-lg border border-border bg-surface-brand p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-structure dark:text-gold-300">
          {carrier ? <CircleCheck className="size-5" /> : <Truck className="size-5" />}
        </span>
        <div className="flex flex-col gap-1">
          <h2 id="carrier-setup" className="text-lg font-semibold">
            {carrier ? t("readyTitle") : t("title")}
          </h2>
          <p className="max-w-prose text-sm text-foreground-muted text-pretty">
            {carrier
              ? t("ready", {
                  rate: format.number(lowest / 100, { style: "currency", currency: carrier.tariff.currency }),
                  date: shop.carrierUpdatedAt ? format.dateTime(new Date(shop.carrierUpdatedAt), { dateStyle: "long" }) : "",
                })
              : t("lead")}
          </p>
        </div>
      </div>
      {carrier ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild>
            <Link href="/pro/departs">{t("departures")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/pro/transport">{t("edit")}</Link>
          </Button>
        </div>
      ) : (
        <Button asChild className="shrink-0">
          <Link href="/pro/transport">{t("action")}</Link>
        </Button>
      )}
    </section>
  );
}
