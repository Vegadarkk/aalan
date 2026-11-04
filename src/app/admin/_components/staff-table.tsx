import { Badge } from "@/components/ui/badge";
import type { StaffMember } from "@/lib/auth/staff";
import { staffState, type StaffState } from "@/lib/auth/staff-state";
import { formatMorocco } from "../_lib/moderation-format";
import { ROLE_LABEL } from "./admin-shell";
import { ResendInviteButton } from "./resend-invite-button";
import { RevokeButton } from "./revoke-button";

interface StaffTableProps {
  members: StaffMember[];
  /** The signed-in admin: shown as "vous", never revocable from here. */
  selfUid: string;
  /** Render time (expired invitation links). */
  now?: Date;
}

/** State cell (audit zone 7 P3-5): pending until the password is set, with the link's expiry. */
function StateCell({ state, member, canResend }: { state: StaffState; member: StaffMember; canResend: boolean }) {
  if (state.kind === "revoked") return <Badge variant="danger">Révoqué le {formatMorocco(state.at, "date")}</Badge>;
  if (state.kind === "active") return <Badge variant="success">Actif</Badge>;
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant="warning" className="whitespace-nowrap">
        Invité, en attente
      </Badge>
      <span className={state.expired ? "text-xs text-danger" : "text-xs text-foreground-muted"}>
        {state.expired ? "Lien expiré le " : "Lien valable jusqu'au "}
        <time dateTime={state.expiresAt} className="whitespace-nowrap">
          {formatMorocco(state.expiresAt)}
        </time>
      </span>
      {canResend ? <ResendInviteButton uid={member.uid} email={member.email} /> : null}
    </div>
  );
}

export function StaffTable({ members, selfUid, now = new Date() }: StaffTableProps) {
  if (members.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-strong p-8 text-center text-sm text-foreground-muted">
        Aucun membre pour l&apos;instant. Invitez le premier avec le formulaire.
      </p>
    );
  }
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-surface-muted text-foreground-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-start font-medium">Membre</th>
            <th scope="col" className="px-4 py-2.5 text-start font-medium">Rôle</th>
            <th scope="col" className="px-4 py-2.5 text-start font-medium">État</th>
            <th scope="col" className="px-4 py-2.5 text-start font-medium">Ajouté le</th>
            <th scope="col" className="px-4 py-2.5 text-end font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const self = member.uid === selfUid;
            const state = staffState(member, now);
            const revoked = state.kind === "revoked";
            return (
              <tr key={member.uid} className={revoked ? "border-t border-border align-top text-foreground-muted" : "border-t border-border align-top"}>
                <th scope="row" className="px-4 py-3 text-start font-normal">
                  <span className="block font-medium text-foreground">
                    {member.displayName}
                    {self ? <span className="ms-1.5 text-xs font-normal text-foreground-muted">(vous)</span> : null}
                  </span>
                  <span className="block text-xs text-foreground-muted">{member.email}</span>
                </th>
                <td className="px-4 py-3">
                  <Badge variant={member.role === "admin" ? "featured" : "neutral"}>{ROLE_LABEL[member.role]}</Badge>
                </td>
                <td className="min-w-40 px-4 py-3">
                  <StateCell state={state} member={member} canResend={!self} />
                </td>
                <td className="px-4 py-3 tabular-nums">
                  <time dateTime={member.createdAt}>{formatMorocco(member.createdAt, "date")}</time>
                  <span className="block text-xs text-foreground-muted">{member.invitedBy === "script" ? "par le script d'amorçage" : "sur invitation"}</span>
                </td>
                <td className="px-4 py-3 text-end">{self || revoked ? null : <RevokeButton uid={member.uid} name={member.displayName} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
