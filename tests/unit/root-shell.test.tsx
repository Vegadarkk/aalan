import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as NextIntl from "next-intl";
import { describe, expect, it, vi } from "vitest";

// The <html> shell of both localized root layouts: the footer © line follows the live
// config/legal (getLegalConfig, cached 5 minutes), not the built-in defaults. The client
// providers, header, CGU notice, fonts and footer are stubbed (they have their own tests).

const getLegalConfig = vi.hoisted(() => vi.fn(async () => ({ companyName: "Société Test" })));
vi.mock("@/lib/legal/config", () => ({ getLegalConfig }));
vi.mock("@/lib/fonts", () => ({ readex: { variable: "font-readex" }, tarifitFallback: { variable: "font-tarifit" }, ruqaa: { variable: "font-ruqaa" } }));
vi.mock("@/components/layout/providers", () => ({ Providers: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/layout/site-header", () => ({ SiteHeader: () => <header /> }));
vi.mock("@/components/legal/cgu-notice", () => ({ CguNotice: () => null }));
vi.mock("@/components/legal/footer", () => ({
  Footer: ({ publisher, prefetch }: { publisher: string; prefetch?: boolean }) => <footer data-publisher={publisher} data-prefetch={String(prefetch)} />,
}));
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof NextIntl>()),
  NextIntlClientProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getMessages: async () => ({}),
}));

const { RootShell } = await import("@/components/layout/root-shell");

describe("RootShell", () => {
  it("renders the footer with the live config/legal trade name", async () => {
    const html = renderToStaticMarkup(await RootShell({ locale: "fr", children: <p>page</p> }));
    expect(getLegalConfig).toHaveBeenCalled();
    expect(html).toContain('<footer data-publisher="Société Test" data-prefetch="true">');
    expect(html).toContain("<p>page</p>");
  });

  it("turns the footer's prefetch off under the private root layout (its links lead to the other root layout)", async () => {
    const config = {} as NonNullable<Parameters<typeof RootShell>[0]["config"]>;
    const html = renderToStaticMarkup(await RootShell({ locale: "fr", nonce: "n", config, children: <p>page</p> }));
    expect(html).toContain('data-prefetch="false"');
  });
});
