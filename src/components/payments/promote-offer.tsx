"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { loadListingOptions } from "@/lib/payments/client";
import { cn } from "@/lib/utils";
import { PromoteDialog } from "./promote-dialog";

// "Mettre en avant" at the end of the deposit, the moment classifieds sell their options (zone 6
// audit 6-04); the public listing page links to "Mes annonces" instead (no payment code there). Shown only when the options can be bought for this listing (sales open, subcategory with paid
// options, listing online); nothing at all otherwise, failures included.

interface PromoteOfferProps {
  listingId: string;
  title: string;
  className?: string;
}

export function PromoteOffer({ listingId, title, className }: PromoteOfferProps) {
  const t = useTranslations("Options.offer");
  const [offered, setOffered] = useState(false);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const data = await loadListingOptions(listingId);
        setOffered(data.salesOpen && data.allowed && data.promotable);
      } catch {
        // Not the owner of the shop's wallet, a network error: the page goes on without the offer.
      }
    })();
  }, [listingId]);

  if (!offered) return null;
  return (
    <>
      <section aria-labelledby={`promote-${listingId}`} className={cn("flex flex-col gap-3 rounded-lg border border-featured/50 bg-featured/10 p-5 text-start sm:flex-row sm:items-center sm:justify-between", className)}>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={`promote-${listingId}`} className="font-semibold">
            {t("title")}
          </h2>
          <p className="text-sm text-foreground-muted text-pretty">{t("body")}</p>
        </div>
        <Button ref={button} type="button" variant="structure" className="shrink-0 max-sm:h-11" onClick={() => setOpen(true)}>
          <TrendingUp aria-hidden="true" />
          {t("action")}
        </Button>
      </section>
      {open ? <PromoteDialog listingId={listingId} title={title} onClose={() => setOpen(false)} returnFocus={() => button.current} /> : null}
    </>
  );
}
