import { describe, expect, it } from "vitest";
import { applyInterpretation, interpretQuery, interpretSearch, NEAR_KM } from "@/lib/search/interpret";
import { lexiconPhrases } from "@/lib/search/interpret/lexicon";
import { tokenizeQuery } from "@/lib/search/interpret/tokens";
import { canonicalSearchParams, parseSearchParams, searchParamsToQuery, type CriterionFilter, type SearchParams } from "@/lib/search/params";

// "Chercher en parlant" (Carte vivante, lot 4): a sentence becomes the filters it clearly names.

const opts = (id: string, ...values: string[]) => ({ [id]: { kind: "options" as const, values } });

type Case = [text: string, patch: SearchParams, q: string, near?: number];

const CASES: Case[] = [
  // French.
  ["vélo pour enfant pas cher à côté", { category: "vehicules", subcategory: "velos", criteria: opts("bike-type", "enfant"), sort: "price_asc" }, "", NEAR_KM],
  ["vélo enfant moins de 500 dh", { category: "vehicules", subcategory: "velos", criteria: opts("bike-type", "enfant"), priceMax: 500 }, ""],
  ["voiture d'occasion à Casablanca", { category: "vehicules", subcategory: "voitures", city: "casablanca", region: "06" }, ""],
  ["appartement à louer à Rabat", { category: "immobilier", subcategory: "location", city: "rabat", region: "04", criteria: opts("property-type", "appartement") }, ""],
  ["appartement à vendre entre 500000 et 900000 dh", { category: "immobilier", subcategory: "vente", criteria: opts("property-type", "appartement"), priceMin: 500_000, priceMax: 900_000 }, ""],
  ["villa location de vacances Agadir", { category: "immobilier", subcategory: "location-vacances", city: "agadir", region: "09", criteria: opts("property-type", "villa-riad") }, ""],
  ["location voiture Marrakech", { category: "vehicules", subcategory: "location-voitures", city: "marrakech", region: "07" }, ""],
  ["voiture à louer", { category: "vehicules", subcategory: "location-voitures" }, ""],
  ["canapé max 3000", { category: "maison-jardin", subcategory: "ameublement", criteria: opts("furniture-type", "salon"), priceMax: 3000 }, ""],
  ["frigo samsung < 2000 dh", { category: "maison-jardin", subcategory: "electromenager", criteria: opts("appliance-type", "refrigerateur"), priceMax: 2000 }, "samsung"],
  ["téléphone neuf", { category: "electronique", subcategory: "telephones-objets-connectes", conditions: ["new_tagged", "like_new"] }, ""],
  ["smartphone samsung occasion", { category: "electronique", subcategory: "telephones-objets-connectes", criteria: opts("phone-device-type", "smartphone"), conditions: ["like_new", "very_good", "good"] }, "samsung"],
  ["pc portable gamer 5000 dh max", { category: "electronique", subcategory: "ordinateurs", criteria: opts("computer-type", "portable"), priceMax: 5000 }, "gamer"],
  ["poussette gratuite", { category: "famille", subcategory: "equipement-bebe", criteria: opts("baby-type", "poussette"), donation: true }, ""],
  ["livres à donner", { category: "loisirs", subcategory: "livres", donation: true }, ""],
  // Giving verbs and a holiday rental named alone (journey review 2026-10-29).
  ["je donne un canapé", { category: "maison-jardin", subcategory: "ameublement", criteria: opts("furniture-type", "salon"), donation: true }, ""],
  ["donner", { donation: true }, ""],
  ["location saisonnière à Agadir", { category: "immobilier", subcategory: "location-vacances", city: "agadir", region: "09" }, ""],
  ["location vacances", { category: "immobilier", subcategory: "location-vacances" }, ""],
  ["chaussures femme pointure 38", { category: "mode", subcategory: "chaussures", criteria: opts("audience", "femme") }, "pointure 38"],
  ["caftan pour femme", { category: "mode", subcategory: "tenues-traditionnelles", criteria: { audience: { kind: "options", values: ["femme"] }, "traditional-type": { kind: "options", values: ["caftan"] } } }, ""],
  ["vtt à partir de 1000 dh", { category: "vehicules", subcategory: "velos", criteria: opts("bike-type", "vtt"), priceMin: 1000 }, ""],
  ["vélo électrique de particulier", { category: "vehicules", subcategory: "velos", criteria: opts("bike-type", "electrique"), sellerType: "individual" }, ""],
  ["moto vendeur pro", { category: "vehicules", subcategory: "motos-scooters", sellerType: "pro" }, ""],
  ["chiot berger allemand", { category: "animaux", subcategory: "animaux-compagnie", criteria: opts("animal-type", "chien") }, "berger allemand"],
  ["mouton pour l'aïd", { category: "agriculture", subcategory: "betail-moutons", criteria: opts("livestock-type", "mouton") }, "aïd"],
  ["je cherche un frigo pas cher à Fès", { category: "maison-jardin", subcategory: "electromenager", criteria: opts("appliance-type", "refrigerateur"), city: "fes", region: "03", sort: "price_asc" }, ""],
  ["meubles avec photos", { category: "maison-jardin", subcategory: "ameublement", withPhoto: true }, ""],
  ["table basse bon état", { conditions: ["new_tagged", "like_new", "very_good", "good"] }, "table basse"],
  ["machine à laver en panne", { category: "maison-jardin", subcategory: "electromenager", criteria: opts("appliance-type", "lave-linge"), conditions: ["for_parts"] }, ""],
  ["guitare jusqu'à 1 500 dh", { category: "loisirs", subcategory: "instruments", criteria: opts("instrument-type", "guitare"), priceMax: 1500 }, ""],
  ["vélo de 300 à 800 dh", { category: "vehicules", subcategory: "velos", priceMin: 300, priceMax: 800 }, ""],
  ["vélo 300-800 dh", { category: "vehicules", subcategory: "velos", priceMin: 300, priceMax: 800 }, ""],
  ["trottinette à 2 km", {}, "trottinette", 2],
  ["studio près de moi", { category: "immobilier", criteria: opts("property-type", "studio") }, "", NEAR_KM],
  ["poussette dans un rayon de 5 km", { category: "famille", subcategory: "equipement-bebe", criteria: opts("baby-type", "poussette") }, "", 5],
  ["tapis berbère budget 4k", { category: "maison-jardin", subcategory: "decoration-artisanat", criteria: opts("decor-type", "tapis"), priceMax: 4000 }, "berbère"],
  ["console moins de 3.000 dh", { category: "electronique", subcategory: "consoles-jeux-video", priceMax: 3000 }, ""],
  ["colocation à Tanger", { category: "immobilier", subcategory: "colocation", city: "tanger", region: "01" }, ""],
  ["terrain à vendre à Settat", { category: "immobilier", subcategory: "vente", city: "settat", region: "06", criteria: opts("property-type", "terrain-ferme") }, ""],
  // Darija in Latin letters.
  ["tomobil rkhisa f casa", { category: "vehicules", subcategory: "voitures", city: "casablanca", region: "06", sort: "price_asc" }, ""],
  ["dar lkra f rabat", { category: "immobilier", subcategory: "location", city: "rabat", region: "04", criteria: opts("property-type", "maison") }, ""],
  ["ch9a lkra f tanja", { category: "immobilier", subcategory: "location", city: "tanger", region: "01", criteria: opts("property-type", "appartement") }, ""],
  ["bghit tilifon jdid", { category: "electronique", subcategory: "telephones-objets-connectes", conditions: ["new_tagged", "like_new"] }, ""],
  ["tilifon mosta3mal a9al mn 1000", { category: "electronique", subcategory: "telephones-objets-connectes", conditions: ["like_new", "very_good", "good"], priceMax: 1000 }, ""],
  ["bechklita dyal drari qrib", { category: "vehicules", subcategory: "velos" }, "drari", NEAR_KM],
  ["7awli f marrakech", { category: "agriculture", subcategory: "betail-moutons", city: "marrakech", region: "07", criteria: opts("livestock-type", "mouton") }, ""],
  ["frigo fabor", { category: "maison-jardin", subcategory: "electromenager", criteria: opts("appliance-type", "refrigerateur"), donation: true }, ""],
  ["tomobil kra f agadir", { category: "vehicules", subcategory: "location-voitures", city: "agadir", region: "09" }, ""],
  ["laptop rkhis 9rib mni", { category: "electronique", subcategory: "ordinateurs", criteria: opts("computer-type", "portable"), sort: "price_asc" }, "", NEAR_KM],
  ["motor f fes", { city: "fes", region: "03" }, "motor"],
  ["sbabet rjal", { category: "mode", subcategory: "chaussures" }, "rjal"],
  ["chi tomobil b 50000 dh max", { category: "vehicules", subcategory: "voitures", priceMax: 50_000 }, ""],
  // Arabic script.
  ["سيارة رخيصة في الدار البيضاء", { category: "vehicules", subcategory: "voitures", city: "casablanca", region: "06", sort: "price_asc" }, ""],
  ["شقة للكراء في الرباط", { category: "immobilier", subcategory: "location", city: "rabat", region: "04", criteria: opts("property-type", "appartement") }, ""],
  ["هاتف أقل من 500 درهم", { category: "electronique", subcategory: "telephones-objets-connectes", priceMax: 500 }, ""],
  ["هاتف أقل من ٥٠٠ درهم", { category: "electronique", subcategory: "telephones-objets-connectes", priceMax: 500 }, ""],
  ["ثلاجة مستعملة بمراكش", { category: "maison-jardin", subcategory: "electromenager", city: "marrakech", region: "07", criteria: opts("appliance-type", "refrigerateur"), conditions: ["like_new", "very_good", "good"] }, ""],
  ["دراجة هوائية قريب مني", { category: "vehicules", subcategory: "velos" }, "", NEAR_KM],
  ["قفطان جديد", { category: "mode", subcategory: "tenues-traditionnelles", criteria: opts("traditional-type", "caftan"), conditions: ["new_tagged", "like_new"] }, ""],
  ["كتب مجانا", { category: "loisirs", subcategory: "livres", donation: true }, ""],
  ["حولي بين 2000 و 4000 درهم", { category: "agriculture", subcategory: "betail-moutons", criteria: opts("livestock-type", "mouton"), priceMin: 2000, priceMax: 4000 }, ""],
  ["حولي بين 2000 و4000", { category: "agriculture", subcategory: "betail-moutons", criteria: opts("livestock-type", "mouton"), priceMin: 2000, priceMax: 4000 }, ""],
  ["أريد سيارة بالعيون", { category: "vehicules", subcategory: "voitures", city: "laayoune", region: "11" }, ""],
  ["ملابس الأطفال", { category: "famille", subcategory: "vetements-enfant" }, ""],
  ["زربية مع صور", { category: "maison-jardin", subcategory: "decoration-artisanat", criteria: opts("decor-type", "tapis"), withPhoto: true }, ""],
  // Prices without a category.
  ["iphone moins de 4000", { priceMax: 4000 }, "iphone"],
  ["samsung 500 dh max", { priceMax: 500 }, "samsung"],
  ["iphone 12 plus de 2000 dh", { priceMin: 2000 }, "iphone 12"],
  ["gratuit", { donation: true }, ""],
  ["pas cher", { sort: "price_asc" }, ""],
];

