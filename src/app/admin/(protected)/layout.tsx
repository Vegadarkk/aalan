import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/auth/current-user";
import { workload } from "@/lib/decisions/workload";
import { SITE_VIEWPORT } from "@/lib/i18n/metadata";
import { AdminShell } from "../_components/admin-shell";

// Signed-in part of the back office. This layout is UX only (the shell, a redirect on a full
// load): every page calls requirePageStaff itself, because a client-side navigation renders the
// page without the layout, and every API route re-checks with requireStaff (§6). The menu's
// counters come from the one-minute workload cache (src/lib/decisions/workload.ts).

// Browser chrome in the header colour; the sign-in page has no header and keeps the default.
export const viewport = SITE_VIEWPORT;

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const staff = await currentStaff();
  if (!staff) redirect("/connexion");
  const counts = await workload();
  return (
    <AdminShell email={staff.email ?? ""} role={staff.role} counts={counts}>
      {children}
    </AdminShell>
  );
}
