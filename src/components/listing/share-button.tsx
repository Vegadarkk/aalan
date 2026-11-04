"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Link2, Mail, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/utils";

// "Partager" beside the favourite button of a listing or in a shop's header (audit §7): a menu with
// WhatsApp first (the way listings travel in Morocco), Facebook, e-mail, the link copied, and the
// device's own share sheet where the browser has one (phones). Every target is a plain link: the
// page opens nothing by itself and sends nothing to a third party until the visitor picks one.

const noSubscription = () => () => {};
const shareSheetExists = () => typeof navigator.share === "function";

/** Share targets of a page: the text carries the title then the address (WhatsApp shows a preview). */
export function shareTargets(url: string, title: string): { whatsapp: string; facebook: string; email: string } {
  const text = title ? `${title}\n${url}` : url;
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`,
  };
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.98L2 22l5.15-1.5A9.93 9.93 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.06.9.92-2.98-.2-.31a8.18 8.18 0 1 1 6.82 3.72Zm4.5-6.12c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.55.12-.17.25-.64.8-.78.97-.14.16-.29.18-.53.06a6.7 6.7 0 0 1-1.98-1.22 7.43 7.43 0 0 1-1.37-1.7c-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.74 2.74 0 0 0-.86 2.04c0 1.2.88 2.36 1 2.53.12.16 1.72 2.63 4.17 3.69.58.25 1.04.4 1.4.51.58.19 1.12.16 1.54.1.47-.07 1.46-.6 1.66-1.17.2-.58.2-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}

function FacebookGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M13.5 21.9v-7.4h2.5l.38-2.9H13.5V9.75c0-.84.23-1.41 1.44-1.41h1.53V5.75a20.5 20.5 0 0 0-2.24-.12c-2.22 0-3.73 1.35-3.73 3.84v2.14H8v2.9h2.5v7.4a10 10 0 1 1 3 0Z" />
    </svg>
  );
}

export function ShareButton({ url, title, className }: { url: string; title: string; className?: string }) {
  const t = useTranslations("ListingPage.share");
  const [copied, setCopied] = useState(false);
  // False on the server and at hydration, read from the browser right after.
  const canShare = useSyncExternalStore(noSubscription, shareSheetExists, () => false);
  const targets = shareTargets(url, title);
  const item = "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:shrink-0";

  async function nativeShare() {
    try {
      await navigator.share({ title, url });
    } catch {
      // Cancelled: nothing to say.
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Blocked clipboard: the address bar still has the link.
    }
  }

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="share-button"
          className={cn(
            "inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-base font-medium text-foreground",
            "transition-[background-color,scale] duration-150 ease-door hover:bg-surface-muted active:scale-[0.98] data-[state=open]:bg-surface-muted",
            className,
          )}
        >
          {copied ? <Check className="size-5 text-success" aria-hidden="true" /> : <Share2 className="size-5" aria-hidden="true" />}
          <span aria-live="polite">{copied ? t("copied") : t("share")}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          data-testid="share-menu"
          className="z-50 min-w-56 rounded-md border border-border bg-surface p-1 text-foreground shadow-lg shadow-bab-950/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Item asChild>
            <a href={targets.whatsapp} target="_blank" rel="noopener noreferrer" className={item}>
              <WhatsAppGlyph className="text-[#1f9e54] dark:text-[#25d366]" />
              {t("whatsapp")}
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <a href={targets.facebook} target="_blank" rel="noopener noreferrer" className={item}>
              <FacebookGlyph className="text-[#1877f2]" />
              {t("facebook")}
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <a href={targets.email} className={item}>
              <Mail className="text-foreground-muted" aria-hidden="true" />
              {t("email")}
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => void copy()}>
            <Link2 className="text-foreground-muted" aria-hidden="true" />
            {t("copyLink")}
          </DropdownMenu.Item>
          {canShare ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item className={item} onSelect={() => void nativeShare()}>
                <Share2 className="text-foreground-muted" aria-hidden="true" />
                {t("more")}
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
