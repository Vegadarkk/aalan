"use client";

import { useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/auth/client";
import { LOGO_MAX_BYTES, LOGO_TYPES } from "@/lib/contracts/pro";
import type { ProSector } from "@/lib/pro/profile-schema";
import { removeLogo, saveLogo } from "@/lib/pro/client";
import { ShopEmblem } from "./shop-emblem";

// The shop's logo in « Ma fiche boutique » (UX audit lot 3): saved as soon as it is picked (its
// own request, outside the card's form), shown on the storefront, the directory and this page.
// Until then the emblem stands in. The server re-encodes it and checks it before storing it.

const KNOWN_ERRORS = ["file_too_large", "unsupported_media", "image_refused", "storage_full", "rate_limited"] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

export function ShopLogoField({ name, sector, logo, onChange }: { name: string; sector: ProSector; logo: string | null; onChange: (logo: string | null) => void }) {
  const t = useTranslations("Pro.logo");
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<KnownError | "failed" | null>(null);

  async function run(kind: "save" | "remove", action: () => Promise<{ logo: string | null }>) {
    setPending(kind);
    setError(null);
    try {
      const result = await action();
      onChange(result.logo);
      toast.success(t(kind === "save" ? "saved" : "removed"));
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : null;
      setError(code && (KNOWN_ERRORS as readonly string[]).includes(code) ? (code as KnownError) : "failed");
    } finally {
      setPending(null);
    }
  }

  function onPick(file: File | undefined) {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return setError("unsupported_media");
    if (file.size > LOGO_MAX_BYTES) return setError("file_too_large");
    void run("save", () => saveLogo(file));
  }

  return (
    <div className="flex flex-col gap-3" data-testid="shop-logo">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("label")}</span>
        <p className="text-sm text-foreground-muted text-pretty">{t("hint")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <ShopEmblem name={name} sector={sector} logo={logo} size="lg" />
        <div className="flex flex-wrap gap-3">
          <input ref={input} type="file" accept={LOGO_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => onPick(event.target.files?.[0])} />
          <Button type="button" variant="outline" loading={pending === "save"} disabled={pending !== null} onClick={() => input.current?.click()}>
            <ImageUp aria-hidden="true" />
            {logo ? t("replace") : t("choose")}
          </Button>
          {logo ? (
            <Button type="button" variant="ghost" loading={pending === "remove"} disabled={pending !== null} onClick={() => void run("remove", removeLogo)}>
              <Trash2 aria-hidden="true" />
              {t("remove")}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger text-pretty">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}
