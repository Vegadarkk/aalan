import { beforeAll, describe, expect, it, vi } from "vitest";

// Back-office account search (B12, audit zone 7 P1-1) against the Firebase emulators: by e-mail,
// verified phone, name prefix, profile id and listing reference; identity lookups are audited
// without the value searched.

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/alert", () => ({ alert: vi.fn(async () => true) }));

import { POST as create } from "@/app/api/listings/route";
import type { CreateListingResponse } from "@/lib/contracts/listings";
import { searchAccounts } from "@/lib/decisions/account-search";
import { COLLECTIONS } from "@/lib/db/schemas";
import { resetServerEnv } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { api, freshPhone, member, type Member } from "../listings/helpers";
import { audits, staff, type Staff } from "./decisions/helpers";

let moderator: Staff;
let salma: Member;
let phone: string;
const tag = Date.now().toString(36).replace(/\d/g, "x");
const name = `Zelda ${tag}`;

beforeAll(async () => {
  resetServerEnv();
  moderator = await staff("moderator");
  phone = freshPhone();
  salma = await member({ phone, displayName: name });
});

const searcher = () => ({ uid: moderator.uid, role: "moderator" as const });

describe("account search", () => {
  it("finds an account by e-mail and audits the lookup without the address", async () => {
    const hits = await searchAccounts(searcher(), salma.email.toUpperCase());
    expect(hits).toEqual([expect.objectContaining({ uid: salma.uid, displayName: name, status: "active", matched: ["email"] })]);
    const entries = await audits("account.search.email", salma.uid);
    expect(entries).toEqual([expect.objectContaining({ actorUid: moderator.uid, actorRole: "moderator" })]);
    expect(JSON.stringify(entries)).not.toContain(salma.email);
  });

  it("finds an account by its verified phone, typed in the national form", async () => {
    const national = `0${phone.slice(4)}`.replace(/(\d{2})(?=\d)/g, "$1 ");
    const hits = await searchAccounts(searcher(), national);
    expect(hits.map((hit) => hit.uid)).toEqual([salma.uid]);
    expect(await audits("account.search.phone", salma.uid)).toHaveLength(1);
  });

  it("finds accounts by the start of their name, as typed or lower-cased", async () => {
    expect((await searchAccounts(searcher(), `Zelda ${tag.slice(0, 3)}`)).map((hit) => hit.uid)).toContain(salma.uid);
    expect((await searchAccounts(searcher(), `zelda ${tag}`)).map((hit) => hit.uid)).toContain(salma.uid);
  });

  it("finds the account behind a profile id and behind a listing", async () => {
    const user = await db().collection(COLLECTIONS.users).doc(salma.uid).get();
    const publicId = String(user.get("publicId"));
    expect((await searchAccounts(searcher(), `https://aalan.ma/fr/profil/${publicId}`)).map((hit) => hit.matched)).toEqual([["profile"]]);
    const created = await api<CreateListingResponse>(create, "POST", "/api/listings", { member: salma, body: {} });
    expect(created.status).toBe(201);
    const hits = await searchAccounts(searcher(), `https://aalan.ma/fr/annonce/velo-casablanca-${created.body.id}`);
    expect(hits).toEqual([expect.objectContaining({ uid: salma.uid, matched: ["listing"] })]);
  });

  it("answers nothing for an unknown e-mail", async () => {
    expect(await searchAccounts(searcher(), `nobody-${tag}@example.com`)).toEqual([]);
  });
});
