"use client";

import { useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useApiErrorMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { SHOP_PINS_MAX } from "@/lib/contracts/catalog";
import { isolate } from "@/lib/i18n/bidi";

// "Mes annonces" row of a shop's published listing (UX audit of the Pro shops, lot 3): pins it in
// « Sélection de la boutique », above the storefront grid (up to 4, in the order pinned), or
// takes it out. Saved at once; the storefront follows within its revalidation.

export function OwnerPin({ listingId, title, pinned, onPin }: { listingId: string; title: string; pinned: string[]; onPin: (id: string, pin: boolean) => Promise<void> }) {
  const t = useTranslations("MyListings.pin");
  const apiMessage = useApiErrorMessage("listing");
  const [saving, setSaving] = useState(false);
  const isPinned = pinned.includes(listingId);
  const full = !isPinned && pinned.length >= SHOP_PINS_MAX;

  async function toggle() {
    setSaving(true);
    try {
      await onPin(listingId, !isPinned);
      toast.success(isPinned ? t("removed") : t("added"));
    } catch (error) {
      toast.error(apiMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={saving}
        disabled={full}
        aria-pressed={isPinned}
        aria-label={t(isPinned ? "removeOf" : "addOf", { title: isolate(title) })}
        data-testid="owner-pin"
        onClick={() => void toggle()}
        className="-ms-2 px-2 font-medium max-sm:h-11"
      >
        {saving ? null : isPinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
        {isPinned ? t("remove") : t("add")}
      </Button>
      {full ? <span>{t("full", { max: SHOP_PINS_MAX })}</span> : isPinned ? <span>{t("position", { index: pinned.indexOf(listingId) + 1, max: SHOP_PINS_MAX })}</span> : null}
    </div>
  );
}
