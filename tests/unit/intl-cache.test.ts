import { _createCache, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import requestConfig from "@/i18n/request";

// The compiler replaces next/root-params in the app; the request config only reads it for an
// unknown locale. Outside a React Server Components bundle, next-intl's getRequestConfig throws:
// the server one returns the given function.
vi.mock("next/root-params", () => ({ locale: async () => undefined }));
vi.mock("next-intl/server", () => ({ getRequestConfig: (create: unknown) => create }));

// src/i18n/request.ts shares one formatter cache between requests: the parsed message formats
// must come back from it, and the request config must carry it (next-intl's createTranslator
// takes `_cache`; its getRequestConfig passes unknown keys through).

describe("shared intl cache", () => {
  const messages = { A: { hello: "Hello {name}", plain: "Plain" } };

  it("serves the parsed message format of one translator to the next", () => {
    const cache = _createCache();
    const first = createTranslator({ locale: "fr", messages, namespace: "A", _cache: cache });
    expect(first("hello", { name: "x" })).toBe("Hello x");
    expect(first("plain")).toBe("Plain");
    const keys = Object.keys(cache.message);
    expect(keys).toHaveLength(1);
    // Another request: new formatters, the same cache. The entry is reused as is.
    cache.message[keys[0] as string] = { format: () => "from the cache" } as never;
    const second = createTranslator({ locale: "fr", messages, namespace: "A", _cache: cache });
    expect(second("hello", { name: "x" })).toBe("from the cache");
  });

  it("is part of the request config, once per process", async () => {
    const params = { locale: "fr" as const, requestLocale: Promise.resolve("fr") };
    const [first, second] = await Promise.all([requestConfig(params), requestConfig(params)]);
    const cache = (first as { _cache?: unknown })._cache;
    expect(cache).toMatchObject({ message: {}, number: {}, dateTime: {} });
    expect((second as { _cache?: unknown })._cache).toBe(cache);
    expect(first.locale).toBe("fr");
    expect(first.timeZone).toBe("Africa/Casablanca");
  });
});
