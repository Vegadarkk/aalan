import type { ConversationsPage, ConversationView } from "@/lib/contracts/messaging";

// Pure state of the inbox list (design phase-5 D2): pages of GET /api/conversations merged by cid
// in the server's order (newest activity first), rows replaced or removed by live refetches. The
// archived view holds only archived rows, the inbox only the others.

export interface InboxList {
  archived: boolean;
  rows: ConversationView[];
  /** Cursor of the next page; absent once the end is reached. */
  next?: string;
  more: "idle" | "loading" | "failed";
}

export type InboxState = { kind: "loading"; archived: boolean } | { kind: "failed"; archived: boolean; error: unknown } | ({ kind: "ready" } & InboxList);

/** A loaded view with nothing in it and nothing more to load (the list shows its own empty state). */
export function inboxIsEmpty(inbox: InboxState): boolean {
  return inbox.kind === "ready" && inbox.rows.length === 0 && !inbox.next;
}

/** The server's order: updatedAt desc, then cid desc. */
export function compareRows(a: ConversationView, b: ConversationView): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.cid < b.cid ? 1 : a.cid > b.cid ? -1 : 0;
}

const belongs = (list: Pick<InboxList, "archived">, row: ConversationView) => row.archived === list.archived;

/** The first page of a view. */
export function firstPage(archived: boolean, page: ConversationsPage): InboxState {
  return { kind: "ready", archived, rows: page.conversations.filter((row) => row.archived === archived).sort(compareRows), next: page.next, more: "idle" };
}

/**
 * A later page appended: a row already shown keeps the fresher of the two versions. A page may
 * hold no row of this view at all while `next` is set (the caller keeps paging).
 */
export function withPage(list: InboxList, page: ConversationsPage): InboxList {
  const byCid = new Map(list.rows.map((row) => [row.cid, row]));
  for (const row of page.conversations) {
    if (!belongs(list, row)) continue;
    const known = byCid.get(row.cid);
    if (!known || row.updatedAt >= known.updatedAt) byCid.set(row.cid, row);
  }
  return { ...list, rows: [...byCid.values()].sort(compareRows), next: page.next, more: "idle" };
}

/**
 * The first page fetched again (resync after a reconnection): it replaces the rows of its range;
 * rows older than its last one stay, with the cursor reached so far.
 */
export function withFreshHead(list: InboxList, page: ConversationsPage): InboxList {
  const head = page.conversations.filter((row) => belongs(list, row)).sort(compareRows);
  const oldest = page.conversations.length > 0 ? [...page.conversations].sort(compareRows).at(-1) : undefined;
  if (!page.next || !oldest) return { ...list, rows: head, next: page.next, more: "idle" };
  const fresh = new Set(head.map((row) => row.cid));
  const tail = list.rows.filter((row) => !fresh.has(row.cid) && compareRows(row, oldest) > 0);
  // Pages already loaded past the head keep their cursor; otherwise the head's own.
  return { ...list, rows: [...head, ...tail].sort(compareRows), next: tail.length > 0 ? list.next : page.next, more: "idle" };
}

/**
 * One row fetched again (live event, thread view): replaced, inserted when it falls inside the
 * loaded range (or everything is loaded), or removed when it left this view (archived, unarchived).
 */
export function withRow(list: InboxList, row: ConversationView): InboxList {
  if (!belongs(list, row)) return removeRow(list, row.cid);
  const index = list.rows.findIndex((item) => item.cid === row.cid);
  if (index === -1) {
    const last = list.rows.at(-1);
    if (list.next && last && compareRows(row, last) > 0) return list;
    return { ...list, rows: [...list.rows, row].sort(compareRows) };
  }
  const rows = [...list.rows];
  rows[index] = row;
  return { ...list, rows: rows.sort(compareRows) };
}

export function removeRow(list: InboxList, cid: string): InboxList {
  return list.rows.some((row) => row.cid === cid) ? { ...list, rows: list.rows.filter((row) => row.cid !== cid) } : list;
}

/** Load the next page now: the end of the list is on screen (or nothing of this view is shown yet). */
export function shouldLoadMore(list: InboxList, endVisible: boolean): boolean {
  return Boolean(list.next) && list.more === "idle" && (endVisible || list.rows.length === 0);
}

// ---- Filters (audit §7): « Non lues » and « Par annonce », over the rows loaded so far -------

export interface InboxFilter {
  unread: boolean;
  /** The listing (or shop) of the conversations shown; null for all. */
  listingId: string | null;
  /** Words looked for in the other participant's name and the listing's title (audit zone 5 n°21). */
  query?: string;
}

export const NO_FILTER: InboxFilter = { unread: false, listingId: null, query: "" };

/** Lower case, without accents, Arabic short vowels nor tatweel: « Élodie » finds « elodie ». */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/ـ/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Every word of the query is in the name or the title. */
function matchesQuery(row: ConversationView, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const haystack = foldText(`${row.counterpart.displayName} ${row.listing.title}`);
  return words.every((word) => haystack.includes(word));
}

export interface ListingChoice {
  listingId: string;
  title: string;
  /** Conversations of the listing among the loaded rows. */
  count: number;
}

/** The listings of the loaded rows, most conversations first, then by title. */
export function listingChoices(rows: readonly ConversationView[]): ListingChoice[] {
  const byListing = new Map<string, ListingChoice>();
  for (const row of rows) {
    const known = byListing.get(row.listingId);
    if (known) known.count += 1;
    else byListing.set(row.listingId, { listingId: row.listingId, title: row.listing.title, count: 1 });
  }
  return [...byListing.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

/** The filter as it applies: a listing that left the loaded rows no longer filters. */
export function effectiveFilter(filter: InboxFilter, rows: readonly ConversationView[]): InboxFilter {
  if (filter.listingId && !rows.some((row) => row.listingId === filter.listingId)) return { ...filter, listingId: null };
  return filter;
}

export const isFiltering = (filter: InboxFilter) => filter.unread || filter.listingId !== null || foldText(filter.query ?? "") !== "";

/**
 * Rows the filter keeps. The open conversation stays while it is open: reading it must not make
 * it vanish from « Non lues » under the person's eyes. Words narrow everything, the open one too.
 */
export function filterRows(rows: readonly ConversationView[], filter: InboxFilter, selected: string | null): ConversationView[] {
  if (!isFiltering(filter)) return [...rows];
  const words = foldText(filter.query ?? "").split(" ").filter(Boolean);
  return rows.filter(
    (row) => matchesQuery(row, words) && (row.cid === selected || ((!filter.unread || row.unread > 0) && (!filter.listingId || row.listingId === filter.listingId))),
  );
}

/** Conversations with unread messages among the loaded rows. */
export function unreadConversations(rows: readonly ConversationView[]): number {
  return rows.filter((row) => row.unread > 0).length;
}
