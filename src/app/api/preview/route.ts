import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE } from "@/config/site";
import { serverEnv } from "@/lib/env";
import { isPreviewKey, PREVIEW_COOKIE, PREVIEW_SECONDS, previewPass } from "@/lib/launch/preview";

// Preview pass of the closed site (src/lib/launch/preview.ts). `?cle=<PREVIEW_SECRET>` sets the
// pass and opens the home page; `?fin` removes it. A wrong key, or no secret configured, is a 404
// like any unknown path: nothing tells a visitor this door exists. Never cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
}

export function GET(request: NextRequest): Response {
  const secret = serverEnv().PREVIEW_SECRET;
  if (!secret) return notFound();
  const home = new URL(`/${DEFAULT_LOCALE}`, request.url);
  const params = request.nextUrl.searchParams;
  if (params.has("fin")) {
    const response = NextResponse.redirect(home, 303);
    response.cookies.set(PREVIEW_COOKIE, "", { secure: true, path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
    for (const [name, value] of Object.entries(NO_STORE)) response.headers.set(name, value);
    return response;
  }
  if (!isPreviewKey(params.get("cle"), secret)) return notFound();
  const response = NextResponse.redirect(home, 303);
  response.cookies.set(PREVIEW_COOKIE, previewPass(secret), { secure: true, path: "/", httpOnly: true, sameSite: "lax", maxAge: PREVIEW_SECONDS });
  for (const [name, value] of Object.entries(NO_STORE)) response.headers.set(name, value);
  return response;
}
