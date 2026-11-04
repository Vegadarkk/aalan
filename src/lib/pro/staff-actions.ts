import "server-only";
import { audit } from "@/lib/audit";
import type { StaffContext } from "@/lib/auth/guards";
import { PRO_NOTES_KEPT, type ProLifecycleAction, type ProLifecycleResponse, type ProStaffNoteView } from "@/lib/contracts/pro";
import { getProProfile, proProfileRef, proProfileToFirestore, type ProProfileRecord } from "@/lib/db/repositories/pro-profiles";
import { getStaff } from "@/lib/db/repositories/staff";
import { db } from "@/lib/firebase/admin";
import { HttpError, notFound } from "@/lib/http/errors";
import { storefrontSegment } from "@/lib/listings/public";
import { revalidateListingPaths } from "@/lib/listings/revalidate";
import { consume } from "@/lib/quota";
import type { RequestIdentity } from "@/lib/rate-limit/keys";
import { publishesAsPro, storefrontShown } from "./lifecycle";
import type { ProProfileDoc, ProSector } from "./profile-schema";
import { correctableSectors } from "./review";

// Staff actions on a validated shop (zone 7 audit P2-10): an internal note, and the correction of
// its activity (the sectors whose commitments the owner accepted, as at the verification, B13).
// One transaction on the profile; the audit entry carries the text; a corrected activity also
// leaves a note on the record and refreshes the storefront. Suspension and closure are motivated
// decisions on the owner's account (src/lib/decisions), with the statement of reasons and appeal.

const SECTOR_LABEL: Record<ProSector, string> = {
  general: "Commerce et services",
  dealer: "Concession automobile",
  real_estate: "Agence immobilière",
  car_rental: "Location de voitures",
  holiday_rental: "Location saisonnière",
};

type Note = NonNullable<ProProfileDoc["staffNotes"]>[number];

export function notesView(notes: ProProfileDoc["staffNotes"]): ProStaffNoteView[] {
  return (notes ?? []).map((note) => ({ at: note.at.toISOString(), by: note.byName, text: note.text }));
}

/** The profile after the action: pure, so the unit tests cover every branch without Firestore. */
export function profileAfter(current: ProProfileRecord, input: ProLifecycleAction, note: Omit<Note, "text">): { doc: ProProfileDoc; sectorChange: { from: ProSector; to: ProSector } | null } {
  const { proId: _proId, ...doc } = current;
  const notes = current.staffNotes ?? [];
  if (input.action === "note") return { doc: { ...doc, staffNotes: [{ ...note, text: input.text }, ...notes].slice(0, PRO_NOTES_KEPT), updatedAt: note.at }, sectorChange: null };

  // The activity of a shop that was validated (a suspended one included: it comes back with it).
  if (current.kybc.status !== "verified" || !(publishesAsPro(current.lifecycle) || current.lifecycle === "suspended")) throw new HttpError(409, "conflict", "the shop is not validated");
  const from = current.sector ?? "general";
  if (input.sector === from) throw new HttpError(409, "conflict", "the shop already has this activity");
  if (!correctableSectors(current).includes(input.sector)) throw new HttpError(409, "commitments_required", "the owner has not accepted this sector's commitments");
  const { agency, ...rest } = doc;
  const text = `Activité corrigée : ${SECTOR_LABEL[from]} → ${SECTOR_LABEL[input.sector]}. ${input.reason}`.slice(0, 500);
  return {
    doc: {
      ...rest,
      // "general" is stored as absent (as at the verification); the fee schedule belongs to a real-estate agency only.
      sector: input.sector === "general" ? undefined : input.sector,
      ...(agency && input.sector === "real_estate" ? { agency } : {}),
      staffNotes: [{ ...note, text }, ...notes].slice(0, PRO_NOTES_KEPT),
      updatedAt: note.at,
    },
    sectorChange: { from, to: input.sector },
  };
}

/** POST /api/admin/pros/{proId}/lifecycle: a note or an activity correction, journaled. */
export async function proStaffAction(staff: StaffContext, proId: string, input: ProLifecycleAction, identity: RequestIdentity, now = new Date()): Promise<ProLifecycleResponse> {
  const member = await getStaff(staff.user.uid);
  const byName = member?.displayName ?? staff.accessEmail;
  const result = await db().runTransaction(async (tx) => {
    const current = await getProProfile(proId, tx);
    if (!current) throw notFound();
    const after = profileAfter(current, input, { at: now, by: staff.user.uid, byName });
    tx.set(proProfileRef(proId), proProfileToFirestore(after.doc));
    return { ...after, previous: current };
  });
  void consume("firestore.reads", 1);
  void consume("firestore.writes", 1);

  const { doc, sectorChange, previous } = result;
  await audit({
    actorUid: staff.user.uid,
    actorRole: staff.role,
    action: input.action === "note" ? "pro.note" : "pro.sector.correct",
    target: { type: "pro", id: proId },
    automated: false,
    reason: (input.action === "note" ? input.text : `sector ${sectorChange?.from} -> ${sectorChange?.to}: ${input.reason}`).slice(0, 500),
    ip: identity.ip,
    at: now,
  });
  if (sectorChange && storefrontShown(previous.lifecycle, previous.plan)) revalidateListingPaths({ shopSegment: storefrontSegment(previous.slug, proId) });
  return { proId, sector: doc.sector ?? "general", notes: notesView(doc.staffNotes) };
}
