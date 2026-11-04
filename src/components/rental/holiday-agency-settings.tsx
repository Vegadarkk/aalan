"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormMessage, useApiErrorMessage } from "@/components/auth/form-message";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/post/controls/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { textLinkClassName } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";
import type { ProMeResponse, ProSelfView } from "@/lib/contracts/pro";
import { loadProMe, saveHolidayAgency } from "@/lib/pro/client";
import { publishesAsPro, type ProState } from "@/lib/pro/lifecycle";
import { HOLIDAY_AUTHORIZATION_PATTERN, HOLIDAY_MIN_NIGHTS_MAX, type HolidayAgency } from "@/lib/pro/profile-schema";
import { cn } from "@/lib/utils";

// /pro/sejours: a holiday rental agency's settings (audit L4-02): its tourist accommodation
// authorisation (law 80-14, written on each new home's listing), the arrival and departure times
// and the shortest stay its new listings start with. Shown on its storefront.

type View = { kind: "loading" } | { kind: "failed"; error: unknown } | { kind: "ready"; me: ProMeResponse };

/** Half-hour times offered for arrival and departure. */
const TIMES = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);
const DEFAULTS: HolidayAgency = { authorization: "", checkIn: "15:00", checkOut: "11:00", minNights: 2 };

export function HolidayAgencySettingsPage() {
  const t = useTranslations("HolidayAgency");
  const apiMessage = useApiErrorMessage();
  const [view, setView] = useState<View>({ kind: "loading" });
  const started = useRef(false);

  const load = useCallback(async () => {
    setView({ kind: "loading" });
    try {
      setView({ kind: "ready", me: await loadProMe() });
    } catch (error) {
      setView({ kind: "failed", error });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  if (view.kind === "loading") {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }
  if (view.kind === "failed") {
    return (
      <FormMessage
        error={view.error}
        title={t("loadFailed")}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {t("retry")}
          </Button>
        }
      >
        {apiMessage(view.error)}
      </FormMessage>
    );
  }
  const shop = view.me.shop;
  if (!shop || !publishesAsPro(shop.lifecycle as ProState)) {
    return (
      <ErrorBanner tone="info" title={t("notVerified")}>
        <Link href="/pro" className={cn("font-medium text-link", textLinkClassName)}>
          {t("back")}
        </Link>
      </ErrorBanner>
    );
  }
  return <HolidayAgencyForm shop={shop} />;
}

function HolidayAgencyForm({ shop }: { shop: ProSelfView }) {
  const t = useTranslations("HolidayAgency");
  const [draft, setDraft] = useState<HolidayAgency>(() => shop.holiday ?? DEFAULTS);
  const [saved, setSaved] = useState(() => (shop.holiday ? JSON.stringify(shop.holiday) : null));
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const set = (patch: Partial<HolidayAgency>) => setDraft((current) => ({ ...current, ...patch }));
  const input: HolidayAgency = { ...draft, authorization: draft.authorization.trim().toUpperCase() };
  const authorizationError = !input.authorization ? (attempted ? t("authorizationRequired") : undefined) : HOLIDAY_AUTHORIZATION_PATTERN.test(input.authorization) ? undefined : t("authorizationInvalid");
  const invalid = !input.authorization || Boolean(authorizationError);
  const dirty = JSON.stringify(input) !== saved;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (pending || invalid || !dirty) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await saveHolidayAgency(input);
      setDraft(result.holiday);
      setSaved(JSON.stringify(result.holiday));
      toast.success(t("saved"));
    } catch (caught) {
      setFailure(caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate data-testid="holiday-agency-settings" className="flex flex-col gap-8">
      {shop.sector !== "holiday_rental" ? (
        <ErrorBanner tone="warning" title={t("sectorTitle")}>
          {t("sectorBody")}{" "}
          <Link href="/pro" className={cn("font-medium text-link", textLinkClassName)}>
            {t("sectorAction")}
          </Link>
        </ErrorBanner>
      ) : null}

      <Section title={t("authorizationTitle")} lead={t("authorizationLead")}>
        <Field label={t("authorization")} hint={t("authorizationHint")} error={authorizationError} required className="max-w-md">
          <Input
            value={draft.authorization}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            placeholder={t("authorizationPlaceholder")}
            className="uppercase"
            onChange={(event) => set({ authorization: event.target.value })}
          />
        </Field>
      </Section>

      <Section title={t("stayTitle")} lead={t("stayLead")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("checkIn")} hint={t("checkInHint")}>
            <Select value={draft.checkIn} onChange={(event) => set({ checkIn: event.target.value })} className="tabular-nums" dir="ltr">
              {TIMES.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("checkOut")} hint={t("checkOutHint")}>
            <Select value={draft.checkOut} onChange={(event) => set({ checkOut: event.target.value })} className="tabular-nums" dir="ltr">
              {TIMES.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("minNights")} hint={t("minNightsHint")}>
            <Select value={draft.minNights} onChange={(event) => set({ minNights: Number(event.target.value) })} className="tabular-nums">
              {Array.from({ length: HOLIDAY_MIN_NIGHTS_MAX }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {t("nights", { count })}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      {failure ? <FormMessage error={failure} title={t("failed")} /> : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={pending} disabled={!dirty}>
          {t("save")}
        </Button>
        {!dirty && saved !== null ? <p className="text-sm text-foreground-muted">{t("upToDate")}</p> : null}
      </div>
    </form>
  );
}

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {lead ? <p className="max-w-prose text-sm text-foreground-muted text-pretty">{lead}</p> : null}
      </header>
      {children}
    </section>
  );
}
