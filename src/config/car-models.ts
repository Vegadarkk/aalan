import type { CarBrand } from "./categories";

// Car models per brand (audit lot 7, zone 2 P1-1 / P1-4): the « Modèle » search filter and the
// models a typed search understands ("Renault Clio", "logan 2016"). Client-safe data.
//
// The listing keeps its model as free text (`model` criterion): the index derives `a_car_model`
// from that text (carModelOf), so a seller who typed "Clio 4 dCi", "clio4" or "CLIO IV" is found by
// the « Clio » filter. A model this list misses stays searchable by its words only.
//
// Rules for edits:
// - Ids are `<brand>-<model>` kebab-case, unique; labels are the maker's Latin names, shown as they
//   are in every language (the Moroccan market writes them so).
// - `spellings`: extra ways a seller or a buyer writes it, matched as whole words after folding
//   (case, accents, hyphens). The id's own words and the label are always spellings.
// - `guarded`: a model name that is also a common word or a bare code ("golf", "partner", "208",
//   "a3"): understood in a typed search only with its brand or a car word.
// - `codes`: patterns tried on the listing's model text only (never on a search): engine codes
//   that name the model ("C 220 CDI" is a Classe C, "320d" a Série 3).

export interface CarModel {
  id: string;
  brand: CarBrand;
  label: string;
  spellings: readonly string[];
  guarded: boolean;
  codes: readonly RegExp[];
}

type Raw = [slug: string, label: string, options?: { spellings?: string[]; guarded?: true; codes?: RegExp[] }];

const g = { guarded: true } as const;

