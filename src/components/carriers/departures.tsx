"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, CalendarClock, Copy, Eye, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormMessage, useApiErrorMessage } from "@/components/auth/form-message";
import { TurnstileWidget, type TurnstileHandle } from "@/components/auth/turnstile-widget";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { InlineError } from "@/components/feedback/inline-error";
import { ListingStatusBadge } from "@/components/listings/owner/status-badge";
import { ChipRadioGroup } from "@/components/post/controls/chips";
import { ConfirmDialog } from "@/components/post/controls/confirm-dialog";
import { IntegerBox } from "@/components/post/controls/integer-box";
import { Select } from "@/components/post/controls/select";
import { Textarea } from "@/components/post/controls/textarea";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { inputClassName } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { textLinkClassName } from "@/components/ui/text-link";
import { CARRIER_SPACES, DEPARTURE_LIMITS, euZoneById, type CarrierDirection, type CarrierSpace } from "@/config/carriers";
import { cityBySlug, cityName } from "@/config/regions";
import type { Locale } from "@/config/site";
import { Link, getPathname } from "@/i18n/navigation";
import { ApiError, isApiError } from "@/lib/auth/client";
import { createDepartures, editDeparture, loadDepartures, saveDepartureSpace } from "@/lib/carriers/client";
import { departureInputSchema, departureWindowIssue, shiftDeparture, type DepartureInput } from "@/lib/carriers/departure";
import type { DepartureCreateInput, DepartureSettings, DeparturesResponse, OwnerDeparture } from "@/lib/contracts/departures";
import { deleteListing, listingAction } from "@/lib/listings/client/api";
import { dayNumber, dayString, moroccoToday } from "@/lib/listings/rental-availability";
import { cn } from "@/lib/utils";

// /pro/departs, « Mes départs » (transporteurs/spec.md §4): the carrier's upcoming departures by
// date, the room left set in one tap on each, a departure created in a few fields (its places and
// dates prefilled from the price list's areas and transit days), copied from the previous one with
// new dates, or repeated every week or two weeks (up to 8 at once). Each departure is a listing:
// published at once, screened like any other, gone the day after it leaves.

type View = { kind: "loading" } | { kind: "failed"; error: unknown } | { kind: "ready"; data: DeparturesResponse };

interface Draft {
  direction: CarrierDirection;
  departOn: string;
  depositBy: string;
  arriveFrom: string;
  arriveTo: string;
  euZones: string[];
  maCities: string[];
  space: CarrierSpace;
  spaceKg: number | null;
  note: string;
  /** Recurrence (creation only): once, every week, every two weeks. */
  repeat: "once" | "1" | "2";
  count: number;
}

type Editor = { mode: "create"; draft: Draft } | { mode: "edit"; id: string; draft: Draft };

const plusDays = (day: string, days: number) => dayString(dayNumber(day) + days);

/** A new departure: next week, deposit the day before, arrival after the price list's transit days, every area. */
function newDraft(settings: DepartureSettings, today: number): Draft {
  const departOn = dayString(today + 7);
  return {
    direction: settings.directions[0] ?? "eu_ma",
    departOn,
    depositBy: plusDays(departOn, -1),
    arriveFrom: plusDays(departOn, settings.transitDays.min),
    arriveTo: plusDays(departOn, settings.transitDays.max),
    euZones: [...settings.euZones],
    maCities: [...settings.maCities],
    space: "lots",
    spaceKg: null,
    note: "",
    repeat: "once",
    count: 4,
  };
}

