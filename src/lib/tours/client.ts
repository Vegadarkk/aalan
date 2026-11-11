import { apiGet, apiPost } from "@/lib/auth/client";
import type { TutorialSettings } from "@/lib/contracts/account";
import { ACCOUNT_API } from "@/lib/contracts/endpoints";
import { EMPTY_TOUR_STATE, REPLAY_PARAM, TUTORIAL_IDS, cleanSeen, mergeTourStates, shouldStart, tutorialById, withReplay, type TourId, type TourState, type TutorialId } from "./catalog";

// Browser side of the guided tours (src/lib/tours/catalog.ts). The device keeps its own copy
// (localStorage `tours`), so a tour already seen or switched off costs nothing; a member's account
// is asked once per page load while a tour is still due here, and a tour seen or the switch turned
// off on either side counts (the settings write both). A replay (`?tuto=` from the tutorials page) lives in sessionStorage until the
// tutorial's tours have been gone through again. One tour shows at a time.

const STORAGE_KEY = "tours";
const REPLAY_KEY = "tours-replay";

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The device's copy; anything unreadable is a fresh start. */
export function readDeviceState(): TourState {
  try {
    const raw = storage("local")?.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_TOUR_STATE;
    const value = JSON.parse(raw) as { seen?: unknown; off?: unknown };
    return { seen: Array.isArray(value.seen) ? cleanSeen(value.seen) : [], off: value.off === true };
  } catch {
    return EMPTY_TOUR_STATE;
  }
}

export function writeDeviceState(state: TourState): void {
  try {
    storage("local")?.setItem(STORAGE_KEY, JSON.stringify({ seen: state.seen, off: state.off }));
  } catch {
    // Private mode or full storage: the tour simply shows again next time.
  }
}

function readReplay(): TutorialId | null {
  try {
    const value = storage("session")?.getItem(REPLAY_KEY);
    return (TUTORIAL_IDS as readonly string[]).includes(value ?? "") ? (value as TutorialId) : null;
  } catch {
    return null;
  }
}

function writeReplay(id: TutorialId | null): void {
  try {
    const session = storage("session");
    if (id) session?.setItem(REPLAY_KEY, id);
    else session?.removeItem(REPLAY_KEY);
  } catch {
    // Without session storage the replay covers the first screen only.
  }
}

/** The account's answer of this page load (null: guest, or the request failed). */
let accountState: Promise<TourState | null> | null = null;

function loadAccountState(): Promise<TourState | null> {
  accountState ??= apiGet<TutorialSettings>(ACCOUNT_API.tutorials).then(
    (settings) => ({ seen: cleanSeen(settings.seen), off: settings.off }),
    () => null,
  );
  return accountState;
}


/**
 * `?tuto={id}` on the page: the tutorial's tours become unseen on this device and the replay
 * starts. The parameter leaves the address, so a later render of the page does not restart it.
 */
function takeReplayParam(): void {
  const url = new URL(window.location.href);
  const tutorial = tutorialById(url.searchParams.get(REPLAY_PARAM));
  if (!tutorial) return;
  writeDeviceState(withReplay(readDeviceState(), tutorial));
  writeReplay(tutorial.id);
  url.searchParams.delete(REPLAY_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

/** Whether `tour` starts now on this screen. */
export async function tourShouldStart(tour: TourId, signedIn: boolean): Promise<boolean> {
  takeReplayParam();
  const device = readDeviceState();
  const replaying = readReplay();
  // A replay goes by the device alone: the account still lists the tours as seen.
  if (replaying && tutorialById(replaying)?.tours.includes(tour)) return shouldStart(tour, device, replaying);
  if (!shouldStart(tour, device, null) || !signedIn) return shouldStart(tour, device, null);
  const account = await loadAccountState();
  if (!account) return true;
  const merged = mergeTourStates(device, account);
  writeDeviceState(merged);
  return shouldStart(tour, merged, null);
}

/** A tour finished, skipped or left: not offered again by itself. */
export function markTourSeen(tour: TourId, signedIn: boolean): void {
  const device = readDeviceState();
  const next: TourState = { ...device, seen: cleanSeen([...device.seen, tour]) };
  writeDeviceState(next);
  const replaying = tutorialById(readReplay());
  if (replaying && replaying.tours.every((id) => next.seen.includes(id))) writeReplay(null);
  if (!signedIn) return;
  void (async () => {
    const account = await loadAccountState();
    const seen = cleanSeen([...next.seen, ...(account?.seen ?? [])]);
    try {
      const saved = await apiPost<TutorialSettings>(ACCOUNT_API.tutorials, { seen });
      accountState = Promise.resolve({ seen: cleanSeen(saved.seen), off: saved.off });
    } catch {
      // The device remembers it; the account learns it with the next tour.
    }
  })();
}

/** The settings section: the account's state (members) or the device's (no account answer). */
export async function readTourSettings(signedIn: boolean): Promise<TourState> {
  const device = readDeviceState();
  if (!signedIn) return device;
  accountState = null;
  const account = await loadAccountState();
  if (!account) return device;
  const merged = mergeTourStates(device, account);
  writeDeviceState(merged);
  return merged;
}

/**
 * The settings section's changes: the switch, or « Revoir les tutoriels » (every tour unseen).
 * Saved on the device at once and on the account for a member; throws when the account refused.
 */
export async function saveTourSettings(change: { off?: boolean; reset?: boolean }, signedIn: boolean): Promise<TourState> {
  const device = readDeviceState();
  const next: TourState = { seen: change.reset ? [] : device.seen, off: change.off ?? device.off };
  writeDeviceState(next);
  if (change.reset) writeReplay(null);
  if (!signedIn) return next;
  const saved = await apiPost<TutorialSettings>(ACCOUNT_API.tutorials, { ...(change.reset ? { seen: [] } : {}), ...(change.off === undefined ? {} : { off: change.off }) });
  const state = { seen: cleanSeen(saved.seen), off: saved.off };
  accountState = Promise.resolve(state);
  writeDeviceState(state);
  return state;
}

/** One tour at a time: resolves with the release once the screen is free. */
let queue: Promise<void> = Promise.resolve();

export function acquireTourSlot(): Promise<() => void> {
  let release!: () => void;
  const freed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const turn = queue.then(() => release);
  queue = queue.then(() => freed);
  return turn;
}

/** Test hook: forget the account's answer of this page load. */
export function resetTourClientForTests(): void {
  accountState = null;
  queue = Promise.resolve();
}
