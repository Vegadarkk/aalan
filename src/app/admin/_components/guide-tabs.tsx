import Link from "next/link";
import { TAX_GUIDE_PATH } from "@/lib/guide/tax-guide";
import { cn } from "@/lib/utils";

// The two pages of "Guide démarches": the official links of the public guide (team), and the tax
// guide (admins, zone 7 audit P3-7). Moderators see the first page only, without tabs.

export function GuideTabs({ current, admin }: { current: "links" | "tax"; admin: boolean }) {
  if (!admin) return null;
  const tabs = [
    { key: "links", href: "/guide", label: "Liens officiels" },
    { key: "tax", href: TAX_GUIDE_PATH, label: "Guide fiscal" },
  ] as const;
  return (
    <nav aria-label="Guide démarches" className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={cn(
            "-mb-px flex min-h-10 items-center border-b-2 border-transparent px-3 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground",
            "aria-[current=page]:border-primary aria-[current=page]:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
