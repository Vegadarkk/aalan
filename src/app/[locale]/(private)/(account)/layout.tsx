import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "@/i18n/navigation";
import { pageLocale } from "@/i18n/params";
import { currentMember } from "@/lib/auth/current-user";

// Account area: a member session is required (§6 "layout : session obligatoire"). The guard only
// decides what renders; every API route re-checks the session itself. Nothing secret reaches the
// client from here: the pages fetch their data from /api/auth/me.
//
// No consent gate: the transfers outside Morocco rest on the contract, not on a consent (audit B2,
// 2026-11-04), so the former re-consent panel (design D12) is gone. CGU changes are notified by
// the banner of D11, which never blocks a page.

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
  return <>{children}</>;
}