/** The draft of an existing departure; `copy` moves it to the first same weekday after today. */
function draftOf(departure: OwnerDeparture["departure"], settings: DepartureSettings, today: number, copy: boolean): Draft {
  const from = dayNumber(departure.departOn);
  const facts = copy ? shiftDeparture(departure, 7 * Math.max(1, Math.ceil((today + 1 - from) / 7))) : departure;
  const zones = new Set(settings.euZones);
  const cities = new Set(settings.maCities);
  return {
    direction: settings.directions.includes(departure.direction) ? departure.direction : (settings.directions[0] ?? "eu_ma"),
    departOn: facts.departOn,
    depositBy: facts.depositBy,
    arriveFrom: facts.arriveFrom,
    arriveTo: facts.arriveTo,
    euZones: departure.euZones.filter((id) => zones.has(id)),
    maCities: departure.maCities.filter((slug) => cities.has(slug)),
    space: copy ? "lots" : departure.space,
    spaceKg: copy ? null : departure.spaceKg,
    note: departure.note,
    repeat: "once",
    count: 4,
  };
}

type Problem = "invalid_day" | "deposit_window" | "arrival_window" | "departure_past" | "departure_too_far" | "places";
type ProblemKey = "departOn" | "depositBy" | "arriveFrom" | "arriveTo" | "euZones" | "maCities" | "repeat";

/** The departure as the API takes it, or the first problem of each field (checked as the server checks it). */
function inputOf(draft: Draft, today: number): { input: DepartureInput | null; problems: Partial<Record<ProblemKey, Problem>> } {
  const candidate = {
    direction: draft.direction,
    departOn: draft.departOn,
    depositBy: draft.depositBy,
    arriveFrom: draft.arriveFrom,
    arriveTo: draft.arriveTo,
    euZones: draft.euZones,
    maCities: draft.maCities,
    space: draft.space,
    ...(draft.spaceKg && draft.space !== "full" ? { spaceKg: draft.spaceKg } : {}),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
  };
  const problems: Partial<Record<ProblemKey, Problem>> = {};
  const parsed = departureInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "") as ProblemKey;
      if (problems[key]) continue;
      problems[key] = key === "euZones" || key === "maCities" ? "places" : issue.code === "custom" && (issue.message === "deposit_window" || issue.message === "arrival_window") ? issue.message : "invalid_day";
    }
  }
  const window = departureWindowIssue(draft.departOn, today);
  if (window && !problems.departOn) problems.departOn = window;
  if (draft.repeat !== "once" && !problems.departOn) {
    const last = plusDays(draft.departOn, 7 * Number(draft.repeat) * (draft.count - 1));
    if (departureWindowIssue(last, today) === "departure_too_far") problems.repeat = "departure_too_far";
  }
  return Object.keys(problems).length === 0 && parsed.success ? { input: parsed.data, problems } : { input: null, problems };
}

