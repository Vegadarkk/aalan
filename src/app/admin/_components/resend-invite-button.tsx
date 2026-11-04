"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { StaffResendResponse } from "@/lib/auth/staff";
import { ADMIN_API, adminFetch, errorMessage } from "./api-client";

// Resend the invitation of a member still pending (audit zone 7 P3-5): a new link, valid one hour.

const MESSAGES: Record<string, string> = {
  conflict: "Cette personne a déjà accepté l'invitation, ou son accès a été révoqué. Rechargez la page.",
  not_found: "Ce membre n'existe plus. Rechargez la page.",
  unavailable: "L'e-mail n'a pas pu partir. Réessayez dans un instant.",
};

export function ResendInviteButton({ uid, email }: { uid: string; email: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function resend() {
    setLoading(true);
    try {
      await adminFetch<StaffResendResponse>(`${ADMIN_API.staff}/${encodeURIComponent(uid)}/invitation`, { method: "POST", csrf: true });
      toast.success(`Invitation renvoyée à ${email}`, { description: "Le nouveau lien est valable une heure." });
      router.refresh();
    } catch (cause) {
      toast.error(errorMessage(cause, MESSAGES));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="link" size="sm" loading={loading} onClick={resend} className="h-auto gap-1.5 py-0.5 text-xs">
      <Send className="size-3.5" aria-hidden="true" />
      Renvoyer l&apos;invitation
    </Button>
  );
}
