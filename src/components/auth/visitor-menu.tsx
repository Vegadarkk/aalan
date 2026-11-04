"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { CarFront, CircleHelp, House, LogIn, Mail, ScrollText, ShoppingBag, Store, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { LocaleLinks } from "@/components/layout/locale-menu-items";
import { Link } from "@/i18n/navigation";
import { DIRECTORY_PATH, HOLIDAY_RENTAL_SEARCH, PRO_LANDING_PATH, RENT_CAR_SEARCH } from "@/lib/search/shortcuts";
import { cn } from "@/lib/utils";

// The visitor menu of the header on phones and tablets (below lg), its own chunk (visitor-entry.tsx
// loads it when the pointer reaches the trigger): sign in, create an account, then what the wide
// header shows as buttons (owner's choice B, 29 Oct 2026), the two rental searches and the Pro
// space, the directory of verified shops (owner, 30 Oct 2026), then the help centre, the users' contact (DSA art. 12) and, below md, the other languages
// (UX journeys counter-review, 10).
// A navigation dialog of plain links, not an ARIA menu (audit zone 8, 5.2-3): Tab goes from one link
// to the next and cycles inside, Escape closes it and gives the focus back to the trigger, and the
// links sit in a `nav` landmark. Open at once: the click that asked for it already happened.

export type SignInHref = "/connexion" | { pathname: "/connexion"; query: { next: string } };

export interface VisitorMenuProps {
  signInHref: SignInHref;
  /** The trigger's look, name and content, shared with the plain button shown until this chunk runs. */
  triggerClassName: string;
  label: string;
  children: ReactNode;
}

export default function VisitorMenu({ signInHref, triggerClassName, label, children }: VisitorMenuProps) {
  const t = useTranslations("Nav");
  const [open, setOpen] = useState(true);
  const item = cn(
    "flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm outline-none",
    "hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
    "[&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-structure dark:[&_svg]:text-bab-200",
  );
  const group = "flex flex-col border-t border-border pt-1 mt-1 first:mt-0 first:border-t-0 first:pt-0";
  // A followed link closes the dialog (the header stays mounted across a client navigation).
  const closeOnLink = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  };
  return (
    <Popover.Root modal open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={label} data-testid="visitor-menu" className={triggerClassName}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          data-testid="visitor-menu-panel"
          // Radix skips links when it picks the first focusable element: the first link, by hand.
          onOpenAutoFocus={(event) => {
            const first = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("a[href]");
            if (!first) return;
            event.preventDefault();
            first.focus();
          }}
          className={cn(
            // Scrolls when taller than the room under the header (audit zone 1 Z1-01, B10).
            "z-50 max-h-[var(--radix-popover-content-available-height)] min-w-64 overflow-y-auto overscroll-contain rounded-md border border-border bg-surface p-1 shadow-lg shadow-bab-950/10",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <nav aria-label={label} onClick={closeOnLink}>
            <ul className={group}>
              <li>
                <Link href={signInHref} className={cn(item, "font-semibold")}>
                  <LogIn aria-hidden="true" />
                  {t("signIn")}
                </Link>
              </li>
              <li>
                <Link href="/inscription" className={item}>
                  <UserPlus aria-hidden="true" />
                  {t("signUp")}
                </Link>
              </li>
            </ul>
            <ul className={group}>
              <li>
                <Link href={RENT_CAR_SEARCH} prefetch={false} className={item}>
                  <CarFront aria-hidden="true" />
                  {t("rentCar")}
                </Link>
              </li>
              <li>
                <Link href={HOLIDAY_RENTAL_SEARCH} prefetch={false} className={item}>
                  <House aria-hidden="true" />
                  {t("holidayRental")}
                </Link>
              </li>
              <li>
                <Link href={PRO_LANDING_PATH} prefetch={false} className={item}>
                  <Store aria-hidden="true" />
                  <span className="flex flex-col">
                    <span>{t("proSpace")}</span>
                    <span className="text-xs text-foreground-muted">{t("proHint")}</span>
                  </span>
                </Link>
              </li>
              <li>
                <Link href={DIRECTORY_PATH} prefetch={false} className={item}>
                  <ShoppingBag aria-hidden="true" />
                  <span className="flex flex-col">
                    <span>{t("shops")}</span>
                    <span className="text-xs text-foreground-muted">{t("shopsHint")}</span>
                  </span>
                </Link>
              </li>
            </ul>
            <ul className={group}>
              <li>
                <Link href="/aide" prefetch={false} className={item}>
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
            <LocaleLinks itemClassName={item} className={cn(group, "md:hidden")} />
          </nav>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
