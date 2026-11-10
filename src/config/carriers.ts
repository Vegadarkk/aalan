// Europe–Morocco carriers space (transporteurs/spec.md, owner 2026-11-10): the item catalogue a
// carrier prices, the surcharges, the EU collection zones and the limits of its settings. Pure data,
// client-safe: the settings form, the storefront, the estimator and the tests share it.

/** Directions a carrier serves: Europe to Morocco, Morocco to Europe. */
export const CARRIER_DIRECTIONS = ["eu_ma", "ma_eu"] as const;
export type CarrierDirection = (typeof CARRIER_DIRECTIONS)[number];

/** Vehicle classes: a van up to 2.5 t, a van 2.5–3.5 t (community licence since May 2022), a heavy truck. */
export const CARRIER_VEHICLES = ["van_light", "van", "truck"] as const;
export type CarrierVehicle = (typeof CARRIER_VEHICLES)[number];

/** Currencies of a price list: euros from Europe, dirhams from Morocco. Amounts in minor units (cents, centimes). */
export const CARRIER_CURRENCIES = ["EUR", "MAD"] as const;
export type CarrierCurrency = (typeof CARRIER_CURRENCIES)[number];

/**
 * The standard items a carrier may price at a flat rate (market research, 10 Nov 2026): the units
 * the carriers' own price lists use. `kg` is the weight an unpriced item counts for at the per-kg
 * rate; an item with neither a flat price nor a weight is « sur devis ».
 */
export const CARRIER_ITEMS = {
  suitcase: { kg: 23 },
  "cabin-bag": { kg: 10 },
  "box-s": { kg: 10 },
  "box-m": { kg: 20 },
  "box-l": { kg: 30 },
  "big-bag": { kg: 25 },
  "tv-small": { kg: null },
  "tv-large": { kg: null },
  "appliance-large": { kg: null },
  "appliance-small": { kg: null },
  bicycle: { kg: null },
  "e-scooter": { kg: null },
  motorbike: { kg: null },
  tyre: { kg: null },
  "furniture-m3": { kg: null },
  "car-parts": { kg: null },
  pallet: { kg: null },
} as const satisfies Record<string, { kg: number | null }>;
export type CarrierItem = keyof typeof CARRIER_ITEMS;
export const CARRIER_ITEM_IDS = Object.keys(CARRIER_ITEMS) as CarrierItem[];

/** Goods a carrier refuses or takes on conditions, beyond the catalogue (its item rules). */
export const CARRIER_RESTRICTED = ["lithium-battery", "liquids", "food", "medicines", "perfume", "tobacco", "cash", "documents"] as const;
export type CarrierRestricted = (typeof CARRIER_RESTRICTED)[number];

/**
 * Surcharges: a flat amount (home pickup, home delivery, remote area, fragile handling) or a share
 * in percent (high season on the whole price, insurance on the declared value).
 */
export const CARRIER_SURCHARGES = { pickup: "amount", delivery: "amount", remote: "amount", fragile: "amount", peak: "percent", insurance: "percent" } as const;
export type CarrierSurcharge = keyof typeof CARRIER_SURCHARGES;
export const CARRIER_SURCHARGE_IDS = Object.keys(CARRIER_SURCHARGES) as CarrierSurcharge[];

/** Limits of the settings (minor units: 100 = 1 EUR or 1 MAD). */
export const CARRIER_LIMITS = {
  /** Highest per-kg rate: 100 EUR or 1,000 MAD a kg. */
  perKgMax: { EUR: 10_000, MAD: 100_000 },
  /** Highest flat price of one item or minimum charge: 5,000 EUR or 50,000 MAD. */
  amountMax: { EUR: 500_000, MAD: 5_000_000 },
  /** Weight bands after the base rate (« 2 € le kg, 1,80 € dès 60 kg »). */
  bandsMax: 4,
  bandFromKgMax: 5_000,
  percentMax: 100,
  zonesMax: 150,
  citiesMax: 60,
  /** Days from the departure to the delivery. */
  transitDaysMax: 30,
  noteMax: 300,
  volumeM3Max: 120,
  payloadKgMax: 40_000,
  /** Kilograms of 1 m³ when the price is set on the volumetric weight (a market default is 250). */
  volumetricMin: 100,
  volumetricMax: 500,
} as const;

/**
 * Room left on a departure (spec §3), as the carrier sets it in one tap: four levels, the kilograms
 * left optional. « Complet » keeps the departure online but out of a search for room.
 */
export const CARRIER_SPACES = ["lots", "some", "almost_full", "full"] as const;
export type CarrierSpace = (typeof CARRIER_SPACES)[number];

