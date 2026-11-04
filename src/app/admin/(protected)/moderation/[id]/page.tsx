import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DEFAULT_AI } from "@/config/ai";
import { photoSources } from "@/components/listing/photo";
import { ErrorBanner } from "@/components/feedback/error-banner";
import { Badge } from "@/components/ui/badge";
import { requirePageStaff } from "@/lib/auth/current-user";
import { listingIdSchema } from "@/lib/contracts/listings";
import type { ModerationDecisionDoc } from "@/lib/db/schemas";
import { serverEnv } from "@/lib/env";
import { moderationReview, type ModerationReview, type ModerationReviewPhoto } from "@/lib/listings/moderation-actions";
import { screeningChange, type ScreeningChange } from "@/lib/listings/screening-change";
import { FLAG_LABELS } from "@/lib/moderation/decisions";
import { mediaBaseUrl } from "@/lib/storage/keys";
import { staffPhotoSources, usesStaffPhotos } from "../../../_lib/staff-photos";
import { ACCOUNT_STATUS_LABEL, formatMorocco } from "../../../_lib/moderation-format";
import { ModerationDecisionForm } from "../../../_components/moderation-decision-form";
import { catalogLabels, formatPrice, waitingFor } from "../../../_components/moderation-labels";
import { FlagBadges, HOLD_LABEL } from "../../../_components/moderation-queue";
import { RiskMeter } from "../../../_components/moderation-risk";
import { SensitiveDeclarationNotice } from "../../../_components/sensitive-declaration";
import { Facts, Panel } from "../../../_components/panel";

// Review of one listing of the moderation queue (design D9): the listing as the seller wrote it,
// the signals that held it, the seller's track record, and the decision form while it is pending.

export const metadata: Metadata = { title: "Vérifier une annonce" };

const ACTION_LABEL: Record<ModerationDecisionDoc["action"], string> = {
  remove: "Refus ou retrait",
  restrict_visibility: "Mise en attente",
  demote: "Rétrogradation",
  suspend_account: "Suspension du compte",
  ban: "Bannissement",
  warn: "Avertissement",
  restore: "Validation après vérification",
  no_action: "Sans suite",
};

const DECLARATION_LABEL = { self: "le vendeur est la personne concernée", explicit_consent: "consentement explicite de la personne concernée" } as const;

const yesNo = (value: boolean) => (value ? "Oui" : "Non");

function PhotoChecks({ photo }: { photo: ModerationReviewPhoto }) {
  const badges: { label: string; warn: boolean }[] = [];
  if (photo.checks?.nsfw !== undefined) badges.push({ label: `Nudité ${photo.checks.nsfw.toFixed(2).replace(".", ",")}`, warn: photo.checks.nsfw >= DEFAULT_AI.nsfw.reviewAt });
  if (photo.checks?.faces !== undefined && photo.checks.faces > 0) badges.push({ label: photo.checks.faces > 1 ? `${photo.checks.faces} visages` : "1 visage", warn: true });
  if (photo.uploadStatus && photo.uploadStatus !== "ready") badges.push({ label: "Fichier introuvable ou non traité", warn: true });
  if (!photo.checks) badges.push({ label: "Contrôles indisponibles", warn: false });
  if (badges.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <Badge key={badge.label} variant={badge.warn ? "warning" : "neutral"}>
          {badge.label}
        </Badge>
      ))}
    </span>
  );
}

