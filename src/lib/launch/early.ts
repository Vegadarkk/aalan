import "server-only";
import { HttpError } from "@/lib/http/errors";
import { readCookie } from "@/lib/http/cookies";
import { isClosed, parseOpensAt } from "./gate";
import { hasPreviewPass, PREVIEW_COOKIE } from "./preview";

// Invited shops before the opening (owner's card, 24 Nov 2026): the Pro invitation pass opens
// posting at the gate (gate.ts, access "pro"), but a forwarded link must not let an individual
// post. While closed, a new draft, a duplicate, a photo upload or a publication needs a validated
// Pro (claims role "pro", set at KYBC validation) or the team's preview pass. Their listings and
// the 6 free months count from the opening (opening below), not from the day they were set up.

/** The opening instant from OPENS_AT, or null when unset or invalid (the site is open). */
export function opening(): Date | null {
  return parseOpensAt(process.env.OPENS_AT);
}

/** The later of `now` and a future opening: where a lifetime starting now really starts. */
export function fromOpening(now: Date, opensAt: Date | null = opening()): Date {
  return opensAt && opensAt.getTime() > now.getTime() ? opensAt : now;
}

/** Pure decision: whether this request may post while the site is closed. */
export function postingAllowed(input: { closed: boolean; teamPass: boolean; role: unknown }): boolean {
  return !input.closed || input.teamPass || input.role === "pro";
}

/** Throws 403 posting_closed when an account other than a validated Pro posts before the opening. */
export function assertPostingOpen(request: Request, claims: { role?: unknown }, now: Date = new Date()): void {
  const closed = isClosed(opening(), now);
  if (!closed) return;
  const teamPass = hasPreviewPass(readCookie(request.headers, PREVIEW_COOKIE), process.env.PREVIEW_SECRET);
  if (!postingAllowed({ closed, teamPass, role: claims.role })) throw new HttpError(403, "posting_closed");
}
