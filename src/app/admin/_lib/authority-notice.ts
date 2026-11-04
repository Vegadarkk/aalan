import type { AuthorityNotice } from "@/lib/decisions/contracts";
import { splitMessageId, type TargetRef } from "@/lib/reports/target-key";
import { formatDateTime, KIND_LABEL } from "./moderation-format";

// Banner of a back-office content page under an authority request still in force (audit zone 7
// P3-3): which scope entries the page asks about, and the French lines it shows. An admin reads
// the authority and opens the request; a moderator (the register is admin only) learns that the
// content is preserved and whom to ask. Pure and client-safe.

/** The scope entries a report target page asks about: the content itself, then its account. */
export function noticeEntries(target: TargetRef, ownerUid: string | null | undefined): string[] {
  const entries: string[] = [];
  if (target.type === "listing") entries.push(`listing:${target.id}`);
  else if (target.type === "user") entries.push(`user:${target.id}`);
  else if (target.type === "message") {
    const ids = splitMessageId(target.id);
    if (ids) entries.push(`conversation:${ids.cid}`);
  }
  if (ownerUid && !entries.includes(`user:${ownerUid}`)) entries.push(`user:${ownerUid}`);
  return entries;
}

/** What the page calls each entry it asked about ("cette annonce", "le compte concerné"…). */
export function entryLabel(entry: string, target: TargetRef): string {
  const type = entry.slice(0, entry.indexOf(":"));
  if (type === "user") return target.type === "user" ? "ce compte" : "le compte concerné";
  if (type === "conversation") return "la conversation de ce message";
  return "cette annonce";
}

function joinFr(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
}

export interface NoticeLines {
  title: string;
  body: string;
}

/** The banner's lines for one request; `admin` names the authority, a moderator reads a neutral line. */
export function noticeLines(notice: AuthorityNotice, target: TargetRef, admin: boolean): NoticeLines {
  const what = joinFr(notice.entries.map((entry) => entryLabel(entry, target)));
  const until = notice.status === "answered" ? "jusqu'à la clôture de la demande (réponse envoyée)" : "jusqu'à la clôture de la demande";
  const due = notice.status === "open" && notice.dueAt ? ` Échéance de réponse : ${formatDateTime(notice.dueAt)}.` : "";
  if (!admin) {
    return {
      title: "Demande d'autorité en cours : conservation légale",
      body: `Une demande d'autorité vise ${what}. Les données sont conservées ${until}. Le détail est réservé aux admins : adressez-vous à eux avant toute mesure.`,
    };
  }
  return {
    title: `Demande ${authorityOf(notice.authority)}, conservation en cours`,
    body: `${KIND_LABEL[notice.kind]} reçue le ${formatDateTime(notice.receivedAt)}, visant ${what}. Conservation ${until}.${due}`,
  };
}

/** "du Parquet de Casablanca", "de l'OCLCTIC", "de la Gendarmerie royale", "de : X" otherwise. */
export function authorityOf(name: string): string {
  const trimmed = name.trim();
  const match = /^(le|la|les|l['’])\s*(.+)$/i.exec(trimmed);
  if (match?.[1] && match[2]) {
    const article = match[1].toLowerCase();
    if (article === "le") return `du ${match[2]}`;
    if (article === "les") return `des ${match[2]}`;
    return `de ${article === "la" ? "la " : "l’"}${match[2]}`;
  }
  const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (MASCULINE.has(first)) return `du ${trimmed}`;
  if (FEMININE.has(first)) return `de la ${trimmed}`;
  if (/^[aeiouyéèêâî]/i.test(trimmed)) return `de l’${trimmed}`;
  return `de ${trimmed}`;
}

const MASCULINE = new Set(["parquet", "tribunal", "procureur", "juge", "service", "commissariat", "ministère", "pôle", "bureau", "centre", "conseil", "département"]);
const FEMININE = new Set(["police", "gendarmerie", "direction", "brigade", "cour", "préfecture", "sûreté", "douane", "cellule", "commission"]);
