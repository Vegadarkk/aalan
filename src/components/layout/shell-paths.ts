// Pages where parts of the shell step aside (paths without the locale, as usePathname gives them).

const under = (pathname: string, paths: readonly string[]) => paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/**
 * Focused flows: posting, signing in, the conversations (their shell fills the viewport under the
 * header, src/components/messages/messages-shell.tsx) and the anti-robot check. No category row.
 */
const FOCUSED_PATHS = ["/deposer", "/connexion", "/inscription", "/mot-de-passe-oublie", "/action", "/messages", "/anti-robot"];

/** Pages with their own bar at the bottom of a phone: the listing's contact bar, the Pro save bars. */
const BOTTOM_BAR_PATHS = ["/annonce", "/pro"];

/**
 * Reading and account pages where « Vendre » has nothing to do and only hides text or a form on a
 * phone (audit zone 1 Z1-07, zone 6 6-15, zone 8 P1): the legal texts, help, procedures, prices,
 * the Pro landing, settings, verifications, the wallet and its purchase pages, the appeals.
 */
const QUIET_PATHS = ["/legal", "/aide", "/demarches", "/tarifs", "/professionnels", "/parametres", "/verifications", "/porte-monnaie", "/recours"];

/** Where the assistant bubble steps aside: /aide has its own launcher; forms, conversations and the legal texts. */
const NO_ASSISTANT_PATHS = ["/aide", "/legal", ...FOCUSED_PATHS];

/** The search page (lot 2): its own filters and category shortcuts sit beside the results. */
const SEARCH_PATHS = ["/recherche"];

/** The home page (lot 3): the twelve categories are in its own panel (map) or arcade (list). */
const HOME_PATH = "/";

export function showsCategoryRow(pathname: string): boolean {
  return pathname !== HOME_PATH && !under(pathname, FOCUSED_PATHS) && !under(pathname, SEARCH_PATHS);
}

export function showsSellButton(pathname: string): boolean {
  return !under(pathname, FOCUSED_PATHS) && !under(pathname, BOTTOM_BAR_PATHS) && !under(pathname, QUIET_PATHS);
}

export function showsAssistantBubble(pathname: string): boolean {
  return !under(pathname, NO_ASSISTANT_PATHS);
}
