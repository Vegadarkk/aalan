"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Building2,
  CarFront,
  KeyRound,
  Palmtree,
  Store,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/auth/turnstile-widget";
import {
  FormMessage,
  useApiErrorMessage,
} from "@/components/auth/form-message";
import { InlineError } from "@/components/feedback/inline-error";
import { CityCombobox } from "@/components/post/city-combobox";
import { Select } from "@/components/post/controls/select";
import { Textarea } from "@/components/post/controls/textarea";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cityBySlug, type City } from "@/config/regions";
import type { Locale } from "@/config/site";
import { ApiError } from "@/lib/auth/client";
import type { ProApplyInput, ProSelfView } from "@/lib/contracts/pro";
import {
  sectorCommitmentScope,
  type CommitmentScope,
} from "@/lib/pro/commitments";
import {
  EU_COUNTRIES,
  EU_VAT_PATTERN,
  LEGAL_FORMS,
  MOROCCAN_LEGAL_FORMS,
  euRegistryOk,
  normalizeEuRegistry,
  normalizeIdentifier,
  type EuCountry,
  type LegalForm,
} from "@/lib/pro/kybc";
import { displayNameContact } from "@/lib/moderation/display-name";
import {
  firstStrictIssue,
  type FreeTextIssue,
} from "@/lib/moderation/free-text";
import { submitProApplication } from "@/lib/pro/client";
import {
  PRO_DESCRIPTION_MAX,
  PRO_NAME_MAX,
  type ProSector,
} from "@/lib/pro/profile-schema";
import { cn } from "@/lib/utils";
import { KybcPieces, type PieceState } from "./kybc-pieces";
import { ProCommitments } from "./pro-commitments";

// Pro application form (phase 7 design §4): the activity (journey review 2026-10-29: an agency
// applies as such, with its trade's commitments), shop, legal form and its identifiers, the number
// a moderator calls while the WhatsApp check is parked, the KYBC pieces, the legal commitments
// (with the admin guide's procedures) and a Turnstile check. Checked here as the server checks it
// (src/lib/pro/kybc.ts), so a refusal is shown on its field before anything is sent; the server
// stays the judge. A carrier (owner 2026-11-10) may also apply as a company registered in the EU,
// with an EU mobile in its international form for the moderator's call.

/** What the applicant does; a dealership is a shop whose storefront shows its vehicle stock. */
export const ACTIVITIES = [
  "shop",
  "dealer",
  "real_estate",
  "car_rental",
  "holiday_rental",
  "carrier",
] as const;
export type Activity = (typeof ACTIVITIES)[number];
const ACTIVITY_ICONS: Record<Activity, LucideIcon> = {
  shop: Store,
  dealer: CarFront,
  real_estate: Building2,
  car_rental: KeyRound,
  holiday_rental: Palmtree,
  carrier: Truck,
};

/** The activities offered: the carriers' only while their space is open (`carriersEnabled`). */
export function activitiesShown(
  carriersOpen: boolean,
  current: Activity | null,
): readonly Activity[] {
  return ACTIVITIES.filter(
    (activity) =>
      activity !== "carrier" || carriersOpen || current === "carrier",
  );
}

/** The legal forms offered for an activity: an EU company for a carrier only. */
export function legalFormsFor(activity: Activity | null): readonly LegalForm[] {
  return activity === "carrier" ? LEGAL_FORMS : MOROCCAN_LEGAL_FORMS;
}

/** The sector sent for an activity (src/lib/pro/profile-schema.ts). */
export function sectorOf(activity: Activity): ProSector {
  return activity === "shop" ? "general" : activity;
}

/** The agency commitments an activity adds to the shop's own, or null. */
export function agencyScopeOf(
  activity: Activity | null,
): CommitmentScope | null {
  return activity ? sectorCommitmentScope(sectorOf(activity)) : null;
}

type Identifier =
  | "ice"
  | "rc"
  | "if"
  | "aeNumber"
  | "tp"
  | "coopNumber"
  | "registry"
  | "vat";
type FieldKey =
  | "activity"
  | "name"
  | "city"
  | "form"
  | "country"
  | Identifier
  | "phone"
  | "pieces"
  | "commitment"
  | "sectorCommitment"
  | "challenge";