/** Limits of a departure (spec §3-4). Days are Morocco calendar days ("YYYY-MM-DD"). */
export const DEPARTURE_LIMITS = {
  /** Furthest departure day from today. */
  aheadDays: 180,
  /** Deposit deadline: on the departure day or up to this many days before. */
  depositDaysMax: 30,
  /** Estimated arrival: from the departure day to this many days after (CARRIER_LIMITS.transitDaysMax). */
  arrivalDaysMax: 30,
  /** A recurrence: every week or every two weeks, up to 8 departures at once (spec §4). */
  repeatMax: 8,
  spaceKgMax: 40_000,
  /** The carrier's note on one departure (below the facts on its page). */
  noteMax: 600,
  /** Departures « Mes départs » lists (upcoming, then the latest past ones to copy). */
  listMax: 100,
} as const;

/**
 * Licence reference as the carrier writes it (community licence, transport register, Moroccan
 * authorisation): 3 to 40 Latin letters, digits, spaces and . / - _, one digit at least. Declared,
 * never checked (owner card, 10 Nov 2026: mandatory, shown « déclaré »).
 */
export const CARRIER_LICENCE_PATTERN = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9 ./_-]{1,38}[A-Za-z0-9]$/;

/**
 * EU collection zones, by country: French départements (metropolitan), Belgian provinces and
 * Brussels, Dutch provinces, Spanish provinces, Italian regions, German Länder, Portuguese
 * districts. Ids `{country}-{code}`; names in French (proper nouns, shown as is in every language).
 */
