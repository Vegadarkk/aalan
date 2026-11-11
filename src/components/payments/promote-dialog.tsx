"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Coins, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { toast } from "sonner";
import { FormMessage, useApiErrorMessage } from "@/components/auth/form-message";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { InlineError } from "@/components/feedback/inline-error";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { textLinkClassName } from "@/components/ui/text-link";
import type { OptionId } from "@/config/pricing";
import type { Locale } from "@/config/site";
import { getPathname, Link } from "@/i18n/navigation";
import { useNumbersTranslations } from "@/i18n/numbers";
import { numbersLocale } from "@/i18n/params";
import { ApiError, isApiError } from "@/lib/auth/client";
import type { ListingOptionsResponse, OptionOffer } from "@/lib/contracts/payments";
import { isolate } from "@/lib/i18n/bidi";
import { buyListingOption, loadListingOptions } from "@/lib/payments/client";
import { cn } from "@/lib/utils";
import { moroccoTimeZone } from "@/lib/i18n/morocco-time";

// "Mettre en avant" (phase 7 design §5): the paid options of one listing, priced for its category
// by the server, with the mention each one puts on the card, the wallet that pays, and one
// unticked consent box (terms + immediate execution, zone 6 audit 6-17). A purchase keeps one
// request id per option while the dialog is open, so a retry after a lost answer debits once.
// Short of credits (6-03): how many are missing and the way to buy them; the listing is remembered
// (PROMOTE_AFTER_PURCHASE) so the wallet offers to come back to it once the credits are in.

const DAY_MS = 24 * 60 * 60 * 1000;

type Note = { text: string; tone?: "warning" };

/** sessionStorage key: the listing whose promotion waits for a credits purchase (read by the wallet). */
export const PROMOTE_AFTER_PURCHASE = "aalan.promote.after";

/** Remembers `listingId` for the wallet's "back to your listing" (best effort: storage may be off). */
function rememberListing(listingId: string, title: string): void {
  try {
    window.sessionStorage.setItem(PROMOTE_AFTER_PURCHASE, JSON.stringify({ id: listingId, title }));
  } catch {
    // Private mode or blocked storage: the purchase works the same, without the way back.
  }
}

type State = { kind: "loading" } | { kind: "failed"; error: unknown } | { kind: "ready"; data: ListingOptionsResponse; at: number };

/** Codes the dialog explains in its own words (Options.errors). */
const OPTION_ERRORS = ["sales_closed", "billing_owner_only", "boost_not_allowed", "listing_not_promotable", "bump_too_soon", "wallet_frozen", "insufficient_credits", "price_changed"] as const;
type OptionError = (typeof OPTION_ERRORS)[number];

interface PromoteDialogProps {
  listingId: string;
  title: string;
  onClose: () => void;
  /** Where the focus goes back on close (the menu that opened the dialog is gone by then, 6-18). */
  returnFocus?: () => HTMLElement | null;
}

