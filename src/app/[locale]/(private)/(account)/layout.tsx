import type { ReactNode } from "react";
import { headers } from "next/headers";
import { SuspensionBanner } from "@/components/account/suspension-banner";
import { redirect } from "@/i18n/navigation";
import { pageLocale } from "@/i18n/params";
import { currentMember } from "@/lib/auth/current-user";
import { getSuspension } from "@/lib/decisions/repository";
import { logger } from "@/lib/logging/logger";

// Account area: a member session is required (§6 "layout : session obligatoire"). The guard only
// decides what renders; every API route re-checks the session itself. Nothing secret reaches the
// client from here: the pages fetch their data from /api/auth/me.
//
// No consent gate: the transfers outside Morocco rest on the contract, not on a consent (audit B2,
// 2026-11-04), so the former re-consent panel (design D12) is gone. CGU changes are notified by
// the banner of D11, which never blocks a page.

/** Deposit wizard: replaced by the suspension notice while the account is suspended. */
const DEPOSIT_PATH = /^\/(?:[a-z]{2,3}\/)?deposer(?:[/?]|$)/;

export default async function AccountLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const locale = pageLocale((await params).locale);
  const user = await currentMember();
  if (!user) {
    // `x-pathname` (path + query of this request) is set by the proxy for private pages; without
    // it the person lands on the settings page after signing in.
    const next = (await headers()).get("x-pathname");
    redirect({ href: next ? { pathname: "/connexion", query: { next } } : "/connexion", locale });
    return null; // not reached: redirect() throws
  }
  if (user.claims.st === "suspended") {
    // Suspended (audit zone 7 P2-4): the notice on every account page; no deposit wizard at all.
    const until = await suspensionEnd(user.uid);
    if (DEPOSIT_PATH.test((await headers()).get("x-pathname") ?? "")) return <SuspensionBanner locale={locale} until={until} deposit />;
    return (
      <>
        <SuspensionBanner locale={locale} until={until} />
        {children}
      </>
    );
  }
  return <>{children}</>;
}

async function suspensionEnd(uid: string): Promise<Date | null> {
  try {
    return (await getSuspension(uid))?.until ?? null;
  } catch (error) {
    // Fail open: a Firestore outage must not take the account area down (no end date shown).
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "account layout: suspension read skipped");
    return null;
  }
}