export const EU_ZONES = {
  FR: {
    "01": "Ain",
    "02": "Aisne",
    "03": "Allier",
    "04": "Alpes-de-Haute-Provence",
    "05": "Hautes-Alpes",
    "06": "Alpes-Maritimes",
    "07": "Ardèche",
    "08": "Ardennes",
    "09": "Ariège",
    "10": "Aube",
    "11": "Aude",
    "12": "Aveyron",
    "13": "Bouches-du-Rhône",
    "14": "Calvados",
    "15": "Cantal",
    "16": "Charente",
    "17": "Charente-Maritime",
    "18": "Cher",
    "19": "Corrèze",
    "2A": "Corse-du-Sud",
    "2B": "Haute-Corse",
    "21": "Côte-d'Or",
    "22": "Côtes-d'Armor",
    "23": "Creuse",
    "24": "Dordogne",
    "25": "Doubs",
    "26": "Drôme",
    "27": "Eure",
    "28": "Eure-et-Loir",
    "29": "Finistère",
    "30": "Gard",
    "31": "Haute-Garonne",
    "32": "Gers",
    "33": "Gironde",
    "34": "Hérault",
    "35": "Ille-et-Vilaine",
    "36": "Indre",
    "37": "Indre-et-Loire",
    "38": "Isère",
    "39": "Jura",
    "40": "Landes",
    "41": "Loir-et-Cher",
    "42": "Loire",
    "43": "Haute-Loire",
    "44": "Loire-Atlantique",
    "45": "Loiret",
    "46": "Lot",
    "47": "Lot-et-Garonne",
    "48": "Lozère",
    "49": "Maine-et-Loire",
    "50": "Manche",
    "51": "Marne",
    "52": "Haute-Marne",
    "53": "Mayenne",
    "54": "Meurthe-et-Moselle",
    "55": "Meuse",
    "56": "Morbihan",
    "57": "Moselle",
    "58": "Nièvre",
    "59": "Nord",
    "60": "Oise",
    "61": "Orne",
    "62": "Pas-de-Calais",
    "63": "Puy-de-Dôme",
    "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées",
    "66": "Pyrénées-Orientales",
    "67": "Bas-Rhin",
    "68": "Haut-Rhin",
    "69": "Rhône",
    "70": "Haute-Saône",
    "71": "Saône-et-Loire",
    "72": "Sarthe",
    "73": "Savoie",
    "74": "Haute-Savoie",
    "75": "Paris",
    "76": "Seine-Maritime",
    "77": "Seine-et-Marne",
    "78": "Yvelines",
    "79": "Deux-Sèvres",
    "80": "Somme",
    "81": "Tarn",
    "82": "Tarn-et-Garonne",
    "83": "Var",
    "84": "Vaucluse",
    "85": "Vendée",
    "86": "Vienne",
    "87": "Haute-Vienne",
    "88": "Vosges",
    "89": "Yonne",
    "90": "Territoire de Belfort",
    "91": "Essonne",
    "92": "Hauts-de-Seine",
    "93": "Seine-Saint-Denis",
    "94": "Val-de-Marne",
    "95": "Val-d'Oise",
  },
  BE: {
    BRU: "Bruxelles-Capitale",
    VAN: "Anvers",
    VLI: "Limbourg",
    VOV: "Flandre-Orientale",
    VWV: "Flandre-Occidentale",
    VBR: "Brabant flamand",
    WBR: "Brabant wallon",
    WHT: "Hainaut",
    WLG: "Liège",
    WLX: "Luxembourg",
    WNA: "Namur",
  },
  NL: {
    DR: "Drenthe",
    FL: "Flevoland",
    FR: "Frise",
    GE: "Gueldre",
    GR: "Groningue",
    LI: "Limbourg",
    NB: "Brabant-Septentrional",
    NH: "Hollande-Septentrionale",
    OV: "Overijssel",
    UT: "Utrecht",
    ZE: "Zélande",
    ZH: "Hollande-Méridionale",
  },
  ES: {
    C: "La Corogne",
    VI: "Alava",
    AB: "Albacete",
    A: "Alicante",
    AL: "Almería",
    O: "Asturies",
    AV: "Ávila",
    BA: "Badajoz",
    PM: "Baléares",
    B: "Barcelone",
    BI: "Biscaye",
    BU: "Burgos",
    CC: "Cáceres",
    CA: "Cadix",
    S: "Cantabrie",
    CS: "Castellón",
    CE: "Ceuta",
    CR: "Ciudad Real",
    CO: "Cordoue",
    CU: "Cuenca",
    SS: "Guipuscoa",
    GI: "Gérone",
    GR: "Grenade",
    GU: "Guadalajara",
    H: "Huelva",
    HU: "Huesca",
    J: "Jaén",
    LO: "La Rioja",
    GC: "Las Palmas",
    LE: "León",
    L: "Lérida",
    LU: "Lugo",
    M: "Madrid",
    MA: "Málaga",
    ML: "Melilla",
    MU: "Murcie",
    NA: "Navarre",
    OR: "Orense",
    P: "Palencia",
    PO: "Pontevedra",
    SA: "Salamanque",
    TF: "Santa Cruz de Tenerife",
    SG: "Ségovie",
    SE: "Séville",
    SO: "Soria",
    T: "Tarragone",
    TE: "Teruel",
    TO: "Tolède",
    V: "Valence",
    VA: "Valladolid",
    ZA: "Zamora",
    Z: "Saragosse",
  },
  IT: {
    "65": "Abruzzes",
    "77": "Basilicate",
    "78": "Calabre",
    "72": "Campanie",
    "45": "Émilie-Romagne",
    "36": "Frioul-Vénétie Julienne",
    "62": "Latium",
    "42": "Ligurie",
    "25": "Lombardie",
    "57": "Marches",
    "67": "Molise",
    "21": "Piémont",
    "75": "Pouilles",
    "88": "Sardaigne",
    "82": "Sicile",
    "52": "Toscane",
    "32": "Trentin-Haut-Adige",
    "55": "Ombrie",
    "23": "Vallée d'Aoste",
    "34": "Vénétie",
  },
  DE: {
    BW: "Bade-Wurtemberg",
    BY: "Bavière",
    BE: "Berlin",
    BB: "Brandebourg",
    HB: "Brême",
    HH: "Hambourg",
    HE: "Hesse",
    MV: "Mecklembourg-Poméranie-Occidentale",
    NI: "Basse-Saxe",
    NW: "Rhénanie-du-Nord-Westphalie",
    RP: "Rhénanie-Palatinat",
    SL: "Sarre",
    SN: "Saxe",
    ST: "Saxe-Anhalt",
    SH: "Schleswig-Holstein",
    TH: "Thuringe",
  },
  PT: {
    "01": "Aveiro",
    "02": "Beja",
    "03": "Braga",
    "04": "Bragance",
    "05": "Castelo Branco",
    "06": "Coimbra",
    "07": "Évora",
    "08": "Faro",
    "09": "Guarda",
    "10": "Leiria",
    "11": "Lisbonne",
    "12": "Portalegre",
    "13": "Porto",
    "14": "Santarém",
    "15": "Setúbal",
    "16": "Viana do Castelo",
    "17": "Vila Real",
    "18": "Viseu",
  },
} as const;
export type EuZoneCountry = keyof typeof EU_ZONES;
export const EU_ZONE_COUNTRIES = Object.keys(EU_ZONES) as EuZoneCountry[];

/** Every zone id (`FR-69`, `BE-BRU`…) with its country and name, in the catalogue's order. */
export const EU_ZONE_LIST: readonly { id: string; country: EuZoneCountry; name: string }[] = EU_ZONE_COUNTRIES.flatMap((country) =>
  Object.entries(EU_ZONES[country]).map(([code, name]) => ({ id: `${country}-${code}`, country, name })),
);
const ZONE_BY_ID = new Map(EU_ZONE_LIST.map((zone) => [zone.id, zone]));
export const euZoneById = (id: string) => ZONE_BY_ID.get(id) ?? null;
export const isEuZone = (id: string) => ZONE_BY_ID.has(id);