/** Titles and words that must stay words, untouched. */
const NEGATIVES: string[] = [
  "Golf 7",
  "iPhone 13 128 Go",
  "iPhone 13 Pro",
  "iPhone 13 Pro Max 256",
  "3 pièces",
  "Samsung Galaxy S23 Ultra",
  "PS5 avec 2 manettes",
  "205/55 R16",
  "moins de 2 ans",
  "17 pouces",
  "livraison gratuite",
  "à côté de la gare",
  "قريب من البحر",
  "neuf pièces",
  "Safi",
  "lot de 3",
  "1 million",
  "pro max",
  // A brand or a model that is also a word, without its brand or a car word (audit lot 7).
  "seat",
  "2008",
  "c220",
  "polo bleu",
];

/** A category may be named, but no number becomes a price, a distance or a sort (a car's mileage or year becomes its criterion). */
const NO_AMOUNTS: [text: string, q: string][] = [
  // Rooms are read for real estate only (ROOMS below): elsewhere a count of pieces stays words.
  ["puzzle 1000 pièces", "puzzle 1000 pièces"],
  ["TV 4k 55 pouces", "4k 55 pouces"],
  ["تلفاز 4k", "4k"],
  ["pneus 205/55 R16", "205/55 R16"],
  ["jantes 17 pouces", "17 pouces"],
  ["voiture 150 000 km", ""],
  ["moto 125 cc 2018", "125 cc"],
  ["iphone 13 pro max 256 go", "iphone 13 pro max 256 go"],
  // Price words before (or after) an amount of another unit leave with the understood words.
  ["voiture moins de 100 000 km", ""],
  ["voiture 100 000 km max", ""],
  ["voiture plus de 2 ans", "2 ans"],
  ["frigo max 300 litres", "300 litres"],
  ["moto plus de 125 cc", "125 cc"],
  ["vélo 2 places", "2 places"],
  ["سيارة أقل من 100000 كلم", ""],
  // A weak cue is an ordinary word too: it stays.
  ["voiture sous 3 ans", "sous 3 ans"],
];

