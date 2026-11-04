"use client";

import { MessagesSquare, Plus, Search, Tag, UserRound, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { InlineError } from "@/components/feedback/inline-error";
import { inputClassName } from "@/components/ui/input";
import type { AuthorityTargetCandidate, AuthorityTargetsResponse } from "@/lib/decisions/contracts";
import { cn } from "@/lib/utils";
import { candidateLines, splitPaste } from "../_lib/authority-target-format";
import { ADMIN_API, adminFetch, errorMessage } from "./api-client";

// Content picker of the authority form (audit zone 7 P3-4): paste a public or back-office link,
// a reference, an e-mail, a phone, a name or a listing title; the matches are previewed and the
// admin adds the ones the request names. The selected contents are the request's scope.

const ICONS: Record<AuthorityTargetCandidate["kind"], LucideIcon> = { listing: Tag, user: UserRound, conversation: MessagesSquare };
const DEBOUNCE_MS = 350;
export const SCOPE_MAX = 50;

type Search = { state: "idle" } | { state: "loading" } | { state: "done"; candidates: AuthorityTargetCandidate[]; unreadable: boolean } | { state: "error"; message: string };

async function lookUp(queries: string[]): Promise<{ candidates: AuthorityTargetCandidate[]; unreadable: boolean }> {
  const results = await Promise.all(queries.map((q) => adminFetch<AuthorityTargetsResponse>(`${ADMIN_API.authorities}/targets?q=${encodeURIComponent(q)}`, { method: "GET" })));
  const seen = new Set<string>();
  const candidates: AuthorityTargetCandidate[] = [];
  for (const candidate of results.flatMap((result) => result?.candidates ?? [])) {
    if (seen.has(candidate.entry)) continue;
    seen.add(candidate.entry);
    candidates.push(candidate);
  }
  return { candidates, unreadable: results.every((result) => result?.unreadable !== false) };
}

function CandidateRow({ candidate, action }: { candidate: AuthorityTargetCandidate; action: ReactNode }) {
  const Icon = ICONS[candidate.kind];
  const lines = candidateLines(candidate);
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-foreground-muted" aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-sm">
          <span className="text-foreground-muted">{lines.kind} </span>
          <span dir="auto" className="font-medium break-words">
            {lines.title}
          </span>
        </p>
        <p dir="auto" className="text-sm text-foreground-muted">
          {lines.detail}
        </p>
        <p className="font-mono text-xs break-all text-foreground-muted">{candidate.entry}</p>
      </div>
      {action}
    </div>
  );
}

interface PickerProps {
  value: readonly AuthorityTargetCandidate[];
  onChange: (next: AuthorityTargetCandidate[]) => void;
  error?: string | undefined;
}

