"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { SearchCityCombobox } from "@/components/search/city-combobox";
import { dropEmptyFields } from "@/components/search/drop-empty-fields";
import type { LocationValue } from "@/components/search/location";
import { SEARCH_PATH, SEARCH_Q_MAX, SEARCH_QUERY_KEYS } from "@/lib/search/url-keys";
import { cn } from "@/lib/utils";
import { useRouter } from "@/i18n/navigation";
import { useHeaderSearchBinding, type HeaderSearchBinding } from "./header-search-store";
import { rememberSearch, SuggestionList, useSuggestionItems, type SuggestionItem } from "./search-suggestions";

// The header's search pill (Carte vivante, lot 1): words, then the place from xl (the search page's
// own combobox in its "any city" variant), then the ochre submit. The words field suggests what the
// search understands while typing and the last searches when empty (audit §7, search-suggestions.tsx). A GET form to /recherche that
// works before hydration: `q`, and `ville` (slug) or `region`; empty fields leave the URL once
// hydrated. Below xl the pill keeps the words only (the place is set in the search page's filters):
// beside "Louer", "Espace Pro" and "Vendre" (UX audit, choice B) the place segment left the words
// 60 px at lg.
// On /recherche (lot 2) the page binds the pill (header-search-store.ts): it starts from the current
// words and place, carries the other filters and submits as the page's own navigation.

function onFormData(event: FormDataEvent) {
  dropEmptyFields(event.formData);
}

/** A segment of the pill: borderless, tinted while it holds the focus. */
const SEGMENT_INPUT = cn(
  "h-11 w-full min-w-0 rounded-full border-0 bg-transparent text-base text-ellipsis text-foreground placeholder:text-foreground-muted md:text-[0.9375rem]",
  "transition-[background-color] duration-150 ease-door focus-visible:bg-surface-muted focus-visible:outline-none",
);

export function HeaderSearch({ locale, className }: { locale: string; className?: string }) {
  const binding = useHeaderSearchBinding();
  // A new search starts the fields again from its values.
  return <HeaderSearchForm key={binding?.key ?? ""} locale={locale} binding={binding} className={className} />;
}

function HeaderSearchForm({ locale, binding, className }: { locale: string; binding: HeaderSearchBinding | null; className?: string }) {
  const t = useTranslations("Nav");
  const form = useRef<HTMLFormElement>(null);
  const [q, setQ] = useState(binding?.q ?? "");
  const [place, setPlace] = useState<LocationValue>(binding?.place ?? {});
  const router = useRouter();
  const listId = useId();
  // Suggestions: the index loads on the first focus; the list is open while the field has the focus.
  const [open, setOpen] = useState(false);
  // -1: nothing highlighted (Enter searches the typed words).
  const [active, setActive] = useState(-1);
  const { items, arm, clearRecent } = useSuggestionItems(locale, q);
  const shown = open && items.length > 0;
  const activeItem = shown && active >= 0 ? items[active] : undefined;

  useEffect(() => {
    const element = form.current;
    element?.addEventListener("formdata", onFormData);
    return () => element?.removeEventListener("formdata", onFormData);
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    rememberSearch(q);
    setOpen(false);
    if (!binding) return;
    event.preventDefault();
    binding.submit(q, place);
  }

  /** The place of the pill as URL keys (a suggestion's filters keep it). */
  function placeQuery(): Record<string, string> {
    if (place.city) return { [SEARCH_QUERY_KEYS.city]: place.city };
    return place.region ? { [SEARCH_QUERY_KEYS.region]: place.region } : {};
  }

  function choose(item: SuggestionItem) {
    setOpen(false);
    setActive(-1);
    const words = item.kind === "recent" ? item.q : "q" in item.suggestion.target ? item.suggestion.target.q : null;
    if (words !== null) {
      setQ(words);
      rememberSearch(words);
      if (binding) binding.submit(words, place);
      else router.push({ pathname: SEARCH_PATH, query: { [SEARCH_QUERY_KEYS.q]: words, ...placeQuery() } });
      return;
    }
    if (item.kind !== "suggestion" || !("query" in item.suggestion.target)) return;
    // A category or a noun: its filters, the words it replaces gone.
    setQ("");
    router.push({ pathname: SEARCH_PATH, query: { ...item.suggestion.target.query, ...placeQuery() } });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (items.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      if (!shown) return;
      event.preventDefault();
      setActive((index) => (index <= 0 ? items.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      if (activeItem) {
        event.preventDefault();
        choose(activeItem);
      }
    } else if (event.key === "Escape") {
      if (shown) event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <form
      ref={form}
      action={`/${locale}${SEARCH_PATH}`}
      method="get"
      role="search"
      aria-label={t("searchLabel")}
      onSubmit={onSubmit}
      className={cn(
        "float-card relative flex h-12 min-w-0 items-center gap-1 rounded-full p-0.5 md:h-13 md:p-1",
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
        className,
      )}
    >
      <div className="relative min-w-0 flex-1">
        <label htmlFor="header-search" className="sr-only">
          {t("searchLabel")}
        </label>
        {/* Phones: the submit's magnifier is enough, the words get the room. */}
        <Search className="pointer-events-none absolute start-3.5 top-1/2 hidden size-[1.125rem] -translate-y-1/2 text-foreground-muted md:block" aria-hidden="true" />
        <input
          id="header-search"
          name={SEARCH_QUERY_KEYS.q}
          type="search"
          enterKeyHint="search"
          maxLength={SEARCH_Q_MAX}
          placeholder={t("searchPlaceholder")}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={activeItem ? `${listId}-${active}` : undefined}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => {
            arm();
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(SEGMENT_INPUT, "peer ps-4 pe-2 md:ps-10 lg:placeholder:text-transparent [&::-webkit-search-cancel-button]:hidden")}
        />
        {/* Wide screens: the invitation to type a sentence (« Chercher en parlant », lot 4) in place of
            the short placeholder, shown while the field is empty; phones keep the short one. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute start-10 end-2 top-1/2 hidden -translate-y-1/2 truncate text-sm text-foreground-muted lg:peer-placeholder-shown:block"
        >
          {t("searchPlaceholderLong")}
        </span>
      </div>
      <div className="relative hidden w-48 shrink-0 before:absolute before:start-0 before:top-1/2 before:h-6 before:w-px before:-translate-y-1/2 before:bg-border-strong xl:block">
        <SearchCityCombobox
          value={place}
          onChange={setPlace}
          label={t("searchPlace")}
          hideLabel
          names={{ city: SEARCH_QUERY_KEYS.city, region: SEARCH_QUERY_KEYS.region }}
          className="gap-0 ps-1.5"
          inputClassName={cn(SEGMENT_INPUT, "focus-visible:ring-0")}
        />
      </div>
      <SuggestionList id={listId} items={items} active={active} open={open} onActive={setActive} onChoose={choose} onClearRecent={clearRecent} />
      {binding?.carried.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <button
        type="submit"
        aria-label={t("searchSubmit")}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[background-color,scale] duration-150 ease-door hover:bg-primary-hover active:scale-95"
      >
        <Search className="size-[1.125rem]" strokeWidth={2.25} aria-hidden="true" />
      </button>
    </form>
  );
}
