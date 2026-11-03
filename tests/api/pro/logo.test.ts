import { randomInt } from "node:crypto";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The shop's logo (UX audit of the Pro shops, lot 3) on the emulators and an in-memory object
// store: the owner sends the image as the body, it is re-encoded to two WebP squares in the media
// bucket, the shop card and the storefront show it, a new one replaces the previous variants, a
// non-image or an oversized body is refused before anything is stored, the automated check
// refuses with a recorded decision, and DELETE goes back to the emblem.

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));

import { DELETE as logoDelete, PUT as logoPut } from "@/app/api/pro/me/logo/route";
import { DEFAULT_PRICING } from "@/config/pricing";
import type { AuthContext } from "@/lib/auth/guards";
import { LOGO_MAX_BYTES, PRO_API } from "@/lib/contracts/pro";
import { getProProfile, proProfileRef, proProfileToFirestore } from "@/lib/db/repositories/pro-profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { resetServerEnv } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { setClaims } from "@/lib/firebase/claims";
import { createSessionForUid } from "@/lib/firebase/session";
import { getPublicStorefront } from "@/lib/listings/public";
import { StubImageClassifier } from "@/lib/media/classify";
import { updateLogo } from "@/lib/pro/logo";
import type { ProProfileDoc } from "@/lib/pro/profile-schema";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { csrfToken } from "@/lib/security/csrf";
import { MemoryObjectStore, resetObjectStore, setObjectStoreForTests } from "@/lib/storage";
import { freshPhone, member, ORIGIN, type ErrorBody, type Member } from "../listings/helpers";

const store = new MemoryObjectStore();
const PRO_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newProId = () => Array.from({ length: 8 }, () => PRO_ID_ALPHABET[randomInt(PRO_ID_ALPHABET.length)]).join("");

beforeAll(() => {
  resetServerEnv();
  setObjectStoreForTests(store);
});
afterAll(() => resetObjectStore());
beforeEach(() => {
  resetRateLimiters();
  store.clear();
});

async function shop(owner: Member): Promise<string> {
  const proId = newProId();
  const now = new Date();
  const profile: ProProfileDoc = {
    ownerUid: owner.uid,
    members: { [owner.uid]: "owner" },
    name: "Maison Lalla",
    slug: "maison-lalla",
    description: "Babouches et caftans cousus main.",
    whatsapp: false,
    regionCode: "06",
    citySlug: "casablanca",
    legal: { form: "societe", ice: "001234567000089", rc: "12345", if: "1234567" },
    kybc: { status: "verified", iceFormatOk: true, uploadIds: [] },
    lifecycle: "verified",
    plan: "essentiel",
    planSource: "launch_offer",
    quotas: DEFAULT_PRICING.pro.essentiel,
    createdAt: now,
    updatedAt: now,
  };
  await proProfileRef(proId).set(proProfileToFirestore(profile));
  await db().collection(COLLECTIONS.users).doc(owner.uid).update({ proId });
  await setClaims(owner.uid, { role: "pro", proId, proRole: "owner", v: 2 });
  const minted = await createSessionForUid(owner.uid);
  owner.jar.cookies.set("__Host-session", minted.cookie);
  owner.jar.cookies.set("__Host-csrf", csrfToken(minted.cookie));
  return proId;
}

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 4, background: { r: 200, g: 90, b: 40, alpha: 0.8 } } }).png().toBuffer();

async function send(owner: Member, body: Uint8Array, type: string) {
  const headers = new Headers({ host: "localhost:3000", origin: ORIGIN, "x-forwarded-for": owner.jar.ip, "user-agent": "vitest", "content-type": type, cookie: owner.jar.header() ?? "" });
  headers.set("x-csrf-token", owner.jar.get("__Host-csrf") ?? "");
  const response = await logoPut(new NextRequest(`${ORIGIN}${PRO_API.logo}`, { method: "PUT", headers, body: new Blob([new Uint8Array(body)]) }), { params: Promise.resolve({}) });
  return { status: response.status, body: (await response.json()) as { logo: string | null } & ErrorBody };
}

