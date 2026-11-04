"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FilePen, ImageOff } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FormMessage, useApiErrorMessage } from "@/components/auth/form-message";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { SwitchField } from "@/components/post/controls/switch";
import { Button } from "@/components/ui/button";
import { KhatamLoader } from "@/components/ui/khatam-loader";
import type { Subcategory } from "@/config/categories";
import type { Locale } from "@/config/site";
import { Link, useRouter } from "@/i18n/navigation";
import { isApiError, useSession } from "@/lib/auth/client";
import { MAX_DRAFTS, type OwnerListingSummary } from "@/lib/contracts/listings";
import { usePublicConfig } from "@/lib/config/client";
import { createListing, listMine } from "@/lib/listings/client/api";
import { loadProMe } from "@/lib/pro/client";
import { daysUntil, formatRelativeDays } from "@/lib/listings/client/format";
import { ownerMediaBase, photoUrl } from "@/lib/listings/client/photo-url";
import { wizardPath } from "@/lib/listings/client/routes";
import { CategoryPicker } from "./category-picker";
import { useCategoryLabels } from "./labels";

// `/deposer` without an id (design D3): with drafts, asks "resume one or start a new listing"
// (zone 3 audit P2-3: "Vendre" used to reopen the latest draft without a word, and a second item
// could overwrite the first); without, shows the category grid and creates the draft after the
// subcategory pick. The 5-draft cap is said before the pick (P3-11). `?nouveau=1` skips the choice;
// `?don=1` presets "Je donne" (journey review 2026-10-29: the gift was asked at the price step only),
// which the draft carries from its creation when the subcategory allows donations.

type State = { kind: "checking" } | { kind: "drafts" } | { kind: "pick"; failed?: unknown } | { kind: "creating" } | { kind: "resuming" } | { kind: "draftLimit" } | { kind: "noPlan" };

/** Drafts shown on the choice screen; the rest are one link away in « Mes annonces ». */
const DRAFTS_SHOWN = 3;

export function WizardStart() {
  const t = useTranslations("Listing.start");
  const apiMessage = useApiErrorMessage();
  const router = useRouter();
  const params = useSearchParams();
  const { session } = useSession();
  const forceNew = params.get("nouveau") === "1";
  const [state, setState] = useState<State>({ kind: forceNew ? "pick" : "checking" });
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [giving, setGiving] = useState(params.get("don") === "1");
  const [drafts, setDrafts] = useState<OwnerListingSummary[]>([]);
  const started = useRef(false);
  const creating = useRef(false);
  const full = drafts.length >= MAX_DRAFTS;
  // A verified shop without a plan (zone 6 audit 6-02): told here, before the nine steps, not by
  // the refusal at "Publier". Whether subscriptions are open decides the way out.
  const [noPlan, setNoPlan] = useState<{ salesOpen: boolean } | null>(null);
  const isPro = session?.role === "pro";
  const proChecked = useRef(false);

  useEffect(() => {
    if (!isPro || proChecked.current) return;
    proChecked.current = true;
    void (async () => {
      try {
        const me = await loadProMe();
        if (me.shop && me.shop.quotas.activeListings === 0) setNoPlan({ salesOpen: me.salesOpen });
      } catch {
        // The server refuses the draft anyway (409 no_plan): the start screen then says it.
      }
    })();
  }, [isPro]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const { listings } = await listMine("drafts");
        const sorted = [...listings].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        setDrafts(sorted);
        // `?nouveau=1` already chose a new listing: the cap still shows before the pick.
        if (forceNew) {
          if (sorted.length >= MAX_DRAFTS) setState({ kind: "draftLimit" });
          return;
        }
        if (sorted.length > 0) {
          setState({ kind: "drafts" });
          return;
        }
      } catch {
        // The list is a convenience: without it the person simply starts a new listing.
      }
      if (!forceNew) setState({ kind: "pick" });
    })();
  }, [forceNew]);

  const onSubcategory = useCallback(
    async (subcategory: Subcategory) => {
      // One draft per pick, however fast the double tap.
      if (creating.current) return;
      creating.current = true;
      setState({ kind: "creating" });
      try {
        const { id } = await createListing({ categoryId: subcategory.categoryId, subcategoryId: subcategory.id, ...(giving && subcategory.donationAllowed ? { isDonation: true } : {}) });
        router.replace(wizardPath(id, "criteres"));
      } catch (error) {
        creating.current = false;
        if (isApiError(error, "draft_limit")) setState({ kind: "draftLimit" });
        else if (isApiError(error, "no_plan")) {
          setNoPlan((known) => known ?? { salesOpen: true });
          setState({ kind: "noPlan" });
        } else setState({ kind: "pick", failed: error });
      }
    },
    [giving, router],
  );

  if (noPlan) return <NoPlan salesOpen={noPlan.salesOpen} />;

  if (state.kind === "checking" || state.kind === "resuming" || state.kind === "creating") {
    return (
      <div role="status" aria-busy="true" className="flex flex-col items-center gap-4 py-16 text-foreground-muted">
        <KhatamLoader />
        <p>{state.kind === "creating" ? t("creating") : state.kind === "checking" ? t("checking") : t("resuming")}</p>
      </div>
    );
  }

  if (state.kind === "drafts") {
    return (
      <DraftChoice
        drafts={drafts}
        full={full}
        onResume={(id) => {
          setState({ kind: "resuming" });
          router.push(wizardPath(id));
        }}
        onNew={() => setState({ kind: full ? "draftLimit" : "pick" })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-balance">{t("title")}</h1>
        <p className="text-foreground-muted text-pretty">{t("lead")}</p>
      </header>
      {state.kind === "draftLimit" ? (
        <ErrorBanner
          tone="warning"
          title={t("draftLimitTitle")}
          action={
            <Button asChild variant="outline" size="sm" className="max-sm:h-11">
              <Link href="/mes-annonces">{t("myListings")}</Link>
            </Button>
          }
        >
          {t("draftLimitBody")}
        </ErrorBanner>
      ) : null}
      {state.kind === "pick" && state.failed ? (
        <FormMessage error={state.failed} title={t("createFailed")}>
          {apiMessage(state.failed)}
        </FormMessage>
      ) : null}
      <SwitchField label={t("giveLabel")} hint={t("giveHint")} checked={giving} onCheckedChange={setGiving} name="don" className="rounded-md border border-border bg-surface px-4 py-3" />
      <CategoryPicker categoryId={categoryId} subcategoryId={null} isPro={session?.role === "pro"} onCategory={setCategoryId} onSubcategory={(subcategory) => void onSubcategory(subcategory)} />
    </div>
  );
}

/** A shop without a plan: the real cause and the way to the offers, instead of the category grid. */
function NoPlan({ salesOpen }: { salesOpen: boolean }) {
  const t = useTranslations("Listing.start");
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-balance">{t("title")}</h1>
      </header>
      <ErrorBanner
        tone="info"
        title={t("noPlanTitle")}
        action={
          <Button asChild variant="structure" size="sm" className="max-sm:h-11">
            <Link href={salesOpen ? "/pro/abonnement" : "/pro"}>{salesOpen ? t("choosePlan") : t("proSpace")}</Link>
          </Button>
        }
      >
        {salesOpen ? t("noPlanBody") : t("noPlanClosed")}
      </ErrorBanner>
    </div>
  );
}