const car = (criteria: Record<string, CriterionFilter>, extra: SearchParams = {}, subcategory = "voitures"): SearchParams => ({ category: "vehicules", subcategory, criteria, ...extra });
const options = (...values: string[]): CriterionFilter => ({ kind: "options", values });

/** Brands, models, fuel, gearbox, year and mileage of a vehicle (audit lot 7, zone 2 P1-1). */
const VEHICLES: [text: string, patch: SearchParams, q: string][] = [
  ["Renault Clio", car({ "car-brand": options("renault"), "car-model": options("renault-clio") }), ""],
  ["renaut clio", car({ "car-brand": options("renault"), "car-model": options("renault-clio") }), ""],
  ["Mercedes", car({ "car-brand": options("mercedes-benz") }), ""],
  ["dacia logan", car({ "car-brand": options("dacia"), "car-model": options("dacia-logan") }), ""],
  ["Dacia Logan 2019", car({ "car-brand": options("dacia"), "car-model": options("dacia-logan"), year: { kind: "range", min: 2019, max: 2019 } }), ""],
  ["Clio 4 diesel 2016 Tanger", car({ "car-brand": options("renault"), "car-model": options("renault-clio"), fuel: options("diesel"), year: { kind: "range", min: 2016, max: 2016 } }, { city: "tanger" }), "4"],
  ["Renault Clio d'occasion à Casablanca moins de 60000 dh", car({ "car-brand": options("renault"), "car-model": options("renault-clio") }, { city: "casablanca", priceMax: 60000 }), ""],
  ["Mercedes classe C 220", car({ "car-brand": options("mercedes-benz"), "car-model": options("mercedes-benz-classe-c") }), "220"],
  ["Toyota Yaris 100 000 km", car({ "car-brand": options("toyota"), "car-model": options("toyota-yaris"), mileage: { kind: "range", max: 100000 } }), ""],
  ["voiture plus de 100000 km", car({ mileage: { kind: "range", min: 100000 } }), ""],
  ["Peugeot 208 1.2", car({ "car-brand": options("peugeot"), "car-model": options("peugeot-208") }), "1.2"],
  ["peugeot 2008", car({ "car-brand": options("peugeot"), "car-model": options("peugeot-2008") }), ""],
  ["voiture golf", car({ "car-brand": options("volkswagen"), "car-model": options("volkswagen-golf") }), ""],
  ["seat ibiza", car({ "car-brand": options("seat"), "car-model": options("seat-ibiza") }), ""],
  ["range rover evoque", car({ "car-brand": options("land-rover"), "car-model": options("land-rover-range-rover-evoque") }), ""],
  ["voiture automatique diesel", car({ fuel: options("diesel"), gearbox: options("automatique") }), ""],
  ["voiture 3 portes", car({}), "3 portes"],
  ["location renault clio marrakech", car({ "car-brand": options("renault"), "car-model": options("renault-clio") }, { city: "marrakech" }, "location-voitures"), ""],
  ["camion renault", car({ "car-brand": options("renault") }, {}, "utilitaires-camions"), ""],
  ["yamaha", car({ "moto-brand": options("yamaha") }, {}, "motos-scooters"), ""],
  ["moto honda", car({ "moto-brand": options("honda") }, {}, "motos-scooters"), ""],
  ["honda", car({ "car-brand": options("honda") }), ""],
  ["داسيا لوغان", car({ "car-brand": options("dacia"), "car-model": options("dacia-logan") }), ""],
  // Parts may not state a brand: the brand stays a word.
  ["pneu renault", { category: "vehicules", subcategory: "pieces-accessoires", criteria: { "part-type": options("pneus-jantes") } }, "renault"],
];

