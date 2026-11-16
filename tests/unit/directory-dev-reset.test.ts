import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/dev/directory/reset: development only (APP_ENV=dev), 404 anywhere else (e2e seeds shops
// then forgets the shared copy of the directory).

const env = { APP_ENV: "dev" as "dev" | "staging" | "prod" };
vi.mock("@/lib/env", () => ({ serverEnv: () => env }));
vi.mock("@/lib/observability/capture", () => ({ captureServerException: vi.fn() }));
vi.mock("@/lib/pro/directory", () => ({ resetDirectoryShopsCache: vi.fn() }));

const { resetDirectoryShopsCache } = await import("@/lib/pro/directory");
const { POST } = await import("@/app/api/dev/directory/reset/route");

const call = () => POST(new NextRequest("http://localhost:3000/api/dev/directory/reset", { method: "POST" }), { params: Promise.resolve({}) });

beforeEach(() => {
  env.APP_ENV = "dev";
  vi.mocked(resetDirectoryShopsCache).mockClear();
});

describe("POST /api/dev/directory/reset", () => {
  it("forgets the shared copy in development", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(resetDirectoryShopsCache).toHaveBeenCalledOnce();
  });

  it.each(["staging", "prod"] as const)("does not exist in %s", async (appEnv) => {
    env.APP_ENV = appEnv;
    const response = await call();
    expect(response.status).toBe(404);
    expect(resetDirectoryShopsCache).not.toHaveBeenCalled();
  });
});