interface DraftChoiceProps {
  drafts: OwnerListingSummary[];
  /** MAX_DRAFTS reached: no new listing before one draft is published or deleted. */
  full: boolean;
  onResume: (id: string) => void;
  onNew: () => void;
}

/** "Reprendre un brouillon ou nouvelle annonce" (P2-3): the latest drafts first, each with its photo and age. */
function DraftChoice({ drafts, full, onResume, onNew }: DraftChoiceProps) {
  const t = useTranslations("Listing.start");
  const locale = useLocale() as Locale;
  const labels = useCategoryLabels();
  const config = usePublicConfig();
  const mediaBaseUrl = config?.mediaBaseUrl ?? null;
  const now = new Date();
  return (
    <div className="flex flex-col gap-8" data-testid="draft-choice">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-balance">{t("draftsTitle", { count: drafts.length })}</h1>
        <p className="text-foreground-muted text-pretty">{t("draftsLead")}</p>
      </header>
      <ul className="flex flex-col gap-3">
        {drafts.slice(0, DRAFTS_SHOWN).map((draft) => {
          const thumb = draft.thumb ? photoUrl(ownerMediaBase(draft, mediaBaseUrl), draft.id, draft.thumb.id, "s") : null;
          const title = draft.title.trim();
          const where = draft.categoryId ? (draft.subcategoryId ? labels.subcategory(draft.categoryId, draft.subcategoryId) : labels.category(draft.categoryId)) : null;
          return (
            <li key={draft.id}>
              <button
                type="button"
                onClick={() => onResume(draft.id)}
                aria-label={title ? t("resume", { title }) : t("resumeUntitled")}
                className="group flex w-full items-center gap-4 rounded-lg border border-border bg-surface p-3 text-start transition-[border-color,box-shadow] duration-150 ease-door hover:border-structure hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted text-foreground-muted">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" width={64} height={64} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
                  ) : (
                    <ImageOff className="size-6" aria-hidden="true" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={title ? "truncate font-medium text-foreground" : "truncate font-medium text-foreground-muted"}>{title || t("untitled")}</span>
                  <span className="truncate text-sm text-foreground-muted">
                    {[where, t("edited", { when: formatRelativeDays(daysUntil(new Date(draft.updatedAt), now), locale) })].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 text-sm font-medium text-link group-hover:underline sm:inline-flex">
                  <FilePen className="size-4" aria-hidden="true" />
                  {t("resumeAction")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {drafts.length > DRAFTS_SHOWN ? (
        <Link href={{ pathname: "/mes-annonces", query: { onglet: "drafts" } }} className="self-start text-sm font-medium text-link hover:underline">
          {t("allDrafts", { count: drafts.length })}
        </Link>
      ) : null}
      {full ? (
        <ErrorBanner
          tone="warning"
          title={t("draftLimitTitle")}
          action={
            <Button asChild variant="outline" size="sm" className="max-sm:h-11">
              <Link href={{ pathname: "/mes-annonces", query: { onglet: "drafts" } }}>{t("myListings")}</Link>
            </Button>
          }
        >
          {t("draftLimitBody")}
        </ErrorBanner>
      ) : (
        <div className="flex flex-col gap-2 border-t border-border pt-6">
          <p className="text-sm text-foreground-muted">{t("orNew")}</p>
          <Button type="button" size="lg" className="self-start max-sm:w-full" onClick={onNew}>
            {t("newListing")}
          </Button>
        </div>
      )}
    </div>
  );
}
