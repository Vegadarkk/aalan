import { serverEnv } from "@/lib/env";
import { getLegalConfig } from "@/lib/legal/config";
import { securityTxt } from "@/lib/security/security-txt";

// /.well-known/security.txt (RFC 9116; audit synthesis §7 "Technique"): where to report a
// vulnerability. The contact is config/legal's abuse address (SECURITY.md: subject « Sécurité »),
// so it follows the domain switch without a deploy.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const legal = await getLegalConfig();
  return new Response(securityTxt({ contact: legal.abuseEmail, siteUrl: serverEnv().SITE_URL, now: new Date() }), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
