import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { LoginForm } from "@/components/auth/login-form";
import { Link, redirect } from "@/i18n/navigation";
import { numbersLocale, pageLocale } from "@/i18n/params";
import { currentMember } from "@/lib/auth/current-user";
import { endedSessionReason } from "@/lib/auth/ended-session";
import { afterSignInTarget, safeNextPath } from "@/lib/auth/next-path";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";
import { SESSION_COOKIE } from "@/lib/security/cookies";
import { DEVICE_ID_HEADER, gisNonce } from "@/lib/security/device";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = pageLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Auth.signIn" });
  return { title: t("title") };
}

export default async function SignInPage({ params, searchParams }: Props) {
  const locale = pageLocale((await params).locale);
  setRequestLocale(locale);
  // Already signed in: straight to the page the person wanted (same `next` check as the form).
  if (await currentMember()) {
    const target = afterSignInTarget((await searchParams).next);
    redirect({ href: target.pathname, locale: target.locale ?? locale });
  }
  const t = await getTranslations({ locale, namespace: "Auth.signIn" });
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  // Device id set by the proxy (never the client's): the nonce Google writes in its ID token.
  const deviceId = requestHeaders.get(DEVICE_ID_HEADER);
  // The link to the other flow keeps a valid `next`.
  const raw = (await searchParams).next;
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw);
  // A session cookie that no longer signs in: the session was revoked (a shop validated, a
  // suspension, a password change elsewhere) or ended; a sign-out clears it. Said instead of a
  // silent sign-in page (zone 6 audit 6-07).
  const sessionCookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const ended = Boolean(sessionCookie);
  const toPro = next !== null && /^\/(?:[a-z]{2,3}\/)?pro(?:[/?#]|$)/.test(next);
  // Ended by a suspension (synthesis §5, zone 7 P2-4): say so, with its end in Morocco's time. Ended
  // by a change of the account's rights, a shop's validation first (zone 7 P4): say that too.
  const reason = ended ? await endedSessionReason(sessionCookie) : null;
  const until = reason?.kind === "suspended" ? new Intl.DateTimeFormat(numbersLocale(locale), { dateStyle: "long", timeStyle: "short", timeZone: moroccoTimeZone(reason.until.getTime()) }).format(reason.until) : null;
  return (
    <AuthShell
      title={t("title")}
      lead={t("lead")}
      footer={
        <p>
          {t("noAccount")}{" "}
          <Link href={next ? { pathname: "/inscription", query: { next } } : "/inscription"} className="font-medium text-link underline-offset-2 hover:underline">
            {t("create")}
          </Link>
        </p>
      }
    >
      {until ? (
        <ErrorBanner tone="warning" className="mb-6" title={t("sessionEndedSuspended", { date: until })}>
          {t("sessionEndedSuspendedBody")}
        </ErrorBanner>
      ) : reason ? (
        <ErrorBanner tone="info" className="mb-6" title={t(reason.kind === "pro-validated" ? "sessionEndedProValidated" : "sessionEndedChanged")}>
          {t(reason.kind === "pro-validated" ? "sessionEndedProValidatedBody" : "sessionEndedChangedBody")}
        </ErrorBanner>
      ) : ended ? (
        <ErrorBanner tone="info" className="mb-6" title={t(toPro ? "sessionEndedPro" : "sessionEnded")} />
      ) : null}
      <LoginForm nonce={nonce} gisNonce={deviceId ? gisNonce(deviceId) : undefined} />
    </AuthShell>
  );
}
