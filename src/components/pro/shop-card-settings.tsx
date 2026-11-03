"use client";

import { useState, type FormEvent } from "react";
import { Copy, ExternalLink, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BannerPicker } from "@/components/account/storefront-section";
import { FormMessage } from "@/components/auth/form-message";
import { CityCombobox } from "@/components/post/city-combobox";
import { Textarea } from "@/components/post/controls/textarea";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { inputClassName } from "@/components/ui/input";
import { cityBySlug, type City } from "@/config/regions";
import type { BannerKey } from "@/config/storefront";
import { Link } from "@/i18n/navigation";
import type { ProSelfView, ProShopCard } from "@/lib/contracts/pro";
import { firstStrictIssue, type FreeTextIssue } from "@/lib/moderation/free-text";
import { saveShopCard } from "@/lib/pro/client";
import { PRO_ADDRESS_MAX, PRO_DESCRIPTION_MAX, PRO_HOURS_NOTE_MAX, WEEKDAYS, type OpeningHours, type Weekday } from "@/lib/pro/profile-schema";
import { cn } from "@/lib/utils";

// « Ma fiche boutique » in the Pro area (UX audit of the Pro shops, lot 1): what the storefront
// shows besides the listings. Banner, presentation in French and Arabic, city, address, weekly
// hours, the verified number and WhatsApp (switches, never a typed number), website. Every text
// is screened as it is typed, and again on the server. The name stays the verified one.

type Slot = { from: string; to: string };
type DayDraft = { open: boolean; slots: Slot[] };
type Week = Record<Weekday, DayDraft>;

const DEFAULT_SLOT: Slot = { from: "09:00", to: "19:00" };

function weekOf(hours: OpeningHours | null): Week {
  const byDay = new Map((hours?.days ?? []).map((entry) => [entry.day, entry.slots]));
  return Object.fromEntries(WEEKDAYS.map((day) => [day, { open: byDay.has(day), slots: byDay.get(day) ?? [DEFAULT_SLOT] }])) as Week;
}

function hoursOf(week: Week, note: string): OpeningHours | null {
  const days = WEEKDAYS.filter((day) => week[day].open).map((day) => ({ day, slots: week[day].slots }));
  return days.length > 0 || note ? { days, note } : null;
}

/** The first day whose periods are not in order (start before end, the second after the first). */
function badDay(week: Week): Weekday | null {
  for (const day of WEEKDAYS) {
    const { open, slots } = week[day];
    if (!open) continue;
    if (slots.some((slot) => !slot.from || !slot.to || slot.from >= slot.to)) return day;
    if (slots.length === 2 && (slots[0]?.to ?? "") > (slots[1]?.from ?? "")) return day;
  }
  return null;
}

const websiteOk = (value: string) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
};