/** Identifier inputs per legal form, in reading order; `commercant` needs rc or tp. */
const IDENTIFIERS: Record<LegalForm, readonly Identifier[]> = {
  societe: ["ice", "rc", "if"],
  auto_entrepreneur: ["ice", "aeNumber"],
  commercant: ["ice", "rc", "tp"],
  cooperative: ["ice", "coopNumber"],
  entreprise_ue: ["registry", "vat"],
};

const REGISTRY = /^[A-Z0-9/]{1,30}$/;
/** Moroccan mobile as typed (06…, +212 6…, 00212 6…); the server normalizes and checks it for real. */
const MOBILE = /^(?:0|\+212|00212)[67]\d{8}$/;
/** An EU carrier's mobile in its international form (+33 6…, 0032 4…); the server checks the ranges. */
const EU_MOBILE = /^(?:\+|00)(?:33|32|31|34|39|49|351)\d{6,12}$/;

export interface Draft {
  activity: Activity | null;
  name: string;
  description: string;
  city: City | null;
  form: LegalForm | null;
  /** Country of registration of an EU company. */
  country: EuCountry | null;
  ids: Record<Identifier, string>;
  phone: string;
  commitment: boolean;
  /** The agency commitments of the activity, ticked (agencies only). */
  sectorCommitment: boolean;
}

type MessageKey =
  | "required"
  | "activityRequired"
  | "nameLength"
  | "nameContact"
  | "cityRequired"
  | "iceFormat"
  | "identifierFormat"
  | "registryFormat"
  | "vatFormat"
  | "rcOrTp"
  | "phoneRequired"
  | "phoneFormat"
  | "phoneFormatEu"
  | "piecesRequired"
  | "piecesPending"
  | "commitmentRequired"
  | "sectorCommitmentRequired"
  | "challenge";

export function initialDraft(previous: ProSelfView | null): Draft {
  const form =
    previous && (LEGAL_FORMS as readonly string[]).includes(previous.legalForm)
      ? (previous.legalForm as LegalForm)
      : null;
  return {
    // A rejected application keeps its sector (a dealership's too since B13).
    activity: previous
      ? previous.sector === "general"
        ? "shop"
        : previous.sector
      : null,
    name: previous?.name ?? "",
    description: previous?.description ?? "",
    city: previous ? (cityBySlug(previous.citySlug) ?? null) : null,
    form,
    country:
      previous?.legalCountry &&
      (EU_COUNTRIES as readonly string[]).includes(previous.legalCountry)
        ? (previous.legalCountry as EuCountry)
        : null,
    // The registry numbers of a rejected application are not sent back (only the ICE is shown).
    ids: {
      ice: previous?.ice ?? "",
      rc: "",
      if: "",
      aeNumber: "",
      tp: "",
      coopNumber: "",
      registry: "",
      vat: "",
    },
    phone: "",
    commitment: false,
    sectorCommitment: false,
  };
}

/** The presentation's text screen, as the storefront's (src/lib/moderation/free-text.ts): null when it may be sent. */
export function descriptionIssue(
  draft: Pick<Draft, "description">,
): FreeTextIssue | null {
  const text = draft.description.trim();
  return text ? firstStrictIssue(text) : null;
}