const RAW: Partial<Record<CarBrand, Raw[]>> = {
  dacia: [
    ["logan", "Logan", { spellings: ["لوغان", "لوكان"] }],
    ["sandero", "Sandero", { spellings: ["سانديرو"] }],
    ["sandero-stepway", "Sandero Stepway", { spellings: ["stepway"] }],
    ["duster", "Duster", { spellings: ["داستر", "دستر"] }],
    ["lodgy", "Lodgy"],
    ["dokker", "Dokker"],
    ["spring", "Spring", g],
    ["jogger", "Jogger", g],
    ["bigster", "Bigster"],
  ],
  renault: [
    ["clio", "Clio", { spellings: ["كليو"] }],
    ["megane", "Mégane", { spellings: ["ميغان", "ميكان"] }],
    ["symbol", "Symbol", g],
    ["kangoo", "Kangoo", { spellings: ["kangou", "كانغو", "كانكو"] }],
    ["captur", "Captur"],
    ["kadjar", "Kadjar"],
    ["fluence", "Fluence"],
    ["laguna", "Laguna", g],
    ["scenic", "Scénic", g],
    ["twingo", "Twingo"],
    ["austral", "Austral", g],
    ["arkana", "Arkana"],
    ["koleos", "Koleos"],
    ["express", "Express", g],
    ["talisman", "Talisman", g],
    ["espace", "Espace", g],
    ["master", "Master", g],
    ["trafic", "Trafic", g],
  ],
  peugeot: [
    ["106", "106", g],
    ["107", "107", g],
    ["108", "108", g],
    ["205", "205", g],
    ["206", "206", g],
    ["207", "207", g],
    ["208", "208", g],
    ["301", "301", g],
    ["306", "306", g],
    ["307", "307", g],
    ["308", "308", g],
    ["405", "405", g],
    ["406", "406", g],
    ["407", "407", g],
    ["508", "508", g],
    ["2008", "2008", g],
    ["3008", "3008", g],
    ["5008", "5008", g],
    ["partner", "Partner", g],
    ["rifter", "Rifter"],
    ["bipper", "Bipper"],
    ["expert", "Expert", g],
    ["boxer", "Boxer", g],
  ],
  citroen: [
    ["c1", "C1", g],
    ["c3", "C3", g],
    ["c3-aircross", "C3 Aircross", g],
    ["c4", "C4", g],
    ["c4-picasso", "C4 Picasso", g],
    ["c5", "C5", g],
    ["c5-aircross", "C5 Aircross", g],
    ["c-elysee", "C-Élysée", { spellings: ["celysee", "c elysee"] }],
    ["berlingo", "Berlingo", { spellings: ["برلينغو", "برلينكو"] }],
    ["xsara", "Xsara"],
    ["saxo", "Saxo", g],
    ["jumpy", "Jumpy", g],
    ["nemo", "Nemo", g],
  ],
  ds: [
    ["ds3", "DS 3", { ...g, spellings: ["ds 3"] }],
    ["ds4", "DS 4", { ...g, spellings: ["ds 4"] }],
    ["ds7", "DS 7", { ...g, spellings: ["ds 7"] }],
  ],
  volkswagen: [
    ["golf", "Golf", { ...g, spellings: ["غولف", "كولف"] }],
    ["polo", "Polo", g],
    ["passat", "Passat", { spellings: ["باسات"] }],
    ["jetta", "Jetta"],
    ["tiguan", "Tiguan"],
    ["touareg", "Touareg", g],
    ["touran", "Touran"],
    ["caddy", "Caddy", g],
    ["t-roc", "T-Roc", { ...g, spellings: ["troc"] }],
    ["up", "Up!", g],
    ["scirocco", "Scirocco"],
    ["arteon", "Arteon"],
    ["transporter", "Transporter", g],
  ],
  "mercedes-benz": [
    ["classe-a", "Classe A", { ...g, spellings: ["class a", "a class"], codes: [/^a ?\d{3}\b/] }],
    ["classe-b", "Classe B", { ...g, spellings: ["class b", "b class"], codes: [/^b ?\d{3}\b/] }],
    ["classe-c", "Classe C", { ...g, spellings: ["class c", "c class"], codes: [/^c ?\d{3}\b/] }],
    ["classe-e", "Classe E", { ...g, spellings: ["class e", "e class"], codes: [/^e ?\d{3}\b/] }],
    ["classe-s", "Classe S", { ...g, spellings: ["class s", "s class"], codes: [/^s ?\d{3}\b/] }],
    ["classe-g", "Classe G", { ...g, spellings: ["class g", "g class"], codes: [/^g ?\d{2,3}\b/] }],
    ["classe-v", "Classe V", { ...g, spellings: ["class v", "v class"] }],
    ["cla", "CLA", { ...g, codes: [/^cla ?\d{3}\b/] }],
    ["cls", "CLS", { ...g, codes: [/^cls ?\d{3}\b/] }],
    ["gla", "GLA", { ...g, codes: [/^gla ?\d{3}\b/] }],
    ["glc", "GLC", { ...g, codes: [/^glc ?\d{3}\b/] }],
    ["gle", "GLE", { ...g, codes: [/^gle ?\d{3}\b/] }],
    ["ml", "ML", { ...g, codes: [/^ml ?\d{3}\b/] }],
    ["190", "190", g],
    ["vito", "Vito", g],
    ["sprinter", "Sprinter", g],
    ["citan", "Citan", g],
  ],
  bmw: [
    ["serie-1", "Série 1", { ...g, spellings: ["serie 1", "series 1", "1 series"], codes: [/^1\d{2}[a-z]{0,2}\b/] }],
    ["serie-2", "Série 2", { ...g, spellings: ["series 2", "2 series"], codes: [/^2\d{2}[a-z]{0,2}\b/] }],
    ["serie-3", "Série 3", { ...g, spellings: ["series 3", "3 series"], codes: [/^3\d{2}[a-z]{0,2}\b/] }],
    ["serie-4", "Série 4", { ...g, spellings: ["series 4", "4 series"], codes: [/^4\d{2}[a-z]{0,2}\b/] }],
    ["serie-5", "Série 5", { ...g, spellings: ["series 5", "5 series"], codes: [/^5\d{2}[a-z]{0,2}\b/] }],
    ["serie-7", "Série 7", { ...g, spellings: ["series 7", "7 series"], codes: [/^7\d{2}[a-z]{0,2}\b/] }],
    ["x1", "X1", g],
    ["x2", "X2", g],
    ["x3", "X3", g],
    ["x4", "X4", g],
    ["x5", "X5", g],
    ["x6", "X6", g],
    ["x7", "X7", g],
  ],
  audi: [
    ["a1", "A1", g],
    ["a3", "A3", g],
    ["a4", "A4", g],
    ["a5", "A5", g],
    ["a6", "A6", g],
    ["a7", "A7", g],
    ["a8", "A8", g],
    ["q2", "Q2", g],
    ["q3", "Q3", g],
    ["q5", "Q5", g],
    ["q7", "Q7", g],
    ["q8", "Q8", g],
    ["tt", "TT", g],
  ],
  opel: [
    ["corsa", "Corsa", g],
    ["astra", "Astra", g],
    ["insignia", "Insignia", g],
    ["mokka", "Mokka"],
    ["crossland", "Crossland"],
    ["grandland", "Grandland"],
    ["zafira", "Zafira"],
    ["meriva", "Meriva"],
    ["vectra", "Vectra"],
    ["combo", "Combo", g],
  ],
  fiat: [
    ["punto", "Punto"],
    ["panda", "Panda", g],
    ["500", "500", g],
    ["tipo", "Tipo", g],
    ["uno", "Uno", g],
    ["doblo", "Doblò"],
    ["fiorino", "Fiorino"],
    ["palio", "Palio"],
    ["siena", "Siena", g],
    ["linea", "Linea", g],
    ["bravo", "Bravo", g],
  ],
  ford: [
    ["fiesta", "Fiesta", g],
    ["focus", "Focus", g],
    ["kuga", "Kuga"],
    ["ecosport", "EcoSport"],
    ["puma", "Puma", g],
    ["mondeo", "Mondeo"],
    ["ranger", "Ranger", g],
    ["transit", "Transit", g],
    ["fusion", "Fusion", g],
    ["ka", "Ka", g],
  ],
  toyota: [
    ["yaris", "Yaris", { spellings: ["ياريس"] }],
    ["corolla", "Corolla", { spellings: ["كورولا"] }],
    ["auris", "Auris"],
    ["rav4", "RAV4", { spellings: ["rav 4"] }],
    ["hilux", "Hilux", { spellings: ["هيلوكس"] }],
    ["land-cruiser", "Land Cruiser", { spellings: ["landcruiser"] }],
    ["prado", "Prado", g],
    ["c-hr", "C-HR", { ...g, spellings: ["chr"] }],
    ["aygo", "Aygo"],
    ["prius", "Prius"],
    ["avensis", "Avensis"],
    ["camry", "Camry"],
    ["fortuner", "Fortuner"],
  ],
  hyundai: [
    ["i10", "i10", g],
    ["i20", "i20", g],
    ["i30", "i30", g],
    ["accent", "Accent", { ...g, spellings: ["أكسنت", "اكسنت"] }],
    ["elantra", "Elantra"],
    ["tucson", "Tucson", { spellings: ["توسان"] }],
    ["santa-fe", "Santa Fe", { ...g, spellings: ["santafe"] }],
    ["creta", "Creta", g],
    ["kona", "Kona", g],
    ["getz", "Getz"],
    ["atos", "Atos", g],
    ["bayon", "Bayon"],
    ["h1", "H-1", { ...g, spellings: ["h 1"] }],
  ],
  kia: [
    ["picanto", "Picanto", { spellings: ["بيكانتو"] }],
    ["rio", "Rio", g],
    ["ceed", "Ceed"],
    ["sportage", "Sportage", { spellings: ["سبورتاج"] }],
    ["sorento", "Sorento"],
    ["cerato", "Cerato"],
    ["stonic", "Stonic"],
    ["seltos", "Seltos"],
    ["niro", "Niro", g],
    ["carens", "Carens"],
    ["soul", "Soul", g],
    ["pegas", "Pegas", g],
  ],
  nissan: [
    ["micra", "Micra"],
    ["qashqai", "Qashqai", { spellings: ["kashkai", "qashkai", "قشقاي"] }],
    ["juke", "Juke", g],
    ["x-trail", "X-Trail", { spellings: ["xtrail"] }],
    ["navara", "Navara"],
    ["sunny", "Sunny", g],
    ["note", "Note", g],
    ["patrol", "Patrol", g],
    ["pathfinder", "Pathfinder", g],
    ["almera", "Almera"],
    ["tiida", "Tiida"],
  ],
  honda: [
    ["civic", "Civic", g],
    ["accord", "Accord", g],
    ["jazz", "Jazz", g],
    ["cr-v", "CR-V", { ...g, spellings: ["crv"] }],
    ["hr-v", "HR-V", { ...g, spellings: ["hrv"] }],
    ["city", "City", g],
  ],
  mazda: [
    ["2", "Mazda 2", { ...g, spellings: ["mazda2"] }],
    ["3", "Mazda 3", { ...g, spellings: ["mazda3"] }],
    ["6", "Mazda 6", { ...g, spellings: ["mazda6"] }],
    ["cx-3", "CX-3", { ...g, spellings: ["cx3"] }],
    ["cx-5", "CX-5", { ...g, spellings: ["cx5"] }],
    ["cx-30", "CX-30", { ...g, spellings: ["cx30"] }],
  ],
  mitsubishi: [
    ["pajero", "Pajero", { spellings: ["باجيرو"] }],
    ["l200", "L200", { ...g, spellings: ["l 200"] }],
    ["outlander", "Outlander", g],
    ["lancer", "Lancer", g],
    ["asx", "ASX", g],
    ["space-star", "Space Star", g],
    ["colt", "Colt", g],
  ],
  suzuki: [
    ["swift", "Swift", g],
    ["alto", "Alto", g],
    ["celerio", "Celerio"],
    ["vitara", "Vitara", { spellings: ["grand vitara"] }],
    ["jimny", "Jimny"],
    ["sx4", "SX4", g],
    ["baleno", "Baleno"],
    ["s-presso", "S-Presso", { spellings: ["spresso"] }],
    ["dzire", "Dzire"],
    ["ignis", "Ignis", g],
  ],
  skoda: [
    ["octavia", "Octavia", g],
    ["fabia", "Fabia", g],
    ["superb", "Superb", g],
    ["kodiaq", "Kodiaq"],
    ["karoq", "Karoq"],
    ["kamiq", "Kamiq"],
    ["rapid", "Rapid", g],
    ["scala", "Scala", g],
  ],
  seat: [
    ["ibiza", "Ibiza", g],
    ["leon", "León", g],
    ["arona", "Arona", g],
    ["ateca", "Ateca"],
    ["tarraco", "Tarraco"],
    ["toledo", "Toledo", g],
    ["cordoba", "Córdoba", g],
  ],
  cupra: [
    ["formentor", "Formentor"],
    ["born", "Born", g],
  ],
  "land-rover": [
    ["range-rover", "Range Rover", { spellings: ["rangerover", "رانج روفر"] }],
    ["range-rover-sport", "Range Rover Sport"],
    ["range-rover-evoque", "Range Rover Evoque", { spellings: ["evoque"] }],
    ["range-rover-velar", "Range Rover Velar", { spellings: ["velar"] }],
    ["discovery", "Discovery", g],
    ["discovery-sport", "Discovery Sport", g],
    ["defender", "Defender", g],
    ["freelander", "Freelander"],
  ],
  jeep: [
    ["wrangler", "Wrangler", g],
    ["cherokee", "Cherokee", g],
    ["grand-cherokee", "Grand Cherokee", g],
    ["compass", "Compass", g],
    ["renegade", "Renegade", g],
  ],
  chevrolet: [
    ["aveo", "Aveo"],
    ["spark", "Spark", g],
    ["cruze", "Cruze"],
    ["optra", "Optra"],
    ["captiva", "Captiva"],
    ["sail", "Sail", g],
  ],
  volvo: [
    ["xc40", "XC40", { ...g, spellings: ["xc 40"] }],
    ["xc60", "XC60", { ...g, spellings: ["xc 60"] }],
    ["xc90", "XC90", { ...g, spellings: ["xc 90"] }],
    ["s60", "S60", g],
    ["v40", "V40", g],
  ],
  porsche: [
    ["cayenne", "Cayenne", g],
    ["macan", "Macan"],
    ["911", "911", g],
    ["panamera", "Panamera"],
    ["taycan", "Taycan"],
  ],
  mini: [
    ["cooper", "Cooper", g],
    ["countryman", "Countryman", g],
    ["clubman", "Clubman", g],
  ],
  "alfa-romeo": [
    ["giulietta", "Giulietta"],
    ["giulia", "Giulia", g],
    ["stelvio", "Stelvio"],
    ["mito", "MiTo", g],
  ],
  tesla: [
    ["model-3", "Model 3", g],
    ["model-y", "Model Y", g],
    ["model-s", "Model S", g],
    ["model-x", "Model X", g],
  ],
  byd: [
    ["atto-3", "Atto 3", { spellings: ["atto3"] }],
    ["dolphin", "Dolphin", g],
    ["seal", "Seal", g],
    ["han", "Han", g],
    ["tang", "Tang", g],
  ],
  chery: [
    ["tiggo-2", "Tiggo 2", { spellings: ["tiggo2"] }],
    ["tiggo-4", "Tiggo 4", { spellings: ["tiggo4"] }],
    ["tiggo-7", "Tiggo 7", { spellings: ["tiggo7"] }],
    ["tiggo-8", "Tiggo 8", { spellings: ["tiggo8"] }],
    ["arrizo", "Arrizo"],
  ],
  geely: [
    ["coolray", "Coolray"],
    ["emgrand", "Emgrand"],
  ],
  mg: [
    ["zs", "ZS", g],
    ["hs", "HS", g],
    ["mg3", "MG3", { ...g, spellings: ["mg 3"] }],
    ["mg4", "MG4", { ...g, spellings: ["mg 4"] }],
    ["mg5", "MG5", { ...g, spellings: ["mg 5"] }],
  ],
  haval: [
    ["h6", "H6", g],
    ["jolion", "Jolion"],
  ],
  smart: [
    ["fortwo", "ForTwo", g],
    ["forfour", "ForFour", g],
  ],
  ssangyong: [
    ["rexton", "Rexton"],
    ["korando", "Korando"],
    ["tivoli", "Tivoli", g],
  ],
};

