import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/layout/logo";
import { Badge } from "@/components/ui/badge";
import type { StaffRole } from "@/lib/db/repositories/staff";
import type { Workload } from "@/lib/decisions/workload";
import { TIME_ZONE_LABEL } from "../_lib/moderation-format";
import { AdminMenuButton, AdminSideNav } from "./admin-nav";
import { LogoutButton } from "./logout-button";

export const ROLE_LABEL: Record<StaffRole, string> = { admin: "Admin", moderator: "Modérateur" };

interface AdminShellProps {
  email: string;
  role: StaffRole;
  /** The queues' counters (null: Firestore did not answer, the menu shows none). */
  counts: Workload | null;
  children: ReactNode;
}

/**
 * Chrome of the signed-in back office: a green frame line, the logo and who is signed in, then
 * the sections in four groups. From 1024 px a side menu keeps every section in view whatever their
 * number (zone 7 audit P2-7; a single row hid five of the admin's sections at 1440 px); below, a
 * "Sections" button under the header opens the same groups.
 */
export function AdminShell({ email, role, counts, children }: AdminShellProps) {
  const admin = role === "admin";
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-t-[3px] border-b border-border border-t-structure bg-surface-brand dark:border-t-bab-600">
        <div className="mx-auto flex w-full max-w-[96rem] flex-wrap items-stretch gap-x-6 px-4 sm:px-6">
          <Link href="/" className="flex h-14 shrink-0 items-center gap-3 rounded-sm" aria-label="Back-office Aalan, tableau de bord">
            <Logo label="Aalan" className="h-7" />
            <Badge variant="pro" className="whitespace-nowrap dark:bg-bab-700">
              Back-office
            </Badge>
          </Link>
          <div className="ms-auto flex h-14 min-w-0 items-center gap-2 sm:gap-3">
            <span className="hidden max-w-56 truncate text-sm text-foreground-muted xl:inline" title={email}>
              {email}
            </span>
            <Badge variant={admin ? "featured" : "neutral"} className="whitespace-nowrap">
              {ROLE_LABEL[role]}
            </Badge>
            <LogoutButton />
          </div>
          <div className="order-last -mx-4 w-[calc(100%+2rem)] border-t border-border px-4 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6 lg:hidden">
            <AdminMenuButton admin={admin} counts={counts} />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[96rem] flex-1 items-start gap-8 px-4 sm:px-6">
        <AdminSideNav admin={admin} counts={counts} />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex w-full flex-1 flex-col gap-6 py-8">{children}</main>
          <footer className="w-full pb-6 text-xs text-foreground-muted">
            Toutes les dates et heures du back-office sont en {TIME_ZONE_LABEL} (Africa/Casablanca), saisies comprises.
          </footer>
        </div>
      </div>
    </div>
  );
}
