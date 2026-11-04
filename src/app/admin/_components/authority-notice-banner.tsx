import Link from "next/link";
import { Landmark } from "lucide-react";
import type { AuthorityNotice } from "@/lib/decisions/contracts";
import type { TargetRef } from "@/lib/reports/target-key";
import { noticeLines } from "../_lib/authority-notice";
import { linkClassName } from "./panel";

// Banner of a content page under an authority request still in force (audit zone 7 P3-3): one
// line per request, above the content, with the link to the request for an admin.

export function AuthorityNoticeBanner({ notices, target, admin }: { notices: readonly AuthorityNotice[]; target: TargetRef; admin: boolean }) {
  if (notices.length === 0) return null;
  return (
    <section aria-label="Demandes d'autorité en cours" className="flex flex-col divide-y divide-warning/20 rounded-lg border border-warning/35 border-s-4 border-s-warning bg-warning-surface">
      {notices.map((notice) => {
        const lines = noticeLines(notice, target, admin);
        return (
          <div key={notice.id} className="flex gap-3 p-4">
            <Landmark className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p dir="auto" className="font-medium text-pretty">
                {lines.title}
              </p>
              <p dir="auto" className="max-w-prose text-sm text-pretty">
                {lines.body}
              </p>
              {admin ? (
                <Link href={`/autorites/${encodeURIComponent(notice.id)}`} className={`mt-1 self-start text-sm font-medium ${linkClassName}`}>
                  Ouvrir la demande
                </Link>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