/** Mounted for one opening: fresh prices and wallet, nothing ticked, new request ids each time. */
export function PromoteDialog({ listingId, title, onClose, returnFocus }: PromoteDialogProps) {
  const t = useNumbersTranslations("Options");
  const apiMessage = useApiErrorMessage("listing");
  const locale = useLocale() as Locale;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [choice, setChoice] = useState<OptionId | null>(null);
  const [consent, setConsent] = useState(false);
  const [problems, setProblems] = useState<{ choice?: boolean; consent?: boolean }>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<unknown>(undefined);
  const requests = useRef<Partial<Record<OptionId, string>>>({});
  const descriptionId = useId();
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const date = useCallback((iso: string) => new Intl.DateTimeFormat(numbersLocale(locale), { dateStyle: "long", timeZone: moroccoTimeZone(new Date(iso).getTime()) }).format(new Date(iso)), [locale]);
  // "aujourd'hui à 19:33" or "le 5 nov. à 08:10", in Morocco's time (6-26: an hour alone was ambiguous).
  const when = useCallback(
    (iso: string) => {
      const at = new Date(iso);
      const zone = moroccoTimeZone(at.getTime());
      const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeZone: zone }).format(value);
      const hour = new Intl.DateTimeFormat(numbersLocale(locale), { timeStyle: "short", timeZone: zone }).format(at);
      return day(at) === day(new Date()) ? t("today", { time: hour }) : t("onDay", { date: new Intl.DateTimeFormat(numbersLocale(locale), { day: "numeric", month: "short", timeZone: zone }).format(at), time: hour });
    },
    [locale, t],
  );

  // State changes only once the answer is in (the first render is already "loading").
  const fetchOptions = useCallback(async () => {
    try {
      const data = await loadListingOptions(listingId);
      setState({ kind: "ready", data, at: Date.now() });
    } catch (error) {
      setState({ kind: "failed", error });
    }
  }, [listingId]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void fetchOptions();
  }, [fetchOptions]);

  function load() {
    setState({ kind: "loading" });
    void fetchOptions();
  }

  function messageOf(error: unknown): string {
    return error instanceof ApiError && (OPTION_ERRORS as readonly string[]).includes(error.code) ? t(`errors.${error.code as OptionError}`) : apiMessage(error);
  }

  async function submit() {
    if (state.kind !== "ready") return;
    const offer = state.data.options.find((option) => option.id === choice);
    const next = { choice: !offer, consent: !consent };
    setProblems(next);
    if (!offer || next.consent) {
      // The first message may sit below the fold of the scrolling body: bring it into view once drawn.
      requestAnimationFrame(() => body.current?.querySelector("[role=alert]")?.scrollIntoView({ block: "center" }));
      return;
    }
    const requestId = (requests.current[offer.id] ??= crypto.randomUUID());
    setSubmitting(true);
    setFailure(undefined);
    try {
      const result = await buyListingOption(listingId, offer.id, requestId, offer.coveredByAllowance ? 0 : offer.price);
      toast.success(result.optionId === "bump" || !result.boosts.featuredUntil ? t("success.bump") : t("success.featured", { date: date(result.boosts.featuredUntil) }));
      onClose();
    } catch (error) {
      // A refusal the dialog can show better reloads the prices and the wallet.
      if (isApiError(error, "insufficient_credits", "wallet_frozen", "listing_not_promotable", "price_changed")) {
        // The reloaded offer has its own price: a new request id for it.
        requests.current = {};
        setChoice(null);
        load();
      }
      setFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  /** Under each option: what runs already, and À la Une days the listing's end would cut short. */
  function notesOf(offer: OptionOffer, options: ListingOptionsResponse, at: number): Note[] {
    const notes: Note[] = [];
    if (offer.id === "bump") {
      if (options.boosts.bumpedAt) notes.push({ text: t("bumpedOn", { date: date(options.boosts.bumpedAt) }) });
      return notes;
    }
    const running = options.boosts.featuredUntil ? Date.parse(options.boosts.featuredUntil) : 0;
    if (options.boosts.featuredUntil) notes.push({ text: t("featuredRunning", { date: date(options.boosts.featuredUntil) }) });
    const end = Math.max(at, running) + (offer.days ?? 0) * DAY_MS;
    if (options.expiresAt && end > Date.parse(options.expiresAt)) notes.push({ text: t("expiresFirst", { date: date(options.expiresAt) }), tone: "warning" });
    return notes;
  }

  const data = state.kind === "ready" ? state.data : null;
  // Sales closed, the gift credits of a launch place still pay (owner, 2026-11-11): `optionsOpen`.
  const buyable = data !== null && data.optionsOpen && data.allowed && data.promotable;
  const chosen = data?.options.find((option) => option.id === choice);
  // No option can be paid now (6-03): the credits missing for the cheapest one, and the way to buy them.
  const shortfall = (() => {
    // No credit to buy while sales are closed: only the gift credits pay then.
    if (!data || !buyable || !data.salesOpen || data.wallet.frozen || data.options.some((option) => option.affordable && option.availableAt === null)) return 0;
    const prices = data.options.filter((option) => !option.coveredByAllowance && option.availableAt === null).map((option) => option.price);
    if (prices.length === 0) return 0;
    return Math.max(0, Math.min(...prices) - (Math.max(0, data.wallet.balance) + data.wallet.planCredits));
  })();

  return (
    <Dialog.Root open onOpenChange={(value) => !value && !submitting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bab-950/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={descriptionId}
          // The title first, not « Annuler » (6-18); the focus goes back to the listing's actions.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus?.();
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-lg border border-border bg-surface shadow-xl shadow-bab-950/20 outline-none",
            "sm:inset-x-auto sm:start-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-[88dvh] sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg rtl:sm:translate-x-1/2",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex flex-col gap-1.5 border-b border-border px-5 pt-5 pb-4 sm:px-6">
            <Dialog.Title ref={heading} tabIndex={-1} className="text-lg font-semibold text-balance outline-none">{t("title", { title: isolate(title) })}</Dialog.Title>
            <Dialog.Description id={descriptionId} className="text-sm text-foreground-muted text-pretty">
              {t("intro")}
            </Dialog.Description>
          </div>

          <div ref={body} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 sm:px-6">
            {state.kind === "loading" ? (
              <div aria-busy="true" aria-label={t("loading")} className="flex flex-col gap-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : null}
            {state.kind === "failed" ? (
              <ErrorBanner
                title={t("failed")}
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                    {t("retry")}
                  </Button>
                }
              >
                {messageOf(state.error)}
              </ErrorBanner>
            ) : null}
            {data && !data.optionsOpen ? <ErrorBanner tone="info" title={t("closed")} /> : null}
            {data && data.optionsOpen && !data.salesOpen && data.allowed && data.promotable ? <ErrorBanner tone="info" title={t("giftOnly")} /> : null}
            {data && data.optionsOpen && !data.allowed ? <ErrorBanner tone="info" title={t("notAllowed")} /> : null}
            {data && data.optionsOpen && data.allowed && !data.promotable ? <ErrorBanner tone="warning" title={t("notPromotable")} /> : null}

            {data && buyable ? (
              <>
                <WalletLine data={data} />
                {shortfall > 0 ? (
                  <ErrorBanner
                    tone="info"
                    title={t("shortfall", { count: shortfall })}
                    action={
                      <Button asChild size="sm" className="max-sm:h-11">
                        <Link href="/porte-monnaie/recharger" onClick={() => rememberListing(listingId, title)}>
                          <Coins aria-hidden="true" />
                          {t("buyCredits")}
                        </Link>
                      </Button>
                    }
                  >
                    {t("shortfallBody")}
                  </ErrorBanner>
                ) : null}
                <fieldset className="flex flex-col gap-2.5" aria-invalid={problems.choice ? true : undefined}>
                  <legend className="sr-only">{t("legend")}</legend>
                  {data.options.map((offer) => (
                    <OptionCard
                      key={offer.id}
                      offer={offer}
                      frozen={data.wallet.frozen}
                      when={when}
                      selected={choice === offer.id}
                      onSelect={() => {
                        setChoice(offer.id);
                        setProblems((current) => ({ ...current, choice: false }));
                      }}
                      notes={notesOf(offer, data, state.kind === "ready" ? state.at : 0)}
                    />
                  ))}
                  {problems.choice ? <InlineError>{t("choose")}</InlineError> : null}
                </fieldset>

                {shortfall > 0 ? null : (
                  <div className="flex flex-col gap-3 rounded-md bg-surface-muted p-4">
                    <ConsentBox checked={consent} invalid={problems.consent && !consent} onChange={setConsent}>
                      {t("consent.single")}{" "}
                      <a href={getPathname({ href: "/legal/cgv", locale })} target="_blank" rel="noopener noreferrer" className={cn("font-medium", textLinkClassName)}>
                        {t("consent.termsLink")}
                      </a>
                    </ConsentBox>
                    {problems.consent ? <InlineError>{t("consent.requiredOne")}</InlineError> : null}
                  </div>
                )}
                <FormMessage error={failure} title={failure === undefined ? undefined : messageOf(failure)} />
              </>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                {buyable ? t("cancel") : t("close")}
              </Button>
            </Dialog.Close>
            {buyable ? (
              // Disabled until an option is chosen (6-03); the label says what is spent (6-17).
              <Button type="button" loading={submitting} disabled={!chosen} onClick={() => void submit()}>
                {chosen ? (chosen.coveredByAllowance ? t("confirmIncluded") : t("confirmCredits", { count: chosen.price })) : t("confirmIdle")}
              </Button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WalletLine({ data }: { data: ListingOptionsResponse }) {
  const t = useNumbersTranslations("Options");
  const { wallet } = data;
  const link = (
    <Link href="/porte-monnaie" className={cn("inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-link", textLinkClassName)}>
      <Wallet aria-hidden="true" className="size-4 shrink-0" />
      {t("walletLink")}
    </Link>
  );
  if (wallet.frozen) return <ErrorBanner tone="warning" title={t("frozen")} action={link} />;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="flex flex-col gap-0.5 text-sm">
        {/* Sales closed, purchased credits wait: only the gift credits count. */}
        <p className="font-medium tabular-nums">{t("available", { count: (data.salesOpen ? Math.max(0, wallet.balance) : 0) + wallet.planCredits })}</p>
        {wallet.planCredits > 0 ? <p className="text-foreground-muted">{t(data.account === "personal" ? "availableGift" : "availableDetail", { count: wallet.planCredits })}</p> : null}
        {wallet.featuredAllowance > 0 ? <p className="text-foreground-muted">{t("allowanceLeft", { count: wallet.featuredAllowance })}</p> : null}
      </div>
      {link}
    </div>
  );
}

function OptionCard({ offer, frozen, selected, onSelect, notes, when }: { offer: OptionOffer; frozen: boolean; selected: boolean; onSelect: () => void; notes: Note[]; when: (iso: string) => string }) {
  const t = useNumbersTranslations("Options");
  const card = useTranslations("ListingCard");
  const disabled = !offer.affordable || offer.availableAt !== null;
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-md border bg-surface p-4 transition-colors duration-150",
        disabled ? "cursor-not-allowed border-border opacity-60" : "cursor-pointer",
        !disabled && (selected ? "border-primary bg-primary/5" : "border-border hover:border-border-strong"),
      )}
    >
      <input type="radio" name="listing-option" value={offer.id} checked={selected} disabled={disabled} onChange={onSelect} className="mt-1 size-4 shrink-0 accent-primary" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="font-medium">{t(`options.${offer.id}.title`)}</span>
          <span className={cn("text-sm font-semibold tabular-nums", offer.coveredByAllowance && "text-structure dark:text-gold-300")}>
            {offer.coveredByAllowance ? t("included") : t("price", { count: offer.price })}
          </span>
        </span>
        <span className="text-sm text-foreground-muted text-pretty">{t(`options.${offer.id}.body`)}</span>
        {/* The mention buyers will see on the card (§8), as it is drawn there. */}
        <span className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium",
              offer.id === "bump" ? "border border-featured/70 bg-gold-100/60 text-foreground dark:bg-transparent" : "bg-featured text-featured-foreground",
            )}
          >
            {offer.id === "bump" ? <ArrowUp className="size-3 shrink-0" /> : null}
            {offer.id === "bump" ? card("bumped") : card("featured")}
          </span>
          {offer.availableAt ? <span className="text-xs font-medium text-foreground-muted">{t("availableAt", { when: when(offer.availableAt) })}</span> : null}
          {!offer.affordable && !frozen && !offer.availableAt ? <span className="text-xs font-medium text-danger">{t("insufficient")}</span> : null}
        </span>
        {notes.map((note) => (
          <span key={note.text} className={cn("text-xs text-pretty", note.tone === "warning" ? "text-warning" : "text-foreground-muted")}>
            {note.text}
          </span>
        ))}
      </span>
    </label>
  );
}

function ConsentBox({ checked, invalid, onChange, children }: { checked: boolean; invalid?: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-pretty">
      <input type="checkbox" checked={checked} aria-invalid={invalid ? true : undefined} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span>{children}</span>
    </label>
  );
}