export function ShopCardSettings({ shop }: { shop: Pick<ProSelfView, "card" | "storefront"> }) {
  const t = useTranslations("Pro.card");
  const issues = useTranslations("FreeText");
  const [saved, setSaved] = useState<ProShopCard>(shop.card);
  const [bannerKey, setBannerKey] = useState<BannerKey>(saved.bannerKey);
  const [description, setDescription] = useState(saved.description);
  const [descriptionAr, setDescriptionAr] = useState(saved.descriptionAr);
  const [city, setCity] = useState<City | null>(cityBySlug(saved.citySlug) ?? null);
  const [address, setAddress] = useState(saved.address);
  const [week, setWeek] = useState<Week>(() => weekOf(saved.hours));
  const [note, setNote] = useState(saved.hours?.note ?? "");
  const [showPhone, setShowPhone] = useState(saved.showPhone);
  const [whatsapp, setWhatsapp] = useState(saved.whatsapp);
  const [website, setWebsite] = useState(saved.website);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const screen = (text: string): FreeTextIssue | null => (text.trim() ? firstStrictIssue(text.trim()) : null);
  const textIssues = { description: screen(description), descriptionAr: screen(descriptionAr), address: screen(address), note: screen(note) };
  const wrongDay = badDay(week);
  const wrongWebsite = !websiteOk(website.trim());
  const invalid = Object.values(textIssues).some(Boolean) || wrongDay !== null || wrongWebsite || city === null;

  function setDay(day: Weekday, next: Partial<DayDraft>) {
    setWeek((current) => ({ ...current, [day]: { ...current[day], ...next } }));
  }
  function setSlot(day: Weekday, index: number, next: Partial<Slot>) {
    setWeek((current) => ({ ...current, [day]: { ...current[day], slots: current[day].slots.map((slot, at) => (at === index ? { ...slot, ...next } : slot)) } }));
  }
  function copyToAll(day: Weekday) {
    setWeek((current) => Object.fromEntries(WEEKDAYS.map((other) => [other, other === "sun" && day !== "sun" ? current.sun : { open: current[day].open, slots: current[day].slots.map((slot) => ({ ...slot })) }])) as Week);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || invalid || !city) return;
    setPending(true);
    setFailure(null);
    try {
      const { card } = await saveShopCard({
        description: description.trim(),
        descriptionAr: descriptionAr.trim(),
        citySlug: city.slug,
        address: address.trim(),
        hours: hoursOf(week, note.trim()),
        showPhone: saved.phoneVerified && showPhone,
        whatsapp: saved.phoneVerified && whatsapp,
        website: website.trim(),
        bannerKey,
      });
      setSaved(card);
      toast.success(t("saved"));
    } catch (caught) {
      setFailure(caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <section id="fiche-boutique" aria-labelledby="pro-card" data-testid="shop-card-settings" className="flex scroll-mt-24 flex-col gap-5 rounded-lg border border-border bg-surface p-5">
      <header className="flex flex-col gap-1">
        <h2 id="pro-card" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-foreground-muted text-pretty">{t("lead")}</p>
      </header>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-6">
        <BannerPicker value={bannerKey} onChange={setBannerKey} />

        <div className="grid gap-5 lg:grid-cols-2">
          <Field label={t("description")} hint={t("descriptionHint")} error={textIssues.description ? issues(textIssues.description) : undefined}>
            <Textarea value={description} rows={6} maxLength={PRO_DESCRIPTION_MAX} dir="auto" className="min-h-36" onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label={t("descriptionAr")} hint={t("descriptionArHint")} error={textIssues.descriptionAr ? issues(textIssues.descriptionAr) : undefined}>
            <Textarea value={descriptionAr} rows={6} maxLength={PRO_DESCRIPTION_MAX} dir="rtl" lang="ar" className="min-h-36" onChange={(event) => setDescriptionAr(event.target.value)} />
          </Field>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <CityCombobox value={city} onSelect={setCity} required error={city === null ? t("cityRequired") : undefined} />
          </div>
          <Field label={t("address")} hint={t("addressHint")} error={textIssues.address ? issues(textIssues.address) : undefined}>
            <input value={address} maxLength={PRO_ADDRESS_MAX} dir="auto" autoComplete="street-address" className={inputClassName} onChange={(event) => setAddress(event.target.value)} />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3" data-testid="shop-card-hours">
          <legend className="mb-1 text-sm font-medium">{t("hours")}</legend>
          <p className="-mt-1 text-sm text-foreground-muted text-pretty">{t("hoursHint")}</p>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {WEEKDAYS.map((day) => {
              const draft = week[day];
              return (
                <li key={day} data-day={day} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5", wrongDay === day && "bg-danger/5")}>
                  <label className="flex min-h-11 w-32 cursor-pointer items-center gap-2.5 text-sm font-medium">
                    <input type="checkbox" checked={draft.open} onChange={(event) => setDay(day, { open: event.target.checked })} className="size-5 shrink-0 accent-structure" />
                    {t(`days.${day}`)}
                  </label>
                  {draft.open ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      {draft.slots.map((slot, index) => (
                        <span key={index} className="inline-flex items-center gap-1.5">
                          <input type="time" aria-label={t("from", { day: t(`days.${day}`) })} value={slot.from} onChange={(event) => setSlot(day, index, { from: event.target.value })} className={cn(inputClassName, "w-28 tabular-nums")} />
                          <span aria-hidden="true">–</span>
                          <input type="time" aria-label={t("to", { day: t(`days.${day}`) })} value={slot.to} onChange={(event) => setSlot(day, index, { to: event.target.value })} className={cn(inputClassName, "w-28 tabular-nums")} />
                          {index === 1 ? (
                            <Button type="button" variant="ghost" size="sm" aria-label={t("removeBreak")} onClick={() => setDay(day, { slots: draft.slots.slice(0, 1) })}>
                              <X aria-hidden="true" />
                            </Button>
                          ) : null}
                        </span>
                      ))}
                      {draft.slots.length === 1 ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setDay(day, { slots: [{ from: draft.slots[0]?.from ?? "09:00", to: "12:30" }, { from: "14:30", to: draft.slots[0]?.to ?? "19:00" }] })}>
                          <Plus aria-hidden="true" />
                          {t("addBreak")}
                        </Button>
                      ) : null}
                      {day === "mon" ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => copyToAll(day)}>
                          <Copy aria-hidden="true" />
                          {t("copyWeek")}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-sm text-foreground-muted">{t("closed")}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {wrongDay ? <p className="text-sm text-danger">{t("hoursInvalid", { day: t(`days.${wrongDay}`) })}</p> : null}
          <Field label={t("hoursNote")} hint={t("hoursNoteHint")} error={textIssues.note ? issues(textIssues.note) : undefined}>
            <input value={note} maxLength={PRO_HOURS_NOTE_MAX} dir="auto" className={inputClassName} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("contact")}</legend>
          <label className={cn("flex min-h-11 items-start gap-3 text-sm", saved.phoneVerified ? "cursor-pointer" : "opacity-60")}>
            <input type="checkbox" checked={saved.phoneVerified && showPhone} disabled={!saved.phoneVerified} onChange={(event) => setShowPhone(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-structure" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t("showPhone")}</span>
              <span className="text-foreground-muted text-pretty">{t("showPhoneHint")}</span>
            </span>
          </label>
          <label className={cn("flex min-h-11 items-start gap-3 text-sm", saved.phoneVerified ? "cursor-pointer" : "opacity-60")}>
            <input type="checkbox" checked={saved.phoneVerified && whatsapp} disabled={!saved.phoneVerified} onChange={(event) => setWhatsapp(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-structure" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t("whatsapp")}</span>
              <span className="text-foreground-muted text-pretty">{t("whatsappHint")}</span>
            </span>
          </label>
          {saved.phoneVerified ? null : (
            <p className="text-sm text-pretty">
              {t("phoneMissing")}{" "}
              <Link href="/verifications" className="font-medium text-link underline underline-offset-2">
                {t("verifyPhone")}
              </Link>
            </p>
          )}
        </fieldset>

        <Field label={t("website")} hint={t("websiteHint")} error={wrongWebsite ? t("websiteInvalid") : undefined}>
          <input type="url" inputMode="url" value={website} maxLength={200} dir="ltr" placeholder="https://" className={inputClassName} onChange={(event) => setWebsite(event.target.value)} />
        </Field>

        {failure ? <FormMessage error={failure} title={t("failed")} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pending} disabled={invalid}>
            {t("save")}
          </Button>
          {shop.storefront ? (
            <Button asChild variant="outline">
              <Link href={`/boutique/${shop.storefront}`} prefetch={false}>
                <ExternalLink aria-hidden="true" />
                {t("view")}
              </Link>
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
