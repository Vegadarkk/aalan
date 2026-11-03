"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { InlineError } from "@/components/feedback/inline-error";
import { catalogueKind, subcategoryById } from "@/config/categories";
import type { Locale } from "@/config/site";
import { formatPrice } from "@/lib/listings/client/format";
import { useWizard } from "@/lib/listings/client/store";
import { stepIssues } from "@/lib/listings/client/validation";
import { attributesWithoutAxes } from "@/lib/listings/client/variants";
import { priceLooksHigh } from "@/lib/listings/price-sense";
import { useValidationMessage } from "../field-messages";
import { PriceInput } from "../price-input";
import { VariantsEditor } from "../variants-editor";
import { STEP_FORM_ID } from "../wizard-shell";

export function PriceStep({ onNext }: { onNext: () => void }) {
  const { listing, update, flush, blockers } = useWizard();
  const message = useValidationMessage();
  const t = useTranslations("Listing.fields");
  const locale = useLocale() as Locale;
  const [attempted, setAttempted] = useState(false);
  const subcategory = listing.subcategoryId ? subcategoryById(listing.subcategoryId) : undefined;
  const issues = useMemo(() => stepIssues("prix", listing), [listing]);
  const blocker = blockers.find((issue) => issue.path === "price" || issue.path === "isDonation");
  const issue = blocker ?? (attempted ? issues[0] : undefined);
  // No "ou cochez « Je donne cet objet »" where giving is not offered (real estate, rentals: P2-10).
  const error = issue ? message(issue.code === "price_required" && !subcategory?.donationAllowed ? "price_required_amount" : issue.code) : undefined;
  const kind = catalogueKind(subcategory);
  const unit = subcategory?.priceUnit ? ` ${t(`per.${subcategory.priceUnit}`)}` : "";
  const warning = !listing.isDonation && listing.price !== null && priceLooksHigh(listing.price, listing.categoryId, listing.subcategoryId) ? t("priceCheck", { price: `${formatPrice(listing.price, locale)}${unit}` }) : undefined;
  const catalogueBlockers = blockers.filter((item) => item.path === "stock" || item.path.startsWith("variants"));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (stepIssues("prix", listing).length === 0) {
      void flush();
      onNext();
    }
  }

  return (
    <form id={STEP_FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <PriceInput
        value={listing.price}
        onChange={(price) => update({ price })}
        negotiable={listing.priceNegotiable}
        onNegotiable={(priceNegotiable) => update({ priceNegotiable }, { flush: true })}
        isDonation={listing.isDonation}
        onDonation={(isDonation) => update(isDonation ? { isDonation, price: null, priceNegotiable: false } : { isDonation }, { flush: true })}
        donationAllowed={Boolean(subcategory?.donationAllowed)}
        priceOptional={Boolean(subcategory?.priceOptional)}
        priceUnit={subcategory?.priceUnit}
        priceMode={subcategory?.priceMode}
        error={error}
        warning={warning}
        onBlur={() => void flush()}
      />
      {/* Pro catalogue (owner decision 5: Pros only): no stock nor variants on a donation, nor on real
          estate, services or jobs; a rental car declares its available vehicles only (P2-10). */}
      {subcategory && listing.sellerType === "pro" && !listing.isDonation && kind !== "none" ? (
        <VariantsEditor
          fleet={kind === "fleet"}
          subcategory={subcategory}
          price={listing.price}
          variants={listing.variants}
          stock={listing.stock}
          onChange={({ variants, stock }) => update({ variants, stock, ...(variants ? { attributes: attributesWithoutAxes(listing.attributes, variants.axes) } : {}) })}
          onBlur={() => void flush()}
        />
      ) : null}
      {catalogueBlockers.map((item) => (
        <InlineError key={`${item.path}:${item.code}`}>{message(item.code)}</InlineError>
      ))}
    </form>
  );
}