function Photos({ review, base }: { review: ModerationReview; base: string | null }) {
  const { listing } = review;
  if (listing.photos.length === 0) return <p className="text-sm text-foreground-muted">Aucune photo.</p>;
  // A refused or removed listing's photos leave the public media bucket: read through the staff-only route.
  const staff = usesStaffPhotos(listing.status);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {listing.photos.map((photo, index) => {
        const sources = staff ? staffPhotoSources(listing.id, photo, "s") : photoSources(base, listing.id, photo, "s");
        return (
          <li key={photo.id}>
            <figure className="flex flex-col gap-1.5">
              <div className="aspect-[4/3] overflow-hidden rounded-md bg-surface-muted">
                {sources ? (
                  // eslint-disable-next-line @next/next/no-img-element -- media variants are served as is (design §8)
                  <img src={sources.src} alt={`Photo ${index + 1} sur ${listing.photos.length}`} width={sources.width} height={sources.height} loading="lazy" decoding="async" className="size-full object-contain" />
                ) : null}
              </div>
              <figcaption className="flex flex-col gap-1 text-sm">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-foreground-muted">Photo {index + 1}</span>
                  {sources ? (
                    <a href={sources.large} target="_blank" rel="noopener noreferrer" className="text-link underline underline-offset-4 hover:no-underline">
                      Voir en grand
                    </a>
                  ) : null}
                </span>
                <PhotoChecks photo={photo} />
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ul>
  );
}

const flagList = (flags: readonly ModerationReview["moderation"]["flags"][number][]) => flags.map((flag) => `« ${FLAG_LABELS[flag]} »`).join(", ");

/** The re-run's sentence: a content change only when the seller changed the text, price or photos (zone 7 P2-11). */
function changeSentence(change: Exclude<ScreeningChange, { kind: "none" }>): string {
  if (change.kind === "content") {
    return change.rescored
      ? "Le vendeur a modifié le texte, le prix ou les photos depuis la mise en attente. Contrôle relancé sur la version actuelle :"
      : "Le vendeur a modifié le texte, le prix ou les photos depuis la mise en attente ; le contrôle relancé donne le même résultat.";
  }
  const reasons = [...(change.added.length > 0 ? [`nouveau signal : ${flagList(change.added)}`] : []), ...(change.removed.length > 0 ? [`signal levé : ${flagList(change.removed)}`] : [])];
  return `Contenu inchangé. Contrôle relancé : score mis à jour (${reasons.length > 0 ? reasons.join(" ; ") : "mêmes signaux, poids recalculés sur le contexte du vendeur"}).`;
}

export default async function ModerationReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageStaff(["moderator", "admin"]);
  const id = listingIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const [review, labels] = await Promise.all([moderationReview(id.data), catalogLabels()]);
  if (!review) notFound();
  const { listing, moderation, screening, seller } = review;
  const site = serverEnv().SITE_URL.replace(/\/$/, "");
  const pending = listing.status === "pending_review";
  const attributes = Object.entries(listing.attributes);
  const change = screeningChange(moderation, screening, moderation.contentChanged);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/moderation" className="self-start text-sm text-link underline underline-offset-4 hover:no-underline">
          Retour aux annonces à vérifier
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-balance">{listing.title || "Sans titre"}</h1>
          <Badge variant={pending ? "warning" : listing.status === "published" ? "success" : "neutral"}>{labels.status(listing.status)}</Badge>
        </div>
        <p className="text-sm text-foreground-muted">
          {review.approval ? `${HOLD_LABEL[review.approval.kind]}. ` : null}Référence {listing.id}. Créée le {formatMorocco(listing.createdAt, "date")}, dernière modification{" "}
          <time dateTime={listing.updatedAt}>{waitingFor(listing.updatedAt)}</time>.
        </p>
      </div>
      {pending && moderation.sensitiveDeclaration ? <SensitiveDeclarationNotice kind={moderation.sensitiveDeclaration} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <article className="flex flex-col gap-6">
          <Panel title="Photos">
            <Photos review={review} base={mediaBaseUrl()} />
          </Panel>
          <Panel title="Annonce">
            <p className="text-xl font-semibold tabular-nums">
              {formatPrice(listing.price, listing.isDonation)}
              {listing.priceNegotiable && !listing.isDonation && listing.price !== null ? <span className="ms-2 text-sm font-normal text-foreground-muted">négociable</span> : null}
            </p>
            <Facts
              rows={[
                ["Catégorie", labels.category(listing.categoryId, listing.subcategoryId)],
                ["Lieu", labels.place(listing.location?.citySlug ?? null, listing.location?.regionCode) + (listing.location?.district ? ` (${listing.location.district})` : "")],
                ...(listing.condition ? ([["État", labels.condition(listing.condition)]] as [string, ReactNode][]) : []),
                ["Numéro affiché", yesNo(listing.contact.showPhone)],
                ["WhatsApp", yesNo(listing.contact.whatsapp)],
                ...(moderation.sensitiveDeclaration ? ([["Déclaration", DECLARATION_LABEL[moderation.sensitiveDeclaration]]] as [string, ReactNode][]) : []),
              ]}
            />
            <div className="border-t border-border pt-3">
              <h3 className="mb-1.5 text-sm font-medium text-foreground-muted">Description</h3>
              <p className="max-w-prose text-pretty whitespace-pre-line">{listing.description || "Sans description."}</p>
            </div>
            {attributes.length > 0 ? (
              <div className="border-t border-border pt-3">
                <h3 className="mb-1.5 text-sm font-medium text-foreground-muted">Caractéristiques</h3>
                <Facts rows={attributes.map(([key, value]) => [labels.criterion(key), labels.value(key, value)])} />
              </div>
            ) : null}
            {listing.status === "published" && listing.slugId ? (
              <a href={`${site}/fr/annonce/${listing.slugId}`} target="_blank" rel="noopener noreferrer" className="self-start text-sm text-link underline underline-offset-4 hover:no-underline">
                Voir la page publique
              </a>
            ) : null}
          </Panel>
        </article>

        <aside className="flex flex-col gap-6" aria-label="Signaux, décision et vendeur">
          <Panel title="Signaux">
            <RiskMeter score={moderation.score} />
            <FlagBadges flags={moderation.flags} declaration={moderation.sensitiveDeclaration} />
            {change.kind !== "none" && screening ? (
              <div className="flex flex-col gap-2 rounded-md bg-surface-muted p-3 text-sm" data-testid="screening-change">
                <p>{changeSentence(change)}</p>
                {change.kind === "rescored" || change.rescored ? (
                  <>
                    <RiskMeter score={screening.score} />
                    <FlagBadges flags={screening.flags} declaration={moderation.sensitiveDeclaration} />
                  </>
                ) : null}
              </div>
            ) : null}
            {screening && screening.evidence.length > 0 ? (
              <div className="text-sm">
                <h3 className="mb-1 font-medium text-foreground-muted">Détail du contrôle</h3>
                <ul className="list-disc ps-5 text-foreground-muted">
                  {screening.evidence.map((line) => (
                    <li key={line}>{labels.evidence(line)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {moderation.lastDecision ? (
              <p className="text-sm text-foreground-muted">
                {ACTION_LABEL[moderation.lastDecision.action]} ({moderation.lastDecision.automated ? "automatique" : "modérateur"}) le {formatMorocco(moderation.lastDecision.createdAt)} : {moderation.lastDecision.facts}
              </p>
            ) : null}
          </Panel>

          {pending && review.approval ? (
            <>
              {seller.status !== "active" ? (
                <ErrorBanner
                  tone="warning"
                  title={seller.status === "suspended" ? `Vendeur suspendu${seller.suspendedUntil ? ` jusqu'au ${formatMorocco(seller.suspendedUntil)}` : ""}` : `Compte du vendeur : ${(ACCOUNT_STATUS_LABEL[seller.status] ?? "inconnu").toLowerCase()}`}
                >
                  La publication est bloquée tant que le compte n&apos;est pas actif ; vous pouvez refuser l&apos;annonce ou la laisser en attente.
                </ErrorBanner>
              ) : null}
              <ModerationDecisionForm listingId={listing.id} version={listing.version} approval={review.approval} expiresAt={listing.expiresAt} riskScore={Math.max(moderation.score, screening?.score ?? 0)} />
            </>
          ) : (
            <Panel title="Décision">
              <p className="text-sm text-foreground-muted">
                Cette annonce n&apos;attend plus de décision ({labels.status(listing.status).toLowerCase()}
                {moderation.reviewedAt ? `, vérifiée le ${formatMorocco(moderation.reviewedAt)}` : ""}).
              </p>
            </Panel>
          )}

          <Panel title="Vendeur">
            <Facts
              rows={[
                [
                  "Nom",
                  <a key="profile" href={`${site}/fr/profil/${seller.publicId}`} target="_blank" rel="noopener noreferrer" className="text-link underline underline-offset-4 hover:no-underline">
                    {seller.displayName}
                  </a>,
                ],
                ["Compte", seller.type === "pro" ? "Professionnel" : "Particulier"],
                ["Ancienneté", seller.accountAgeDays === null ? "Inconnue" : seller.accountAgeDays === 0 ? "Créé aujourd'hui" : `${seller.accountAgeDays} jour${seller.accountAgeDays > 1 ? "s" : ""}`],
                ["E-mail vérifié", yesNo(seller.emailVerified)],
                ["Téléphone vérifié", yesNo(seller.phoneVerified)],
                ["Annonces actives", String(seller.activeListings)],
                ["Annonces refusées", String(seller.rejectedListings)],
                ...(seller.status !== "active"
                  ? ([["État du compte", `${ACCOUNT_STATUS_LABEL[seller.status] ?? "Inconnu"}${seller.suspendedUntil ? ` jusqu'au ${formatMorocco(seller.suspendedUntil)}` : ""}`]] as [string, ReactNode][])
                  : []),
              ]}
            />
            {seller.decisions.length > 0 ? (
              <div className="border-t border-border pt-3 text-sm">
                <h3 className="mb-1.5 font-medium text-foreground-muted">Décisions récentes</h3>
                <ul className="flex flex-col gap-1">
                  {seller.decisions.map((decision, index) => (
                    <li key={`${decision.createdAt}-${index}`} className="flex justify-between gap-3">
                      <span>
                        {ACTION_LABEL[decision.action]}
                        <span className="text-foreground-muted"> ({decision.automated ? "automatique" : "modérateur"})</span>
                      </span>
                      <time dateTime={decision.createdAt} className="shrink-0 text-foreground-muted tabular-nums">
                        {formatMorocco(decision.createdAt, "date")}
                      </time>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>
        </aside>
      </div>
    </>
  );
}
