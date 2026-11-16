import "server-only";
import { getProProfile } from "@/lib/db/repositories/pro-profiles";
import { getUserRecord, type UserRecord } from "@/lib/db/repositories/profiles";
import { getUserPrivate } from "@/lib/db/repositories/users";
import { getSuspension, type DecisionRecord } from "./repository";
import { standingSuspension, type StandingSuspension } from "./sanctions";

// What the reviewer of an appeal sees of the affected account next to the form: its status, a
// closure, another suspension that stands whatever the outcome, and the shop's lifecycle. A
// reversal restores only what these allow (decide.ts), and the warnings say so before it is posted.

export interface AppealAccountState {
  status: UserRecord["status"] | "missing";
  closed: boolean;
  /** The account's current suspension record (its end). */
  suspendedUntil: Date | null;
  /** Another suspension decision that keeps running if this one is reversed. */
  otherSuspension: StandingSuspension | null;
  shopLifecycle: string | null;
}

export async function appealAccountState(decision: Pick<DecisionRecord, "id" | "affectedUid">, now = new Date()): Promise<AppealAccountState> {
  const uid = decision.affectedUid;
  const [owner, account, suspension, otherSuspension] = await Promise.all([getUserRecord(uid), getUserPrivate(uid), getSuspension(uid), standingSuspension(uid, decision.id, now)]);
  const shop = owner?.proId ? await getProProfile(owner.proId) : null;
  return {
    status: owner?.status ?? "missing",
    closed: account?.closedAt !== undefined || owner?.status === "closed",
    suspendedUntil: suspension?.until ?? null,
    otherSuspension,
    shopLifecycle: shop?.lifecycle ?? null,
  };
}

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Africa/Casablanca" });

/** Plain-French warnings for the reviewer: what a reversal will not give back now. */
export function appealWarnings(state: AppealAccountState, decision: Pick<DecisionRecord, "action" | "target">): string[] {
  const warnings: string[] = [];
  const listing = decision.target.type === "listing";
  const restoresListings = listing || decision.action === "ban";
  if (state.status === "missing") warnings.push("Le compte n'existe plus : rien ne sera remis en ligne.");
  else if (state.closed) warnings.push("Compte fermé : l'annulation est enregistrée, mais aucune annonce n'est remise en ligne et le compte reste fermé.");
  else if (state.status === "banned" && decision.action !== "ban") warnings.push("Compte banni par une autre décision : aucune annonce n'est remise en ligne.");
  if (state.otherSuspension && !state.closed) {
    warnings.push(`Une autre suspension court jusqu'au ${DATE.format(state.otherSuspension.until)} : elle reste en vigueur${restoresListings ? ", et les annonces reviennent en pause jusqu'à sa fin" : ""}.`);
  } else if (state.status === "suspended" && decision.action !== "suspend_account" && restoresListings && !state.closed) {
    warnings.push("Compte suspendu : les annonces reviennent en pause jusqu'à la fin de la suspension.");
  }
  if (state.shopLifecycle === "revalidation_required" && restoresListings && !state.closed) warnings.push("Boutique en revalidation : les annonces reviennent en pause jusqu'à la nouvelle validation.");
  if (state.status === "restricted" && restoresListings) warnings.push("Compte restreint : les annonces repassent par la file de modération.");
  return warnings;
}
