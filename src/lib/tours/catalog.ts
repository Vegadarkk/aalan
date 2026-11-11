// Guided tours (owner, 2026-11-11): on a member's first visit of a screen, the rest of the window
// dims and blurs, the control to use stays sharp, and a card says what to do. A tour belongs to
// one screen; a tutorial chains the tours of one journey and is what the tutorials page
// (/aide/tutoriels) and the settings list. The texts live in messages/*.json under `Tours`.
//
// A step points at an element by its `data-tour` attribute. A step whose element is not on the
// screen (a section only some accounts see) is left out; a tour with none left does not start.

export const TOUR_IDS = ["post-start", "post-wizard", "post-photos", "post-review", "pro-apply", "pro-shop"] as const;
export type TourId = (typeof TOUR_IDS)[number];

/** Values of the `data-tour` attributes the tours point at; each one is a step's texts in messages (`Tours.steps.{target}`). */
export const TOUR_TARGETS = ["post-give", "post-categories", "post-progress", "post-actions", "post-photos", "post-preview", "post-publish", "pro-eligibility", "pro-activity", "pro-legal", "pro-pieces", "pro-submit", "pro-shortcuts", "pro-plan", "pro-card", "pro-share", "pro-sector"] as const;
export type TourTarget = (typeof TOUR_TARGETS)[number];

export interface TourStep {
  target: TourTarget;
}

export const TOURS: Record<TourId, readonly TourStep[]> = {
  "post-start": [{ target: "post-give" }, { target: "post-categories" }],
  "post-wizard": [{ target: "post-progress" }, { target: "post-actions" }],
  "post-photos": [{ target: "post-photos" }],
  "post-review": [{ target: "post-preview" }, { target: "post-publish" }],
  "pro-apply": [{ target: "pro-eligibility" }, { target: "pro-activity" }, { target: "pro-legal" }, { target: "pro-pieces" }, { target: "pro-submit" }],
  "pro-shop": [{ target: "pro-shortcuts" }, { target: "pro-plan" }, { target: "pro-card" }, { target: "pro-share" }, { target: "pro-sector" }],
};

export const TUTORIAL_IDS = ["deposer", "pro", "boutique"] as const;
export type TutorialId = (typeof TUTORIAL_IDS)[number];

export interface Tutorial {
  id: TutorialId;
  /** The tours of the journey, in order; the first one is on `start`. */
  tours: readonly TourId[];
  /** Where the tutorial starts (without the locale); `?tuto={id}` is added to replay it. */
  start: "/deposer" | "/pro";
  /** Extra query of the start page (`nouveau=1`: the category grid even with drafts). */
  query?: Record<string, string>;
  /** Shown to every member, or only to a verified shop. */
  audience: "member" | "pro";
}

export const TUTORIALS: readonly Tutorial[] = [
  { id: "deposer", tours: ["post-start", "post-wizard", "post-photos", "post-review"], start: "/deposer", query: { nouveau: "1" }, audience: "member" },
  { id: "pro", tours: ["pro-apply"], start: "/pro", audience: "member" },
  { id: "boutique", tours: ["pro-shop"], start: "/pro", audience: "pro" },
];

/** Query parameter that replays a tutorial on its start page. */
export const REPLAY_PARAM = "tuto";

export function isTourId(value: unknown): value is TourId {
  return typeof value === "string" && (TOUR_IDS as readonly string[]).includes(value);
}

export function tutorialById(id: string | null | undefined): Tutorial | null {
  return TUTORIALS.find((tutorial) => tutorial.id === id) ?? null;
}

/** The tutorial a tour belongs to. */
export function tutorialOf(tour: TourId): Tutorial | null {
  return TUTORIALS.find((tutorial) => tutorial.tours.includes(tour)) ?? null;
}

/** Number of steps of a tutorial (on the tutorials page; some may be left out on screen). */
export function tutorialStepCount(tutorial: Tutorial): number {
  return tutorial.tours.reduce((sum, tour) => sum + TOURS[tour].length, 0);
}

/** The link that replays a tutorial. */
export function tutorialHref(tutorial: Tutorial): { pathname: Tutorial["start"]; query: Record<string, string> } {
  return { pathname: tutorial.start, query: { ...tutorial.query, [REPLAY_PARAM]: tutorial.id } };
}

/** What is known of a member's (or a device's) tours. */
export interface TourState {
  /** Tours finished or skipped: not offered again by themselves. */
  seen: TourId[];
  /** « Afficher les tutoriels » switched off in the settings: no tour starts by itself. */
  off: boolean;
}

export const EMPTY_TOUR_STATE: TourState = { seen: [], off: false };

/** Keeps the known ids, once each, in catalogue order (a removed tour id is dropped). */
export function cleanSeen(seen: readonly unknown[]): TourId[] {
  return TOUR_IDS.filter((id) => seen.includes(id));
}

/** Device and account together: a tour seen on either is seen; off on either is off. */
export function mergeTourStates(a: TourState, b: TourState): TourState {
  return { seen: cleanSeen([...a.seen, ...b.seen]), off: a.off || b.off };
}

/**
 * Whether a tour starts by itself: not seen and tours on, or part of the tutorial being replayed
 * (the replay brings it back even when tours are off, and until it has been gone through again).
 */
export function shouldStart(tour: TourId, state: TourState, replaying: TutorialId | null): boolean {
  if (state.seen.includes(tour)) return false;
  if (replaying && tutorialById(replaying)?.tours.includes(tour)) return true;
  return !state.off;
}

/** The state after a replay request: the tutorial's tours are unseen again. */
export function withReplay(state: TourState, tutorial: Tutorial): TourState {
  return { ...state, seen: state.seen.filter((id) => !tutorial.tours.includes(id)) };
}
