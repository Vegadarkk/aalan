"use client";

import { useState } from "react";
import { BellPlus, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { isApiError, loadSession } from "@/lib/auth/client";
import { SAVED_SEARCH_NAME_MAX } from "@/lib/contracts/search";
import { existingSearchId, saveSearch } from "@/lib/saved-searches/client";
import { cn } from "@/lib/utils";

// « Suivre la boutique » (UX audit of the Pro shops, lot 3): a saved search on the shop's listings
// with the daily alert, so a follower hears of each new listing by e-mail and finds it in « Mes
// recherches ». No new store: the saved searches' limits and unsubscribe apply. Nothing is read
// before the click; an already followed shop is recognised by the save's 409. Anonymous visitors
// go to sign-in and come back to the storefront.

const BASE = "inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-base font-medium text-foreground transition-[background-color,scale] duration-150 ease-door hover:bg-surface-muted active:scale-[0.98]";

export function FollowShopButton({ shopPublicId, shopName, className }: { shopPublicId: string; shopName: string; className?: string }) {
  const t = useTranslations("Storefront.follow");
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "followed">("idle");

  async function follow() {
    setState("pending");
    try {
      const viewer = await loadSession();
      if (!viewer) {
        router.push({ pathname: "/connexion", query: { next: window.location.pathname } });
        setState("idle");
        return;
      }
      await saveSearch({ name: t("searchName", { name: shopName }).slice(0, SAVED_SEARCH_NAME_MAX), params: { shop: shopPublicId }, alert: "daily" });
      setState("followed");
      toast.success(t("done"), { action: { label: t("manage"), onClick: () => router.push("/recherches") } });
    } catch (caught) {
      if (isApiError(caught, "saved_search_exists") && existingSearchId(caught.details)) {
        setState("followed");
        return;
      }
      setState("idle");
      toast.error(isApiError(caught, "saved_search_limit") ? t("limit") : t("failed"));
    }
  }

  if (state === "followed") {
    return (
      <Link href="/recherches" prefetch={false} data-testid="follow-shop" data-followed="true" className={cn(BASE, className)}>
        <Check className="size-5 text-success" aria-hidden="true" />
        {t("followed")}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => void follow()} disabled={state === "pending"} aria-busy={state === "pending"} data-testid="follow-shop" className={cn(BASE, "disabled:opacity-70", className)}>
      <BellPlus className="size-5" aria-hidden="true" />
      {t("follow")}
    </button>
  );
}