async function remove(owner: Member) {
  const headers = new Headers({ host: "localhost:3000", origin: ORIGIN, "x-forwarded-for": owner.jar.ip, "user-agent": "vitest", cookie: owner.jar.header() ?? "" });
  headers.set("x-csrf-token", owner.jar.get("__Host-csrf") ?? "");
  const response = await logoDelete(new NextRequest(`${ORIGIN}${PRO_API.logo}`, { method: "DELETE", headers }), { params: Promise.resolve({}) });
  return { status: response.status, body: (await response.json()) as { logo: string | null } & ErrorBody };
}

const mediaKeys = () => store.keys("media").sort();

describe("shop logo", () => {
  it("stores two WebP squares, shows them, replaces and removes them", async () => {
    const owner = await member({ phone: freshPhone() });
    const proId = await shop(owner);

    const first = await send(owner, await png(900, 300), "image/png");
    expect(first.status).toBe(200);
    expect(first.body.logo).toMatch(new RegExp(`shops/${proId}/logo-[a-z0-9]+-l\\.webp$`));
    const keys = mediaKeys();
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      const meta = await sharp(Buffer.from((await store.get("media", key))!)).metadata();
      expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(["webp", key.endsWith("-l.webp") ? 512 : 160, key.endsWith("-l.webp") ? 512 : 160, true]);
    }
    const profile = await getProProfile(proId);
    expect(profile?.logoKey).toMatch(/^shops\/[a-z0-9]{8}\/logo-[a-z0-9]+$/);
    expect((await getPublicStorefront(proId))?.logo).toBe(first.body.logo);

    // A new logo replaces the previous variants (a later version key).
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await send(owner, await png(400, 400), "image/png");
    expect(second.status).toBe(200);
    expect(second.body.logo).not.toBe(first.body.logo);
    expect(mediaKeys()).toHaveLength(2);
    expect(mediaKeys().every((key) => !keys.includes(key))).toBe(true);

    const removed = await remove(owner);
    expect([removed.status, removed.body.logo]).toEqual([200, null]);
    expect(mediaKeys()).toHaveLength(0);
    expect((await getProProfile(proId))?.logoKey).toBeUndefined();
  });

  it("refuses a body that is not an image, a lying type and an oversized body", async () => {
    const owner = await member({ phone: freshPhone() });
    await shop(owner);
    const text = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect((await send(owner, text, "image/svg+xml")).body.error.code).toBe("unsupported_media");
    expect((await send(owner, text, "image/png")).body.error.code).toBe("unsupported_media");
    const jpegAsPng = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    expect((await send(owner, jpegAsPng, "image/png")).body.error.code).toBe("unsupported_media");
    const huge = new Uint8Array(LOGO_MAX_BYTES + 1);
    huge.set(await png(10, 10));
    const tooLarge = await send(owner, huge, "image/png");
    expect([tooLarge.status, tooLarge.body.error.code]).toEqual([413, "file_too_large"]);
    expect(mediaKeys()).toHaveLength(0);
  });

  it("refuses a logo flagged by the image check and records the decision", async () => {
    const owner = await member({ phone: freshPhone() });
    const proId = await shop(owner);
    const auth = { user: { uid: owner.uid, claims: { role: "pro", proId, proRole: "owner" } } } as unknown as AuthContext;
    await expect(updateLogo(auth, await png(300, 300), "image/png", { store, classifier: new StubImageClassifier({ nsfw: 0.99, faces: 0 }) })).rejects.toMatchObject({ status: 422, code: "image_refused" });
    expect(mediaKeys()).toHaveLength(0);
    const decisions = await db().collection(COLLECTIONS.moderationDecisions).where("target.id", "==", proId).get();
    expect(decisions.docs.map((doc) => doc.get("target.type"))).toEqual(["shop_logo"]);
  });

  it("is for the owner of a publishing shop only", async () => {
    const someone = await member({ phone: freshPhone() });
    const refused = await send(someone, await png(50, 50), "image/png");
    expect(refused.status).toBe(409);
  });
});
