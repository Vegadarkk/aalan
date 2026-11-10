import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fr from "../../messages/fr.json";
import {
  CATEGORY_PAGE_CLIENT_NAMESPACES,
  CARRIERS_PAGE_CLIENT_NAMESPACES,
  GUIDE_PAGE_CLIENT_NAMESPACES,
  HELP_PAGE_CLIENT_NAMESPACES,
  HOME_PAGE_CLIENT_NAMESPACES,
  LAYOUT_CLIENT_NAMESPACES,
  LISTING_PAGE_CLIENT_NAMESPACES,
  pickMessages,
  PROFILE_PAGE_CLIENT_NAMESPACES,
  SEARCH_PAGE_CLIENT_NAMESPACES,
  STOREFRONT_PAGE_CLIENT_NAMESPACES,
} from "@/i18n/client-messages";

// The public layout ships LAYOUT_CLIENT_NAMESPACES to the browser and each public page provides
// its own list in a nested provider (which replaces, never merges). A client component that reads
// a namespace missing from the provider above it would show raw keys: this walks the import graph
// of every public route file (static and dynamic imports, from each "use client" boundary down)
// and checks each list against the namespaces the modules under its provider read, both ways.

const SRC = path.resolve(__dirname, "../../src");
const PUBLIC = path.join(SRC, "app/[locale]/(public)");

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const IMPORT = /(?:import|export)\s+(type\s+)?[^"';]*?\sfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/gm;

/** Client modules reachable from `entries`: each "use client" module and everything it imports. */
function clientModules(entries: string[]): Set<string> {
  const modules = new Set<string>();
  const seen = new Set<string>();
  const stack: Array<[string, boolean]> = entries.map((file) => [file, false]);
  while (stack.length > 0) {
    const [file, importedByClient] = stack.pop()!;
    const text = readFileSync(file, "utf8");
    const client = importedByClient || /^\s*["']use client["']/.test(text);
    const key = `${file}|${client}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (client) modules.add(file);
    for (const match of text.matchAll(IMPORT)) {
      if (match[1]) continue; // import type: erased
      const resolved = resolveImport(file, match[2] ?? match[3] ?? match[4] ?? "");
      if (resolved) stack.push([resolved, client]);
    }
  }
  return modules;
}

/** The wrapper of useTranslations (src/i18n/numbers.ts): its callers name the namespaces. */
const WRAPPER = path.join(SRC, "i18n/numbers.ts");

/** Namespaces read by useTranslations (or useNumbersTranslations) in client modules reachable from `entries`, with their readers. */
function clientNamespaces(entries: string[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of clientModules(entries)) {
    if (file === WRAPPER) continue;
    for (const match of readFileSync(file, "utf8").matchAll(/use(?:Numbers)?Translations\(([^)]*)\)/g)) {
      const literal = /^\s*"([^"]+)"\s*$/.exec(match[1] ?? "");
      const namespace = literal?.[1] ?? `<not a literal: ${match[1]}>`;
      if (!found.has(namespace)) found.set(namespace, new Set());
      found.get(namespace)!.add(path.relative(SRC, file));
    }
  }
  return found;
}

const covers = (entry: string, namespace: string) => namespace === entry || namespace.startsWith(`${entry}.`);
const lookup = (tree: unknown, dotted: string) => dotted.split(".").reduce<unknown>((node, key) => (typeof node === "object" && node !== null ? (node as Record<string, unknown>)[key] : undefined), tree);

interface Provider {
  name: string;
  list: readonly string[];
  /** Route files (relative to the public segment) rendered under this provider; a directory covers everything in it. */
  routes: string[];
}

/** The page providers (PageMessages), mirroring the pages; every other route file renders under the layout's provider. */
const PAGE_PROVIDERS: Provider[] = [
  { name: "HOME_PAGE_CLIENT_NAMESPACES", list: HOME_PAGE_CLIENT_NAMESPACES, routes: ["page.tsx"] },
  { name: "SEARCH_PAGE_CLIENT_NAMESPACES", list: SEARCH_PAGE_CLIENT_NAMESPACES, routes: ["recherche/page.tsx"] },
  { name: "LISTING_PAGE_CLIENT_NAMESPACES", list: LISTING_PAGE_CLIENT_NAMESPACES, routes: ["annonce/[slugId]/page.tsx"] },
  { name: "CATEGORY_PAGE_CLIENT_NAMESPACES", list: CATEGORY_PAGE_CLIENT_NAMESPACES, routes: ["c/[category]/[[...rest]]/page.tsx"] },
  { name: "STOREFRONT_PAGE_CLIENT_NAMESPACES", list: STOREFRONT_PAGE_CLIENT_NAMESPACES, routes: ["boutique/[shop]/page.tsx"] },
  { name: "PROFILE_PAGE_CLIENT_NAMESPACES", list: PROFILE_PAGE_CLIENT_NAMESPACES, routes: ["profil/[publicId]/page.tsx"] },
  { name: "GUIDE_PAGE_CLIENT_NAMESPACES", list: GUIDE_PAGE_CLIENT_NAMESPACES, routes: ["demarches/page.tsx"] },
  { name: "CARRIERS_PAGE_CLIENT_NAMESPACES", list: CARRIERS_PAGE_CLIENT_NAMESPACES, routes: ["transporteurs/page.tsx"] },
  // The help centre's layout wraps every page under it.
  { name: "HELP_PAGE_CLIENT_NAMESPACES", list: HELP_PAGE_CLIENT_NAMESPACES, routes: ["aide/"] },
];
const LAYOUT: Provider = { name: "LAYOUT_CLIENT_NAMESPACES", list: LAYOUT_CLIENT_NAMESPACES, routes: [] };

const routeFiles = filesUnder(PUBLIC).filter((file) => /\/(page|layout|error|not-found|loading|template)\.tsx$/.test(file));
const providerOf = (file: string) => {
  const route = path.relative(PUBLIC, file);
  return PAGE_PROVIDERS.find((provider) => provider.routes.some((prefix) => (prefix.endsWith("/") ? route.startsWith(prefix) : route === prefix))) ?? LAYOUT;
};
const filesOf = (provider: Provider) => routeFiles.filter((file) => providerOf(file) === provider);

describe("public client messages", () => {
  it("finds the client islands of the public routes", () => {
    expect(routeFiles.length).toBeGreaterThan(15);
    const layout = clientNamespaces(filesOf(LAYOUT));
    for (const namespace of ["Nav", "Consent", "Error"]) expect(layout.has(namespace), namespace).toBe(true);
    const listing = clientNamespaces(filesOf(PAGE_PROVIDERS[2]!));
    for (const namespace of ["ListingPage.gallery", "ListingPage.contact"]) expect(listing.has(namespace), namespace).toBe(true);
  });

  for (const provider of [LAYOUT, ...PAGE_PROVIDERS]) {
    describe(provider.name, () => {
      const files = filesOf(provider);
      const used = clientNamespaces(files);

      it("is rendered by its routes alone", () => {
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
          const source = readFileSync(file, "utf8");
          const own = provider !== LAYOUT && (provider.routes.includes(path.relative(PUBLIC, file)) || /\/layout\.tsx$/.test(file));
          expect(source.includes(`namespaces={${provider.name}}`), path.relative(SRC, file)).toBe(own);
          if (!own) expect(source.includes("PageMessages"), path.relative(SRC, file)).toBe(false);
        }
      });

      it("covers every namespace its client components read", () => {
        const missing = [...used].filter(([namespace]) => !provider.list.some((entry) => covers(entry, namespace))).map(([namespace, readers]) => `${namespace} (${[...readers].join(", ")})`);
        expect(missing).toEqual([]);
      });

      it("names only namespaces its client components read, and that exist", () => {
        const unused = provider.list.filter((entry) => ![...used.keys()].some((namespace) => covers(entry, namespace)));
        expect(unused).toEqual([]);
        for (const entry of provider.list) expect(lookup(fr, entry), entry).toBeTypeOf("object");
      });
    });
  }

  it("ships a fraction of the catalog with the layout", () => {
    const picked = JSON.stringify(pickMessages(fr, LAYOUT_CLIENT_NAMESPACES)).length;
    expect(picked).toBeLessThan(JSON.stringify(fr).length / 4);
  });
});

describe("listing page JavaScript", () => {
  it("pulls no validation schemas (zod): client islands import paths and limits from contracts/endpoints", () => {
    const entries = ["app/[locale]/(public)/layout.tsx", "app/[locale]/(public)/annonce/[slugId]/page.tsx", "app/[locale]/(public)/aide/[slug]/page.tsx"].map((file) => path.join(SRC, file));
    const modules = clientModules(entries);
    expect(modules.has(path.join(SRC, "components/favorites/favorite-button.tsx"))).toBe(true);
    const withZod = [...modules].filter((file) => /from\s+["'](?:zod|@\/lib\/zod)["']/.test(readFileSync(file, "utf8"))).map((file) => path.relative(SRC, file));
    expect(withZod).toEqual([]);
  });
});

describe("pickMessages", () => {
  const messages = { A: { x: "1", y: { z: "2" } }, B: { w: "3" }, C: "4" };

  it("keeps the named subtrees, merged under their parents", () => {
    expect(pickMessages(messages, ["A.y", "A.x", "C"])).toEqual({ A: { x: "1", y: { z: "2" } }, C: "4" });
    expect(pickMessages(messages, ["B"])).toEqual({ B: { w: "3" } });
  });

  it("skips unknown paths", () => {
    expect(pickMessages(messages, ["D", "A.q", "C.x"])).toEqual({});
  });

  it("shares the catalog's subtrees, so a page's and the layout's messages travel once", () => {
    const picked = pickMessages(messages, ["A.y", "B"]);
    expect(picked.B).toBe(messages.B);
    expect((picked.A as typeof messages.A).y).toBe(messages.A.y);
  });
});
