import { isSocialNetwork, parseSocialLink, socialHref, type SocialNetwork } from "@/config/social-links";

// Aalan's own social accounts, linked from the countdown page (owner, 5 Nov 2026: the campaign's
// videos live there). BRAND_SOCIAL_LINKS lists "network=handle or profile address" pairs separated
// by spaces or commas, in display order: "instagram=aalan.ma tiktok=@aalan.ma
// youtube=https://www.youtube.com/@aalan". Each value goes through the shops' parser
// (src/config/social-links.ts): only the network's own profile page can come out, over https.
// Unset: no row of links. An invalid pair fails the start (env.ts) and is never shown.

export interface BrandSocialLink {
  network: SocialNetwork;
  href: string;
}

export function brandSocialLinks(raw: string | undefined): { links: BrandSocialLink[]; problems: string[] } {
  const links: BrandSocialLink[] = [];
  const problems: string[] = [];
  for (const pair of (raw ?? "").split(/[\s,]+/).filter(Boolean)) {
    const at = pair.indexOf("=");
    const network = pair.slice(0, at).trim().toLowerCase();
    if (at <= 0 || !isSocialNetwork(network)) {
      problems.push(`"${pair}" is not network=handle (networks: instagram, tiktok, facebook, youtube, x, linkedin, snapchat, whatsapp)`);
      continue;
    }
    if (links.some((link) => link.network === network)) {
      problems.push(`${network} is listed twice`);
      continue;
    }
    const parsed = parseSocialLink(network, pair.slice(at + 1));
    if ("problem" in parsed) problems.push(`${network}: ${parsed.problem}`);
    else links.push({ network, href: socialHref(network, parsed.handle) });
  }
  return { links, problems };
}
