// Shared Intl formatters. Building one costs 15 to 65 µs (locale data lookup); formatting with it
// about 1 µs. A grid of 24 cards built 24 of them per render; the public pages now reuse one per
// locale, time zone and shape. Pure functions aside from the cache, safe in the browser too (the
// listing formats run in client components as well).

const formats = new Map<string, object>();

/**
 * The formatter of `key`, built by `create` on first use. The key must name everything the formatter
 * depends on (its locale, its time zone, the call site's options): "card-date|fr-MA|UTC".
 */
export function sharedFormat<T extends object>(key: string, create: () => T): T {
  let format = formats.get(key) as T | undefined;
  if (!format) {
    format = create();
    formats.set(key, format);
  }
  return format;
}
