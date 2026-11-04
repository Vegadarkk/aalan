import { LOCALES } from "@/config/site";
import type { AssistantResponse } from "@/lib/contracts/assistant";
import { ASSISTANT_QUESTION_MAX } from "@/lib/contracts/endpoints";
import { z } from "@/lib/zod";

// The Assistant's conversation kept for the tab (audit zone 5 n°17): an article link, a page
// change or a reload no longer empties it. sessionStorage, so it ends with the tab and never
// reaches the server or another device; only the turns are kept (questions, answers, article
// links), never a Turnstile token, a draft or an error. « Recommencer » clears it. Storage can be
// missing or throw (private window, blocked site data): the conversation then lives in memory only.

export const ASSISTANT_STORAGE_KEY = "aalan.assistant.v1";

/** Turns kept: the last ten exchanges, well past the history the API takes back. */
export const STORED_TURNS_MAX = 20;

export type AssistantTurnView = { id: number; role: "user"; text: string } | { id: number; role: "assistant"; response: AssistantResponse };

const hitSchema = z.object({
  slug: z.string().min(1).max(100),
  title: z.string().max(300),
  summary: z.string().max(1000),
  locale: z.enum(LOCALES).optional(),
});

const turnSchema = z.union([
  z.object({ id: z.number().int().nonnegative(), role: z.literal("user"), text: z.string().min(1).max(ASSISTANT_QUESTION_MAX) }),
  z.object({
    id: z.number().int().nonnegative(),
    role: z.literal("assistant"),
    response: z.union([
      z.object({ mode: z.literal("ai"), answer: z.string().max(5000), articles: z.array(hitSchema).max(10) }),
      z.object({ mode: z.literal("search"), articles: z.array(hitSchema).max(10) }),
    ]),
  }),
]);

const storedSchema = z.object({ v: z.literal(1), turns: z.array(turnSchema).max(STORED_TURNS_MAX) });

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
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data.turns as AssistantTurnView[]) : [];
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
