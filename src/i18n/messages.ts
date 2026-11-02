import type { Locale } from "@/config/site";
import type fr from "../../messages/fr.json";

export type Messages = typeof fr;

type Tree = { [key: string]: string | Tree };

function isTree(value: unknown): value is Tree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge: keys of `override` win, missing keys come from `base`. */
export function mergeMessages(base: Tree, override: Tree): Tree {
  const result: Tree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isTree(value) && isTree(current) ? mergeMessages(current, value) : value;
  }
  return result;
}

/**
 * The catalogs are static: merged once per locale and process, not on every request (the merge of
 * ~1 300 keys cost about 1 ms of CPU per page). Callers never write to the messages.
 */
const merged = new Map<Locale, Promise<Messages>>();

/** Messages of a locale over the French base, so a missing key always falls back to French. */
export function loadMessages(locale: Locale): Promise<Messages> {
  let messages = merged.get(locale);
  if (!messages) {
    messages = buildMessages(locale);
    merged.set(locale, messages);
  }
  return messages;
}

async function buildMessages(locale: Locale): Promise<Messages> {
  const base = (await import("../../messages/fr.json")).default as Tree;
  if (locale === "fr") return base as Messages;
  const own =
    locale === "ar"
      ? (await import("../../messages/ar.json")).default
      : (await import("../../messages/rif.json")).default;
  return mergeMessages(base, own as Tree) as Messages;
}
