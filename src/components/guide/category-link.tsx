import { useTranslations } from "next-intl";
import { ScrollText } from "lucide-react";
import { guideRubricCard, type GuideRubric } from "@/content/guide";
import type { Locale } from "@/config/site";
import { textLinkClassName } from "@/components/ui/text-link";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// Listing page of a category the admin procedures guide serves (vehicles, property; design
// guide-demarches G1): one line to the rubric with the official procedures (mutation, land registry).

/** `procedure`: straight to one of the rubric's procedures (a holiday home: the tourist rental one, audit L4-12). */
export function GuideCategoryLink({ rubric, procedure, locale, className }: { rubric: GuideRubric; procedure?: string; locale: Locale; className?: string }) {
  const t = useTranslations("Guide");
  return (
    <Link href={procedure ? `/demarches/${rubric}#procedure-${procedure}` : `/demarches/${rubric}`} className={cn("inline-flex min-h-11 items-center gap-2 self-start rounded-sm text-sm font-medium text-link", textLinkClassName, className)}>
      <ScrollText aria-hidden="true" className="size-4 shrink-0 text-structure dark:text-gold-300" />
      {t("categoryLink", { title: guideRubricCard(locale, rubric).title })}
    </Link>
  );
}
