// The body of /.well-known/security.txt (RFC 9116). Expires is rolling, 180 days ahead (the RFC
// recommends less than a year): the file is generated per request, so it never goes stale.

export const SECURITY_TXT_DAYS = 180;

export function securityTxt({ contact, siteUrl, now }: { contact: string; siteUrl: string; now: Date }): string {
  const expires = new Date(now.getTime() + SECURITY_TXT_DAYS * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  const origin = siteUrl.replace(/\/+$/, "");
  return [
    `Contact: mailto:${contact}?subject=S%C3%A9curit%C3%A9`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    "Preferred-Languages: fr, ar, en",
    `Canonical: ${origin}/.well-known/security.txt`,
    "",
  ].join("\n");
}
