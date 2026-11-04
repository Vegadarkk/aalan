import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_STORAGE_KEY, STORED_TURNS_MAX, decodeTurns, encodeTurns, loadTurns, saveTurns, type AssistantTurnView } from "@/components/help/assistant-history";

// Audit zone 5 n°17: the Assistant's conversation survives an article link or a reload, for the
// tab only, and nothing but the turns is kept.

const question = (id: number, text = `Question ${id}`): AssistantTurnView => ({ id, role: "user", text });
const answer = (id: number): AssistantTurnView => ({
  id,
  role: "assistant",
  response: { mode: "ai", answer: `Réponse ${id}`, articles: [{ slug: "eviter-les-arnaques", title: "تجنب الاحتيال", summary: "…", locale: "ar" }] },
});

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("assistant history", () => {
  it("round-trips the turns, article locales included", () => {
    const turns = [question(0), answer(1), question(2), { id: 3, role: "assistant", response: { mode: "search", articles: [] } } as AssistantTurnView];
    expect(decodeTurns(encodeTurns(turns))).toEqual(turns);
  });

  it("keeps the last turns only, starting with a question", () => {
    const turns = Array.from({ length: 25 }, (_, id) => (id % 2 === 0 ? question(id) : answer(id)));
    const kept = decodeTurns(encodeTurns(turns));
    expect(kept.length).toBeLessThanOrEqual(STORED_TURNS_MAX);
    expect(kept[0]?.role).toBe("user");
    expect(kept.at(-1)).toEqual(turns.at(-1));
  });

  it("reads nothing from a missing, broken or foreign value", () => {
    expect(decodeTurns(null)).toEqual([]);
    expect(decodeTurns("{not json")).toEqual([]);
    expect(decodeTurns(JSON.stringify({ v: 2, turns: [question(0)] }))).toEqual([]);
    expect(decodeTurns(JSON.stringify({ v: 1, turns: [{ id: 0, role: "user", text: "" }] }))).toEqual([]);
    expect(decodeTurns(JSON.stringify({ v: 1, turns: [{ id: 0, role: "system", text: "x" }] }))).toEqual([]);
  });

  it("saves to the tab's storage, clears it on restart, and never throws without storage", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    saveTurns([question(0), answer(1)]);
    expect(JSON.parse(storage.getItem(ASSISTANT_STORAGE_KEY) ?? "{}")).toMatchObject({ v: 1 });
    expect(loadTurns()).toEqual([question(0), answer(1)]);
    saveTurns([]);
    expect(storage.getItem(ASSISTANT_STORAGE_KEY)).toBeNull();

    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(() => saveTurns([question(0)])).not.toThrow();
    expect(loadTurns()).toEqual([]);
  });
});
