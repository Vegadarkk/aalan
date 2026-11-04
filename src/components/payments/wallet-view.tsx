"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Plus, TrendingUp } from "lucide-react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useApiErrorMessage } from "@/components/auth/form-message";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { textLinkClassName } from "@/components/ui/text-link";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { useNumbersTranslations } from "@/i18n/numbers";
import { numbersLocale } from "@/i18n/params";
import type { LedgerEntryView, WalletResponse } from "@/lib/contracts/payments";
import { loadWallet } from "@/lib/payments/client";
import { isolate } from "@/lib/i18n/bidi";
import { cn } from "@/lib/utils";
import { PROMOTE_AFTER_PURCHASE } from "./promote-dialog";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";

// Wallet page (phase 7 design §5, §6): what can be spent now (the plan's credits first, then the
// purchased ones), the plan's À la Une allowance, the way to buy credits, and the ledger, newest
// first, page by page. While sales are closed the page says so. Back from the payment page
// (`?achat=ok`, RevenueCat's success redirect) it says the credits are on their way and reloads
// until the webhook has credited them (the balance moves) or for two minutes.

/** Reloads after a payment, in seconds after the page opened (billing retries start at one minute). */
const AFTER_PAYMENT_RELOADS = [3, 6, 10, 15, 25, 40, 60, 90, 120];

const noSubscription = () => () => {};

function readPromoteAfter(): string | null {
  try {
    return window.sessionStorage.getItem(PROMOTE_AFTER_PURCHASE);
  } catch {
    return null;
  }
}

/** `{ id, title }` stored by the promote dialog; anything else (storage edited by hand) is ignored. */
function parseWaiting(value: string | null): { id: string; title: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { id?: unknown; title?: unknown } | null;
    if (typeof parsed?.id !== "string" || typeof parsed.title !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(parsed.id)) return null;
    return { id: parsed.id, title: parsed.title.slice(0, 200) };
  } catch {
    return null;
  }
}

type State = { kind: "loading" } | { kind: "failed"; error: unknown } | { kind: "ready"; data: WalletResponse; entries: LedgerEntryView[]; next: string | null; more: boolean };