export function AuthorityTargetPicker({ value, onChange, error }: PickerProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const latest = useRef(0);
  const selected = new Set(value.map((candidate) => candidate.entry));
  const full = value.length >= SCOPE_MAX;

  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** Debounced lookup of what was typed or pasted; a newer query discards an older answer. */
  function onQuery(text: string) {
    setQuery(text);
    window.clearTimeout(timer.current);
    const ticket = ++latest.current;
    const queries = splitPaste(text);
    if (queries.length === 0 || (queries.length === 1 && (queries[0]?.length ?? 0) < 2)) {
      setSearch({ state: "idle" });
      return;
    }
    timer.current = window.setTimeout(() => {
      setSearch({ state: "loading" });
      lookUp(queries)
        .then((result) => {
          if (ticket === latest.current) setSearch({ state: "done", ...result });
        })
        .catch((cause: unknown) => {
          if (ticket === latest.current) setSearch({ state: "error", message: errorMessage(cause, { invalid_body: "Recherche trop longue ou trop courte." }) });
        });
    }, DEBOUNCE_MS);
  }

  function add(candidates: readonly AuthorityTargetCandidate[]) {
    const next = [...value];
    for (const candidate of candidates) {
      if (next.length >= SCOPE_MAX) break;
      if (!next.some((entry) => entry.entry === candidate.entry)) next.push(candidate);
    }
    onChange(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (search.state === "done" && search.candidates.length === 1) {
      add(search.candidates);
      onQuery("");
    }
  }

  const found = search.state === "done" ? search.candidates : [];
  const addable = found.filter((candidate) => !selected.has(candidate.entry));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">
          <label htmlFor={`${id}-q`}>Contenus visés</label>
          <span className="ms-0.5 text-danger" aria-hidden="true">
            *
          </span>
        </span>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" aria-hidden="true" />
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={2000}
            autoComplete="off"
            spellCheck={false}
            disabled={full}
            placeholder="Lien d'annonce ou de profil, titre, nom, e-mail, téléphone, référence…"
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
            aria-invalid={error ? true : undefined}
            aria-controls={`${id}-results`}
            className={cn(inputClassName, "ps-9")}
          />
        </div>
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          Collez le lien public ou la page du back-office (plusieurs liens à la fois, séparés par un espace), ou cherchez par titre d&apos;annonce, nom affiché, e-mail ou téléphone. Chaque
          contenu ajouté est conservé ; les conversations sont gelées.
        </p>
        {error ? <InlineError id={`${id}-error`}>{error}</InlineError> : null}
      </div>

      <div id={`${id}-results`} aria-live="polite" className="empty:hidden">
        {search.state === "loading" ? <p className="text-sm text-foreground-muted">Recherche…</p> : null}
        {search.state === "error" ? <p className="text-sm text-danger">{search.message}</p> : null}
        {search.state === "done" && found.length === 0 ? (
          <p className="rounded-md bg-surface-muted p-3 text-sm text-pretty">
            {search.unreadable
              ? "Ce texte n'est ni un lien, ni une référence, ni un e-mail, un téléphone, un nom ou un titre. Collez le lien de la page du contenu."
              : "Aucun contenu trouvé. Le titre ne trouve que les annonces en ligne : pour une annonce retirée ou un message, collez le lien de sa page dans le back-office."}
          </p>
        ) : null}
        {found.length > 0 ? (
          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted px-3 py-2 text-sm">
              <span className="text-foreground-muted">{found.length > 1 ? `${found.length} résultats` : "1 résultat"}</span>
              {addable.length > 1 ? (
                <button type="button" onClick={() => add(addable)} disabled={full} className="font-medium text-link underline-offset-4 hover:underline disabled:opacity-50">
                  Tout ajouter
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-border px-3">
              {found.map((candidate) => (
                <li key={candidate.entry}>
                  <CandidateRow
                    candidate={candidate}
                    action={
                      selected.has(candidate.entry) ? (
                        <span className="mt-1 shrink-0 text-sm text-foreground-muted">Ajouté</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => add([candidate])}
                          disabled={full}
                          className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-border-strong px-2.5 py-1 text-sm font-medium hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                        >
                          <Plus className="size-3.5" aria-hidden="true" />
                          Ajouter
                        </button>
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <section aria-label="Contenus ajoutés à la demande" className="rounded-md border border-dashed border-border-strong p-3">
        <h3 className="text-sm font-medium">
          {value.length === 0 ? "Aucun contenu ajouté" : value.length > 1 ? `${value.length} contenus seront conservés` : "1 contenu sera conservé"}
          {full ? ` (maximum ${SCOPE_MAX})` : ""}
        </h3>
        {value.length > 0 ? (
          <ul className="mt-1 divide-y divide-border">
            {value.map((candidate) => (
              <li key={candidate.entry}>
                <CandidateRow
                  candidate={candidate}
                  action={
                    <button
                      type="button"
                      onClick={() => onChange(value.filter((entry) => entry.entry !== candidate.entry))}
                      aria-label={`Retirer ${candidateLines(candidate).title} de la demande`}
                      className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-foreground-muted">Les contenus ajoutés apparaissent ici, avec leur aperçu, avant l&apos;enregistrement.</p>
        )}
      </section>
    </div>
  );
}