/** Folded words: lower case, no accents, Arabic letter variants folded, any other mark a space. */
export function modelWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export const CAR_MODELS: readonly CarModel[] = Object.entries(RAW).flatMap(([brand, models]) =>
  (models ?? []).map(([slug, label, options]) => ({
    id: `${brand}-${slug}`,
    brand: brand as CarBrand,
    label,
    spellings: [...new Set([slug.replace(/-/g, " "), label, ...(options?.spellings ?? [])].map((spelling) => modelWords(spelling).join(" ")).filter(Boolean))],
    guarded: options?.guarded === true,
    codes: options?.codes ?? [],
  })),
);

export const CAR_MODEL_IDS: readonly string[] = CAR_MODELS.map((model) => model.id);

const BY_ID = new Map(CAR_MODELS.map((model) => [model.id, model]));

export function carModelById(id: string): CarModel | undefined {
  return BY_ID.get(id);
}

/** Models of the given brands, in list order (every model when no brand is given). */
export function carModelsOf(brands: readonly string[] | undefined): CarModel[] {
  if (!brands?.length) return [...CAR_MODELS];
  const set = new Set(brands);
  return CAR_MODELS.filter((model) => set.has(model.brand));
}

/** Whether a text word is a spelling word, or that word with a generation number glued ("clio4"). */
function wordMatches(text: string, spelling: string): boolean {
  if (text === spelling) return true;
  return /\p{L}$/u.test(spelling) && text.startsWith(spelling) && /^\d{1,2}$/.test(text.slice(spelling.length));
}

