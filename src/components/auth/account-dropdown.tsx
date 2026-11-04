"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { BellRing, CarFront, CircleHelp, Heart, House, LogOut, Mail, MessageSquare, Scale, ScrollText, Settings, ShoppingBag, Star, Store, Tag, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { toast } from "sonner";
import { ASSISTANT_HASH, openAssistant } from "@/components/help/assistant-event";
import { LocaleLinks } from "@/components/layout/locale-menu-items";
import { canMessage } from "@/components/messages/can-message";
import { useLiveSnapshot } from "@/components/messages/use-live";
import { Link, useRouter } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/client";
import { DIRECTORY_PATH, HOLIDAY_RENTAL_SEARCH, RENT_CAR_SEARCH } from "@/lib/search/shortcuts";
import type { SessionSummary } from "@/lib/contracts/auth";
import { cn } from "@/lib/utils";

// The signed-in account menu: its own chunk (account-menu.tsx loads it once a session is known), so
// the popover primitives and the toast library stay out of the first JavaScript of public pages.
// A navigation dialog of plain links, not an ARIA menu, like the visitor menu (audit zone 8, 5.2-3):
// Tab goes from one link to the next and cycles inside, Escape closes it and gives the focus back to
// the trigger, and the links sit in a `nav` landmark; sign-out is a plain button at its foot.

export interface AccountDropdownProps {
  session: SessionSummary;
  name: string;
  /** The trigger's look and content, shared with the plain button shown while this chunk loads. */
  triggerClassName: string;
  children: ReactNode;
}

export default function AccountDropdown({ session, name, triggerClassName, children }: AccountDropdownProps) {
  const t = useTranslations("Auth.menu");
  const s = useTranslations("Auth.settings");
  const nav = useTranslations("Nav");
  const router = useRouter();
  // The header's messages link holds the stream; the menu only reads its total.
  const unread = useLiveSnapshot().unread ?? 0;

  const [open, setOpen] = useState(false);

  async function onSignOut() {
    setOpen(false);
    await signOut();
    toast.success(s("signedOut"));
    // Private layouts re-run their guard; public pages only swap the menu.
    router.refresh();
  }
  const item = cn(
    "flex min-h-11 w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-start text-sm outline-none",
    "hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
    "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-foreground-muted",
  );
  const group = "flex flex-col border-t border-border pt-1 mt-1";
  const label = t("account");
  // A followed link closes the dialog (the header stays mounted across a client navigation).
  const closeOnLink = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  };
  return (
    <Popover.Root modal open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={triggerClassName}>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          data-testid="account-menu-panel"
          // Radix skips links when it picks the first focusable element: the first link, by hand.
          onOpenAutoFocus={(event) => {
            const first = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("a[href]");
            if (!first) return;
            event.preventDefault();
            first.focus();
          }}
          className={cn(
            // Never taller than the room under the header (audit zone 1 Z1-01, B10): the list scrolls
            // and the sign-out row stays pinned at its foot, reachable on any phone.
            "z-50 max-h-[var(--radix-popover-content-available-height)] min-w-56 overflow-y-auto overscroll-contain rounded-md border border-border bg-surface p-1 pb-0 shadow-lg shadow-bab-950/10",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex flex-col px-3 py-2">
            <span dir="auto" className="truncate text-sm font-semibold">
              {name}
            </span>
            {session.displayName && session.email ? (
              <span className="truncate text-xs text-foreground-muted" dir="ltr">
                {session.email}
              </span>
            ) : null}
          </div>
          <nav aria-label={label} onClick={closeOnLink}>
            <ul className={group}>
              {/* The member's own listings first: the only way to them from the menu tree (UX journeys, 1). */}
              <li>
                <Link href="/mes-annonces" className={item}>
                  <Tag aria-hidden="true" />
                  {t("listings")}
                </Link>
              </li>
            </ul>
            {/* Below lg the header has no "Louer": the two rental searches sit here (owner's choice B, 29 Oct 2026). */}
            <ul className={cn(group, "lg:hidden")}>
              <li>
                <Link href={RENT_CAR_SEARCH} prefetch={false} className={item}>
                  <CarFront aria-hidden="true" />
                  {nav("rentCar")}
                </Link>
              </li>
              <li>
                <Link href={HOLIDAY_RENTAL_SEARCH} prefetch={false} className={item}>
                  <House aria-hidden="true" />
                  {nav("holidayRental")}
                </Link>
              </li>
            </ul>
            <ul className={group}>
              {canMessage(session) ? (
                <li>
                  <Link href="/messages" className={item}>
                    <MessageSquare aria-hidden="true" />
                    <span className="flex-1">{t("messages")}</span>{" "}
                    {unread > 0 ? (
                      <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs leading-5 font-semibold text-primary-foreground tabular-nums">
                        <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
                        <span className="sr-only">{t("unreadCount", { count: unread })}</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              ) : null}
              <li>
                <Link href="/favoris" className={item}>
                  <Heart aria-hidden="true" />
                  {t("favorites")}
                </Link>
              </li>
              <li>
                <Link href="/mes-avis" className={item}>
                  <Star aria-hidden="true" />
                  {t("reviews")}
                </Link>
              </li>
              <li>
                <Link href="/recherches" className={item}>
                  <BellRing aria-hidden="true" />
                  {t("savedSearches")}
                </Link>
              </li>
              <li>
                <Link href="/pro" className={item}>
                  <Store aria-hidden="true" />
                  {t("pro")}
                </Link>
              </li>
              <li>
                <Link href="/porte-monnaie" className={item}>
                  <Wallet aria-hidden="true" />
                  {t("wallet")}
                </Link>
              </li>
            </ul>
            {/* Vérifications is reached from Mes paramètres (its phone row), not from here (Z1-01: fewer entries). */}
            <ul className={group}>
              <li>
                <Link href="/parametres" className={item}>
                  <Settings aria-hidden="true" />
                  {t("settings")}
                </Link>
              </li>
              <li>
                <Link href="/recours" className={item}>
                  <Scale aria-hidden="true" />
                  {t("decisions")}
                </Link>
              </li>
              {/* The directory of verified shops (owner, 30 Oct 2026), with the help centre and the guide. */}
              <li>
                <Link href={DIRECTORY_PATH} prefetch={false} className={item}>
                  <ShoppingBag aria-hidden="true" />
                  {nav("shops")}
                </Link>
              </li>
              {/* Help centre with the Assistant Aalan open (phase 5 D25); the event opens it when already there. */}
              <li>
                <Link href={`/aide${ASSISTANT_HASH}`} className={item} onClick={openAssistant}>
                  <CircleHelp aria-hidden="true" />
                  {t("help")}
                </Link>
              </li>
              <li>
                <Link href="/aide/contact" prefetch={false} className={item}>
                  <Mail aria-hidden="true" />
                  {t("contact")}
                </Link>
              </li>
              <li>
                <Link href="/demarches" prefetch={false} className={item}>
                  <ScrollText aria-hidden="true" />
                  {t("procedures")}
                </Link>
              </li>
            </ul>
            {/* Below md the header has no language pill: the other languages sit here. */}
            <LocaleLinks itemClassName={item} className={cn(group, "md:hidden")} />
          </nav>
          <div className="sticky bottom-0 -mx-1 mt-1 border-t border-border bg-surface px-1 pt-1 pb-1">
            <button type="button" className={cn(item, "cursor-pointer")} onClick={() => void onSignOut()} data-testid="account-sign-out">
              <LogOut aria-hidden="true" />
              {t("signOut")}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
