"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CircleCheck, Printer } from "lucide-react";
import { useLocale } from "next-intl";
import { FormMessage, useApiErrorMessage } from "@/components/auth/form-message";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { InlineError } from "@/components/feedback/inline-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { textLinkClassName } from "@/components/ui/text-link";
import type { Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { useNumbersTranslations } from "@/i18n/numbers";
import { numbersLocale } from "@/i18n/params";
import { isApiError } from "@/lib/auth/client";
import type { WithdrawablePackView, WithdrawalReceiptView, WithdrawalsResponse } from "@/lib/contracts/payments";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";
import { loadWithdrawals, requestWithdrawal } from "@/lib/payments/client";
import { cn } from "@/lib/utils";

// Online withdrawal from a credit pack (CGV §6; L221-21 Code de la consommation, art. 36 loi 31-08):
// the packs bought in the last 14 days with what withdrawing removes and refunds now, one statement
// box, then the acknowledgement on the page (printable) and by e-mail, and the past withdrawals.

type State = { kind: "loading" } | { kind: "failed"; error: unknown } | { kind: "ready"; data: WithdrawalsResponse };

/** Codes the page explains in its own words (Withdrawal.errors). */
const WITHDRAWAL_ERRORS = ["withdrawal_not_consumer", "withdrawal_exists", "withdrawal_refunded", "withdrawal_expired", "withdrawal_nothing_left"] as const;

const major = (minor: number) => Math.round(minor) / 100;

export function WithdrawalView() {
  const t = useNumbersTranslations("Withdrawal");
  const apiMessage = useApiErrorMessage();
  const locale = useLocale() as Locale;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [choice, setChoice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(undefined);
  const [receipt, setReceipt] = useState<WithdrawalReceiptView | null>(null);
  const receiptRef = useRef<HTMLElement>(null);

  const date = useCallback(
    (iso: string, withTime = false) =>
      new Intl.DateTimeFormat(numbersLocale(locale), { dateStyle: "long", ...(withTime ? { timeStyle: "short" } : {}), timeZone: moroccoTimeZone(new Date(iso).getTime()) }).format(new Date(iso)),
    [locale],
  );

  const fetchData = useCallback(async () => {
    try {
      const data = await loadWithdrawals();
      setState({ kind: "ready", data });
    } catch (error) {
      setState({ kind: "failed", error });
    }
  }, []);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (receipt) receiptRef.current?.focus();
  }, [receipt]);

  function reload() {
    setState({ kind: "loading" });
    setChoice(null);
    void fetchData();
  }

  const messageOf = (error: unknown) => {
    const code = WITHDRAWAL_ERRORS.find((candidate) => isApiError(error, candidate));
    return code ? t(`errors.${code}`) : apiMessage(error);
  };

  const header = (
    <header className="flex flex-col gap-3 print:hidden">
      <Link href="/porte-monnaie" className={cn("inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-link", textLinkClassName)}>
        <ArrowLeft aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
        {t("back")}
      </Link>
      <h1 className="text-3xl font-semibold text-balance">{t("title")}</h1>
    </header>
  );

  if (state.kind === "loading") {
    return (
      <div aria-busy="true" aria-label={t("loading")} className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <ErrorBanner
          title={t("failed")}
          action={
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              {t("retry")}
            </Button>
          }
        >
          {apiMessage(state.error)}
        </ErrorBanner>
      </div>
    );
  }

  const { data } = state;
  const selected = data.packs.find((pack) => pack.orderId === choice);
  const problems = attempted ? { choice: !selected, confirm: !confirm } : { choice: false, confirm: false };

  async function send() {
    setAttempted(true);
    if (!selected || !confirm || selected.removableCredits === 0) return;
    setPending(true);
    setFailure(undefined);
    try {
      const answer = await requestWithdrawal(selected.orderId, locale);
      setReceipt(answer);
      setChoice(null);
      setConfirm(false);
      setAttempted(false);
      void fetchData();
    } catch (error) {
      setFailure(error);
      if (isApiError(error, ...WITHDRAWAL_ERRORS)) void fetchData();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {header}

      {receipt ? <ReceiptCard ref={receiptRef} receipt={receipt} date={date} /> : null}

      {!data.eligible ? (
        <ErrorBanner tone="info" title={t("notConsumer")} />
      ) : (
        <>
          <section className="flex flex-col gap-2 text-pretty print:hidden">
            <p>{t("intro")}</p>
            <p className="text-sm text-foreground-muted">{t("rules")}</p>
          </section>

          <form
            noValidate
            className="flex flex-col gap-6 print:hidden"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <fieldset className="flex flex-col gap-3" aria-invalid={problems.choice ? true : undefined}>
              <legend className="mb-3 text-lg font-semibold">{t("packsTitle")}</legend>
              {data.packs.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-foreground-muted">{t("none")}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.packs.map((pack) => (
                    <PackRow key={pack.orderId} pack={pack} selected={pack.orderId === choice} onSelect={() => setChoice(pack.orderId)} date={date} />
                  ))}
                </div>
              )}
              {problems.choice ? <InlineError>{t("choose")}</InlineError> : null}
            </fieldset>

            {data.packs.length > 0 ? (
              <>
                <div className="flex flex-col gap-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-muted p-4 text-pretty">
                    <input type="checkbox" checked={confirm} aria-invalid={problems.confirm ? true : undefined} onChange={(event) => setConfirm(event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" />
                    <span>{t("statement")}</span>
                  </label>
                  {problems.confirm ? <InlineError>{t("confirmRequired")}</InlineError> : null}
                </div>

                {failure !== undefined ? <FormMessage error={failure} title={messageOf(failure)} /> : null}

                <div className="flex justify-end border-t border-border pt-6">
                  <Button type="submit" variant="structure" loading={pending} disabled={selected?.removableCredits === 0} className="w-full sm:w-auto">
                    {t("submit")}
                  </Button>
                </div>
              </>
            ) : null}
          </form>

          {data.receipts.length > 0 ? (
            <section aria-labelledby="withdrawal-history" className="flex flex-col gap-4 print:hidden">
              <h2 id="withdrawal-history" className="text-xl font-semibold">
                {t("historyTitle")}
              </h2>
              <ol className="flex flex-col divide-y divide-border border-y border-border">
                {data.receipts.map((item) => (
                  <li key={item.receipt} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-3.5">
                    <span className="font-medium tabular-nums">{t("receiptNumber", { receipt: item.receipt })}</span>
                    <Badge variant={item.status === "refunded" ? "success" : "warning"}>{item.status === "refunded" ? t("statusRefunded") : t("statusRequested")}</Badge>
                    <span className="text-sm text-foreground-muted">{t("receiptAt", { date: date(item.requestedAt, true) })}</span>
                    <span className="text-end text-sm text-foreground-muted tabular-nums">
                      {item.refundedAt
                        ? t("receiptRefunded", { amount: major(item.refundMinor), currency: item.currency, date: date(item.refundedAt) })
                        : t("receiptRefund", { amount: major(item.refundMinor), currency: item.currency, date: date(item.refundBy) })}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function PackRow({ pack, selected, onSelect, date }: { pack: WithdrawablePackView; selected: boolean; onSelect: () => void; date: (iso: string) => string }) {
  const t = useNumbersTranslations("Withdrawal");
  const empty = pack.removableCredits === 0;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-4 rounded-lg border bg-surface p-4 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring sm:p-5",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-border-strong",
      )}
    >
      <input type="radio" name="withdrawal-pack" value={pack.orderId} checked={selected} onChange={onSelect} className="mt-1 size-4 shrink-0 accent-primary" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">{t("packLabel", { credits: pack.packCredits, date: date(pack.purchasedAt) })}</span>
        <span className="text-sm text-foreground-muted">{t("until", { date: date(pack.until) })}</span>
        <span className={cn("text-sm", empty ? "text-foreground-muted" : "font-medium")}>{empty ? t("removableNone") : t("removable", { count: pack.removableCredits })}</span>
      </span>
      {!empty ? <span className="shrink-0 text-end text-sm font-semibold tabular-nums">{t("refund", { amount: major(pack.refundMinor), currency: pack.currency })}</span> : null}
    </label>
  );
}

function ReceiptCard({ ref, receipt, date }: { ref: React.Ref<HTMLElement>; receipt: WithdrawalReceiptView; date: (iso: string, withTime?: boolean) => string }) {
  const t = useNumbersTranslations("Withdrawal");
  return (
    <section ref={ref} tabIndex={-1} aria-labelledby="withdrawal-receipt" className="threshold flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 outline-none sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="withdrawal-receipt" className="flex items-center gap-2 text-xl font-semibold">
          <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-success" />
          {t("receiptTitle")}
        </h2>
        <Button type="button" variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          {t("print")}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5 text-pretty">
        <p className="text-lg font-semibold tabular-nums">{t("receiptNumber", { receipt: receipt.receipt })}</p>
        <p>{t("receiptAt", { date: date(receipt.requestedAt, true) })}</p>
        <p>{t("receiptRemoved", { count: receipt.removedCredits, total: receipt.packCredits })}</p>
        <p className="font-medium">{t("receiptRefund", { amount: major(receipt.refundMinor), currency: receipt.currency, date: date(receipt.refundBy) })}</p>
      </div>
      <p className="text-sm text-foreground-muted text-pretty">{t("receiptMail")}</p>
    </section>
  );
}
