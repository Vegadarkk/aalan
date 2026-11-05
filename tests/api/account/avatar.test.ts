import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The member's profile photo (audit §7) on the emulators and an in-memory object store: the image
// is the body, re-encoded to two 4:5 WebP variants in the media bucket under the public id, shown by
// the storefront settings and the seller card, replaced and removed; a non-image is refused; the
// automated check refuses with a recorded decision; a moderator removes it with a statement of
// reasons; the account closure deletes it.

const sendMail = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/mail", () => ({ sendMail }));
vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => true) }));
vi.mock("@/lib/search/queue", () => ({ notifySearchIndex: vi.fn(async () => undefined) }));

import { DELETE as avatarDelete, PUT as avatarPut } from "@/app/api/account/avatar/route";
import { DELETE as staffRemoveRoute } from "@/app/api/admin/users/[uid]/avatar/route";
import { removeAvatarQuietly, updateAvatar } from "@/lib/account/avatar";
import { storefrontSettings } from "@/lib/account/storefront";
import { AVATAR_MAX_BYTES } from "@/lib/contracts/account";
import { ACCOUNT_API } from "@/lib/contracts/endpoints";
import { getUserRecord } from "@/lib/db/repositories/profiles";
import { COLLECTIONS } from "@/lib/db/schemas";
import { resetServerEnv } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { getSeller } from "@/lib/listings/public";
import { StubImageClassifier } from "@/lib/media/classify";
import { resetRateLimiters } from "@/lib/rate-limit/limiter";
import { MemoryObjectStore, resetObjectStore, setObjectStoreForTests } from "@/lib/storage";
import { adminCall, audits, staff, type Staff } from "../admin/decisions/helpers";
import { member, ORIGIN, type ErrorBody, type Member } from "../listings/helpers";

const store = new MemoryObjectStore();
let moderator: Staff;

beforeAll(async () => {
  resetServerEnv();
  setObjectStoreForTests(store);
  moderator = await staff("moderator");
});
afterAll(() => resetObjectStore());
beforeEach(() => {
  resetRateLimiters();
  store.clear();
  sendMail.mockClear();
});

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 4, background: { r: 30, g: 120, b: 90, alpha: 0.7 } } }).png().toBuffer();

function headers(who: Member, type?: string): Headers {
  const result = new Headers({ host: "localhost:3000", origin: ORIGIN, "x-forwarded-for": who.jar.ip, "user-agent": "vitest", cookie: who.jar.header() ?? "" });
  if (type) result.set("content-type", type);
  result.set("x-csrf-token", who.jar.get("__Host-csrf") ?? "");
  return result;
}

async function send(who: Member, body: Uint8Array, type: string) {
  const response = await avatarPut(new NextRequest(`${ORIGIN}${ACCOUNT_API.avatar}`, { method: "PUT", headers: headers(who, type), body: new Blob([new Uint8Array(body)]) }), { params: Promise.resolve({}) });
  return { status: response.status, body: (await response.json()) as { avatar: string | null } & ErrorBody };
}

async function remove(who: Member) {
  const response = await avatarDelete(new NextRequest(`${ORIGIN}${ACCOUNT_API.avatar}`, { method: "DELETE", headers: headers(who) }), { params: Promise.resolve({}) });
  return { status: response.status, body: (await response.json()) as { avatar: string | null } & ErrorBody };
}

const mediaKeys = () => store.keys("media").sort();

