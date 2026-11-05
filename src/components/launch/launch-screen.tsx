import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";
import { LEGAL_PAGES } from "@/config/legal-pages";
import { LOCALE_TAGS, type Locale } from "@/config/site";
import { SocialIcon } from "@/components/pro/social-icon";
import { SOCIAL_NETWORK_NAMES } from "@/components/pro/social-links";
import { DoorScene } from "@/components/welcome/door-scene";
import { numbersLocale } from "@/i18n/params";
import type { BrandSocialLink } from "@/lib/launch/social";
import { LaunchStage } from "./launch-stage";

// The countdown page before the opening (owner, 5 Nov 2026; src/lib/launch/gate.ts): the welcome
// threshold's gate on its night ground, the door shut, the brand promise, the time left, the date,
// Aalan's social accounts (the campaign's videos) and the legal texts, the only pages still open.

/** Legal texts linked under the countdown: the ones a visitor may look for before an opening. */
const LEGAL_LINKS = ["mentions", "cgu", "confidentialite", "cookies"] as const;

export interface LaunchScreenProps {
  locale: Locale;
  opensAt: Date;
  socials: readonly BrandSocialLink[];
  publisher: string;
}

/** The opening date in Morocco's time ("jeudi 20 novembre 2026 à 10:00"); Tarifit takes the French format. */
export function openingDate(locale: Locale, at: Date): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[numbersLocale(locale)], { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Casablanca", numberingSystem: "latn" }).format(at);
}

export async function LaunchScreen({ locale, opensAt, socials, publisher }: LaunchScreenProps) {
  const [t, welcome, common, legal] = await Promise.all([
    getTranslations({ locale, namespace: "Launch" }),
    getTranslations({ locale, namespace: "Welcome" }),
    getTranslations({ locale, namespace: "Auth.common" }),
    getTranslations({ locale, namespace: "SearchMap.legal.short" }),
  ]);
  const title = welcome("title");
  const slugOf = (key: (typeof LEGAL_LINKS)[number]) => LEGAL_PAGES.find((page) => page.key === key)?.slug ?? key;
  return (
    <LaunchStage
      opensAt={opensAt.getTime()}
      numberLocale={LOCALE_TAGS[numbersLocale(locale)]}
      tagline={
        <p className="welcome-tagline launch-tagline welcome-enter max-w-[18ch] text-balance sm:max-w-none" data-enter="copy">
          {common("brandPromise")}
        </p>
      }
      labels={{ label: t("countdownLabel"), days: t("days"), hours: t("hours"), minutes: t("minutes"), seconds: t("seconds"), opening: t("opening") }}
      after={
        <>
          <p className="launch-date welcome-enter" data-enter="date">
            <time dateTime={opensAt.toISOString()}>{t("opensOn", { date: openingDate(locale, opensAt) })}</time>
            <span className="launch-date-zone">{t("moroccoTime")}</span>
          </p>
          {socials.length > 0 ? (
            <section aria-labelledby="launch-follow" className="launch-follow welcome-enter" data-enter="follow" data-testid="launch-social">
              <h2 id="launch-follow" className="launch-follow-title">
                {t("follow")}
              </h2>
              <ul className="launch-social">
                {socials.map((link) => (
                  <li key={link.network}>
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className="launch-social-link" aria-label={SOCIAL_NETWORK_NAMES[link.network]}>
                      <SocialIcon network={link.network} className="size-5" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <nav aria-label={t("legal")} className="launch-legal welcome-enter" data-enter="legal">
            <ul>
              {LEGAL_LINKS.map((key) => (
                <li key={key}>
                  {/* The other root layout: a plain link (a full load either way). */}
                  <a href={`/${locale}/legal/${slugOf(key)}`}>{legal(key)}</a>
                </li>
              ))}
            </ul>
            <p>
              © {new Date().getFullYear()} {publisher}
            </p>
          </nav>
        </>
      }
    >
      {/* Its length sizes the band on a phone, as on the welcome screen (globals.css). */}
      <h1 className="welcome-crest welcome-enter" data-welcome-part="crest" style={{ "--welcome-crest-chars": title.length } as CSSProperties}>
        <CrestRule />
        <span className="welcome-crest-text">{title}</span>
        <CrestRule />
      </h1>
      <div className="welcome-gate welcome-enter" data-enter="door">
        <DoorScene />
      </div>
    </LaunchStage>
  );
}

/** The welcome crest's gold rule ending in the logo's star (welcome-threshold.tsx), mirrored by CSS. */
function CrestRule() {
  return (
    <svg className="welcome-crest-rule" viewBox="0 0 72 16" aria-hidden="true" focusable="false">
      <path d="M0 8H54" />
      <path d="M64 1.5L65.9 3.4H68.6V6.1L70.5 8L68.6 9.9V12.6H65.9L64 14.5L62.1 12.6H59.4V9.9L57.5 8L59.4 6.1V3.4H62.1Z" />
    </svg>
  );
}
