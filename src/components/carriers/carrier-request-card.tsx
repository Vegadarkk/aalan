"use client";

import { useCallback, useId, useState } from "react";
import { CalendarDays, CircleCheck, CircleX, Gauge, PackageCheck, PackagePlus, PackageSearch, ReceiptText, Truck, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { InlineError } from "@/components/feedback/inline-error";
import { useMessagingErrorMessage } from "@/components/messages/errors";
import { Textarea } from "@/components/post/controls/textarea";
import { formatRentalDay } from "@/components/rental/rental-day";
import { Button } from "@/components/ui/button";
import { SITE_NAME, type Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/auth/client";
import { postCarrierRequestAction } from "@/lib/carrier-requests/client";
import { carrierRequestOpen, type CarrierRequestAction, type CarrierRequestEvent, type CarrierRequestEventView, type CarrierRequestResponse, type CarrierRequestView } from "@/lib/contracts/carrier-requests";
import { isolate } from "@/lib/i18n/bidi";
import { moroccoToday } from "@/lib/listings/rental-availability";
import { cn } from "@/lib/utils";
import { useBasketParts, useCarrierMoney } from "./basket";

// The conversation's current place request on a carrier's departure (transporteurs/spec.md §5),
// pinned under the thread header until the departure day. For the carrier: the client's basket and
// its estimate, « Place réservée » or « Pas de place » (a second step with an optional word, sent as
// its own message, like the booking requests), then a link to update the room left. For the
// client: the request sent, withdraw it. The card always says the price is an estimate: nothing is
// paid on the site, the carrier sets the final price after the control weighing (owner, 10 Nov).

const ERROR_KEYS = ["carrier_request_changed", "carrier_request_past", "carrier_request_unavailable"] as const;

export function useCarrierRequestErrorMessage(): (error: unknown) => string {
  const t = useTranslations("CarrierRequest.errors");
  const messaging = useMessagingErrorMessage();
  return useCallback(
    (error: unknown) => {
      const code = error instanceof ApiError ? error.code : null;
      const key = ERROR_KEYS.find((item) => item === code);
      return key ? t(key) : messaging(error);
    },
    [t, messaging],
  );
}

/** The carrier's word with its answer: a message of the thread, so the composer's limit. */
const NOTE_MAX = 500;

/** The basket, its estimate and the departure day: what the card and its confirmation show. */
function RequestFacts({ request }: { request: Pick<CarrierRequestView, "departOn" | "basket" | "estimate"> }) {
  const t = useTranslations("CarrierRequest.card");
  const labels = useTranslations("Carriers");
  const locale = useLocale() as Locale;
  const money = useCarrierMoney();
  const parts = useBasketParts()(request.basket);
  const { estimate } = request;
  return (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <CalendarDays className="size-4 shrink-0 text-structure dark:text-gold-300" aria-hidden="true" />
        <span>{t("departure", { day: formatRentalDay(request.departOn, locale) })}</span>
      </p>
      <p className="flex items-start gap-1.5 text-sm text-foreground-muted" data-testid="carrier-request-basket-summary">
        <PackageSearch className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{parts.join(locale === "ar" ? "، " : ", ")}</span>
      </p>
      <p className="flex items-start gap-1.5 text-sm" data-testid="carrier-request-estimate">
        <ReceiptText className="mt-0.5 size-4 shrink-0 text-structure dark:text-gold-300" aria-hidden="true" />
        <span>
          {estimate ? <span className="font-semibold tabular-nums">{t("estimate", { total: money(estimate.total, estimate.currency) })}</span> : <span className="text-foreground-muted">{t("noEstimate")}</span>}
          {estimate && estimate.onRequest.length > 0 ? <span className="block text-foreground-muted">{t("onRequest", { items: estimate.onRequest.map((item) => labels(`items.${item}`)).join(", ") })}</span> : null}
        </span>
      </p>
    </>
  );
}

export interface CarrierRequestCardProps {
  cid: string;
  request: CarrierRequestView;
  counterpartName: string;
  /** False when the conversation is read-only (blocked, frozen, closed, suspended): no action. */
  writable: boolean;
  /** The thread's clock (refreshed every 15 s). */
  now: number;
  onChange: (response: CarrierRequestResponse) => void;
  /** Sends the carrier's word with its answer as a message of the thread; resolves false when it failed. */
  onNote?: (text: string) => Promise<boolean>;
}

export function CarrierRequestCard({ cid, request, counterpartName, writable, now, onChange, onNote }: CarrierRequestCardProps) {
  const t = useTranslations("CarrierRequest.card");
  const id = useId();
  const errorMessage = useCarrierRequestErrorMessage();
  const [busy, setBusy] = useState<CarrierRequestAction["action"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"accept" | "decline" | null>(null);
  const [note, setNote] = useState("");

  if (!carrierRequestOpen(request, moroccoToday(now))) return null;
  const name = isolate(counterpartName);
  const carrier = !request.requestedByMe;

  async function act(action: CarrierRequestAction, done: string) {
    setBusy(action.action);
    setError(null);
    try {
      const response = await postCarrierRequestAction(cid, action);
      onChange(response);
      toast.success(done);
      const word = note.trim();
      if (word && onNote) await onNote(word);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  const notice = (
    <p className="flex gap-1.5 text-xs text-foreground-muted text-pretty" data-testid="carrier-request-notice">
      <Gauge className="mt-px size-3.5 shrink-0 text-structure dark:text-gold-300" aria-hidden="true" />
      {t("notice", { site: SITE_NAME })}
    </p>
  );
  const frame = "mx-3 mt-3 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3.5 shadow-sm lg:mx-5";
  const badge = (accepted: boolean) => (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-t-full rounded-b-sm",
        accepted ? "bg-success-surface text-success" : carrier ? "bg-primary text-primary-foreground" : "bg-primary/12 text-primary",
      )}
    >
      {accepted ? <PackageCheck className="size-4.5" /> : <Truck className="size-4.5" />}
    </span>
  );

  if (request.status === "accepted") {
    return (
      <section aria-labelledby={`${id}-title`} className={cn(frame, "border-structure/25")} data-testid="carrier-request-card" data-status="accepted">
        <div className="flex items-start gap-3">
          {badge(true)}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 id={`${id}-title`} className="font-semibold text-pretty">
              {carrier ? t("acceptedMine", { name }) : t("acceptedTheirs", { name })}
            </h3>
            <RequestFacts request={request} />
          </div>
        </div>
        {carrier && writable ? (
          <Button asChild variant="outline" size="sm" className="self-start max-sm:h-11">
            <Link href="/pro/departs">{t("updateSpace")}</Link>
          </Button>
        ) : null}
        {notice}
      </section>
    );
  }

  if (!carrier) {
    return (
      <section aria-labelledby={`${id}-title`} className={frame} data-testid="carrier-request-card" data-status="requested-mine">
        <div className="flex items-start gap-3">
          {badge(false)}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 id={`${id}-title`} className="font-semibold text-pretty">
              {t("requestedMine", { name })}
            </h3>
            <RequestFacts request={request} />
            <p className="text-sm text-foreground-muted">{t("waiting")}</p>
          </div>
        </div>
        {writable ? (
          <Button type="button" variant="ghost" size="sm" className="self-start max-sm:h-11" loading={busy === "withdraw"} onClick={() => void act({ action: "withdraw", id: request.id }, t("withdrawnToast"))}>
            {t("withdraw")}
          </Button>
        ) : null}
        {notice}
        {error ? <InlineError>{error}</InlineError> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className={cn(frame, "border-primary/40 ring-1 ring-primary/15")} data-testid="carrier-request-card" data-status="requested-theirs">
      <div className="flex items-start gap-3">
        {badge(false)}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={`${id}-title`} className="font-semibold text-pretty">
            {t("requestedTheirs", { name })}
          </h3>
          <RequestFacts request={request} />
        </div>
      </div>
      {writable && confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-muted p-3" data-testid="carrier-request-confirm" data-answer={confirming}>
          <p className="text-sm font-medium text-pretty">{t(confirming === "accept" ? "confirmAccept" : "confirmDecline", { name })}</p>
          {onNote ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-note`} className="text-sm font-medium">
                {t("note")}
              </label>
              <Textarea
                id={`${id}-note`}
                rows={2}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(event) => setNote(event.target.value.replace(/[⟦⟧]/g, ""))}
                placeholder={t(confirming === "accept" ? "notePlaceholderAccept" : "notePlaceholderDecline")}
                data-testid="carrier-request-note"
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant={confirming === "accept" ? "primary" : "outline"}
              className="max-sm:w-full"
              loading={busy !== null}
              onClick={() => void act(confirming === "accept" ? { action: "accept", id: request.id } : { action: "decline", id: request.id }, t(confirming === "accept" ? "acceptedToast" : "declinedToast"))}
              data-testid="carrier-request-confirm-send"
            >
              {confirming === "accept" ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
              {t(confirming === "accept" ? "confirmAcceptButton" : "confirmDeclineButton")}
            </Button>
            <Button type="button" variant="ghost" className="max-sm:w-full" disabled={busy !== null} onClick={() => setConfirming(null)}>
              {t("back")}
            </Button>
          </div>
        </div>
      ) : writable ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" className="max-sm:w-full" onClick={() => setConfirming("accept")} data-testid="carrier-request-accept">
            <CircleCheck aria-hidden="true" />
            {t("accept")}
          </Button>
          <Button type="button" variant="outline" className="max-sm:w-full" onClick={() => setConfirming("decline")} data-testid="carrier-request-decline">
            <CircleX aria-hidden="true" />
            {t("decline")}
          </Button>
        </div>
      ) : null}
      {notice}
      {error ? <InlineError>{error}</InlineError> : null}
    </section>
  );
}

const ICONS: Record<CarrierRequestEvent, typeof Truck> = { requested: PackagePlus, changed: PackageSearch, accepted: PackageCheck, declined: CircleX, withdrawn: Undo2 };

/** A place request step in the thread (system message): who asked or answered, for which departure. */
export function CarrierRequestEventItem({ step, counterpartName, time }: { step: CarrierRequestEventView; counterpartName: string; time: string }) {
  const t = useTranslations("CarrierRequest.event");
  const thread = useTranslations("Messaging.thread");
  const locale = useLocale() as Locale;
  const parts = useBasketParts();
  const Icon = ICONS[step.event];
  const tone = step.event === "accepted" ? "text-success" : step.event === "declined" ? "text-danger" : "text-primary";
  return (
    <li className="group/message flex items-center justify-center gap-1 py-1" data-testid="carrier-request-event" data-event={step.event}>
      <p dir="auto" className="flex max-w-[90%] items-start gap-2 rounded-2xl border border-border bg-surface px-3.5 py-2 text-sm text-pretty shadow-xs">
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden="true" />
        <span className="min-w-0">
          <span className="sr-only">{thread("system")} : </span>
          {t(`${step.event}.${step.byMe ? "mine" : "theirs"}`, { name: isolate(counterpartName), day: formatRentalDay(step.departOn, locale) })}
          {step.basket ? <span className="text-foreground-muted"> ({parts(step.basket).join(locale === "ar" ? "، " : ", ")})</span> : null}
          <time className="ms-2 text-[0.6875rem] text-foreground-muted tabular-nums">{time}</time>
        </span>
      </p>
    </li>
  );
}
