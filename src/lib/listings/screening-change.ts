import type { ModerationFlag } from "@/lib/contracts/listings";

// What the back-office review says when the pre-moderation re-run on the current listing differs
// from the score stored with the hold (zone 7 audit P2-11). A seller's edit while held is screened
// at once and rewrites the stored score, so a difference at review time mostly comes from the
// seller's context (account age, listings in 24 hours, duplicates among the other listings) or from
// photo checks and screening rules updated since. "content" only when the seller really changed the
// text, price or photos since the hold (contentFingerprint, src/lib/listings/screening.ts).

export interface ScreeningSnapshot {
  score: number;
  flags: readonly ModerationFlag[];
}

export type ScreeningChange =
  | { kind: "none" }
  | { kind: "content"; rescored: boolean }
  | { kind: "rescored"; added: ModerationFlag[]; removed: ModerationFlag[] };

/**
 * `contentChanged`: the seller changed the text, price or photos since the hold (null: the hold
 * predates the fingerprint, read as unchanged since an edit is screened when it is saved).
 */
export function screeningChange(stored: ScreeningSnapshot, rerun: ScreeningSnapshot | null, contentChanged: boolean | null): ScreeningChange {
  const rescored = rerun !== null && (rerun.score !== stored.score || [...rerun.flags].sort().join() !== [...stored.flags].sort().join());
  if (contentChanged === true) return { kind: "content", rescored };
  if (!rescored || !rerun) return { kind: "none" };
  return {
    kind: "rescored",
    added: rerun.flags.filter((flag) => !stored.flags.includes(flag)),
    removed: stored.flags.filter((flag) => !rerun.flags.includes(flag)),
  };
}
