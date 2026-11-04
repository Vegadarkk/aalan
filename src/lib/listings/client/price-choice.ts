// "Prix à discuter" is a choice of the seller, not the state of an empty optional price (zone 3
// audit P3-4): the draft stores `price: null` either way, so the switch starts off and remembers an
// explicit tick for this tab only (back to the step, a reload). Storage can be missing or throw
// (private window, blocked site data): a memory copy keeps the choice for the visit.

const PREFIX = "aalan:price-to-discuss:";
const memory = new Map<string, boolean>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Whether the seller ticked "à discuter" on this listing in this tab. */
export function readToDiscuss(listingId: string): boolean {
  const remembered = memory.get(listingId);
  if (remembered !== undefined) return remembered;
  try {
    return storage()?.getItem(PREFIX + listingId) === "1";
  } catch {
    return false;
  }
}

/** Records the switch; off forgets it. */
export function rememberToDiscuss(listingId: string, checked: boolean): void {
  memory.set(listingId, checked);
  try {
    const store = storage();
    if (!store) return;
    if (checked) store.setItem(PREFIX + listingId, "1");
    else store.removeItem(PREFIX + listingId);
  } catch {
    // The memory copy is enough for this visit.
  }
}
