import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
import { requirePageStaff } from "@/lib/auth/current-user";
import { ACCOUNT_QUERY_MAX, accountLookups } from "@/lib/decisions/account-query";
import { searchAccounts, type AccountHit, type AccountMatch } from "@/lib/decisions/account-search";
import { ACCOUNT_STATUS_LABEL, formatMorocco, plural } from "../../_lib/moderation-format";
import { linkClassName } from "../../_components/panel";

// Account search (design D24, B12 / audit zone 7 P1-1): by e-mail, verified phone, display name,
// profile link or id, listing link or reference, then the account's moderation page. One exact
// match opens the account at once; several are listed with their state.

export const metadata: Metadata = { title: "Comptes" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MATCH_LABEL: Record<AccountMatch, string> = {
  email: "E-mail",
  phone: "Téléphone vérifié",
  profile: "Profil public",
  listing: "Auteur de l'annonce",
  uid: "Identifiant de compte",
  name: "Nom affiché",
};

const STATUS_TONE: Record<AccountHit["status"], "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  restricted: "warning",
  suspended: "warning",
  banned: "danger",
  closed: "neutral",
};

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requirePageStaff(["moderator", "admin"]);
  const params = await searchParams;
  // `profil` is the former parameter (bookmarks, links from other pages).
  const raw = typeof params["q"] === "string" ? params["q"] : typeof params["profil"] === "string" ? params["profil"] : "";
  const query = raw.trim().slice(0, ACCOUNT_QUERY_MAX);
  let hits: AccountHit[] | null = null;
  let problem: string | null = null;
  if (query) {
    if (accountLookups(query).length === 0) {
      problem = "Saisissez une adresse e-mail complète, un numéro marocain, un nom (2 caractères au moins), un lien de profil ou d'annonce, ou une référence.";
    } else {
      hits = await searchAccounts({ uid: staff.uid, role: staff.role }, query);
      const only = hits.length === 1 ? hits[0] : undefined;
      if (only && !only.matched.includes("name")) redirect(`/comptes/${encodeURIComponent(only.uid)}`);
    }
  }
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Comptes</h1>
        <p className="mt-1 max-w-prose text-sm text-foreground-muted">
          Échelle des sanctions, suspension en cours, fiabilité comme signalant et décisions d&apos;un compte. Cherchez par e-mail, téléphone vérifié, nom affiché, lien du profil ou d&apos;une annonce, ou
          référence.
        </p>
      </div>
      <form method="get" action="/comptes" role="search" className="flex max-w-2xl flex-col gap-2 rounded-lg border border-border bg-surface p-5">
        <label htmlFor="q" className="text-sm font-medium">
          Rechercher un compte
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            required
            minLength={2}
            maxLength={ACCOUNT_QUERY_MAX}
            autoComplete="off"
            spellCheck={false}
            placeholder="salma@exemple.ma, 06 12 34 56 78, Salma B., lien d'annonce…"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "q-error" : "q-hint"}
            className={inputClassName}
          />
          <Button type="submit" variant="structure">
            Rechercher
          </Button>
        </div>
        {problem ? (
          <p id="q-error" role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : (
          <p id="q-hint" className="text-xs text-foreground-muted">
            Le nom se cherche par son début, majuscules comprises. Les recherches par e-mail ou téléphone sont journalisées ; ni l&apos;un ni l&apos;autre ne s&apos;affiche ici.
          </p>
        )}
      </form>
      {hits ? (
        <section aria-labelledby="results-title" className="flex max-w-3xl flex-col gap-3">
          <h2 id="results-title" className="text-sm font-medium text-foreground-muted" aria-live="polite">
            {hits.length === 0 ? "Aucun compte ne correspond à cette recherche." : plural(hits.length, "compte trouvé", "comptes trouvés")}
          </h2>
          {hits.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {hits.map((hit) => (
                <li key={hit.uid} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/comptes/${encodeURIComponent(hit.uid)}`} className={`${linkClassName} font-medium`}>
                      {hit.displayName}
                    </Link>
                    <p className="text-xs text-foreground-muted">
                      {hit.type === "pro" ? "Pro" : "Particulier"} · inscrit le {formatMorocco(hit.createdAt, "date")} · {plural(hit.activeListings, "annonce en ligne", "annonces en ligne")} · profil{" "}
                      <span className="font-mono">{hit.publicId}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {hit.matched.map((kind) => (
                      <Badge key={kind} variant="neutral">
                        {MATCH_LABEL[kind]}
                      </Badge>
                    ))}
                    <Badge variant={STATUS_TONE[hit.status]}>{ACCOUNT_STATUS_LABEL[hit.status] ?? hit.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
