import { describe, expect, it, vi } from "vitest";

// The shared copy of the shop directory lives on globalThis: route handlers and pages load
// src/lib/pro/directory.ts as separate module instances, and a reset from one (a shop verified in
// the back office) must reach the copy the other reads.

const get = vi.fn(async () => ({ size: 0, docs: [] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({
  isFirebaseConfigured: () => true,
  db: () => ({ collection: () => ({ where: () => ({ limit: () => ({ get }) }) }), getAll: vi.fn(async () => []) }),
}));
vi.mock("@/lib/quota", () => ({ consume: vi.fn(async () => undefined) }));
vi.mock("@/lib/quota/gate", () => ({ assertQuotas: vi.fn(async () => undefined), PUBLIC_READ_QUOTAS: [] }));

async function freshInstance() {
  vi.resetModules();
  return import("@/lib/pro/directory");
}

describe("directoryShops shared copy", () => {
  it("is one copy across module instances, and a reset from one reaches the other", async () => {
    const page = await freshInstance();
    const route = await freshInstance();
    expect(page).not.toBe(route);
    page.resetDirectoryShopsCache();
    get.mockClear();

    await page.directoryShops(1_000);
    await route.directoryShops(2_000);
    expect(get).toHaveBeenCalledTimes(1);

    route.resetDirectoryShopsCache();
    await page.directoryShops(3_000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reads again after 5 minutes", async () => {
    const directory = await freshInstance();
    directory.resetDirectoryShopsCache();
    get.mockClear();
    await directory.directoryShops(0);
    await directory.directoryShops(5 * 60_000 - 1);
    expect(get).toHaveBeenCalledTimes(1);
    await directory.directoryShops(5 * 60_000);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