export function WalletView() {
  const t = useNumbersTranslations("Wallet");
  const apiMessage = useApiErrorMessage();
  const locale = useLocale() as Locale;
  const [state, setState] = useState<State>({ kind: "loading" });
  // Balance first shown, then whether it has moved since (a payment back from RevenueCat landed).
  const opening = useRef<number | null>(null);
  const credited = useRef(false);

  const date = useCallback((iso: string, withTime = false) => new Intl.DateTimeFormat(numbersLocale(locale), { dateStyle: withTime ? "medium" : "long", ...(withTime ? { timeStyle: "short" } : {}), timeZone: moroccoTimeZone(new Date(iso).getTime()) }).format(new Date(iso)), [locale]);

  // State changes only once the answer is in (the first render is already "loading").
  const fetchWallet = useCallback(async () => {
    try {
      const data = await loadWallet();
      opening.current ??= data.wallet.balance;
      if (data.wallet.balance !== opening.current) credited.current = true;
      setState({ kind: "ready", data, entries: data.entries, next: data.next, more: false });
    } catch (error) {
      setState({ kind: "failed", error });
    }
  }, []);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void fetchWallet();
  }, [fetchWallet]);

  // The listing whose "Mettre en avant" sent the person here to buy credits (zone 6 audit 6-03):
  // read from the tab's storage after hydration (null on the server), parsed once per value.
  const stored = useSyncExternalStore(noSubscription, readPromoteAfter, () => null);
  const waiting = useMemo(() => parseWaiting(stored), [stored]);
  const forget = () => {
    try {
      window.sessionStorage.removeItem(PROMOTE_AFTER_PURCHASE);
    } catch {
      // Nothing to clear.
    }
  };

  const paid = useSearchParams().get("achat") === "ok";
  useEffect(() => {
    if (!paid) return;
    const timers = AFTER_PAYMENT_RELOADS.map((seconds) =>
      setTimeout(() => {
        if (!credited.current) void fetchWallet();
      }, seconds * 1_000),
    );
    return () => timers.forEach(clearTimeout);
  }, [paid, fetchWallet]);

  function retry() {
    setState({ kind: "loading" });
    void fetchWallet();
  }

  async function more() {
    if (state.kind !== "ready" || !state.next || state.more) return;
    const cursor = state.next;
    const settle = (update: (ready: Extract<State, { kind: "ready" }>) => State) => setState((prev) => (prev.kind === "ready" ? update(prev) : prev));
    settle((prev) => ({ ...prev, more: true }));
    try {
      const page = await loadWallet(cursor);
      // A reload meanwhile (after a payment) may have moved the first page: this one then no longer follows it.
      settle((prev) => (prev.next === cursor ? { ...prev, entries: [...prev.entries, ...page.entries], next: page.next, more: false } : { ...prev, more: false }));
    } catch {
      settle((prev) => ({ ...prev, more: false }));
    }
  }

  if (state.kind === "loading") {
    return (
      <div aria-busy="true" aria-label={t("loading")} className="flex flex-col gap-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-44 w-full rounded-lg" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <ErrorBanner
        title={t("failed")}
        action={
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {t("retry")}
          </Button>
        }
      >
        {apiMessage(state.error)}
      </ErrorBanner>
    );
  }

  const { data, entries } = state;
  const { wallet } = data;
  const available = Math.max(0, wallet.balance) + wallet.planCredits;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-semibold text-balance">{t("title")}</h1>
        <p className="text-foreground-muted text-pretty">{data.account === "shop" ? t("shop") : t("personal")}</p>
      </header>

      {paid ? <ErrorBanner tone="info" title={t("paid")} /> : null}
      {waiting && data.salesOpen && available > 0 ? (
        <ErrorBanner
          tone="info"
          title={t("promoteBack", { title: isolate(waiting.title) })}
          action={
            <Button asChild variant="structure" size="sm" className="max-sm:h-11">
              <Link href={{ pathname: "/mes-annonces", query: { promouvoir: waiting.id } }} onClick={forget}>
                <TrendingUp aria-hidden="true" />
                {t("promoteBackAction")}
              </Link>
            </Button>
          }
        />
      ) : null}
      {!data.salesOpen ? <ErrorBanner tone="info" title={t("closed")} /> : null}
      {wallet.frozen ? <ErrorBanner tone="warning" title={t("frozen")} /> : null}

      {/* What can be spent now; the threshold under it in the brand's gold. */}
      <section aria-labelledby="wallet-balance" className="threshold flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex flex-col gap-1">
            <h2 id="wallet-balance" className="text-sm text-foreground-muted">
              {t("available")}
            </h2>
            <p className={cn("text-5xl font-semibold tracking-tight tabular-nums", wallet.frozen && "text-foreground-muted")}>{t("amount", { count: available })}</p>
            <p className="text-sm text-foreground-muted">{t("unit")}</p>
          </div>
          {data.salesOpen ? (
            <Button asChild variant="structure" className="w-full sm:w-auto">
              <Link href="/porte-monnaie/recharger">
                <Plus aria-hidden="true" />
                {t("buy")}
              </Link>
            </Button>
          ) : null}
        </div>
        <dl className={cn("grid gap-4 border-t border-border pt-5", data.account === "shop" && "sm:grid-cols-3")}>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-foreground-muted">{t("balance")}</dt>
            <dd className={cn("text-lg font-semibold tabular-nums", wallet.balance < 0 && "text-danger")}>{t("amount", { count: wallet.balance })}</dd>
          </div>
          {/* Plan credits and the À la Une allowance belong to a shop's offer: for a person they were noise (6-22). */}
          {data.account === "shop" ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm text-foreground-muted">{t("plan")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{t("amount", { count: wallet.planCredits })}</dd>
              <dd className="text-xs text-foreground-muted text-pretty">{wallet.planCreditsResetsAt ? t("planUntil", { date: date(wallet.planCreditsResetsAt) }) : t("planNone")}</dd>
            </div>
          ) : null}
          {data.account === "shop" ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm text-foreground-muted">{t("allowance")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{wallet.featuredAllowance}</dd>
              <dd className="text-xs text-foreground-muted text-pretty">{t("allowanceHint")}</dd>
            </div>
          ) : null}
        </dl>
        <p className="text-sm text-foreground-muted text-pretty">{t("spendOrder")}</p>
        {data.account === "personal" ? (
          <Link href="/porte-monnaie/retractation" className={cn("w-fit rounded-sm text-sm font-medium text-link", textLinkClassName)}>
            {t("withdrawLink")}
          </Link>
        ) : null}
      </section>

      <section aria-labelledby="wallet-history" className="flex flex-col gap-4">
        <h2 id="wallet-history" className="text-xl font-semibold">
          {t("historyTitle")}
        </h2>
        {entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-foreground-muted">{t("empty")}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border border-y border-border">
            {entries.map((entry) => (
              <LedgerRow key={entry.id} entry={entry} when={date(entry.at, true)} />
            ))}
          </ol>
        )}
        {state.next ? (
          <Button type="button" variant="outline" className="self-center" loading={state.more} onClick={() => void more()}>
            {t("more")}
          </Button>
        ) : null}
      </section>
    </div>
  );
}

function LedgerRow({ entry, when }: { entry: LedgerEntryView; when: string }) {
  const t = useNumbersTranslations("Wallet");
  const options = useNumbersTranslations("Options");
  const label = entry.reason === "option" && entry.optionId ? options(`options.${entry.optionId}.title`) : t(`reasons.${entry.reason}`);
  // Spendable credits moved: purchased ones and the plan's together; the detail says where from.
  const total = entry.delta + entry.planCreditsDelta;
  const byAllowance = entry.featuredAllowanceDelta < 0 && total === 0;
  const fromPlan = entry.reason === "option" && entry.planCreditsDelta < 0 ? -entry.planCreditsDelta : 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-3.5">
      <span className="font-medium">{label}</span>
      <span className={cn("text-end font-semibold tabular-nums", total > 0 && "text-structure dark:text-gold-300", total === 0 && "text-foreground-muted")}>
        {byAllowance ? t("fromAllowance") : total === 0 ? "0" : `${total > 0 ? "+" : "−"}${t("amount", { count: Math.abs(total) })}`}
      </span>
      <time dateTime={entry.at} className="text-sm text-foreground-muted">
        {when}
      </time>
      <span className="text-end text-sm text-foreground-muted tabular-nums">{t("balanceAfter", { count: entry.balanceAfter })}</span>
      {fromPlan > 0 ? <span className="col-span-2 text-xs text-foreground-muted">{t("fromPlan", { count: fromPlan })}</span> : null}
    </li>
  );
}