const property = (criteria: Record<string, CriterionFilter>, extra: SearchParams = {}): SearchParams => ({ category: "immobilier", criteria, ...extra });
const exactly = (value: number): CriterionFilter => ({ kind: "range", min: value, max: value });
const apartment = options("appartement");

/** Rooms and bedrooms of a real-estate search (audit zone 2 P3-5). */
const ROOMS: [text: string, patch: SearchParams, q: string][] = [
  ["appartement à louer à Rabat 2 chambres", property({ "property-type": apartment, bedrooms: exactly(2) }, { subcategory: "location", city: "rabat", region: "04" }), ""],
  ["appartement 3 pièces", property({ "property-type": apartment, rooms: exactly(3) }), ""],
  ["appartement F3 Casablanca", property({ "property-type": apartment, rooms: exactly(3) }, { city: "casablanca", region: "06" }), ""],
  ["appartement au moins 3 pièces", property({ "property-type": apartment, rooms: { kind: "range", min: 3 } }), ""],
  ["villa à vendre 4 chambres et plus", property({ "property-type": options("villa-riad"), bedrooms: { kind: "range", min: 4 } }, { subcategory: "vente" }), ""],
  ["appartement moins de 3 chambres", property({ "property-type": apartment, bedrooms: { kind: "range", max: 3 } }), ""],
  ["appartement entre 2 et 3 chambres", property({ "property-type": apartment, bedrooms: { kind: "range", min: 2, max: 3 } }), ""],
  ["appartement deux chambres à coucher et salon", property({ "property-type": apartment, bedrooms: exactly(2) }), "salon"],
  ["appartement 4 pièces 2 chambres", property({ "property-type": apartment, rooms: exactly(4), bedrooms: exactly(2) }), ""],
  ["maison neuf pièces", property({ "property-type": options("maison"), rooms: exactly(9) }), ""],
  ["villa vacances 3 chambres Agadir", property({ "property-type": options("villa-riad"), bedrooms: exactly(3) }, { subcategory: "location-vacances", city: "agadir", region: "09" }), ""],
  // Arabic and Darija.
  ["شقة 3 غرف للكراء", property({ "property-type": apartment, bedrooms: exactly(3) }, { subcategory: "location" }), ""],
  ["شقة غرفتين", property({ "property-type": apartment, bedrooms: exactly(2) }), ""],
  ["شقة جوج بيوت", property({ "property-type": apartment, bedrooms: exactly(2) }), ""],
  ["ch9a 2 byout f casa", property({ "property-type": apartment, bedrooms: exactly(2) }, { city: "casablanca", region: "06" }), ""],
  // A count the filter cannot hold, or an offer without the filter, stays words.
  ["appartement 80 pièces", property({ "property-type": apartment }), "80 pièces"],
  ["colocation 2 chambres", { category: "immobilier", subcategory: "colocation" }, "2 chambres"],
  ["villa vacances 3 pièces", property({ "property-type": options("villa-riad") }, { subcategory: "location-vacances" }), "3 pièces"],
];

