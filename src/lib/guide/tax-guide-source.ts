import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseMarkdown } from "@/lib/legal/markdown";
import { taxGuide, type TaxGuide } from "./tax-guide";

// docs/tax-runbook.md, read once per process. The Docker build context keeps this one file of
// docs/ (.dockerignore) and next.config.ts traces it into the standalone output of the page.

const SOURCE = path.join(process.cwd(), "docs", "tax-runbook.md");
let cached: TaxGuide | undefined;

export function readTaxGuide(): TaxGuide {
  cached ??= taxGuide(parseMarkdown(readFileSync(SOURCE, "utf8")));
  return cached;
}
