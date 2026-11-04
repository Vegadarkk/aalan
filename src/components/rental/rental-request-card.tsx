"use client";

import { useCallback, useId, useState } from "react";
import { BedDouble, CalendarCheck, CalendarRange, CalendarX, CarFront, History, KeyRound, MapPin, NotebookPen, Package, ShieldCheck, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { InlineError } from "@/components/feedback/inline-error";
import { Textarea } from "@/components/post/controls/textarea";
import { useMessagingErrorMessage } from "@/components/messages/errors";
import { Button } from "@/components/ui/button";
import { SITE_NAME, type Locale } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/auth/client";
import { URL_MARKER } from "@/lib/contracts/messaging";
import { rentalRequestOpen, type RentalRequestAction, type RentalRequestResponse, type RentalRequestView } from "@/lib/contracts/rental-requests";
import { isolate } from "@/lib/i18n/bidi";
import { moroccoToday, rentalDuration } from "@/lib/listings/rental-availability";
import { postRentalRequestAction } from "@/lib/rental-requests/client";
import { cn } from "@/lib/utils";
import { formatRentalDay } from "./rental-day";

// The conversation's current booking request of a car rental, pinned under the thread header while
// it is open (rental pack §6); a holiday home's stay reads by nights, with the guest's note, and has
// no pick-up appointment (seasonal rental conception §3). For the agency: the renter's days and pick-up place, "Disponible"
// (optionally blocking the days on the listing) or "Pas disponible". For the renter: the request
// sent, withdraw it. Once accepted: the days, and the pick-up appointment of the messaging (a stay:
// the arrival). The agency's answer takes a second step (audit L4-07): it confirms « Disponible » or
// « Pas disponible » and may add a word (another period, another vehicle), sent as its own message.
// The card always says that nothing is paid through the site. The earlier requests of the
// conversation stay listed under it with their answer (audit L4-04).

const ERROR_KEYS = ["rental_request_changed", "rental_request_past", "rental_request_unavailable", "place_payment_details"] as const;

/** Texts of a stay (RentalRequest.card.home), the car rental's otherwise. */
type HomeKey = "period" | "pickup" | "waiting" | "requestedTheirs" | "block" | "blockHint" | "blockFailed" | "planning" | "blockedNote" | "safety" | "pickupAppointment" | "notePlaceholderAccept" | "notePlaceholderDecline" | "confirmAccept" | "confirmDecline";
export const rentalCardKey = <K extends HomeKey>(key: K, unit: RentalRequestView["unit"]) => (unit === "night" ? (`home.${key}` as const) : key);

export function useRentalRequestErrorMessage(): (error: unknown) => string {
  const t = useTranslations("RentalRequest.errors");
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

export interface RentalRequestCardProps {
  cid: string;
  request: RentalRequestView;
  counterpartName: string;
  /** False when the conversation is read-only (blocked, frozen, closed, suspended): no action. */
  writable: boolean;
  /** The thread's clock (refreshed every 15 s). */
  now: number;
  onChange: (response: RentalRequestResponse) => void;
  /** Opens the slot picker on a pick-up appointment (a stay: the arrival); absent while an appointment is active. */
  onPickup?: () => void;
  /** Sends the agency's word with its answer as a message of the thread; resolves false when it failed. */
  onNote?: (text: string) => Promise<boolean>;
}

/** The agency's word with its answer: a message of the thread, so the composer's limit. */
export const RENTAL_NOTE_MAX = 500;

export function RentalRequestCard({ cid, request, counterpartName, writable, now, onChange, onPickup, onNote }: RentalRequestCardProps) {
  const t = useTranslations("RentalRequest.card");
  const locale = useLocale() as Locale;
  const id = useId();
  const errorMessage = useRentalRequestErrorMessage();
  const [busy, setBusy] = useState<RentalRequestAction["action"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [block, setBlock] = useState(true);
  const [blockFailed, setBlockFailed] = useState(false);
  /** The answer the agency is confirming, with its optional word. */
  const [confirming, setConfirming] = useState<"accept" | "decline" | null>(null);
  const [note, setNote] = useState("");

  if (!rentalRequestOpen(request, moroccoToday(now))) return null;
  const name = isolate(counterpartName);
  const agency = !request.requestedByMe;
  const stay = request.unit === "night";
  const k = <K extends HomeKey>(key: K) => rentalCardKey(key, request.unit);

  async function act(action: RentalRequestAction, done: string) {
    setBusy(action.action);
    setError(null);
    try {
      const response = await postRentalRequestAction(cid, action);
      setBlockFailed(response.blocked === false);
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

  const period = (
    <p className="flex items-center gap-1.5 text-sm font-medium">
      <CalendarRange className="size-4 shrink-0 text-structure dark:text-gold-300" aria-hidden="true" />
      <span className="tabular-nums">{t(k("period"), { from: formatRentalDay(request.from, locale), to: formatRentalDay(request.to, locale), days: rentalDuration(request) })}</span>
    </p>
  );
  const guests =
    stay && request.guests ? (
      <p className="flex items-center gap-1.5 text-sm text-foreground-muted" data-testid="rental-request-guests">
        <Users className="size-4 shrink-0" aria-hidden="true" />
        <span>{t("home.guests", { count: request.guests })}</span>
      </p>
    ) : null;
  const PickupIcon = stay ? NotebookPen : MapPin;
  const pickup = request.pickup ? (
    <p dir="auto" className="flex items-center gap-1.5 text-sm text-foreground-muted">
      <PickupIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{t(k("pickup"), { place: isolate(request.pickup.split(URL_MARKER).join(t("maskedLink"))) })}</span>
    </p>
  ) : null;
  const safety = (
    <p className="flex gap-1.5 text-xs text-foreground-muted text-pretty">
      <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden="true" />
      {t(k("safety"), { site: SITE_NAME })}
    </p>
  );
  const frame = "mx-3 mt-3 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3.5 shadow-sm lg:mx-5";
  const badge = (accepted: boolean) => (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-t-full rounded-b-sm",
        accepted ? "bg-success-surface text-success" : agency ? "bg-primary text-primary-foreground" : "bg-primary/12 text-primary",
      )}
    >
      {accepted ? <CalendarCheck className="size-4.5" /> : stay ? <BedDouble className="size-4.5" /> : <CarFront className="size-4.5" />}
    </span>
  );

  if (request.status === "accepted") {
    return (
      <section aria-labelledby={`${id}-title`} className={cn(frame, "border-structure/25")} data-testid="rental-request-card" data-status="accepted">
        <div className="flex items-start gap-3">
          {badge(true)}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 id={`${id}-title`} className="font-semibold text-pretty">
              {agency ? t("acceptedMine") : t("acceptedTheirs", { name })}
            </h3>
            {period}
            {guests}
            {pickup}
            {request.blocked ? <p className="text-xs text-foreground-muted">{t(k("blockedNote"))}</p> : null}
          </div>
        </div>
        {blockFailed ? (
          <div className="flex flex-col items-start gap-2">
            <InlineError>{t(k("blockFailed"))}</InlineError>
            <Button asChild variant="outline" size="sm" className="max-sm:h-11">
              <Link href={stay ? "/mes-annonces" : "/pro/flotte"}>{t(k("planning"))}</Link>
            </Button>
          </div>
        ) : null}
        {writable && onPickup ? (
          <Button type="button" variant="outline" size="sm" className="self-start max-sm:h-11" onClick={onPickup} data-testid="rental-request-pickup">
            {stay ? <KeyRound aria-hidden="true" /> : <Package aria-hidden="true" />}
            {t(k("pickupAppointment"))}
          </Button>
        ) : null}
        {safety}
      </section>
    );
  }

  if (!agency) {
    return (
      <section aria-labelledby={`${id}-title`} className={frame} data-testid="rental-request-card" data-status="requested-mine">
        <div className="flex items-start gap-3">
          {badge(false)}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 id={`${id}-title`} className="font-semibold text-pretty">
              {t("requestedMine", { name })}
            </h3>
            {period}
            {guests}
            {pickup}
            <p className="text-sm text-foreground-muted">{t(k("waiting"))}</p>
          </div>
        </div>
        {writable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start max-sm:h-11"
            loading={busy === "withdraw"}
            onClick={() => void act({ action: "withdraw", id: request.id }, t("withdrawnToast"))}
          >
            {t("withdraw")}
          </Button>
        ) : null}
        {safety}
        {error ? <InlineError>{error}</InlineError> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className={cn(frame, "border-primary/40 ring-1 ring-primary/15")} data-testid="rental-request-card" data-status="requested-theirs">
      <div className="flex items-start gap-3">
        {badge(false)}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={`${id}-title`} className="font-semibold text-pretty">
            {t(k("requestedTheirs"), { name })}
          </h3>
          {period}
          {guests}
          {pickup}
        </div>
      </div>
      {writable && confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-muted p-3" data-testid="rental-request-confirm" data-answer={confirming}>
          <p className="text-sm font-medium text-pretty">{t(k(confirming === "accept" ? "confirmAccept" : "confirmDecline"), { name })}</p>
          {confirming === "accept" ? (
            <label htmlFor={`${id}-block`} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface px-3 py-2.5 has-[:checked]:border-structure has-[:checked]:bg-structure/5">
              <input
                id={`${id}-block`}
                type="checkbox"
                checked={block}
                onChange={(event) => setBlock(event.target.checked)}
                aria-describedby={`${id}-block-hint`}
                data-testid="rental-request-block"
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-structure)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t(k("block"))}</span>
                <span id={`${id}-block-hint`} className="text-xs text-foreground-muted text-pretty">
                  {t(k("blockHint"))}
                </span>
              </span>
            </label>
          ) : null}
          {onNote ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-note`} className="text-sm font-medium">
                {t("note")}
              </label>
              <Textarea
                id={`${id}-note`}
                rows={2}
                maxLength={RENTAL_NOTE_MAX}
                value={note}
                onChange={(event) => setNote(event.target.value.replace(/[⟦⟧]/g, ""))}
                placeholder={t(k(confirming === "accept" ? "notePlaceholderAccept" : "notePlaceholderDecline"))}
                data-testid="rental-request-note"
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant={confirming === "accept" ? "primary" : "outline"}
              className="max-sm:w-full"
              loading={busy !== null}
              onClick={() =>
                void act(confirming === "accept" ? { action: "accept", id: request.id, block } : { action: "decline", id: request.id }, t(confirming === "accept" ? "acceptedToast" : "declinedToast"))
              }
              data-testid="rental-request-confirm-send"
            >
              {confirming === "accept" ? <CalendarCheck aria-hidden="true" /> : <CalendarX aria-hidden="true" />}
              {t(confirming === "accept" ? "confirmAcceptButton" : "confirmDeclineButton")}
            </Button>
            <Button type="button" variant="ghost" className="max-sm:w-full" disabled={busy !== null} onClick={() => setConfirming(null)}>
              {t("back")}
            </Button>
          </div>
        </div>
      ) : writable ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" className="max-sm:w-full" onClick={() => setConfirming("accept")} data-testid="rental-request-accept">
            <CalendarCheck aria-hidden="true" />
            {t("accept")}
          </Button>
          <Button type="button" variant="outline" className="max-sm:w-full" onClick={() => setConfirming("decline")} data-testid="rental-request-decline">
            <CalendarX aria-hidden="true" />
            {t("decline")}
          </Button>
        </div>
      ) : null}
      {safety}
      {error ? <InlineError>{error}</InlineError> : null}
    </section>
  );
}

const HISTORY_STATUS_TONES: Record<RentalRequestView["status"], string> = {
  accepted: "bg-success-surface text-success",
  declined: "bg-surface-muted text-foreground-muted",
  withdrawn: "bg-surface-muted text-foreground-muted",
  requested: "bg-surface-muted text-foreground-muted",
};

/**
 * The conversation's earlier requests under the current card (audit L4-04): an accepted rental
 * still ahead stays in sight, one line each; the others (declined, withdrawn, over) fold under
 * « Demandes précédentes ». The thread keeps every step as well.
 */
export function RentalRequestHistory({ history, now }: { history: readonly RentalRequestView[]; now: number }) {
  const t = useTranslations("RentalRequest.history");
  const card = useTranslations("RentalRequest.card");
  const locale = useLocale() as Locale;
  const today = moroccoToday(now);
  const ahead = history.filter((request) => request.status === "accepted" && rentalRequestOpen(request, today));
  const earlier = history.filter((request) => !ahead.includes(request));
  const line = (request: RentalRequestView, done: boolean) => (
    <li key={request.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="rental-history-item" data-status={done ? "past" : request.status}>
      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", HISTORY_STATUS_TONES[request.status])}>
        {t(`status.${done ? "past" : request.status}`)}
      </span>
      <span className="tabular-nums">{card(rentalCardKey("period", request.unit), { from: formatRentalDay(request.from, locale), to: formatRentalDay(request.to, locale), days: rentalDuration(request) })}</span>
      {request.unit === "night" && request.guests ? <span className="text-foreground-muted">{card("home.guests", { count: request.guests })}</span> : null}
    </li>
  );
  return (
    <section aria-label={t("title")} className="mx-3 mt-2 flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 lg:mx-5" data-testid="rental-history">
      {ahead.length > 0 ? (
        <>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground-muted">
            <CalendarCheck className="size-3.5 text-success" aria-hidden="true" />
            {t("ahead")}
          </h3>
          <ul className="flex flex-col gap-1.5">{ahead.map((request) => line(request, false))}</ul>
        </>
      ) : null}
      {earlier.length > 0 ? (
        <details className="group text-sm">
          <summary className="flex cursor-pointer items-center gap-1.5 rounded-sm text-xs font-semibold text-foreground-muted hover:text-foreground">
            <History className="size-3.5" aria-hidden="true" />
            {t("earlier", { count: earlier.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">{earlier.map((request) => line(request, request.status === "accepted"))}</ul>
        </details>
      ) : null}
    </section>
  );
}
