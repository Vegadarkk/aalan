import { LOCALES } from "@/config/site";
import type { AssistantResponse } from "@/lib/contracts/assistant";
import { ASSISTANT_QUESTION_MAX } from "@/lib/contracts/endpoints";

// The Assistant's conversation kept for the tab (audit zone 5 n°17): an article link, a page
// change or a reload no longer empties it. sessionStorage, so it ends with the tab and never
// reaches the server or another device; only the turns are kept (questions, answers, article
// links), never a Turnstile token, a draft or an error. « Recommencer » clears it. Storage can be
// missing or throw (private window, blocked site data): the conversation then lives in memory only.

export const ASSISTANT_STORAGE_KEY = "aalan.assistant.v1";

/** Turns kept: the last ten exchanges, well past the history the API takes back. */
export const STORED_TURNS_MAX = 20;

export type AssistantTurnView = { id: number; role: "user"; text: string } | { id: number; role: "assistant"; response: AssistantResponse };

// Checked by hand on read: zod would join the client JavaScript of every public page.
const isText = (value: unknown, max: number, min = 0): value is string => typeof value === "string" && value.length >= min && value.length <= max;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isHit(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value.slug, 100, 1) &&
    isText(value.title, 300) &&
    isText(value.summary, 1000) &&
    (value.locale === undefined || (LOCALES as readonly unknown[]).includes(value.locale))
  );
}

function isTurn(value: unknown): value is AssistantTurnView {
  if (!isRecord(value) || !Number.isInteger(value.id) || (value.id as number) < 0) return false;
  if (value.role === "user") return isText(value.text, ASSISTANT_QUESTION_MAX, 1);
  if (value.role !== "assistant" || !isRecord(value.response)) return false;
  const { mode, answer, articles } = value.response;
  const hits = Array.isArray(articles) && articles.length <= 10 && articles.every(isHit);
  return hits && (mode === "search" || (mode === "ai" && isText(answer, 5000)));
}

/** The stored form: the last turns only, starting with a question. */
export function encodeTurns(turns: readonly AssistantTurnView[]): string {
  let kept = turns.slice(-STORED_TURNS_MAX);
  while (kept[0] && kept[0].role !== "user") kept = kept.slice(1);
  return JSON.stringify({ v: 1, turns: kept });
}

/** The turns of a stored value; anything unreadable or of another shape gives none. */
export function decodeTurns(raw: string | null): AssistantTurnView[] {
  if (!raw) return [];
  try {
    const stored: unknown = JSON.parse(raw);
    if (!isRecord(stored) || stored.v !== 1) return [];
    const { turns } = stored;
    return Array.isArray(turns) && turns.length <= STORED_TURNS_MAX && turns.every(isTurn) ? turns : [];
  } catch {
    return [];
  }
}

export function loadTurns(): AssistantTurnView[] {
  try {
    return decodeTurns(window.sessionStorage.getItem(ASSISTANT_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveTurns(turns: readonly AssistantTurnView[]): void {
  try {
    if (turns.length === 0) window.sessionStorage.removeItem(ASSISTANT_STORAGE_KEY);
    else window.sessionStorage.setItem(ASSISTANT_STORAGE_KEY, encodeTurns(turns));
  } catch {
    // No storage (private window, quota, blocked site data): the conversation stays in memory.
  }
}