/** Length (in words) of `spelling` found at `words[at]`, or 0. */
function spellingAt(words: readonly string[], at: number, spelling: readonly string[]): number {
  if (spelling.length === 0 || at + spelling.length > words.length) return 0;
  for (let offset = 0; offset < spelling.length; offset += 1) {
    const word = words[at + offset] ?? "";
    // Only the last word may carry a glued generation number.
    if (offset < spelling.length - 1 ? word !== spelling[offset] : !wordMatches(word, spelling[offset] ?? "")) return 0;
  }
  return spelling.length;
}

export interface ModelMatch {
  model: CarModel;
  /** Index of the first word and number of words. */
  start: number;
  length: number;
}

/** Every model of `brands` (all when empty) spelled in `words`, the longest first at each position. */
export function findModels(words: readonly string[], brands?: readonly string[]): ModelMatch[] {
  const models = carModelsOf(brands);
  const out: ModelMatch[] = [];
  for (let at = 0; at < words.length; at += 1) {
    let best: ModelMatch | undefined;
    for (const model of models) {
      for (const spelling of model.spellings) {
        const length = spellingAt(words, at, spelling.split(" "));
        if (length > (best?.length ?? 0)) best = { model, start: at, length };
      }
    }
    if (best) {
      out.push(best);
      at += best.length - 1;
    }
  }
  return out;
}

/**
 * The catalogue model of a listing from its brand and its free-text model ("Clio 4 dCi 90" ->
 * renault-clio), or undefined when the text names none of the brand's models.
 */
export function carModelOf(brand: unknown, model: unknown): string | undefined {
  if (typeof brand !== "string" || typeof model !== "string") return undefined;
  const words = modelWords(model);
  if (words.length === 0) return undefined;
  const found = findModels(words, [brand]);
  if (found.length > 0) return found[0]?.model.id;
  const text = words.join(" ");
  return carModelsOf([brand]).find((each) => each.codes.some((code) => code.test(text)))?.id;
}

/** Message id of a criterion's label: a derived criterion borrows its source's (`car-model` -> `model`). */
export function criterionLabelId(criterionId: string): string {
  return criterionId === "car-model" ? "model" : criterionId;
}

/** Label of a derived criterion's option (model names are not translated); undefined otherwise. */
export function derivedOptionLabel(criterionId: string, optionId: string): string | undefined {
  return criterionId === "car-model" ? (carModelById(optionId)?.label ?? optionId) : undefined;
}
