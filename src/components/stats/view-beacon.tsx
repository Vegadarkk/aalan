"use client";

import { useEffect } from "react";
import { STATS_API } from "@/lib/contracts/endpoints";

// One view of a cached listing or storefront page for the shop counters (src/lib/stats): a
// same-origin POST after the page is shown, once per tab and day (the server also keeps one per
// visitor and day). Fire and forget: never retried, never shown, never blocks the page.

/** `token`: viewToken(scope, id), computed by the server page (src/lib/stats/counters.ts). */
export function ViewBeacon({ scope, id, token }: { scope: "shop" | "listing"; id: string; token: string }) {
  useEffect(() => {
    const mark = `aalan:view:${scope}:${id}:${new Date().toISOString().slice(0, 10)}`;
    try {
      if (window.sessionStorage.getItem(mark)) return;
      window.sessionStorage.setItem(mark, "1");
    } catch {
      // Storage refused (private mode): the server's own once-a-day rule still applies.
    }
    void fetch(STATS_API.view, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, id, t: token }),
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  }, [scope, id, token]);
  return null;
}
