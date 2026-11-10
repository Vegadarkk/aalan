"use client";

import { useEffect, useEffectEvent, useId, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { BedDouble, CalendarClock, CalendarRange, CarFront, HandCoins, LogIn, MessageCircle, MessageSquare, MessagesSquare, PencilLine, Phone, RotateCw, Settings2, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { InlineError } from "@/components/feedback/inline-error";
import { loadWithRetry } from "@/components/layout/chunk-retry";
import { RENTAL_DATES_EVENT, clearPendingContact, contactFragment, fragmentDates, pendingContact } from "@/components/rental/rental-day";
import { Button } from "@/components/ui/button";
import type { RentalUnit } from "@/config/categories";
import { getPathname, Link } from "@/i18n/navigation";
import { ApiError, apiPost, loadSession, useSession } from "@/lib/auth/client";
import type { SessionSummary } from "@/lib/contracts/auth";
import { LISTING_API, MESSAGING_API } from "@/lib/contracts/endpoints";
import type { PhoneRevealResponse } from "@/lib/contracts/listings";
import { isolateLtr } from "@/lib/i18n/bidi";
import { findBuyerConversation, findListingConversation, findShopConversation } from "@/lib/messaging/client";
import { RentalRequestBanner, shownRentalRequest } from "@/components/rental/rental-request-banner";
import { ConversationStatusBanner, listingConversationStatus, type ListingConversationStatus } from "./conversation-status";
import type { RentalRequestView } from "@/lib/contracts/rental-requests";
import { cn } from "@/lib/utils";
import type { RevealChallengeProps, RevealErrorProps } from "./contact-feedback";
import type { MessageDialogProps } from "./message-dialog";
import { useVariantSelection } from "./variant-selection";
import { isWhatsappUrl, revealFailure } from "./reveal";

export { isWhatsappUrl, REVEAL_ERROR_KEYS, revealFailure, type RevealErrorKey } from "./reveal";

// Contact actions of a published listing (design §5, phase-5 U1): the message button, which opens
// the buyer's conversation about the listing when there is one, else the first-message dialog
// (message-dialog.tsx, then /messages/{cid}), and the phone reveal island
// (POST /api/listings/{id}/phone with the phase 2 CSRF header; the number is never in the ISR HTML)
// with WhatsApp once revealed, both shown only when the seller offers them (no phone check while
// WhatsApp is parked, so messaging is then the only channel). The message is the main action
// (ochre) and the phone the secondary one: messaging is the platform's channel, the number an
// option of the seller (UX audit, 29 Oct 2026). Anonymous visitors get a sign-in link, shown
// under the buttons, that brings them back here; the seller sees links to edit the listing and to
// their listings instead. A signed-in buyer who already wrote about the listing gets « Voir la
// conversation » and a reminder of a pending or accepted offer and of a confirmed appointment
// (audit zone 5 n°14), from the first page of their inbox: the page itself is cached for everyone.
// On phones the actions sit in a bar fixed to the bottom of the screen: the message and the listing's own
// action (dates, visit, test drive or offer), the number as an icon beside them; from lg they sit in the seller card. The
// dialog, the challenge and the refusal messages load on demand: most visitors never need them.
// When their chunk cannot be downloaded (dropped connection, tab opened before a redeploy) the
// download is tried again, then the visitor is asked to reload (chunk-retry.tsx).

/** Stands in for the challenge or a refusal message while their chunk cannot be downloaded. */
export function RevealFeedbackFallback() {
  const t = useTranslations("ListingPage.contact");
  return (
    <div className="flex flex-col items-start gap-2">
      <InlineError>{t("errors.outdated")}</InlineError>
      <Button type="button" variant="outline" onClick={() => window.location.reload()}>
        <RotateCw aria-hidden="true" />
        {t("reload")}
      </Button>
    </div>
  );
}

export const loadRevealChallenge = loadWithRetry<RevealChallengeProps>(() => import("./contact-feedback").then((module) => module.RevealChallenge), RevealFeedbackFallback);
export const loadRevealError = loadWithRetry<RevealErrorProps>(() => import("./contact-feedback").then((module) => module.RevealError), RevealFeedbackFallback);
/** The dialog's chunk is missing: the reload request shows in the bar instead. */
function MessageDialogFallback(props: MessageDialogProps) {
  return props.open ? <RevealFeedbackFallback /> : null;
}
export const loadMessageDialog = loadWithRetry<MessageDialogProps>(() => import("./message-dialog").then((module) => module.MessageDialog), MessageDialogFallback);

const RevealChallenge = dynamic(() => loadRevealChallenge(), { ssr: false });
const RevealError = dynamic(() => loadRevealError(), { ssr: false });
const MessageDialog = dynamic(() => loadMessageDialog(), { ssr: false });

export interface ContactBarProps {
  listingId: string;
  /** Canonical `{slug}-{id}`: the `?next=` of the sign-in link. */
  slugId: string;
  /** Hides the actions from the seller looking at their own listing. */
  sellerPublicId: string;
  /** The owner's edit link (`ownerEditPath`): the wizard, or the tool that made the listing (« Mes départs »). */
  editHref?: string;
  /** Title of the message dialog ("Écrire à {name}"). */
  sellerName?: string;
  /** Reminded in the message dialog. */
  listingTitle?: string;
  showPhone: boolean;
  whatsapp: boolean;
  /** Adults-only listing: the message dialog asks the buyer's 18+ confirmation. */
  adultsOnly?: boolean;
  /**
   * Real estate: a "Demander une visite" action. It writes the first message like the message
   * button, then opens the conversation on the appointment slots (`?rdv=visit`). No booking, no
   * deposit: the visit is agreed in the messaging.
   */
  visit?: boolean;
  /**
   * A Pro's vehicle for sale (Concession pack): "Demander un essai" writes a first message, then
   * opens the thread with the slot picker of a test drive (`?rdv=test_drive`).
   */
  testDrive?: boolean;
  /**
   * A car rental (rental pack §6, `day`): "Demander une réservation" always opens the first-message
   * dialog with the days and the pick-up place (an existing conversation takes the request too); the
   * agency answers on the request's card in the thread. A holiday home (`night`): "Demander un
   * séjour", arrival and departure, the host answers the same way.
   */
  rental?: RentalUnit;
  /**
   * A price offer is possible (Carte vivante lot 5): "Faire une offre" writes the first message with
   * the amount, or opens the existing conversation on the offer dialog (`?offre=1`). The price is
   * the one the amount is checked against (promo included).
   */
  offer?: { price: number } | null;
  /**
   * A shop's storefront (UX audit of the Pro shops, lot 1): `listingId` is the shop's proId and
   * `slugId` its storefront segment. The message goes to the shop (no listing), the number comes
   * from the shop's reveal route, and the wide block sits in the storefront's contact card.
   */
  shop?: boolean;
  /** Options can be bought for this listing (sales open, category with paid options): the owner's view links to them. */
  promotable?: boolean;
}

export type ComposeIntent = "message" | "visit" | "test_drive" | "rental" | "offer";

/** The conversation page, opened on the slots of a visit or a test drive, or on the offer dialog. */
export function threadHref(cid: string, intent: ComposeIntent): string {
  if (intent === "offer") return `/messages/${cid}?offre=1`;
  return intent === "message" || intent === "rental" ? `/messages/${cid}` : `/messages/${cid}?rdv=${intent}`;
}

type Phone = PhoneRevealResponse["phone"];

export type MessageStep = { kind: "signin" } | { kind: "thread"; cid: string } | { kind: "compose" };

export interface MessageStepDeps {
  loadSession: () => Promise<SessionSummary | null>;
  findListingConversation: (listingId: string) => Promise<string | null>;
}

/**
 * What the message button does: sign in first, open the conversation the viewer already has about
 * the listing, or write the first message (also when that lookup fails). No phone check (D8).
 */
export async function messageStep(listingId: string, deps: MessageStepDeps = { loadSession, findListingConversation }): Promise<MessageStep> {
  const viewer = await deps.loadSession();
  if (!viewer) return { kind: "signin" };
  const cid = await deps.findListingConversation(listingId).catch(() => null);
  return cid ? { kind: "thread", cid } : { kind: "compose" };
}

type RevealState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "signin" }
  /** The IP allowance is spent (escalation.ts): a Turnstile challenge, then the same request with its token. */
  | { kind: "challenge"; failed: boolean }
  | { kind: "revealed"; phone: Phone }
  | { kind: "error"; error: unknown };

const subscribeNever = () => () => {};

/** Tailwind `lg`: the actions sit in the seller card from here, in the fixed phone bar below. */
const DESKTOP_QUERY = "(min-width: 64rem)";

function subscribeDesktop(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** One layout renders the challenge: two Turnstile widgets would ask twice. */
function useDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
}

/**
 * Room for the fixed phone bar after the footer (portalled to the end of <body>): without it the bar
 * would cover the last lines of the page. Client only, below the fold: no visible shift.
 */
function BarSpacer({ tall = false }: { tall?: boolean }) {
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  return mounted ? createPortal(<div aria-hidden="true" data-testid="contact-bar-spacer" className={cn(tall ? "h-36" : "h-24", "lg:hidden")} />, document.body) : null;
}

export function ContactBar({ listingId, slugId, sellerPublicId, editHref, sellerName, listingTitle, showPhone, whatsapp, adultsOnly = false, visit = false, testDrive = false, rental, offer = null, shop = false, promotable = false }: ContactBarProps) {
  const t = useTranslations("ListingPage.contact");
  const stay = rental === "night";
  const offers = useTranslations("Offers.listing");
  const locale = useLocale();
  const { status, session } = useSession();
  const hintId = useId();
  const [state, setState] = useState<RevealState>({ kind: "idle" });
  /** closed; checking the session; signin: anonymous, the prompt shows; open: the dialog (mounted from then on). */
  const [compose, setCompose] = useState<"closed" | "checking" | "signin" | "open">("closed");
  const [composeMounted, setComposeMounted] = useState(false);
  const [intent, setIntent] = useState<ComposeIntent>("message");
  const desktop = useDesktop();
  /** The combination picked on the page (Pro catalogue): the first message names it. */
  const variant = useVariantSelection(listingId);

  const canReveal = showPhone || whatsapp;
  const own = status === "ready" && session !== null && session.publicId === sellerPublicId;
  const next = shop ? `/${locale}/boutique/${slugId}` : `/${locale}/annonce/${slugId}`;
  /**
   * The listing's own action beside "Message" in the phone bar (owner's choice, 30 Oct 2026, UX
   * journeys 8): the dates of a rental, a visit, a test drive or an offer, the first that applies.
   */
  const barIntent: Exclude<ComposeIntent, "message"> | null = rental ? "rental" : visit ? "visit" : testDrive ? "test_drive" : offer ? "offer" : null;

  async function reveal(turnstileToken?: string) {
    if (state.kind === "loading") return;
    setState({ kind: "loading" });
    const viewer = await loadSession();
    if (!viewer) {
      setState({ kind: "signin" });
      return;
    }
    try {
      const { phone } = await apiPost<PhoneRevealResponse>(shop ? MESSAGING_API.shopPhone(listingId) : LISTING_API.phone(listingId), turnstileToken ? { turnstileToken } : {});
      setState({ kind: "revealed", phone });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      if (code === "turnstile_required" || code === "turnstile_failed") {
        // A refused token is single use: the widget mounts again for a fresh one.
        setState({ kind: "challenge", failed: code === "turnstile_failed" || turnstileToken !== undefined });
        return;
      }
      setState(revealFailure(error) === "signin" ? { kind: "signin" } : { kind: "error", error });
    }
  }

  async function openComposer(next: ComposeIntent = "message") {
    if (compose === "checking") return;
    setIntent(next);
    setCompose("checking");
    const step = await messageStep(listingId, shop ? { loadSession, findListingConversation: findShopConversation } : undefined);
    if (step.kind === "signin") {
      setCompose("signin");
    } else if (step.kind === "thread" && next !== "rental") {
      // Another root layout (private pages): a document load either way. The button spins until then.
      window.location.assign(getPathname({ href: threadHref(step.cid, next), locale }));
    } else {
      setComposeMounted(true);
      setCompose("open");
    }
  }

  /** The rental buttons: the dialog on the days the calendar or the search left in the fragment (audit L4-05). */
  function openRentalComposer() {
    const dates = fragmentDates(window.location.hash);
    setDatesKey(dates ? `${dates.from}_${dates.to}` : "");
    void openComposer("rental");
  }

  /** Days picked on the listing page's calendar (they are in the fragment): a fresh request dialog on them. */
  const [datesKey, setDatesKey] = useState("");
  const onRentalDates = useEffectEvent((dates: { from: string; to: string }) => {
    if (!rental || own) return;
    setDatesKey(`${dates.from}_${dates.to}`);
    void openComposer("rental");
  });
  useEffect(() => {
    const listener = (event: Event) => onRentalDates((event as CustomEvent<{ from: string; to: string }>).detail);
    window.addEventListener(RENTAL_DATES_EVENT, listener);
    return () => window.removeEventListener(RENTAL_DATES_EVENT, listener);
  }, []);

  /**
   * Back from the sign-in page (audit L4-03, zone 5 n°8): the dialog the visitor had opened comes
   * back by itself, on the days already picked, once the session is known. Only the intents this
   * listing offers; the key leaves the address bar so a reload does not reopen it.
   */
  const resumeContact = useEffectEvent(() => {
    const pending = pendingContact(window.location.hash);
    if (!pending) return;
    clearPendingContact();
    const offered: Record<ComposeIntent, boolean> = { message: true, rental: Boolean(rental), visit, test_drive: testDrive, offer: offer !== null };
    const wanted = (Object.keys(offered) as ComposeIntent[]).find((candidate) => candidate === pending && offered[candidate]);
    if (!wanted) return;
    if (wanted === "rental") {
      const dates = fragmentDates(window.location.hash);
      setDatesKey(dates ? `${dates.from}_${dates.to}` : "");
    }
    void openComposer(wanted);
  });
  const signedIn = status === "ready" && session !== null;

  /**
   * The buyer's conversation about this listing, once signed in: its id (« Voir la conversation »),
   * the renter's request (audit L4-09), the offer and the appointment (audit zone 5 n°14).
   */
  const [mine, setMine] = useState<{ cid: string; request: RentalRequestView | null; status: ListingConversationStatus | null } | null>(null);
  useEffect(() => {
    if (!signedIn || own || shop) return;
    let live = true;
    findBuyerConversation(listingId)
      .then((conversation) => {
        if (!live) return;
        const now = Date.now();
        setMine(conversation ? { cid: conversation.cid, request: rental ? shownRentalRequest(conversation, now) : null, status: listingConversationStatus(conversation, now) } : null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [rental, signedIn, own, shop, listingId]);
  const myRequest = mine?.request ? { cid: mine.cid, request: mine.request } : null;
  // The rental request has its own banner; the offer and appointment reminder shows otherwise.
  const myStatus = !myRequest && mine?.status ? mine.status : null;
  const conversationCid = mine?.cid ?? null;
  useEffect(() => {
    if (!signedIn || own) return;
    // After the commit, and once (a strict-mode remount clears the first timer).
    const timer = window.setTimeout(resumeContact, 0);
    return () => window.clearTimeout(timer);
  }, [signedIn, own]);

  if (own) {
    return (
      <div data-testid="contact-bar" className="flex flex-col gap-3 rounded-md bg-surface-muted p-4">
        <p className="text-sm text-pretty">{shop ? t("ownShop") : t("own")}</p>
        <div className="flex flex-wrap gap-2">
          {/* The owner's own actions instead of the buyer's (zone 3 audit P3-9); the wizard path of lib/listings/client/routes. */}
          {shop ? null : (
            <Button asChild variant="primary" className="self-start">
              <Link href={editHref ?? `/deposer/${encodeURIComponent(listingId)}`}>
                <PencilLine aria-hidden="true" />
                {t("edit")}
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="self-start">
            <Link href={shop ? "/pro" : "/mes-annonces"}>
              <Settings2 aria-hidden="true" />
              {t("manage")}
            </Link>
          </Button>
          {/* The owner's way to the options from the page itself (zone 6 audit 6-04): "Mes annonces" opens them. */}
          {promotable && !shop ? (
            <Button asChild variant="outline" className="self-start">
              <Link href={`/mes-annonces?promouvoir=${encodeURIComponent(listingId)}`}>
                <TrendingUp aria-hidden="true" />
                {t("promote")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const revealLabel = showPhone ? t("showPhone") : t("showWhatsapp");
  const revealed = state.kind === "revealed" ? state.phone : null;

  // The phone actions: secondary under the message button in the seller card; in the phone bar,
  // where the message button leaves once the number shows, the first revealed action takes the lead.
  const phoneActions = (wide: boolean, iconOnly = false) =>
    revealed ? (
      <>
        {showPhone ? (
          <Button asChild variant={wide ? "primary" : "outline"} className={cn(wide && "min-w-0 flex-1")}>
            <a href={`tel:${revealed.e164}`} aria-label={t("call", { number: isolateLtr(revealed.display) })}>
              <Phone aria-hidden="true" />
              <span dir="ltr" className="tabular-nums">
                {revealed.display}
              </span>
            </a>
          </Button>
        ) : null}
        {revealed.whatsappUrl && isWhatsappUrl(revealed.whatsappUrl) ? (
          <Button asChild variant={wide && !showPhone ? "primary" : "outline"} className={cn(wide && "min-w-0 flex-1")}>
            <a href={revealed.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden="true" />
              {t("whatsapp")}
            </a>
          </Button>
        ) : null}
      </>
    ) : iconOnly ? (
      // Three actions in the bar: the number's button keeps its icon and its name.
      <Button type="button" variant="outline" size="icon" onClick={() => void reveal()} loading={state.kind === "loading"} aria-label={revealLabel} title={revealLabel} className="shrink-0">
        <Phone aria-hidden="true" />
      </Button>
    ) : (
      <Button type="button" variant="outline" onClick={() => void reveal()} loading={state.kind === "loading"} className={cn(wide && "min-w-0 flex-1")}>
        <Phone aria-hidden="true" />
        {revealLabel}
      </Button>
    );

  // `compact`: the narrow half of the phone bar ("Message" instead of "Envoyer un message"); `wide`:
  // alone in the phone bar.
  // With a conversation already there, the button opens it (a document load, as from the dialog).
  const messageButton = (compact: boolean, wide = false) =>
    conversationCid ? (
      <Button asChild variant="primary" aria-describedby={hintId} className={cn(compact && "min-w-0 flex-1 px-3", wide && "min-w-0 flex-1")}>
        <a href={getPathname({ href: threadHref(conversationCid, "message"), locale })} data-testid="conversation-link">
          <MessagesSquare aria-hidden="true" />
          {compact ? t("conversationShort") : t("conversation")}
        </a>
      </Button>
    ) : (
      <Button
        type="button"
        variant="primary"
        onClick={() => void openComposer()}
        loading={compose === "checking" && intent === "message"}
        aria-describedby={hintId}
        aria-haspopup="dialog"
        className={cn(compact && "min-w-0 flex-1 px-3", wide && "min-w-0 flex-1")}
      >
        <MessageSquare aria-hidden="true" />
        {compact ? t("messageShort") : t("message")}
      </Button>
    );

  const visitButton = (compact: boolean) =>
    visit ? (
      <Button
        type="button"
        variant="outline"
        onClick={() => void openComposer("visit")}
        loading={compose === "checking" && intent === "visit"}
        aria-haspopup="dialog"
        data-testid="visit-button"
        className={cn(compact && "min-w-0 flex-1 px-3")}
      >
        <CalendarClock aria-hidden="true" />
        {compact ? t("visitShort") : t("visit")}
      </Button>
    ) : null;

  // The phone bar's second button: the visit keeps its button, the others get a short label.
  const barAction =
    barIntent === "visit" ? (
      visitButton(true)
    ) : barIntent ? (
      <Button
        type="button"
        variant="outline"
        onClick={() => (barIntent === "rental" ? openRentalComposer() : void openComposer(barIntent))}
        loading={compose === "checking" && intent === barIntent}
        aria-haspopup="dialog"
        data-testid="contact-bar-action"
        data-intent={barIntent}
        className="min-w-0 flex-1 px-3"
      >
        {barIntent === "rental" ? stay ? <BedDouble aria-hidden="true" /> : <CalendarRange aria-hidden="true" /> : barIntent === "test_drive" ? <CarFront aria-hidden="true" /> : <HandCoins aria-hidden="true" />}
        {barIntent === "rental" ? t(stay ? "home.rentalShort" : "rentalShort") : barIntent === "test_drive" ? t("testDriveShort") : offers("makeShort")}
      </Button>
    ) : null;

  // Shown only after a click (never server rendered): the fragment of this very page is known.
  const signIn = (body: string, resume?: ComposeIntent) => (
    <div className="flex flex-col gap-2 rounded-md bg-surface-muted p-3 text-sm">
      <p className="text-pretty">{body}</p>
      <Button asChild variant="structure" className="self-start">
        <Link href={{ pathname: "/connexion", query: { next: resume ? `${next}${contactFragment(window.location.hash, resume)}` : next } }}>
          <LogIn aria-hidden="true" />
          {t("signIn")}
        </Link>
      </Button>
    </div>
  );

  const feedback = (inDesktopBlock: boolean) =>
    state.kind === "challenge" ? (
      inDesktopBlock === desktop ? (
        <RevealChallenge failed={state.failed} onToken={(token) => void reveal(token)} />
      ) : null
    ) : compose === "signin" ? (
      signIn(intent === "visit" ? t("signInVisit") : intent === "rental" ? t(stay ? "home.signInRental" : "signInRental") : intent === "offer" ? offers("signIn") : t("signInMessage"), intent)
    ) : state.kind === "signin" ? (
      signIn(t("signInBody"))
    ) : state.kind === "error" ? (
      <RevealError error={state.error} />
    ) : null;

  const hint = (
    <p id={hintId} className="text-xs text-foreground-muted text-pretty">
      {conversationCid ? t("conversationHint") : t("messageHint")}
    </p>
  );

  return (
    <div data-testid="contact-bar">
      {/* lg and up: inside the seller card. The sign-in prompt, the challenge and the errors come
          under the buttons, so the one just clicked stays in place. */}
      <div className="hidden flex-col gap-3 lg:flex">
        {myStatus ? <ConversationStatusBanner status={myStatus} /> : null}
        {messageButton(false)}
        {canReveal ? <div className="flex flex-col gap-2">{phoneActions(false)}</div> : null}
        {visitButton(false)}
        {feedback(true)}
        {hint}
      </div>
      {rental ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {myRequest ? (
            <div className="hidden lg:block">
              <RentalRequestBanner cid={myRequest.cid} request={myRequest.request} />
            </div>
          ) : null}
          <Button
            type="button"
            variant="structure"
            onClick={openRentalComposer}
            loading={compose === "checking" && intent === "rental"}
            aria-haspopup="dialog"
            data-testid="rental-request-button"
            className="w-full"
          >
            {stay ? <BedDouble aria-hidden="true" /> : <CalendarRange aria-hidden="true" />}
            {t(stay ? "home.rental" : "rental")}
          </Button>
          <p className="text-xs text-foreground-muted text-pretty">{t(stay ? "home.rentalHint" : "rentalHint")}</p>
        </div>
      ) : null}
      {offer ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <Button
            type="button"
            variant="structure"
            onClick={() => void openComposer("offer")}
            loading={compose === "checking" && intent === "offer"}
            aria-haspopup="dialog"
            data-testid="offer-button"
            className="w-full"
          >
            <HandCoins aria-hidden="true" />
            {offers("make")}
          </Button>
          <p className="text-xs text-foreground-muted text-pretty">{offers("makeHint")}</p>
        </div>
      ) : null}
      {testDrive ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <Button type="button" variant="structure" onClick={() => void openComposer("test_drive")} loading={compose === "checking" && intent === "test_drive"} aria-haspopup="dialog" className="w-full">
            <CarFront aria-hidden="true" />
            {t("testDrive")}
          </Button>
          <p className="text-xs text-foreground-muted text-pretty">{t("testDriveHint")}</p>
        </div>
      ) : null}
      {/* Phones and tablets: fixed to the bottom of the screen (the page reserves the space). The
          hint above stays the description of both message buttons (aria-describedby may point at
          hidden text). Once revealed, the bar holds the call and WhatsApp actions only. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_-18px_rgb(11_30_31/0.35)] lg:hidden">
        <div className="mx-auto flex max-w-xl flex-col gap-2">
          {myRequest && compose !== "signin" ? <RentalRequestBanner cid={myRequest.cid} request={myRequest.request} compact /> : null}
          {myStatus && compose !== "signin" ? <ConversationStatusBanner status={myStatus} compact /> : null}
          {feedback(false)}
          <div className="flex gap-2">
            {revealed ? null : canReveal || barIntent ? messageButton(true) : messageButton(false, true)}
            {revealed ? null : barAction}
            {canReveal ? phoneActions(true, barIntent !== null && !revealed) : null}
          </div>
        </div>
      </div>
      <BarSpacer tall={myRequest !== null || myStatus !== null} />
      {composeMounted ? (
        <MessageDialog
          // A fresh form per intent (the visit request comes with its own draft) and per picked combination.
          key={`${intent}:${variant ?? ""}:${intent === "rental" ? datesKey : ""}`}
          intent={intent === "visit" || intent === "rental" || intent === "offer" ? intent : "message"}
          offerPrice={offer?.price}
          rentalUnit={rental}
          open={compose === "open"}
          onOpenChange={(open) => setCompose(open ? "open" : "closed")}
          listingId={listingId}
          listingTitle={listingTitle}
          sellerName={sellerName}
          shop={shop}
          adultsOnly={adultsOnly}
          onSignedOut={() => setCompose("signin")}
          {...(intent === "test_drive" ? { initialText: t("testDriveText", { title: listingTitle ?? "" }), threadQuery: "rdv=test_drive" } : {})}
          {...(intent === "message" && variant ? { initialText: t("variantText", { title: listingTitle ?? "", variant }) } : {})}
        />
      ) : null}
    </div>
  );
}
