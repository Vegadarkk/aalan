import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { photoSources } from "@/components/listing/photo";
import type { SensitiveDeclarationKind } from "@/lib/contracts/listings";
import { isolate } from "@/lib/i18n/bidi";
import type { ModerationQueueItem } from "@/lib/listings/moderation-actions";
import { FLAG_LABELS } from "@/lib/moderation/decisions";
import { ALWAYS_REVIEW_FLAGS } from "@/lib/moderation/risk";
import { formatPrice, waitingFor, type CatalogLabels } from "./moderation-labels";
import { RiskMeter } from "./moderation-risk";
import { DECLARATION_SIGNAL } from "./sensitive-declaration";

/** What waits for review (lifecycle `holdKind`). */
export const HOLD_LABEL: Record<ModerationQueueItem["hold"], string> = {
  publication: "Nouvelle annonce",
  renewal: "Renouvellement d'une annonce expirée",
  edit: "Modification d'une annonce déjà publiée",
};

interface ModerationQueueProps {
  items: ModerationQueueItem[];
  labels: CatalogLabels;
  mediaBaseUrl: string | null;
}

interface FlagBadgesProps {
  flags: readonly ModerationQueueItem["flags"][number][];
  /** The seller's sensitive-data declaration: shown first and named by who the data concern (zone 7 P3-2). */
  declaration?: SensitiveDeclarationKind | null;
}

/** Flags that alone send a listing to review are shown in amber, the others neutral. */
export function FlagBadges({ flags, declaration = null }: FlagBadgesProps) {
  const others = declaration ? flags.filter((flag) => flag !== "sensitive_declared") : flags;
  if (others.length === 0 && !declaration) return <span className="text-sm text-foreground-muted">Aucun signal</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Signaux du contrôle automatique">
      {declaration ? (
        <li>
          <Badge variant="warning">
            <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
            {DECLARATION_SIGNAL[declaration]}
          </Badge>
        </li>
      ) : null}
      {others.map((flag) => (
        <li key={flag}>
          <Badge variant={ALWAYS_REVIEW_FLAGS.has(flag) ? "warning" : "neutral"}>{FLAG_LABELS[flag]}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** The queue, oldest first: what each listing is, why it was held, and for how long. */
export function ModerationQueue({ items, labels, mediaBaseUrl }: ModerationQueueProps) {
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {items.map((item) => {
        const thumb = item.photo ? photoSources(mediaBaseUrl, item.id, item.photo, "s") : null;
        const href = `/moderation/${item.id}`;
        return (
          <li key={item.id} className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 p-4 sm:grid-cols-[4rem_minmax(0,1fr)_auto]">
            <div className="relative size-16 overflow-hidden rounded-md bg-surface-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- media variants are served as is (images.unoptimized, design §8) */}
              {thumb ? <img src={thumb.src} alt="" width={64} height={64} loading="lazy" decoding="async" className="size-full object-cover" /> : null}
              {item.photoCount > 1 ? (
                <span className="absolute end-1 bottom-1 rounded-sm bg-foreground/75 px-1 text-xs font-medium text-surface tabular-nums">{item.photoCount}</span>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Link href={href} dir="auto" className="truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline">
                {item.title || "Sans titre"}
              </Link>
              <p className="text-sm text-foreground-muted">
                {labels.category(item.categoryId, item.subcategoryId)}, {labels.place(item.citySlug)}, {formatPrice(item.price, item.isDonation)}
              </p>
              <p className="text-sm text-foreground">{HOLD_LABEL[item.hold]}</p>
              <FlagBadges flags={item.flags} declaration={item.sensitiveDeclaration} />
            </div>
            <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end">
              <RiskMeter score={item.score} />
              <p className="text-sm text-foreground-muted">
                <span dir="auto" className="text-foreground">
                  {item.seller.displayName}
                </span>
                {item.seller.type === "pro" ? " (Pro)" : null}, <time dateTime={item.waitingSince}>{waitingFor(item.waitingSince)}</time>
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href={href} aria-label={`Examiner « ${isolate(item.title || "Sans titre")} »`}>
                  Examiner
                </Link>
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