describe("interpretQuery", () => {
  it.each(VEHICLES)("reads the vehicle in %j", (text, patch, q) => {
    const result = interpretQuery(text);
    expect(result.patch).toEqual(canonicalSearchParams(patch));
    expect(result.q).toBe(q);
  });

  it.each(ROOMS)("reads the rooms in %j", (text, patch, q) => {
    const result = interpretQuery(text);
    expect(result.patch).toEqual(canonicalSearchParams(patch));
    expect(result.q).toBe(q);
  });

  it("leaves a room count out of a search with no real estate", () => {
    expect(interpretQuery("2 chambres").understood).toEqual([]);
    expect(interpretQuery("voiture 5 places").patch.criteria).toBeUndefined();
  });

  it("gives the room words back when the rooms are removed", () => {
    const applied = applyInterpretation({ q: "appartement 2 chambres" }, interpretQuery("appartement 2 chambres"));
    const bedrooms = applied?.items.find((item) => item.key === "criterion:bedrooms");
    expect(bedrooms?.words).toBe("2 chambres");
    expect(bedrooms?.without).toEqual({ q: "2 chambres", raw: true, category: "immobilier", criteria: { "property-type": apartment } });
  });

  it("gives the words back when the category of a brand is removed", () => {
    const applied = applyInterpretation({ q: "Renault Clio" }, interpretQuery("Renault Clio"));
    const category = applied?.items.find((item) => item.key === "category");
    expect(category?.without).toEqual({ q: "Renault Clio", raw: true });
    const model = applied?.items.find((item) => item.key === "criterion:car-model");
    expect(model?.without).toEqual({ q: "Clio", raw: true, category: "vehicules", subcategory: "voitures", criteria: { "car-brand": options("renault") } });
  });

  it.each(CASES)("reads %j", (text, patch, q, near) => {
    const result = interpretQuery(text);
    expect(result.patch).toEqual(canonicalSearchParams(patch));
    expect(result.q).toBe(q);
    const nearItem = result.understood.find((item) => item.key === "near");
    expect(nearItem?.km).toBe(near);
  });

  it("covers sixty phrases or more", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
  });

  it.each(NEGATIVES)("leaves %j as words", (text) => {
    const result = interpretQuery(text);
    expect(result.patch).toEqual({});
    expect(result.understood).toEqual([]);
    expect(result.q).toBe(text);
  });

  it.each(NO_AMOUNTS)("keeps the numbers of %j as words", (text, q) => {
    const result = interpretQuery(text);
    expect(result.understood.filter((item) => !["category", "location"].includes(item.key) && !item.key.startsWith("criterion:"))).toEqual([]);
    expect(result.q).toBe(q);
  });

  it("keeps the price words of an unread amount when nothing else is understood", () => {
    // The sentence is then searched as typed (no interpretation): nothing to tidy.
    expect(interpretQuery("moins de 2 ans").q).toBe("moins de 2 ans");
    expect(interpretSearch({ q: "moins de 2 ans" })).toBeNull();
    expect(interpretSearch({ q: "voiture plus de 2 ans" })?.params).toEqual({ q: "2 ans", category: "vehicules", subcategory: "voitures" });
  });

  it("names a property type without an offer at the category level", () => {
    expect(interpretQuery("appartement lumineux").patch).toEqual({ category: "immobilier", criteria: opts("property-type", "appartement") });
    expect(interpretQuery("appartement lumineux").q).toBe("lumineux");
  });

  it("keeps everything when two categories are named", () => {
    const result = interpretQuery("vélo ou voiture");
    expect(result.understood).toEqual([]);
    expect(result.q).toBe("vélo ou voiture");
  });

  it("keeps « dar » a word without a rent or sale word", () => {
    expect(interpretQuery("dar").understood).toEqual([]);
    expect(interpretQuery("dar bouazza").patch).toEqual({ city: "dar-bouazza", region: "06" });
  });

  it("reads a guarded city only after a place word", () => {
    expect(interpretQuery("safi").understood).toEqual([]);
    expect(interpretQuery("vélo à Safi").patch).toMatchObject({ city: "safi" });
    expect(interpretQuery("vélo f safi").patch).toMatchObject({ city: "safi" });
  });

  it("keeps « neuf » a word where the condition does not apply", () => {
    const car = interpretQuery("voiture neuve");
    expect(car.patch).toEqual({ category: "vehicules", subcategory: "voitures" });
    expect(car.q).toBe("neuve");
    // "Occasion" says nothing more about a car: dropped, no filter.
    expect(interpretQuery("voiture d'occasion").q).toBe("");
  });

  it("never turns « pas cher » into a ceiling", () => {
    const result = interpretQuery("vélo pas cher");
    expect(result.patch.priceMax).toBeUndefined();
    expect(result.patch.sort).toBe("price_asc");
  });

  it("only produces parameters the URL schema accepts", () => {
    for (const [text] of CASES) {
      const { patch } = interpretQuery(text);
      const reparsed = parseSearchParams(searchParamsToQuery(patch));
      expect(reparsed).toEqual(canonicalSearchParams(patch));
    }
  });

  it("is stable on its own leftovers", () => {
    for (const [text] of CASES) {
      const first = interpretQuery(text);
      if (!first.q) continue;
      expect(interpretQuery(first.q).understood.filter((item) => item.key !== "near")).toEqual([]);
    }
  });
});

