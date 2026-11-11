import { describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/http/errors";
import { completeMetaSignup, metaSignupConfig, metaSignupRequestSchema } from "@/lib/phone-verify/meta-signup";

vi.mock("server-only", () => ({}));

const env = { META_APP_ID: "2137715150178668", WHATSAPP_SIGNUP_CONFIG_ID: "998877", WHATSAPP_APP_SECRET: "app-secret" } as unknown as ServerEnv;

function graphMock(overrides: Partial<Record<"token" | "subscribe" | "numbers", Response>> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/oauth/access_token")) return overrides.token ?? Response.json({ access_token: "business-token" });
    if (url.endsWith("/subscribed_apps")) return overrides.subscribe ?? Response.json({ success: true });
    return (
      overrides.numbers ??
      Response.json({ data: [{ id: "1510737355447981", display_phone_number: "+33 6 00 00 00 00", verified_name: "Aalan", platform_type: "CLOUD_API", is_on_biz_app: true }] })
    );
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("WhatsApp Embedded Signup (coexistence)", () => {
  it("is offered only once the app id, the configuration id and the app secret are set", () => {
    expect(metaSignupConfig(env)).toEqual({ appId: "2137715150178668", configId: "998877", graphVersion: "v27.0" });
    expect(metaSignupConfig({ ...env, WHATSAPP_SIGNUP_CONFIG_ID: undefined })).toBeNull();
    expect(metaSignupConfig({ ...env, WHATSAPP_APP_SECRET: undefined })).toBeNull();
  });

  it("accepts numeric account ids only", () => {
    expect(metaSignupRequestSchema.safeParse({ code: "c", wabaId: "2230322651698544" }).success).toBe(true);
    expect(metaSignupRequestSchema.safeParse({ code: "c", wabaId: "../me" }).success).toBe(false);
    expect(metaSignupRequestSchema.safeParse({ code: "c", wabaId: "1", extra: 1 }).success).toBe(false);
  });

  it("exchanges the code, subscribes the app and lists the numbers, without keeping the token", async () => {
    const { calls, fetchImpl } = graphMock();
    const result = await completeMetaSignup({ code: "one-time", wabaId: "2230322651698544" }, env, fetchImpl);
    expect(result).toEqual({
      wabaId: "2230322651698544",
      subscribed: true,
      numbers: [{ id: "1510737355447981", displayPhoneNumber: "+33 6 00 00 00 00", verifiedName: "Aalan", platformType: "CLOUD_API", isOnBizApp: true }],
    });
    const exchange = new URL(calls[0]!.url);
    expect(exchange.pathname).toBe("/v27.0/oauth/access_token");
    expect(Object.fromEntries(exchange.searchParams)).toEqual({ client_id: "2137715150178668", client_secret: "app-secret", code: "one-time" });
    expect(calls[1]).toMatchObject({ url: "https://graph.facebook.com/v27.0/2230322651698544/subscribed_apps", init: { method: "POST", headers: { authorization: "Bearer business-token" } } });
    expect(calls[2]!.url).toContain("/v27.0/2230322651698544/phone_numbers?fields=");
    // No /register call: a coexistence number is already registered.
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("business-token");
  });

  it("stops at the first refused step, without leaking the secret", async () => {
    const { calls, fetchImpl } = graphMock({ token: Response.json({ error: { code: 100, message: "Invalid verification code format." } }, { status: 400 }) });
    const error = await completeMetaSignup({ code: "stale", wabaId: "1" }, env, fetchImpl).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(502);
    expect((error as HttpError).details).toEqual({ step: "code exchange", detail: "HTTP 400 100 Invalid verification code format." });
    expect(JSON.stringify((error as HttpError).details)).not.toContain("app-secret");
    expect(calls).toHaveLength(1);
  });

  it("answers 503 when the configuration is missing", async () => {
    const { fetchImpl } = graphMock();
    await expect(completeMetaSignup({ code: "c", wabaId: "1" }, { ...env, META_APP_ID: undefined }, fetchImpl)).rejects.toMatchObject({ status: 503 });
  });
});
