"use client";

import { useState } from "react";
import { BellPlus, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SaveSearchDialog } from "@/components/saved-searches/save-search-dialog";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { loadSession } from "@/lib/auth/client";
import type { SearchParams } from "@/lib/search/params";
import { cn } from "@/lib/utils";

// « Créer une alerte pour ce trajet » (transporteurs/spec.md §5): the saved-search dialog on the
// route's search (lib/carriers/route-alert.ts). Its words come from the server (the filter labels
// would ship the whole criteria catalogue to this page). Anonymous visitors sign in and come back.

export interface RouteAlertButtonProps {
  params: SearchParams;
  suggestedName: string;
  summary: string[];
  label: string;
  variant?: "primary" | "outline";
  className?: string;
}

export function RouteAlertButton({ params, suggestedName, summary, label, variant = "outline", className }: RouteAlertButtonProps) {
  const t = useTranslations("SavedSearches.button");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onClick() {
    setChecking(true);
    const viewer = await loadSession();
    setChecking(false);
    if (!viewer) {
      router.push({ pathname: "/connexion", query: { next: `${window.location.pathname}${window.location.search}` } });
      return;
    }
    setOpen(true);
  }

  if (saved) {
    return (
      <Button asChild variant="outline" className={cn("border-structure/40", className)} data-testid="carrier-alert" data-saved="true">
        <Link href="/recherches">
          <Check aria-hidden="true" className="text-success" />
          {t("saved")}
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button type="button" variant={variant} loading={checking} onClick={() => void onClick()} className={className} data-testid="carrier-alert">
        {checking ? null : <BellPlus aria-hidden="true" />}
        {label}
      </Button>
      {open ? (
        <SaveSearchDialog
          open={open}
          onOpenChange={setOpen}
          params={params}
          suggestedName={suggestedName}
          summary={summary}
          onSaved={({ existing }) => {
            setOpen(false);
            setSaved(true);
            const action = { label: t("view"), onClick: () => router.push("/recherches") };
            if (existing) toast.info(t("exists"), { action });
            else toast.success(t("done"), { action });
          }}
        />
      ) : null}
    </>
  );
}
