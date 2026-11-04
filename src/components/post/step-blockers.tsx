"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { ErrorBanner } from "@/components/feedback/error-banner";
import type { FieldIssue, WizardStep } from "@/lib/contracts/listings";
import { useWizard } from "@/lib/listings/client/store";
import { stepOfPath } from "@/lib/listings/client/validation";
import { isPassageIssue, textAtPath, usePassageFinder } from "./blocker-passages";
import { useBlockerMessage } from "./field-messages";
import { STEP_FORM_ID } from "./wizard-shell";

// The reasons of a refused publication on the step « Corriger » leads to (zone 3 P2-9): shown at
// the top of the step, with the passage at fault quoted and selected in its field. The reasons
// seen on arrival stay listed while the person fixes them; an edited one says it will be checked
// again at the next publication (the server is the judge, the store drops it on edit).

const sameIssue = (a: FieldIssue, b: FieldIssue) => a.path === b.path && a.code === b.code;

export function StepBlockers({ step }: { step: WizardStep }) {
  const { blockers, listing } = useWizard();
  const t = useTranslations("Listing.stepBlockers");
  const message = useBlockerMessage();
  const current = blockers.filter((issue) => stepOfPath(issue.path) === step);
  const [arrived] = useState(() => current);
  const shown = [...arrived, ...current.filter((issue) => !arrived.some((seen) => sameIssue(seen, issue)))];
  const finder = usePassageFinder(shown.some(isPassageIssue));
  const selected = useRef(false);

  const items = shown.map((issue) => {
    const pending = current.some((standing) => sameIssue(standing, issue));
    const passages = finder && isPassageIssue(issue) ? finder(issue.code, textAtPath(listing, issue.path)) : [];
    return { issue, passages, fixed: !pending && passages.length === 0 };
  });

  // The passage at fault, selected in its field (title, description) once the finder is there.
  const target = items.find((item) => !item.fixed && item.passages.length > 0 && (item.issue.path === "title" || item.issue.path === "description"));
  useEffect(() => {
    if (selected.current || !target) return;
    selected.current = true;
    const field = document.getElementById(STEP_FORM_ID)?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${target.issue.path}"]`);
    const passage = target.passages[0] ?? "";
    const at = field ? field.value.indexOf(passage) : -1;
    if (!field || at < 0) return;
    field.focus();
    field.setSelectionRange(at, at + passage.length);
  }, [target]);

  if (items.length === 0) return null;
  const open = items.filter((item) => !item.fixed).length;

  return (
    <ErrorBanner tone={open > 0 ? "danger" : "info"} title={open > 0 ? t("title") : t("editedTitle")}>
      <div data-testid="step-blockers" className="flex flex-col gap-2">
        {open > 0 ? <p>{t("lead")}</p> : null}
        <ul className="flex flex-col gap-2">
          {items.map(({ issue, passages, fixed }) => (
            <li key={`${issue.path}-${issue.code}`} className="flex flex-col gap-1">
              <span className={fixed ? "text-foreground-muted line-through" : undefined}>{message(issue)}</span>
              {passages.map((passage) => (
                <span key={passage} className="text-foreground">
                  {t.rich("passage", {
                    passage,
                    mark: (chunks) => (
                      <mark dir="auto" className="rounded-sm bg-danger/15 px-1 font-medium text-danger">
                        {chunks}
                      </mark>
                    ),
                  })}
                </span>
              ))}
              {fixed ? (
                <span className="inline-flex items-center gap-1.5 text-foreground-muted">
                  <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
                  {t("edited")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </ErrorBanner>
  );
}