export function draftProblems(
  draft: Draft,
  pieces: readonly PieceState[],
  needsPhone: boolean,
  token: string | null,
): Partial<Record<FieldKey, MessageKey>> {
  const out: Partial<Record<FieldKey, MessageKey>> = {};
  if (!draft.activity) out.activity = "activityRequired";
  const name = draft.name.trim();
  if (name === "") out.name = "required";
  else if (name.length < 2 || name.length > PRO_NAME_MAX)
    out.name = "nameLength";
  // The shop's name and presentation show publicly: no number or link in them (B6, Z1-27).
  else if (displayNameContact(name)) out.name = "nameContact";
  if (!draft.city) out.city = "cityRequired";
  if (!draft.form) out.form = "required";
  else if (draft.form === "entreprise_ue") {
    if (!draft.country) out.country = "required";
    const registry = normalizeIdentifier(draft.ids.registry);
    if (registry === "") out.registry = "required";
    else if (draft.country && !euRegistryOk(draft.country, registry))
      out.registry = "registryFormat";
    const vat = normalizeIdentifier(draft.ids.vat);
    if (
      vat !== "" &&
      (!EU_VAT_PATTERN.test(vat) ||
        (draft.country !== null && !vat.startsWith(draft.country)))
    )
      out.vat = "vatFormat";
  } else {
    const ice = normalizeIdentifier(draft.ids.ice);
    if (ice === "") out.ice = "required";
    else if (!/^\d{15}$/.test(ice)) out.ice = "iceFormat";
    for (const key of IDENTIFIERS[draft.form]) {
      if (key === "ice") continue;
      const value = normalizeIdentifier(draft.ids[key]);
      if (value === "") {
        if (draft.form !== "commercant") out[key] = "required";
      } else if (!REGISTRY.test(value)) out[key] = "identifierFormat";
    }
    if (
      draft.form === "commercant" &&
      normalizeIdentifier(draft.ids.rc) === "" &&
      normalizeIdentifier(draft.ids.tp) === ""
    )
      out.rc = "rcOrTp";
  }
  if (needsPhone) {
    const phone = draft.phone.replace(/[\s.()-]/g, "");
    const eu = draft.form === "entreprise_ue";
    if (phone === "") out.phone = "phoneRequired";
    else if (!MOBILE.test(phone) && !(eu && EU_MOBILE.test(phone)))
      out.phone = eu ? "phoneFormatEu" : "phoneFormat";
  }
  if (pieces.some((piece) => piece.phase === "uploading"))
    out.pieces = "piecesPending";
  else if (!pieces.some((piece) => piece.phase === "ready"))
    out.pieces = "piecesRequired";
  if (!draft.commitment) out.commitment = "commitmentRequired";
  if (agencyScopeOf(draft.activity) && !draft.sectorCommitment)
    out.sectorCommitment = "sectorCommitmentRequired";
  if (!token) out.challenge = "challenge";
  return out;
}

function legalOf(draft: Draft & { form: LegalForm }): ProApplyInput["legal"] {
  const id = (key: Identifier) => normalizeIdentifier(draft.ids[key]);
  if (draft.form === "entreprise_ue") {
    const country = draft.country ?? "FR";
    return {
      form: "entreprise_ue",
      country,
      registry: normalizeEuRegistry(country, draft.ids.registry),
      ...(id("vat") ? { vat: id("vat") } : {}),
    };
  }
  if (draft.form === "societe")
    return { form: "societe", ice: id("ice"), rc: id("rc"), if: id("if") };
  if (draft.form === "auto_entrepreneur")
    return {
      form: "auto_entrepreneur",
      ice: id("ice"),
      aeNumber: id("aeNumber"),
    };
  if (draft.form === "cooperative")
    return {
      form: "cooperative",
      ice: id("ice"),
      coopNumber: id("coopNumber"),
    };
  return {
    form: "commercant",
    ice: id("ice"),
    ...(id("rc") ? { rc: id("rc") } : {}),
    ...(id("tp") ? { tp: id("tp") } : {}),
  };
}

interface ProApplicationFormProps {
  /** The rejected application being corrected, or null for a first application. */
  previous: ProSelfView | null;
  /** The number is asked: not verified on the account and the WhatsApp check is parked. */
  needsPhone: boolean;
  /** Sent, or refused because the account's state changed meanwhile: the area reloads. */
  onDone: () => void;
  /** The button's text when it is neither a first application nor a correction (a shop's new KYBC, P2-10). */
  submitLabel?: string;
  /** The carriers space is open (`carriersEnabled`): the carrier activity is offered. */
  carriersOpen?: boolean;
}