describe("applyInterpretation", () => {
  it("applies what the URL leaves free and keeps the URL's own filters", () => {
    const url: SearchParams = { q: "vélo pas cher moins de 500 dh", city: "rabat", region: "04" };
    const applied = applyInterpretation(url, interpretQuery(url.q ?? ""));
    expect(applied?.params).toEqual(canonicalSearchParams({ category: "vehicules", subcategory: "velos", city: "rabat", priceMax: 500, sort: "price_asc" }));
    expect(applied?.items.map((item) => item.key)).toEqual(["category", "price", "sort"]);
  });

  it("never replaces a filter of the URL; a contradicted category word stays a word", () => {
    const url: SearchParams = { q: "vélo moins de 500 dh", category: "immobilier", priceMax: 900 };
    const applied = applyInterpretation(url, interpretQuery(url.q ?? ""));
    expect(applied).toBeNull();
    const sorted = applyInterpretation({ ...url, q: "vélo pas cher" }, interpretQuery("vélo pas cher"));
    expect(sorted?.params).toEqual(canonicalSearchParams({ q: "vélo", category: "immobilier", priceMax: 900, sort: "price_asc" }));
  });

  it("refines a category of the URL into the subcategory named", () => {
    const url: SearchParams = { q: "tomobil zqword", category: "vehicules" };
    expect(interpretSearch(url)?.params).toEqual(canonicalSearchParams({ q: "zqword", category: "vehicules", subcategory: "voitures" }));
  });

  it("gives each item the search without it, words not interpreted again", () => {
    const applied = interpretSearch({ q: "vélo enfant pas cher" });
    const byKey = Object.fromEntries((applied?.items ?? []).map((item) => [item.key, item.without]));
    // A category word returns to the text; a sort word does not.
    expect(byKey.category).toEqual({ q: "vélo enfant", raw: true, sort: "price_asc" });
    expect(byKey["criterion:bike-type"]).toEqual({ q: "enfant", raw: true, category: "vehicules", subcategory: "velos", sort: "price_asc" });
    // No words left: nothing to keep raw.
    expect(byKey.sort).toEqual({ category: "vehicules", subcategory: "velos", criteria: opts("bike-type", "enfant") });
    expect(searchParamsToQuery(byKey.sort ?? {}).get("brut")).toBeNull();
    expect(searchParamsToQuery(byKey.category ?? {}).get("brut")).toBe("1");
    expect(applied?.exact).toEqual({ q: "vélo enfant pas cher", raw: true });
  });

  it("asks for the position, then reads the URL circle as « près de moi »", () => {
    const asked = interpretSearch({ q: "vélo à côté" });
    expect(asked?.near).toEqual({ state: "ask", km: NEAR_KM, target: { q: "vélo à côté" } });
    expect(asked?.params).toEqual({ category: "vehicules", subcategory: "velos" });
    const zone = { lat: 33.599, lng: -7.62, km: 3 };
    const located = interpretSearch({ q: "vélo à côté", zone, fromPosition: true });
    expect(located?.near?.state).toBe("zone");
    expect(located?.params).toEqual({ category: "vehicules", subcategory: "velos", zone, fromPosition: true });
    expect(located?.items.find((item) => item.key === "near")?.without).toEqual({ category: "vehicules", subcategory: "velos" });
    // A city of the URL: the near words go, no position asked.
    expect(interpretSearch({ q: "vélo à côté", city: "rabat" })?.near).toBeUndefined();
  });

  it("never calls a map area « de vous »: the position is still asked, the zone kept", () => {
    // « Rechercher dans cette zone » around Agadir, then « vélo à côté » typed in the header.
    const area = { lat: 30.421, lng: -9.598, km: 15 };
    const applied = interpretSearch({ q: "vélo à côté", zone: area });
    expect(applied?.near).toEqual({ state: "ask", km: NEAR_KM, target: { q: "vélo à côté", zone: area } });
    expect(applied?.params).toEqual({ category: "vehicules", subcategory: "velos", zone: area });
    // The flag lives with a zone only, and round-trips in the URL.
    expect(parseSearchParams(new URLSearchParams("q=velo&position=1"))).toEqual({ q: "velo" });
    const located = parseSearchParams(new URLSearchParams("q=velo&zone=33.599,-7.62,3&position=1"));
    expect(located).toEqual({ q: "velo", zone: { lat: 33.599, lng: -7.62, km: 3 }, fromPosition: true });
    expect(searchParamsToQuery(located).toString()).toBe("q=velo&zone=33.599%2C-7.62%2C3&position=1");
  });

  it("leaves a raw search and a search without understood words alone", () => {
    expect(interpretSearch({ q: "vélo pas cher", raw: true })).toBeNull();
    expect(interpretSearch({ q: "zqword" })).toBeNull();
    expect(interpretSearch({ category: "vehicules" })).toBeNull();
  });

  it("drops a criterion the subcategory of the URL does not have", () => {
    const applied = interpretSearch({ q: "enfant vélo", subcategory: "velos", category: "vehicules" });
    expect(applied?.params.criteria).toEqual(opts("bike-type", "enfant"));
  });
});

