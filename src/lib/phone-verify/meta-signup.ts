import "server-only";
import { z } from "@/lib/zod";
import { serverEnv, type ServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/http/errors";
import { logger } from "@/lib/logging/logger";

// Linking Aalan's WhatsApp number to the Cloud API through Meta's Embedded Signup (owner,
// 2026-11-11: the line stays in the WhatsApp Business app, "coexistence"). An admin runs the
// signup popup on admin page /parametres/whatsapp (Facebook JS SDK, flow
// "whatsapp_business_app_onboarding"); the page sends the one-time code (30 s) and the account
// ids here. The server exchanges the code for a business token with the app secret, subscribes
// the app to the account's webhooks (inbound `messages` reach /api/webhooks/whatsapp) and lists
// the account's numbers so the admin can set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_DISPLAY_NUMBER.
// The token is dropped at the end of the request: Aalan never sends messages. No /register call:
// a coexistence number is already registered.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users

export const GRAPH_VERSION = "v27.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TIMEOUT_MS = 10_000;

/** Public values the signup page needs (app id and Facebook Login for Business configuration id). */
export interface MetaSignupConfig {
  appId: string;
  configId: string;
  graphVersion: string;
}

/** Null until META_APP_ID, WHATSAPP_SIGNUP_CONFIG_ID and WHATSAPP_APP_SECRET are all set. */
export function metaSignupConfig(env: ServerEnv = serverEnv()): MetaSignupConfig | null {
  if (!env.META_APP_ID || !env.WHATSAPP_SIGNUP_CONFIG_ID || !env.WHATSAPP_APP_SECRET) return null;
  return { appId: env.META_APP_ID, configId: env.WHATSAPP_SIGNUP_CONFIG_ID, graphVersion: GRAPH_VERSION };
}

const graphId = z.string().regex(/^\d{1,32}$/);

export const metaSignupRequestSchema = z
  .object({
    code: z.string().min(1).max(2048),
    wabaId: graphId,
  })
  .strict();
export type MetaSignupRequest = z.infer<typeof metaSignupRequestSchema>;

export interface LinkedNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName?: string;
  platformType?: string;
  isOnBizApp?: boolean;
}

export interface MetaSignupResult {
  wabaId: string;
  subscribed: boolean;
  numbers: LinkedNumber[];
}

type Fetch = typeof fetch;

/** Graph error message for the logs (never the token, never the request URL). */
async function graphError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown; code?: unknown } };
    return `HTTP ${response.status} ${String(body.error?.code ?? "")} ${String(body.error?.message ?? "").slice(0, 200)}`.trim();
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function graph(fetchImpl: Fetch, step: string, url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!response.ok) {
    const detail = await graphError(response);
    logger.warn({ step, detail }, "meta embedded signup step failed");
    throw new HttpError(502, "unavailable", `Meta refused the ${step} step`, { details: { step, detail } });
  }
  return response.json();
}

const tokenSchema = z.object({ access_token: z.string().min(1) });
const subscribeSchema = z.object({ success: z.boolean() });
const numbersSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      display_phone_number: z.string(),
      verified_name: z.string().optional(),
      platform_type: z.string().optional(),
      is_on_biz_app: z.boolean().optional(),
    }),
  ),
});

/** Code exchange, webhook subscription and the account's numbers (see the header). */
export async function completeMetaSignup(request: MetaSignupRequest, env: ServerEnv = serverEnv(), fetchImpl: Fetch = fetch): Promise<MetaSignupResult> {
  const config = metaSignupConfig(env);
  if (!config || !env.WHATSAPP_APP_SECRET) throw new HttpError(503, "unavailable", "META_APP_ID, WHATSAPP_SIGNUP_CONFIG_ID and WHATSAPP_APP_SECRET are required");
  const exchange = new URL(`${GRAPH}/oauth/access_token`);
  exchange.searchParams.set("client_id", config.appId);
  exchange.searchParams.set("client_secret", env.WHATSAPP_APP_SECRET);
  exchange.searchParams.set("code", request.code);
  const token = tokenSchema.parse(await graph(fetchImpl, "code exchange", exchange.toString())).access_token;
  const auth = { authorization: `Bearer ${token}` };

  const subscribed = subscribeSchema.parse(await graph(fetchImpl, "webhook subscription", `${GRAPH}/${request.wabaId}/subscribed_apps`, { method: "POST", headers: auth })).success;
  const fields = "id,display_phone_number,verified_name,platform_type,is_on_biz_app";
  const listed = numbersSchema.parse(await graph(fetchImpl, "phone numbers", `${GRAPH}/${request.wabaId}/phone_numbers?fields=${fields}`, { headers: auth }));
  return {
    wabaId: request.wabaId,
    subscribed,
    numbers: listed.data.map((number) => ({
      id: number.id,
      displayPhoneNumber: number.display_phone_number,
      verifiedName: number.verified_name,
      platformType: number.platform_type,
      isOnBizApp: number.is_on_biz_app,
    })),
  };
}
