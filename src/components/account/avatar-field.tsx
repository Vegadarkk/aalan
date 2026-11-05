"use client";

import { useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SellerAvatar } from "@/components/listing/seller-card";
import { Button } from "@/components/ui/button";
import { ApiError, apiDelete, apiPutFile } from "@/lib/auth/client";
import { AVATAR_MAX_BYTES, AVATAR_TYPES, type AvatarResponse } from "@/lib/contracts/account";
import { ACCOUNT_API } from "@/lib/contracts/endpoints";

// The member's profile photo in « Ma vitrine » (audit §7): saved as soon as it is picked (its own
// request, outside the storefront form), shown on /profil and on the seller card of the listings.
// Until then the initial stands in. The server re-encodes it, crops it to the arch and checks it.

const KNOWN_ERRORS = ["file_too_large", "unsupported_media", "image_refused", "storage_full", "rate_limited"] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

export function AvatarField({ name, avatar, onChange }: { name: string; avatar: string | null; onChange: (avatar: string | null) => void }) {
  const t = useTranslations("Auth.settings.storefront.photo");
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<KnownError | "failed" | null>(null);

  async function run(kind: "save" | "remove", action: () => Promise<AvatarResponse>) {
    setPending(kind);
    setError(null);
    try {
      const result = await action();
      onChange(result.avatar);
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
    if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return setError("unsupported_media");
    if (file.size > AVATAR_MAX_BYTES) return setError("file_too_large");
    void run("save", () => apiPutFile<AvatarResponse>(ACCOUNT_API.avatar, file));
  }

  return (
    <div className="flex flex-col gap-3" data-testid="avatar-field">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("label")}</span>
        <p className="text-sm text-foreground-muted text-pretty">{t("hint")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SellerAvatar name={name || "?"} src={avatar} size="lg" />
        <div className="flex flex-wrap gap-3">
          <input ref={input} type="file" accept={AVATAR_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => onPick(event.target.files?.[0])} />
          <Button type="button" variant="outline" loading={pending === "save"} disabled={pending !== null} onClick={() => input.current?.click()}>
            <ImageUp aria-hidden="true" />
            {avatar ? t("replace") : t("choose")}
          </Button>
          {avatar ? (
            <Button type="button" variant="ghost" loading={pending === "remove"} disabled={pending !== null} onClick={() => void run("remove", () => apiDelete<AvatarResponse>(ACCOUNT_API.avatar))}>
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