describe("brut", () => {
  it("round-trips in the URL with words only", () => {
    expect(parseSearchParams(new URLSearchParams("q=v%C3%A9lo&brut=1"))).toEqual({ q: "vélo", raw: true });
    expect(parseSearchParams(new URLSearchParams("brut=1&categorie=vehicules"))).toEqual({ category: "vehicules" });
    expect(searchParamsToQuery({ q: "vélo", raw: true, category: "vehicules" }).toString()).toBe("q=v%C3%A9lo&brut=1&categorie=vehicules");
  });
});

describe("lexicon", () => {
  it("lists each phrase with one meaning", () => {
    const meanings = new Map<string, string>();
    const clashes: string[] = [];
    for (const { tokens, entry, phrase } of lexiconPhrases()) {
      const key = tokens.join(" ");
      const meaning = JSON.stringify(entry);
      const previous = meanings.get(key);
      // A city listed in both the regions data and the darija lexicon is the same meaning.
      if (previous !== undefined && previous !== meaning && entry.kind !== "city") clashes.push(phrase);
      if (previous === undefined) meanings.set(key, meaning);
    }
    expect(clashes).toEqual([]);
  });

  it("splits glued numbers and keeps offsets of the typed text", () => {
    expect(tokenizeQuery("<500dh").map((token) => token.norm)).toEqual(["<", "500", "dh"]);
    expect(tokenizeQuery("و٢٠٠٠").map((token) => token.norm)).toEqual(["و", "2000"]);
    expect(tokenizeQuery("128go").map((token) => token.norm)).toEqual(["128go"]);
  });
});
