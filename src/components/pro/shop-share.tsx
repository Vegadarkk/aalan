"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { usePublicConfig } from "@/lib/config/client";
import { encodeQr, qrSvg, type QrMatrix } from "@/lib/qr/encode";

// « Partager ma boutique » in the Pro area (UX audit of the Pro shops, lot 3): the storefront's
// link and its QR code, drawn in the browser (no request, no stored file), to download for a shop
// window, a business card or a flyer. The link has no language prefix: the site sends each
// visitor to the storefront in their own language.

const QR_COLOR = "#0b2a2c"; // bab-900: dark enough for any phone reader on white.
const PNG_MODULE_PX = 16;

function pngBlob(matrix: QrMatrix): Promise<Blob | null> {
  const border = 4;
  const side = (matrix.size + border * 2) * PNG_MODULE_PX;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, side, side);
  context.fillStyle = QR_COLOR;
  matrix.modules.forEach((row, y) => row.forEach((dark, x) => dark && context.fillRect((x + border) * PNG_MODULE_PX, (y + border) * PNG_MODULE_PX, PNG_MODULE_PX, PNG_MODULE_PX)));
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShopShare({ storefront }: { storefront: string }) {
  const t = useTranslations("Pro.share");
  const config = usePublicConfig();
  const [copied, setCopied] = useState(false);
  const origin = config?.siteUrl ?? (typeof window !== "undefined" ? window.location.origin : null);
  const link = origin ? new URL(`/boutique/${storefront}`, origin).toString() : null;
  const qr = useMemo(() => {
    if (!link) return null;
    const matrix = encodeQr(link);
    const svg = qrSvg(matrix, { color: QR_COLOR });
    return { matrix, svg, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
  }, [link]);
  const fileName = `qr-boutique-${storefront.slice(0, 60)}`;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Blocked clipboard: the link stays selectable on screen.
    }
  }

  async function downloadPng() {
    if (!qr) return;
    const blob = await pngBlob(qr.matrix);
    if (blob) save(blob, `${fileName}.png`);
  }

  return (
    <section aria-labelledby="pro-share" data-testid="shop-share" data-tour="pro-share" className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:flex-row sm:items-start sm:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 id="pro-share" className="text-lg font-semibold">
            {t("title")}
          </h2>
          <p className="text-sm text-foreground-muted text-pretty">{t("lead")}</p>
        </header>
        {link ? (
          <>
            <p className="rounded-md border border-border bg-background px-3 py-2.5 font-mono text-sm break-all select-all" dir="ltr" data-testid="shop-share-link">
              {link}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={() => void copy()}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? t("copied") : t("copy")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void downloadPng()}>
                <Download aria-hidden="true" />
                {t("downloadPng")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => qr && save(new Blob([qr.svg], { type: "image/svg+xml" }), `${fileName}.svg`)}>
                <Download aria-hidden="true" />
                {t("downloadSvg")}
              </Button>
            </div>
            <p className="text-xs text-foreground-muted text-pretty">{t("printHint")}</p>
          </>
        ) : null}
      </div>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn in the browser, nothing for next/image to optimize.
        <img src={qr.src} alt={t("qrAlt")} width={176} height={176} className="size-44 shrink-0 self-center rounded-md border border-border bg-white sm:self-start" data-testid="shop-share-qr" />
      ) : null}
    </section>
  );
}