export function DeparturesPage({ nonce, now }: { nonce?: string; now?: number }) {
  const t = useTranslations("Departures");
  const apiMessage = useApiErrorMessage("listing");
  const [clock] = useState(() => now ?? Date.now());
  const today = moroccoToday(clock);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [editor, setEditor] = useState<Editor | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setView({ kind: "loading" });
    try {
      setView({ kind: "ready", data: await loadDepartures() });
    } catch (error) {
      setView({ kind: "failed", error });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  useEffect(() => {
    if (editor) panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editor]);

  if (view.kind === "loading") {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton className="h-11 w-48 rounded-md" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }
  if (view.kind === "failed") {
    const notCarrier = isApiError(view.error, "conflict", "pro_not_verified", "forbidden");
    return (
      <FormMessage
        error={view.error}
        title={notCarrier ? t("notCarrier") : t("loadFailed")}
        action={
          notCarrier ? (
            <Link href="/pro" className={cn("text-sm font-medium text-link", textLinkClassName)}>
              {t("back")}
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {t("retry")}
            </Button>
          )
        }
      >
        {notCarrier ? null : apiMessage(view.error)}
      </FormMessage>
    );
  }

  const { upcoming, past, settings, open } = view.data;
  const canCreate = settings !== null && open;
  const start = (next: Editor) => setEditor(next);
  const done = () => {
    setEditor(null);
    void load(true);
  };

  return (
    <div data-testid="departures-page" className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" data-testid="departure-new" disabled={!canCreate} onClick={() => settings && start({ mode: "create", draft: newDraft(settings, today) })}>
          <Plus aria-hidden="true" className="size-5" />
          {t("new")}
        </Button>
        <Button asChild variant="outline">
          <Link href="/pro/transport">{t("priceList")}</Link>
        </Button>
      </div>

      {settings === null ? (
        <ErrorBanner tone="info" title={t("settingsMissing")}>
          <Link href="/pro/transport" className={cn("font-medium text-link", textLinkClassName)}>
            {t("settingsAction")}
          </Link>
        </ErrorBanner>
      ) : null}
      {!open ? <ErrorBanner tone="info" title={t("closed")} /> : null}

      {editor && settings ? (
        <div ref={panel} className="scroll-mt-24">
          <DepartureForm key={editor.mode === "edit" ? editor.id : `new-${editor.draft.departOn}`} editor={editor} settings={settings} today={today} nonce={nonce} onCancel={() => setEditor(null)} onDone={done} />
        </div>
      ) : null}

      <section aria-labelledby="departures-upcoming" className="flex flex-col gap-4">
        <h2 id="departures-upcoming" className="text-xl font-semibold">
          {t("upcoming", { count: upcoming.length })}
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState title={t("emptyTitle")} className="py-8">
            {t("emptyBody")}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((item) => (
              <li key={item.id}>
                <DepartureRow
                  item={item}
                  onEdit={settings ? () => start({ mode: "edit", id: item.id, draft: draftOf(item.departure, settings, today, false) }) : undefined}
                  onCopy={canCreate ? () => start({ mode: "create", draft: draftOf(item.departure, settings!, today, true) }) : undefined}
                  onChanged={() => void load(true)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section aria-labelledby="departures-past" className="flex flex-col gap-4">
          <h2 id="departures-past" className="text-lg font-semibold">
            {t("past")}
          </h2>
          <ul className="flex flex-col gap-2">
            {past.map((item) => (
              <li key={item.id}>
                <PastRow item={item} onCopy={canCreate ? () => start({ mode: "create", draft: draftOf(item.departure, settings!, today, true) }) : undefined} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function useDayText() {
  const format = useFormatter();
  return useCallback(
    (day: string, withWeekday = false) => format.dateTime(new Date(`${day}T12:00:00Z`), { ...(withWeekday ? { weekday: "long" as const } : {}), day: "numeric", month: "long", timeZone: "UTC" }),
    [format],
  );
}

/** « Lyon, Grenoble +3 → Nador, Oujda »: the first places of each side, in the page's language. */
function usePlaces() {
  const locale = useLocale() as Locale;
  return useCallback(
    (departure: Pick<OwnerDeparture["departure"], "direction" | "euZones" | "maCities">) => {
      const zones = departure.euZones.map((id) => euZoneById(id)?.name ?? id);
      const cities = departure.maCities.map((slug) => {
        const city = cityBySlug(slug);
        return city ? cityName(city, locale) : slug;
      });
      const side = (names: string[]) => (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", "));
      return departure.direction === "eu_ma" ? { from: side(zones), to: side(cities) } : { from: side(cities), to: side(zones) };
    },
    [locale],
  );
}

function DepartureRow({ item, onEdit, onCopy, onChanged }: { item: OwnerDeparture; onEdit?: () => void; onCopy?: () => void; onChanged: () => void }) {
  const t = useTranslations("Departures");
  const labels = useTranslations("Carriers");
  const locale = useLocale() as Locale;
  const apiMessage = useApiErrorMessage("listing");
  const day = useDayText();
  const places = usePlaces()(item.departure);
  // The room set in this session (the list is not read again after a tap); the saved one otherwise.
  const [chosen, setChosen] = useState<CarrierSpace | null>(null);
  const space = chosen ?? item.departure.space;
  const [busy, setBusy] = useState<"space" | "status" | "remove" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { departure } = item;
  const live = item.status === "published";

  async function changeSpace(next: string) {
    const previous = chosen;
    setChosen(next as CarrierSpace);
    setBusy("space");
    try {
      await saveDepartureSpace(item.id, { space: next as CarrierSpace });
      toast.success(t("spaceSaved", { space: labels(`spaces.${next as CarrierSpace}`) }));
    } catch (error) {
      setChosen(previous);
      toast.error(apiMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function run(kind: "status" | "remove", action: () => Promise<unknown>, success: string) {
    setBusy(kind);
    try {
      await action();
      toast.success(success);
      setConfirm(false);
      onChanged();
    } catch (error) {
      toast.error(apiMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article data-testid="departure-row" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-brand text-structure dark:text-gold-300">
            <CalendarClock className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="font-semibold first-letter:uppercase">{day(departure.departOn, true)}</h3>
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-foreground-muted">
              <span>{places.from}</span>
              <ArrowRight aria-label={t("to")} className="size-3.5 shrink-0 rtl:rotate-180" />
              <span>{places.to}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-muted">{labels(`directions.${departure.direction}`)}</span>
          <ListingStatusBadge status={item.status} />
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-1.5">
          <dt className="text-foreground-muted">{t("depositBy")}</dt>
          <dd className="font-medium">{day(departure.depositBy)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-foreground-muted">{t("arrival")}</dt>
          <dd className="font-medium">{departure.arriveFrom === departure.arriveTo ? day(departure.arriveFrom) : t("range", { from: day(departure.arriveFrom), to: day(departure.arriveTo) })}</dd>
        </div>
      </dl>

      {item.status === "pending_review" ? <p className="text-sm text-foreground-muted text-pretty">{t("pendingReview")}</p> : null}

      <div className="flex flex-col gap-1.5" data-testid="departure-space">
        <span className="text-sm font-medium">
          {t("space")}
          {departure.spaceKg && space === departure.space && space !== "full" ? <span className="font-normal text-foreground-muted"> · {t("spaceKg", { kg: departure.spaceKg })}</span> : null}
        </span>
        <ChipRadioGroup label={t("space")} options={CARRIER_SPACES.map((value) => ({ value, label: labels(`spaces.${value}`) }))} value={space} onChange={(next) => (next !== space && busy === null ? void changeSpace(next) : undefined)} />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {onEdit ? (
          <Button type="button" variant="outline" size="sm" data-testid="departure-edit" onClick={onEdit} className="max-sm:h-11">
            <Pencil aria-hidden="true" className="size-4" />
            {t("edit")}
          </Button>
        ) : null}
        {onCopy ? (
          <Button type="button" variant="outline" size="sm" data-testid="departure-copy" onClick={onCopy} className="max-sm:h-11">
            <Copy aria-hidden="true" className="size-4" />
            {t("copy")}
          </Button>
        ) : null}
        {item.slugId && (live || item.status === "paused") ? (
          <Button asChild variant="ghost" size="sm" className="max-sm:h-11">
            {/* A full page load: public pages have their own CSP. */}
            <a href={getPathname({ href: `/annonce/${item.slugId}`, locale })}>
              <Eye aria-hidden="true" className="size-4" />
              {t("view")}
            </a>
          </Button>
        ) : null}
        {live ? (
          <Button type="button" variant="ghost" size="sm" loading={busy === "status"} onClick={() => void run("status", () => listingAction(item.id, "pause"), t("paused"))} className="max-sm:h-11">
            <Pause aria-hidden="true" className="size-4" />
            {t("pause")}
          </Button>
        ) : item.status === "paused" ? (
          <Button type="button" variant="ghost" size="sm" loading={busy === "status"} onClick={() => void run("status", () => listingAction(item.id, "resume"), t("resumed"))} className="max-sm:h-11">
            <Play aria-hidden="true" className="size-4" />
            {t("resume")}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" data-testid="departure-remove" onClick={() => setConfirm(true)} className="text-danger max-sm:h-11">
          <Trash2 aria-hidden="true" className="size-4" />
          {t("remove")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("removeTitle")}
        body={t("removeBody")}
        cancelLabel={t("cancel")}
        confirmLabel={t("remove")}
        loading={busy === "remove"}
        onConfirm={() => void run("remove", () => deleteListing(item.id), t("removed"))}
      />
    </article>
  );
}

function PastRow({ item, onCopy }: { item: OwnerDeparture; onCopy?: () => void }) {
  const t = useTranslations("Departures");
  const day = useDayText();
  const places = usePlaces()(item.departure);
  return (
    <div data-testid="departure-past" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-muted/50 px-4 py-3 text-sm">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2">
        <span className="font-medium">{day(item.departure.departOn)}</span>
        <span className="text-foreground-muted">
          {places.from} → {places.to}
        </span>
      </span>
      {onCopy ? (
        <Button type="button" variant="outline" size="sm" onClick={onCopy} className="max-sm:h-11">
          <Copy aria-hidden="true" className="size-4" />
          {t("copy")}
        </Button>
      ) : null}
    </div>
  );
}

function DepartureForm({ editor, settings, today, nonce, onCancel, onDone }: { editor: Editor; settings: DepartureSettings; today: number; nonce?: string; onCancel: () => void; onDone: () => void }) {
  const t = useTranslations("Departures");
  const labels = useTranslations("Carriers");
  const locale = useLocale() as Locale;
  const apiMessage = useApiErrorMessage("listing");
  const day = useDayText();
  const [draft, setDraft] = useState<Draft>(editor.draft);
  const [attempted, setAttempted] = useState(false);
  const [accepted, setAccepted] = useState(editor.mode === "edit");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [turnstileNeeded, setTurnstileNeeded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const resubmit = useRef(false);
  const running = useRef(false);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const { input, problems } = useMemo(() => inputOf(draft, today), [draft, today]);
  const message = (key: ProblemKey) => (problems[key] ? t(`problems.${problems[key]}`, { max: DEPARTURE_LIMITS.aheadDays }) : undefined);
  const creating = editor.mode === "create";
  const toMorocco = draft.direction === "eu_ma";
  const cityLabel = (slug: string) => {
    const city = cityBySlug(slug);
    return city ? cityName(city, locale) : slug;
  };

  /** The departure day moves its deposit and arrival days along (their gaps stay). */
  function moveDeparture(next: string) {
    const delta = dayNumber(next) - dayNumber(draft.departOn);
    if (Number.isNaN(delta)) return set({ departOn: next });
    set({ departOn: next, depositBy: plusDays(draft.depositBy, delta), arriveFrom: plusDays(draft.arriveFrom, delta), arriveTo: plusDays(draft.arriveTo, delta) });
  }

  async function submit() {
    if (running.current || !input) return;
    running.current = true;
    setPending(true);
    setFailure(null);
    try {
      if (editor.mode === "edit") {
        await editDeparture(editor.id, { departure: input });
        toast.success(t("saved"));
      } else {
        const body: DepartureCreateInput = { departure: input, acceptRules: true, ...(draft.repeat !== "once" ? { repeat: { everyWeeks: Number(draft.repeat) as 1 | 2, count: draft.count } } : {}), ...(token ? { turnstileToken: token } : {}) };
        const result = await createDepartures(body);
        const held = result.created.filter((created) => created.status === "pending_review").length;
        toast.success(t("created", { count: result.created.length }));
        if (held > 0) toast.info(t("createdHeld", { count: held }));
        if (result.failed) toast.error(t("partial", { day: day(result.failed.departOn), reason: apiMessage(new ApiError(409, result.failed.code as ApiError["code"])) }), { duration: 10_000 });
      }
      onDone();
    } catch (error) {
      setToken(null);
      if (isApiError(error, "turnstile_required", "turnstile_failed")) {
        resubmit.current = !turnstileNeeded;
        setTurnstileNeeded(true);
        turnstile.current?.reset();
        if (error.code === "turnstile_failed") setFailure(error);
      } else {
        setFailure(error);
      }
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  function onToken(next: string | null) {
    setToken(next);
    if (next && resubmit.current) {
      resubmit.current = false;
      void submit();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (!input || !accepted || (turnstileNeeded && !token)) return;
    void submit();
  }

  const dateInput = (key: "departOn" | "depositBy" | "arriveFrom" | "arriveTo", onChange: (value: string) => void, testId?: string) => (
    <input
      type="date"
      data-testid={testId}
      value={draft[key]}
      min={dayString(today)}
      onChange={(event) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) onChange(event.target.value);
      }}
      className={cn(inputClassName, "w-full")}
    />
  );

  const failureAction = isApiError(failure, "no_plan") ? (
    <Button asChild variant="structure" size="sm">
      <Link href="/pro/abonnement">{t("choosePlan")}</Link>
    </Button>
  ) : isApiError(failure, "carrier_settings_missing") ? (
    <Button asChild variant="structure" size="sm">
      <Link href="/pro/transport">{t("settingsAction")}</Link>
    </Button>
  ) : undefined;

  return (
    <form onSubmit={onSubmit} noValidate data-testid="departure-form" className="flex flex-col gap-6 rounded-lg border border-structure/40 bg-surface p-5 shadow-sm sm:p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{creating ? t("formNew") : t("formEdit")}</h2>
        <p className="max-w-prose text-sm text-foreground-muted text-pretty">{t("formLead")}</p>
      </header>

      <FormMessage error={failure} scope="listing" action={failureAction} />

      {settings.directions.length > 1 ? (
        <FormGroup title={t("direction")}>
          <ChipRadioGroup label={t("direction")} options={settings.directions.map((value) => ({ value, label: labels(`directions.${value}`) }))} value={draft.direction} onChange={(value) => set({ direction: value as CarrierDirection })} />
        </FormGroup>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("departOn")} hint={t("departOnHint")} error={message("departOn")} required>
          {dateInput("departOn", moveDeparture, "departure-depart-on")}
        </Field>
        <Field label={t("depositByField")} error={message("depositBy")} required>
          {dateInput("depositBy", (value) => set({ depositBy: value }))}
        </Field>
        <Field label={t("arriveFrom")} error={message("arriveFrom")} required>
          {dateInput("arriveFrom", (value) => set({ arriveFrom: value, ...(dayNumber(value) > dayNumber(draft.arriveTo) ? { arriveTo: value } : {}) }))}
        </Field>
        <Field label={t("arriveTo")} error={message("arriveTo")} required>
          {dateInput("arriveTo", (value) => set({ arriveTo: value }))}
        </Field>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PlacePicker
          title={toMorocco ? t("collectEurope") : t("deliverEurope")}
          error={attempted ? message("euZones") : undefined}
          options={settings.euZones.map((id) => ({ value: id, label: euZoneById(id)?.name ?? id }))}
          values={draft.euZones}
          onChange={(euZones) => set({ euZones })}
          testId="departure-zones"
        />
        <PlacePicker
          title={toMorocco ? t("deliverMorocco") : t("collectMorocco")}
          error={attempted ? message("maCities") : undefined}
          options={settings.maCities.map((slug) => ({ value: slug, label: cityLabel(slug) }))}
          values={draft.maCities}
          onChange={(maCities) => set({ maCities })}
          testId="departure-cities"
        />
      </div>

      <div className="flex flex-col gap-3">
        <FormGroup title={t("space")}>
          <ChipRadioGroup label={t("space")} options={CARRIER_SPACES.map((value) => ({ value, label: labels(`spaces.${value}`) }))} value={draft.space} onChange={(value) => set({ space: value as CarrierSpace })} />
        </FormGroup>
        {draft.space !== "full" ? (
          <Field label={t("spaceKgField")} hint={t("spaceKgHint")} className="max-w-56">
            <IntegerBox value={draft.spaceKg} onValue={(spaceKg) => set({ spaceKg })} max={DEPARTURE_LIMITS.spaceKgMax} inputMode="numeric" />
          </Field>
        ) : null}
      </div>

      <Field label={t("note")} hint={t("noteHint", { max: DEPARTURE_LIMITS.noteMax })}>
        <Textarea rows={3} value={draft.note} maxLength={DEPARTURE_LIMITS.noteMax} dir="auto" onChange={(event) => set({ note: event.target.value })} />
      </Field>

      {creating ? (
        <div className="flex flex-col gap-3 rounded-md bg-surface-muted p-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label={t("repeat")} className="min-w-52">
              <Select data-testid="departure-repeat" value={draft.repeat} onChange={(event) => set({ repeat: event.target.value as Draft["repeat"] })}>
                <option value="once">{t("repeatOnce")}</option>
                <option value="1">{t("repeatWeekly")}</option>
                <option value="2">{t("repeatFortnightly")}</option>
              </Select>
            </Field>
            {draft.repeat !== "once" ? (
              <Field label={t("repeatCount")} className="min-w-40">
                <Select data-testid="departure-repeat-count" value={String(draft.count)} onChange={(event) => set({ count: Number(event.target.value) })}>
                  {Array.from({ length: DEPARTURE_LIMITS.repeatMax - 1 }, (_, index) => index + 2).map((count) => (
                    <option key={count} value={count}>
                      {t("departuresCount", { count })}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          {draft.repeat !== "once" && !problems.departOn ? (
            <p className="text-sm text-foreground-muted">{t("repeatUntil", { day: day(plusDays(draft.departOn, 7 * Number(draft.repeat) * (draft.count - 1))) })}</p>
          ) : null}
          {problems.repeat ? <InlineError>{t(`problems.${problems.repeat}`, { max: DEPARTURE_LIMITS.aheadDays })}</InlineError> : null}
        </div>
      ) : null}

      {creating ? (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" data-testid="departure-accept" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-structure" />
          <span className="text-pretty">
            {t.rich("accept", {
              rules: (chunks) => (
                <Link href="/legal/cgu" target="_blank" rel="noopener" className="font-medium text-link underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
      ) : null}
      {creating && attempted && !accepted ? <InlineError>{t("acceptRequired")}</InlineError> : null}

      {turnstileNeeded ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4">
          <p className="text-sm text-foreground-muted text-pretty">{t("turnstile")}</p>
          <TurnstileWidget ref={turnstile} action="listing" nonce={nonce} onToken={onToken} />
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" data-testid="departure-submit" loading={pending}>
          {creating ? (draft.repeat === "once" ? t("publish") : t("publishMany", { count: draft.count })) : t("save")}
        </Button>
      </div>
    </form>
  );
}

function FormGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{title}</span>
      {children}
    </div>
  );
}

/** The places of the price list's areas, all ticked at first: the carrier unticks what this tour skips. */
function PlacePicker({ title, options, values, onChange, error, testId }: { title: string; options: { value: string; label: string }[]; values: string[]; onChange: (values: string[]) => void; error?: string; testId: string }) {
  const t = useTranslations("Departures");
  const chosen = new Set(values);
  const all = options.every((option) => chosen.has(option.value));
  return (
    <fieldset data-testid={testId} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-medium">
          {title}
          <span className="ms-1 font-normal text-foreground-muted tabular-nums">({values.length})</span>
        </legend>
        <Button type="button" variant="link" size="sm" onClick={() => onChange(all ? [] : options.map((option) => option.value))}>
          {all ? t("none") : t("all")}
        </Button>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-surface-muted/40 p-2">
        <div className="grid gap-x-3 sm:grid-cols-2">
          {options.map((option) => (
            <label key={option.value} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-sm hover:bg-surface">
              <input
                type="checkbox"
                checked={chosen.has(option.value)}
                onChange={(event) => onChange(event.target.checked ? options.filter((item) => item.value === option.value || chosen.has(item.value)).map((item) => item.value) : values.filter((value) => value !== option.value))}
                className="size-4 shrink-0 accent-structure"
              />
              <span className="min-w-0 truncate">{option.label}</span>
            </label>
          ))}
        </div>
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
    </fieldset>
  );
}
