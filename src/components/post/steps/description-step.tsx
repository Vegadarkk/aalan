"use client";

import { useEffect, type FocusEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "@/lib/zod";
import { Field } from "@/components/ui/field";
import { useWizard } from "@/lib/listings/client/store";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, descriptionStepSchema } from "@/lib/listings/client/validation";
import { Textarea } from "../controls/textarea";
import { useFieldErrorMessage, useValidationMessage } from "../field-messages";
import { STEP_FORM_ID } from "../wizard-shell";
import { CharacterCounter } from "./character-counter";

type Form = z.input<typeof descriptionStepSchema>;

export function DescriptionStep({ onNext }: { onNext: () => void }) {
  const { listing, update, flush, blockers } = useWizard();
  const t = useTranslations("Listing.fields");
  const fieldMessage = useFieldErrorMessage();
  const validationMessage = useValidationMessage();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(descriptionStepSchema), defaultValues: { description: listing.description }, mode: "onTouched" });
  const description = useWatch({ control, name: "description" });
  // No "too short" before the person has typed (zone 3 P2-8): the rule is the hint and the counter;
  // the error comes with "Continuer", or on leaving a field that holds some text (still onTouched).
  const field = register("description");
  const registered = {
    ...field,
    // Leaving the field empty does not mark it touched: no error before the first character.
    onBlur: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => (event.target.value.trim() ? field.onBlur(event) : undefined),
  };

  useEffect(() => {
    if (description !== listing.description) update({ description });
  }, [description, listing.description, update]);

  useEffect(() => {
    const blocker = blockers.find((issue) => issue.path === "description");
    if (blocker) setError("description", { type: "server", message: validationMessage(blocker.code) }, { shouldFocus: true });
  }, [blockers, setError, validationMessage]);

  const onSubmit = handleSubmit(() => {
    void flush();
    onNext();
  });

  const error = fieldMessage(errors.description?.type === "too_big" ? "description_max" : "description_min", errors.description);

  return (
    <form id={STEP_FORM_ID} onSubmit={onSubmit} onBlur={() => void flush()} noValidate className="flex flex-col gap-5">
      <Field label={t("description")} hint={t("descriptionHint", { min: DESCRIPTION_MIN })} error={error} required>
        <Textarea rows={6} autoFocus={!listing.description} maxLength={DESCRIPTION_MAX + 200} placeholder={t("descriptionPlaceholder")} {...registered} />
      </Field>
      <CharacterCounter count={description.trim().length} min={DESCRIPTION_MIN} max={DESCRIPTION_MAX} />
      <aside className="flex gap-3 rounded-lg bg-surface-brand px-4 py-3 text-sm">
        <Lightbulb className="mt-0.5 size-5 shrink-0 text-featured-foreground" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("tipsTitle")}</p>
          <ul className="list-disc ps-4 text-foreground-muted">
            <li>{t("tip1")}</li>
            <li>{t("tip2")}</li>
            <li>{t("tip3")}</li>
          </ul>
        </div>
      </aside>
    </form>
  );
}
