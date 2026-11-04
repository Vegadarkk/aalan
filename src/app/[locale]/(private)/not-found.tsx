import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotFoundView } from "@/components/feedback/not-found-view";

// The tab says what happened, "Page introuvable | Aalan", not the site's default title (audit zone 2, P3-1).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NotFound");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default function NotFound() {
  return <NotFoundView />;
}