export function ProApplicationForm({
  previous,
  needsPhone,
  onDone,
  submitLabel,
  carriersOpen = false,
}: ProApplicationFormProps) {
  const t = useTranslations("Pro.form");
  const errors = useTranslations("Pro.errors");
  const issues = useTranslations("FreeText");
  const apiMessage = useApiErrorMessage();
  const locale = useLocale() as Locale;
  const formRef = useRef<HTMLFormElement>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(previous));
  const [pieces, setPieces] = useState<PieceState[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const problems = attempted
    ? draftProblems(draft, pieces, needsPhone, token)
    : {};
  const message = (key: FieldKey) => {
    const found = problems[key];
    return found ? t(found) : undefined;
  };
  // Shown as typed, like the storefront's own presentation.
  const textIssue = descriptionIssue(draft);
  const set = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const regionNames = new Intl.DisplayNames([locale], { type: "region" });
  const identifierHint = (key: Identifier): string | undefined => {
    if (key === "ice") return t("iceHint");
    if (key === "rc" && draft.form === "commercant") return t("rcOrTp");
    if (key === "registry")
      return draft.country
        ? t(`registryHints.${draft.country}`)
        : t("registryHint");
    if (key === "vat") return t("vatHint");
    return undefined;
  };
  const setId = (key: Identifier, value: string) =>
    setDraft((current) => ({
      ...current,
      ids: { ...current.ids, [key]: value },
    }));

  function failureText(caught: unknown): string {
    const code = caught instanceof ApiError ? caught.code : "internal";
    const key = code as Parameters<typeof errors.has>[0];
    return errors.has(key) ? errors(key) : apiMessage(caught);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAttempted(true);
    const found = draftProblems(draft, pieces, needsPhone, token);
    if (
      Object.keys(found).length > 0 ||
      textIssue ||
      !draft.activity ||
      !draft.form ||
      !draft.city ||
      !token
    ) {
      // The first invalid control takes the focus, once the messages are rendered.
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      await submitProApplication({
        name: draft.name.trim(),
        description: draft.description.trim(),
        regionCode: draft.city.regionCode,
        citySlug: draft.city.slug,
        legal: legalOf({ ...draft, form: draft.form }),
        ...(needsPhone ? { phone: draft.phone.trim() } : {}),
        uploadIds: pieces.flatMap((piece) =>
          piece.phase === "ready" ? [piece.uploadId] : [],
        ),
        complianceCommitment: true,
        sector: sectorOf(draft.activity),
        ...(agencyScopeOf(draft.activity)
          ? { sectorCommitment: true as const }
          : {}),
        turnstileToken: token,
      });
      toast.success(t("submitted"), { description: t("submittedBody") });
      onDone();
    } catch (caught) {
      setPending(false);
      // A token is single use: a fresh one for the next attempt, whatever went wrong.
      setToken(null);
      turnstile.current?.reset();
      if (
        caught instanceof ApiError &&
        [
          "already_pro",
          "pro_application_exists",
          "pro_signup_closed",
          "account_suspended",
          "email_not_verified",
        ].includes(caught.code)
      ) {
        toast.error(failureText(caught));
        onDone();
        return;
      }
      setFailure(caught);
    }
  }

  const agencyScope = agencyScopeOf(draft.activity);

  return (
    <form
      ref={formRef}
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="flex flex-col gap-10"
    >
      <Section title={t("activityTitle")}>
        <fieldset
          className="flex flex-col gap-3"
          aria-invalid={problems.activity ? true : undefined}
        >
          <legend className="sr-only">{t("activityTitle")}</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {activitiesShown(carriersOpen, draft.activity).map((activity) => {
              const Icon = ACTIVITY_ICONS[activity];
              return (
                <label
                  key={activity}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border bg-surface p-3.5 transition-colors duration-150",
                    draft.activity === activity
                      ? "border-structure bg-structure/5 dark:border-gold-300"
                      : "border-border hover:border-border-strong",
                  )}
                >
                  <input
                    type="radio"
                    name="activity"
                    value={activity}
                    checked={draft.activity === activity}
                    onChange={() =>
                      set({
                        activity,
                        sectorCommitment: false,
                        ...(activity !== "carrier" &&
                        draft.form === "entreprise_ue"
                          ? { form: null }
                          : {}),
                      })
                    }
                    className="mt-1 size-4 shrink-0 accent-structure"
                  />
                  <Icon
                    className="mt-0.5 size-5 shrink-0 text-structure dark:text-gold-300"
                    aria-hidden="true"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {t(`activities.${activity}`)}
                    </span>
                    <span className="text-xs text-foreground-muted text-pretty">
                      {t(`activityHints.${activity}`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {problems.activity ? (
            <InlineError>{t(problems.activity)}</InlineError>
          ) : null}
        </fieldset>
      </Section>

      <Section title={t(agencyScope ? "agencyTitle" : "shopTitle")}>
        <Field
          label={t(agencyScope ? "agencyName" : "name")}
          hint={t("nameHint", { max: PRO_NAME_MAX })}
          error={message("name")}
          required
        >
          <Input
            value={draft.name}
            maxLength={PRO_NAME_MAX}
            dir="auto"
            autoComplete="organization"
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Field
          label={t("description")}
          hint={t("descriptionHint")}
          error={textIssue ? issues(textIssue) : undefined}
        >
          <Textarea
            value={draft.description}
            rows={3}
            maxLength={PRO_DESCRIPTION_MAX}
            dir="auto"
            className="min-h-24"
            onChange={(event) => set({ description: event.target.value })}
          />
        </Field>
        <CityCombobox
          value={draft.city}
          onSelect={(city) => set({ city })}
          error={message("city")}
          required
          locale={locale}
        />
      </Section>

      <Section title={t("legalTitle")}>
        <fieldset
          className="flex flex-col gap-3"
          aria-invalid={problems.form ? true : undefined}
        >
          <legend className="mb-1.5 text-sm font-medium">
            {t("legalForm")}
            <span className="ms-0.5 text-danger" aria-hidden="true">
              *
            </span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {legalFormsFor(draft.activity).map((form) => (
              <label
                key={form}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border bg-surface p-3.5 transition-colors duration-150",
                  draft.form === form
                    ? "border-structure bg-structure/5 dark:border-gold-300"
                    : "border-border hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name="legal-form"
                  value={form}
                  checked={draft.form === form}
                  onChange={() => set({ form })}
                  className="mt-1 size-4 shrink-0 accent-structure"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {t(`forms.${form}`)}
                  </span>
                  <span className="text-xs text-foreground-muted text-pretty">
                    {t(`legalFormHint.${form}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {problems.form ? <InlineError>{t(problems.form)}</InlineError> : null}
        </fieldset>
        {draft.form === "entreprise_ue" ? (
          <Field label={t("country")} error={message("country")} required>
            <Select
              data-testid="pro-legal-country"
              value={draft.country ?? ""}
              onChange={(event) =>
                set({
                  country: (event.target.value || null) as EuCountry | null,
                })
              }
            >
              <option value="">{t("countryPlaceholder")}</option>
              {EU_COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {regionNames.of(country) ?? country}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {draft.form ? (
          <div className="grid gap-5 sm:grid-cols-2">
            {IDENTIFIERS[draft.form].map((key) => (
              <Field
                key={key}
                label={t(key)}
                hint={identifierHint(key)}
                error={message(key)}
                required={
                  key !== "vat" &&
                  (draft.form !== "commercant" || key === "ice")
                }
                className={key === "ice" ? "sm:col-span-2" : undefined}
              >
                <Input
                  value={draft.ids[key]}
                  dir="ltr"
                  inputMode={key === "ice" ? "numeric" : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={key === "ice" ? 24 : 40}
                  className="font-medium tracking-wide tabular-nums"
                  onChange={(event) => setId(key, event.target.value)}
                />
              </Field>
            ))}
          </div>
        ) : null}
      </Section>

      {needsPhone ? (
        <Section title={t("phoneTitle")}>
          <Field
            label={t("phone")}
            hint={t(
              draft.form === "entreprise_ue" ? "phoneHintEu" : "phoneHint",
            )}
            error={message("phone")}
            required
          >
            <Input
              type="tel"
              value={draft.phone}
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              placeholder="06 12 34 56 78"
              onChange={(event) => set({ phone: event.target.value })}
            />
          </Field>
        </Section>
      ) : null}

      <Section title={t("piecesTitle")}>
        <KybcPieces
          pieces={pieces}
          onChange={setPieces}
          error={message("pieces")}
        />
      </Section>

      <Section title={t("commitTitle")}>
        <ProCommitments
          scope="shop"
          checked={draft.commitment}
          onCheckedChange={(commitment) => set({ commitment })}
          error={message("commitment")}
        />
        {agencyScope ? (
          <ProCommitments
            scope={agencyScope}
            checked={draft.sectorCommitment}
            onCheckedChange={(sectorCommitment) => set({ sectorCommitment })}
            error={message("sectorCommitment")}
          />
        ) : null}
        <TurnstileWidget
          ref={turnstile}
          action="pro-apply"
          cData="pro-apply"
          onToken={setToken}
          error={message("challenge")}
        />
      </Section>

      {failure ? (
        <FormMessage error={failure} title={failureText(failure)} />
      ) : null}

      <div className="flex justify-end border-t border-border pt-6">
        <Button type="submit" loading={pending} className="w-full sm:w-auto">
          {submitLabel ?? (previous ? t("resubmit") : t("submit"))}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold text-balance">{title}</h2>
      {children}
    </section>
  );
}
