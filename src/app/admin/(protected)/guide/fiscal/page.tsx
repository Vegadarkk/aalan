import type { Metadata } from "next";
import { requirePageStaff } from "@/lib/auth/current-user";
import type { TaxGuideSection } from "@/lib/guide/tax-guide";
import { readTaxGuide } from "@/lib/guide/tax-guide-source";
import { GuideBlocks } from "../../../_components/guide-markdown";
import { GuideTabs } from "../../../_components/guide-tabs";

// The team's tax guide in the back office (zone 7 audit P3-7), admins only like the Ventes page it
// serves: what to declare, where, when, with which export. Rendered from docs/tax-runbook.md, the
// one source, so the page follows every change of the guide with the code.

export const metadata: Metadata = { title: "Guide fiscal" };

function Progress({ tasks }: { tasks: NonNullable<TaxGuideSection["tasks"]> }) {
  const share = tasks.total === 0 ? 0 : Math.round((tasks.done / tasks.total) * 100);
  const label = `${tasks.done} fait${tasks.done > 1 ? "s" : ""} sur ${tasks.total}`;
  return (
    <div className="flex items-center gap-3 text-sm text-foreground-muted">
      <div role="meter" aria-label={`Points traités : ${label}`} aria-valuemin={0} aria-valuemax={tasks.total} aria-valuenow={tasks.done} className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-muted ring-1 ring-border ring-inset">
        <div className="h-full rounded-full bg-success" style={{ width: `${share}%` }} />
      </div>
      <span className="tabular-nums" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}

export default async function TaxGuidePage() {
  await requirePageStaff(["admin"]);
  const guide = readTaxGuide();
  return (
    <>
      <GuideTabs current="tax" admin />
      <div className="flex flex-col gap-2">
        <h1 id="tax-guide-title" className="text-2xl font-semibold text-balance">
          {guide.title}
        </h1>
        <div className="flex max-w-prose flex-col gap-2 text-sm text-foreground-muted">
          <GuideBlocks blocks={guide.intro} />
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Sommaire du guide fiscal" className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-2 text-sm font-medium">Sommaire</p>
          <ol className="flex flex-col border-s border-border text-sm">
            {guide.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="-ms-px flex gap-2 border-s-2 border-transparent py-1.5 ps-3 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground">
                  {section.number !== null ? <span className="w-5 shrink-0 text-end tabular-nums">{section.number}.</span> : null}
                  <span className="min-w-0 text-pretty">{section.title}</span>
                  {section.tasks ? (
                    <span className="ms-auto shrink-0 ps-2 text-xs tabular-nums" aria-label={`${section.tasks.done} sur ${section.tasks.total} faits`}>
                      {section.tasks.done}/{section.tasks.total}
                    </span>
                  ) : null}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article aria-labelledby="tax-guide-title" className="flex min-w-0 flex-col">
          {guide.sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className={index === 0 ? "scroll-mt-6 pb-8" : "scroll-mt-6 border-t border-border py-8"}
            >
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h2 id={`${section.id}-title`} className="flex gap-3 text-lg font-semibold text-balance">
                  {section.number !== null ? <span className="text-primary tabular-nums">{section.number}.</span> : null}{" "}
                  <span>{section.title}</span>
                </h2>
                {section.tasks ? <Progress tasks={section.tasks} /> : null}
              </div>
              <div className="flex max-w-[72ch] flex-col gap-3 text-[0.9375rem] leading-relaxed">
                <GuideBlocks blocks={section.blocks} />
              </div>
            </section>
          ))}
        </article>
      </div>
    </>
  );
}
