"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { afterSignInTarget, inPreferredLocale } from "@/lib/auth/next-path";
import type { SessionSummary } from "@/lib/contracts/auth";
import { welcomeAfterSignIn } from "@/lib/welcome/flags";

/**
 * Where to go once signed in: the `?next=` path when it is a same-origin relative path (set by
 * the account layout guard and the header link), else the home page. A locale prefix in
 * `next` is honoured; without one, the account's language is (Z1-12: a new device lands in
 * French; the router's locale change also writes the locale cookie). Same check as the sign-in
 * pages' server-side redirect.
 * The device then never gets the welcome screen, and the door opens on the home page when that is
 * where the sign-in lands, once per device.
 */
export function useAfterSignIn(): (session?: Pick<SessionSummary, "locale">) => void {
  const router = useRouter();
  const params = useSearchParams();
  const current = useLocale();
  return useCallback(
    (session?: Pick<SessionSummary, "locale">) => {
      const target = inPreferredLocale(afterSignInTarget(params.get("next")), session?.locale, current);
      welcomeAfterSignIn(target.pathname);
      router.replace(target.pathname, target.locale ? { locale: target.locale } : undefined);
    },
    [router, params, current],
  );
}
