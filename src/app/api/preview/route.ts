import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALES } from "@/config/site";
import { serverEnv } from "@/lib/env";
import { isPreviewKey, isProInviteCode, PREVIEW_COOKIE, PREVIEW_SECONDS, previewPass, proInvitePass } from "@/lib/launch/preview";

// Preview pass of the closed site (src/lib/launch/preview.ts). `?cle=<PREVIEW_SECRET>` sets the
// pass and opens the home page; `?pro=<PRO_INVITE_CODE>` (the shops' outreach mail, `&langue=ar`
// optional) sets an invited shop's pass and opens the sign-up page, then the Pro area; `?fin`
// removes either. A wrong key, or no secret configured, is a 404
// like any unknown path: nothing tells a visitor this door exists. Never cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
}

export function GET(request: NextRequest): Response {
  const secret = serverEnv().PREVIEW_SECRET;
  if (!secret) return notFound();
  // On the public origin (SITE_URL): behind the tunnel, request.url names the container's own
  // address (http://0.0.0.0:3000), which a browser cannot reach.
  const origin = serverEnv().SITE_URL;
  const home = new URL(`/${DEFAULT_LOCALE}`, origin);
  const params = request.nextUrl.searchParams;
  if (params.has("fin")) {
    const response = NextResponse.redirect(home, 303);
    response.cookies.set(PREVIEW_COOKIE, "", { secure: true, path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
    for (const [name, value] of Object.entries(NO_STORE)) response.headers.set(name, value);
    return response;
  }
  const code = serverEnv().PRO_INVITE_CODE;
  if (params.has("pro")) {
    if (!isProInviteCode(params.get("pro"), secret, code)) return notFound();
    const asked = params.get("langue") ?? "";
    const locale = (LOCALES as readonly string[]).includes(asked) ? asked : DEFAULT_LOCALE;
    const signup = new URL(`/${locale}/inscription`, origin);
    signup.searchParams.set("next", `/${locale}/pro`);
    const response = NextResponse.redirect(signup, 303);
    response.cookies.set(PREVIEW_COOKIE, proInvitePass(secret, code as string), { secure: true, path: "/", httpOnly: true, sameSite: "lax", maxAge: PREVIEW_SECONDS });
    for (const [name, value] of Object.entries(NO_STORE)) response.headers.set(name, value);
    return response;
  }
  if (!isPreviewKey(params.get("cle"), secret)) return notFound();
  const response = NextResponse.redirect(home, 303);
  response.cookies.set(PREVIEW_COOKIE, previewPass(secret), { secure: true, path: "/", httpOnly: true, sameSite: "lax", maxAge: PREVIEW_SECONDS });
  for (const [name, value] of Object.entries(NO_STORE)) response.headers.set(name, value);
  return response;
}