describe("profile photo", () => {
  it("stores two 4:5 WebP variants under the public id, shows them, replaces and removes them", async () => {
    const someone = await member();
    const publicId = (await getUserRecord(someone.uid))!.publicId;

    const first = await send(someone, await png(1200, 600), "image/png");
    expect(first.status).toBe(200);
    expect(first.body.avatar).toMatch(new RegExp(`avatars/${publicId}/a-[a-z0-9]+-l\\.webp$`));
    const keys = mediaKeys();
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      const meta = await sharp(Buffer.from((await store.get("media", key))!)).metadata();
      const large = key.endsWith("-l.webp");
      expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(["webp", large ? 320 : 128, large ? 400 : 160, false]);
    }
    const user = await getUserRecord(someone.uid);
    expect(storefrontSettings(user!).avatar).toBe(first.body.avatar);
    expect((await getSeller(someone.uid))?.avatar?.large).toBe(first.body.avatar);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await send(someone, await png(400, 500), "image/png");
    expect(second.status).toBe(200);
    expect(second.body.avatar).not.toBe(first.body.avatar);
    expect(mediaKeys()).toHaveLength(2);
    expect(mediaKeys().every((key) => !keys.includes(key))).toBe(true);

    const removed = await remove(someone);
    expect([removed.status, removed.body.avatar]).toEqual([200, null]);
    expect(mediaKeys()).toHaveLength(0);
    expect((await getUserRecord(someone.uid))?.avatarKey).toBeUndefined();
    expect((await getSeller(someone.uid))?.avatar).toBeNull();
  });

  it("refuses a body that is not an image, a lying type and an oversized body", async () => {
    const someone = await member();
    const text = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect((await send(someone, text, "image/svg+xml")).body.error.code).toBe("unsupported_media");
    expect((await send(someone, text, "image/png")).body.error.code).toBe("unsupported_media");
    const huge = new Uint8Array(AVATAR_MAX_BYTES + 1);
    huge.set(await png(10, 10));
    const tooLarge = await send(someone, huge, "image/png");
    expect([tooLarge.status, tooLarge.body.error.code]).toEqual([413, "file_too_large"]);
    expect(mediaKeys()).toHaveLength(0);
  });

  it("refuses a photo flagged by the image check and records the decision", async () => {
    const someone = await member();
    await expect(updateAvatar(someone.uid, await png(300, 300), "image/png", { store, classifier: new StubImageClassifier({ nsfw: 0.99, faces: 0 }) })).rejects.toMatchObject({ status: 422, code: "image_refused" });
    expect(mediaKeys()).toHaveLength(0);
    const decisions = await db().collection(COLLECTIONS.moderationDecisions).where("affectedUid", "==", someone.uid).get();
    expect(decisions.docs.map((doc) => [doc.get("target.type"), doc.get("templateId")])).toEqual([["user", "photoRejectedNsfw"]]);
  });

  it("is removed by a moderator with a statement of reasons, mailed and audited", async () => {
    const someone = await member();
    expect((await send(someone, await png(300, 400), "image/png")).status).toBe(200);
    const path = `/api/admin/users/${someone.uid}/avatar`;
    expect((await adminCall(staffRemoveRoute, "DELETE", path, { as: moderator, params: { uid: someone.uid }, body: { details: "court" } })).status).toBe(400);
    expect((await adminCall(staffRemoveRoute, "DELETE", path, { params: { uid: someone.uid }, body: { details: "Photo d'une autre personne" } })).status).toBe(401);

    const removed = await adminCall(staffRemoveRoute, "DELETE", path, { as: moderator, params: { uid: someone.uid }, body: { details: "Photo d'une autre personne, signalée par elle." } });
    expect(removed.status).toBe(204);
    expect(mediaKeys()).toHaveLength(0);
    expect((await getUserRecord(someone.uid))?.avatarKey).toBeUndefined();
    const decisions = await db().collection(COLLECTIONS.moderationDecisions).where("affectedUid", "==", someone.uid).get();
    expect(decisions.docs.map((doc) => [doc.get("templateId"), doc.get("action"), doc.get("decidedBy")])).toEqual([["user.avatar.remove", "remove", moderator.uid]]);
    expect(decisions.docs[0]!.get("facts")).toContain("signalée par elle");
    expect(await audits("user.avatar_removed", someone.uid)).toEqual([expect.objectContaining({ actorUid: moderator.uid, automated: false })]);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ template: "decisionNotice" }));

    expect((await adminCall(staffRemoveRoute, "DELETE", path, { as: moderator, params: { uid: someone.uid }, body: { details: "Une deuxième fois, déjà retirée." } })).status).toBe(409);
  });

  it("is deleted with the account (closure step)", async () => {
    const someone = await member();
    expect((await send(someone, await png(300, 400), "image/png")).status).toBe(200);
    await removeAvatarQuietly(someone.uid);
    expect(mediaKeys()).toHaveLength(0);
    // Nothing left: a second call is a no-op, never an error.
    await removeAvatarQuietly(someone.uid);
  });
});
