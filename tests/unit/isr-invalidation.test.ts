import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import {
  decodeMessage,
  encodeMessage,
  expirePaths,
  implicitTag,
  ISR_CHANNEL,
  ISR_MESSAGE_MAX_PATHS,
  listen,
  manifestOf,
  TAGS_MANIFEST_MODULE,
  type Subscriber,
  type TagsManifest,
} from "@/server/isr-invalidation";

// Cross-process ISR invalidation (src/server/isr-invalidation.ts): the channel message, the tags
// revalidatePath expires, and the installed Next runtime's tag manifest that each web process feeds.

const PAGE = "/fr/annonce/velo-casablanca-abcd2345";

describe("ISR channel messages", () => {
  it("carry public page paths only, bounded", () => {
    const paths = [PAGE, "/ar/profil/k7m2p9q4r8", "/rif/boutique/atlas-auto-k7m2p9q4", "/api/admin/exports", "/fr/annonce/../../x", 42];
    expect(decodeMessage(encodeMessage(paths as string[]))).toEqual([PAGE, "/ar/profil/k7m2p9q4r8", "/rif/boutique/atlas-auto-k7m2p9q4"]);
    expect(decodeMessage(JSON.stringify({ paths: Array.from({ length: 100 }, () => PAGE) }))).toHaveLength(ISR_MESSAGE_MAX_PATHS);
    for (const raw of ["", "null", "{}", '{"paths":"x"}', "not json"]) expect(decodeMessage(raw)).toEqual([]);
  });

  it("name the implicit tag revalidatePath expires", () => {
    expect(implicitTag(PAGE)).toBe(`_N_T_${PAGE}`);
    expect(implicitTag(`${PAGE}/`)).toBe(`_N_T_${PAGE}`);
    expect(implicitTag("/fr/annonce/vélo-x")).toBe("_N_T_/fr/annonce/v%C3%A9lo-x");
  });

  it("expire the pages' tags at the given time, keeping the entry's other fields", () => {
    const manifest: TagsManifest = new Map([[implicitTag(PAGE), { stale: 5 }]]);
    expect(expirePaths(manifest, [PAGE, "/x"], 1_000)).toBe(1);
    expect(manifest.get(implicitTag(PAGE))).toEqual({ stale: 5, expired: 1_000 });
  });

  it("are heard on the channel only, and a channel error is logged once a minute", async () => {
    const handlers: { message?: (channel: string, message: string) => void; error?: (error: Error) => void } = {};
    const subscriber: Subscriber = {
      on: ((event: "message" | "error", listener: never) => {
        handlers[event] = listener;
      }) as Subscriber["on"],
      subscribe: vi.fn(async () => 1),
    };
    const manifest: TagsManifest = new Map();
    const log = vi.fn();
    await listen(subscriber, manifest, log);
    expect(subscriber.subscribe).toHaveBeenCalledWith(ISR_CHANNEL);
    handlers.message?.("msg:events:u1", encodeMessage([PAGE]));
    expect(manifest.size).toBe(0);
    handlers.message?.(ISR_CHANNEL, encodeMessage([PAGE]));
    expect(manifest.get(implicitTag(PAGE))?.expired).toEqual(expect.any(Number));
    handlers.error?.(new Error("down"));
    handlers.error?.(new Error("down"));
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("the installed Next runtime", () => {
  it("exposes the tag manifest its cache reads, and an expired page tag makes a cached page miss", () => {
    const required = createRequire(import.meta.url);
    const manifest = manifestOf(required(TAGS_MANIFEST_MODULE));
    expect(manifest).not.toBeNull();
    const { areTagsExpired } = required(TAGS_MANIFEST_MODULE) as { areTagsExpired: (tags: string[], timestamp: number) => boolean };
    const path = "/fr/annonce/test-isr-abcd2345";
    const renderedAt = Date.now() - 10_000;
    expect(areTagsExpired([implicitTag(path)], renderedAt)).toBe(false);
    expirePaths(manifest!, [path]);
    expect(areTagsExpired([implicitTag(path)], renderedAt)).toBe(true);
    // A page rendered after the invalidation is served again.
    expect(areTagsExpired([implicitTag(path)], Date.now() + 1_000)).toBe(false);
  });

  it("names the page's own path among the implicit tags of its cached entry", () => {
    const required = createRequire(import.meta.url);
    const { NEXT_CACHE_IMPLICIT_TAG_ID } = required("next/dist/lib/constants") as { NEXT_CACHE_IMPLICIT_TAG_ID: string };
    expect(implicitTag(PAGE).startsWith(NEXT_CACHE_IMPLICIT_TAG_ID)).toBe(true);
  });
});
