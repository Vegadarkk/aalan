import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DocumentTitle } from "../_components/document-title";

/**
 * Unknown page, or a page another role cannot see (moderators on /personnel). A nested not-found
 * exports no metadata: the tab would keep the refused section's name (zone 7 audit P3-9), so the
 * title is set once the page is shown.
 */
export default function AdminNotFound() {
  return (
    <section className="flex flex-col items-start gap-3 py-8">
      <DocumentTitle title="Page introuvable · Back-office Aalan" />
      <h1 className="text-2xl font-semibold">Page introuvable</h1>
      <p className="text-foreground-muted">Cette page n&apos;existe pas, ou votre rôle n&apos;y donne pas accès.</p>
      <Button asChild variant="outline">
        <Link href="/">Retour au tableau de bord</Link>
      </Button>
    </section>
  );
}
