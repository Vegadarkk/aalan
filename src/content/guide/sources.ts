// Admin procedures guide (design guide-demarches G2): the only links the guide may show. Every URL is
// an official page of a Moroccan administration, on a host of OFFICIAL_HOSTS; the guide never hosts a
// copy of a form or a document, and its texts never hold a URL (tests/unit/guide-corpus.test.ts).
// The worker checks every link weekly (src/worker/jobs/guide-links.ts) and the back office shows the
// result (/guide). Client-safe.
//
// Adding a link: open the page by hand, read it, set `reviewedAt` to that day. `confirmed: false`
// marks a page we could not open from the development machines (geo or anti-bot block): the site
// hides it until the checker has seen it answer once.

/** Hosts the guide may link to, with the authority that runs them (shown next to each link). */
export const OFFICIAL_HOSTS = {
  "idarati.ma": "Idarati",
  "maroc.ma": "Portail national",
  "www.chikaya.ma": "Chikaya",
  "www.tax.gov.ma": "DGI",
  "www.tgr.gov.ma": "TGR",
  "www.cnss.ma": "CNSS",
  "ae.gov.ma": "Auto-entrepreneur",
  "www.onousc.ma": "ONOUSC",
  "mabourse.enssup.gov.ma": "Enseignement supérieur",
  "massar.men.gov.ma": "Massar",
  "www.narsa-securiteroutiere.ma": "NARSA",
  "www.ancfcc.gov.ma": "ANCFCC",
  "www.mre.gov.ma": "Ministère des MRE",
  "www.douane.gov.ma": "Douane (ADII)",
  "www.consulat.ma": "Affaires étrangères",
  "casierjudiciaire.justice.gov.ma": "Ministère de la Justice",
  "nationalitemarocaine.justice.gov.ma": "Ministère de la Justice",
  "www.odco.gov.ma": "ODCO",
  "www.ompic.ma": "OMPIC",
  "www.cnie.ma": "DGSN",
  "www.passeport.ma": "DGSN",
  "mtaess.gov.ma": "Ministère du Tourisme",
  "www.cursussup.gov.ma": "Enseignement supérieur",
  "www.cpge.ac.ma": "Classes préparatoires",
  "www.cnops.org.ma": "CNOPS",
  "www.rsu.ma": "Registre social unifié",
  "www.rnp.ma": "Registre national de la population",
  "www.asd.ma": "Aide sociale directe",
  "www.daamsakane.ma": "Aide au logement",
  "www.cmr.gov.ma": "CMR",
  "www.rcar.ma": "RCAR",
  "www.cimr.ma": "CIMR",
  "www.srm-cs.ma": "SRM Casablanca-Settat",
  "www.redal.ma": "Redal",
  "www.amendis.ma": "Amendis",
  "www.one.org.ma": "ONEE",
  "www.acaps.ma": "ACAPS",
  "reclamation-assurance.acaps.ma": "ACAPS",
  "www.tajnid.ma": "Service militaire",
  // Foreign official hosts (FOREIGN_OFFICIAL_HOSTS): studies in France, asked for by the owner.
  "www.maroc.campusfrance.org": "Campus France (État français)",
  "www.parcoursup.gouv.fr": "Parcoursup (État français)",
  // Moroccan e-visa platform (Ministry of Foreign Affairs).
  "www.acces-maroc.ma": "Affaires étrangères (e-visa)",
  "khadamatnarsa.ma": "NARSA (services en ligne)",
  "equivalence.men.gov.ma": "Ministère de l'Éducation nationale",
  "www.listeselectorales.ma": "Ministère de l'Intérieur",
  "www.habous.gov.ma": "Ministère des Habous",
  // Foreign official hosts (FOREIGN_OFFICIAL_HOSTS): visas for travel abroad, asked for by the owner.
  "france-visas.gouv.fr": "France-Visas (État français)",
  "ma.diplomatie.gouv.fr": "Ambassade de France au Maroc",
  "www.exteriores.gob.es": "Consulats d'Espagne au Maroc",
  "home-affairs.ec.europa.eu": "Commission européenne",
  "www.gov.uk": "Gouvernement britannique",
  "ma.usembassy.gov": "Ambassade des États-Unis au Maroc",
  "travel.state.gov": "Département d'État américain",
  "www.canada.ca": "Gouvernement du Canada",
} as const;
export type OfficialHost = keyof typeof OFFICIAL_HOSTS;

/**
 * The only hosts outside .ma the guide may link to (owner, 2026-10-30: studies in France; 2026-11-11:
 * visas). Governments and their embassies only: never a visa centre operator, an agency or a form filler.
 */
export const FOREIGN_OFFICIAL_HOSTS: ReadonlySet<string> = new Set([
  "www.maroc.campusfrance.org",
  "www.parcoursup.gouv.fr",
  "france-visas.gouv.fr",
  "ma.diplomatie.gouv.fr",
  "www.exteriores.gob.es",
  "home-affairs.ec.europa.eu",
  "www.gov.uk",
  "ma.usembassy.gov",
  "travel.state.gov",
  "www.canada.ca",
]);

/** Languages a page is offered in (badges next to the link). */
export const PAGE_LANGS = ["fr", "ar", "en", "es"] as const;
export type PageLang = (typeof PAGE_LANGS)[number];

export interface GuideSource {
  url: string;
  langs: readonly PageLang[];
  /** Day a person last read the page (YYYY-MM-DD); the back office flags it after 180 days. */
  reviewedAt: string;
  /** False: never opened from our machines; hidden until the checker sees it answer. */
  confirmed: boolean;
}

const source = (url: string, langs: readonly PageLang[], confirmed = true, reviewedAt = "2026-10-28"): GuideSource => ({ url, langs, reviewedAt, confirmed });

export const GUIDE_SOURCES = {
  // Portals
  "idarati-entreprises": source("https://idarati.ma/e-service/services-en-ligne/?thematic=entreprises-emploi-et-affaires", ["fr"]),
  "idarati-logement": source("https://idarati.ma/e-service/services-en-ligne/?thematic=construction-logement-et-immobilier", ["fr"]),
  // Tourist accommodation: law 80-14 and its texts (no step-by-step procedure on the page).
  "tourisme-hebergement": source("https://mtaess.gov.ma/fr/tourisme/metiers-tourisme/hebergement-touristique/", ["fr", "ar"], true, "2026-10-29"),
  "idarati-papiers": source("https://idarati.ma/e-service/services-en-ligne/?thematic=papiers-famille-et-citoyennete", ["fr"]),
  "maroc-grand-public": source("https://maroc.ma/fr/services-numeriques/grand-public", ["fr", "ar"]),
  "maroc-entreprises": source("https://maroc.ma/fr/services-numeriques/entreprises-professionnels", ["fr", "ar"]),
  chikaya: source("https://www.chikaya.ma/", ["fr", "ar"]),
  // Tax and social security
  "dgi-teleservices": source("https://www.tax.gov.ma/wps/portal/DGI/Teleservices", ["fr", "ar", "en", "es"]),
  "tgr-taxes-locales": source("https://www.tgr.gov.ma/wps/portal/EmissionTHTSC", ["fr"]),
  cnss: source("https://www.cnss.ma/", ["fr", "ar"], false),
  "ae-portail": source("https://ae.gov.ma/", ["fr", "ar"], false),
  // Students
  "onousc-bourses": source("https://www.onousc.ma/Bourses", ["fr"]),
  "onousc-bourses-maroc": source("https://www.onousc.ma/Bourses-de-premier-cycle-au-Maroc", ["fr"]),
  "onousc-bourses-etranger": source("https://www.onousc.ma/Bourses-des-etudes-a-l-etranger", ["fr"]),
  "onousc-logement": source("https://www.onousc.ma/se-loger-dans-une-cite-universitaire", ["fr"]),
  "onousc-amo": source("https://www.onousc.ma/Couverture-medicale", ["fr"]),
  mabourse: source("https://mabourse.enssup.gov.ma/", ["fr"]),
  massar: source("https://massar.men.gov.ma/", ["fr", "ar"], false),
  // Vehicles
  "narsa-mutation": source("https://www.narsa-securiteroutiere.ma/fr/mutation-de-vehicules/", ["fr", "ar"]),
  "narsa-permis": source("https://www.narsa-securiteroutiere.ma/fr/echange-du-permis-de-conduire/", ["fr"]),
  // Property
  ancfcc: source("https://www.ancfcc.gov.ma/", ["fr", "ar"]),
  "ancfcc-tarifs": source("https://www.ancfcc.gov.ma/TarifsFr/", ["fr"]),
  // Diaspora (MRE)
  "mre-accueil": source("https://www.mre.gov.ma/fr", ["fr", "ar", "en"]),
  "mre-consulaire": source("https://www.mre.gov.ma/fr/e-services/guide-des-prestations-consulaires-en-ligne", ["fr"]),
  "mre-justice": source("https://www.mre.gov.ma/fr/e-services/services-administratifs-et-judiciaires-en-ligne", ["fr"]),
  // Customs (ADII): its site refuses automated clients (11 Nov 2026); the checker unhides it once it answers.
  adii: source("https://www.douane.gov.ma/", ["fr", "ar"], false, "2026-11-11"),
  "consulat-trouver": source("https://www.consulat.ma/fr/trouver-un-consulat", ["fr", "ar"]),
  "consulat-immatriculation": source("https://www.consulat.ma/fr/attestation-dimmatriculation-consulaire", ["fr", "ar"]),
  "consulat-retour": source("https://www.consulat.ma/fr/le-retour-definitif-au-maroc", ["fr", "ar"]),
  "consulat-voiture": source("https://www.consulat.ma/fr/admission-temporaire-des-voitures-au-maroc", ["fr", "ar"]),
  "consulat-procuration": source("https://www.consulat.ma/fr/procuration-pour-transactions-immobilieres", ["fr", "ar"]),
  // Identity and civil status
  "consulat-naissance": source("https://www.consulat.ma/fr/extrait-dacte-de-naissance", ["fr", "ar"]),
  "consulat-copie-integrale": source("https://www.consulat.ma/fr/copie-integrale-de-lacte-de-naissance", ["fr", "ar"]),
  "consulat-cnie": source("https://www.consulat.ma/fr/delivrance-de-la-cnie-pour-la-premiere-fois", ["fr", "ar"]),
  "consulat-livret": source("https://www.consulat.ma/fr/delivrance-du-livret-de-famille", ["fr", "ar"]),
  "consulat-casier": source("https://www.consulat.ma/fr/casier-judiciare-pour-les-marocains", ["fr", "ar"]),
  casier: source("https://casierjudiciaire.justice.gov.ma/Accueil.aspx", ["fr", "ar", "en", "es"]),
  nationalite: source("https://nationalitemarocaine.justice.gov.ma/Pages/NouvelleDemande", ["ar"]),
  cnie: source("https://www.cnie.ma/", ["fr", "ar"], false),
  passeport: source("https://www.passeport.ma/", ["fr", "ar"], false),
  // Companies and cooperatives
  "odco-creer": source("https://www.odco.gov.ma/service/creer-votre-cooperative/", ["fr", "ar"]),
  "odco-cadre": source("https://www.odco.gov.ma/service/cadre-juridique/", ["fr", "ar"]),
  "odco-delegations": source("https://www.odco.gov.ma/nos-delegations-regionales/", ["fr", "ar"]),
  "ompic-creation": source("https://www.ompic.ma/fr/creation-et-vie-de-lentreprise", ["fr", "ar"]),
  "ompic-rcc": source("https://www.ompic.ma/fr/services-rcc", ["fr", "ar"]),
  "ompic-ice": source("https://www.ompic.ma/fr/identifiant-commun-de-lentreprise", ["fr", "ar"]),
  // Students: admissions after the baccalaureate, studies in France
  cursussup: source("https://www.cursussup.gov.ma/", ["fr", "ar"], false, "2026-10-30"),
  cpge: source("https://www.cpge.ac.ma/", ["fr"], true, "2026-10-30"),
  "campusfrance-procedures": source("https://www.maroc.campusfrance.org/les-procedures-de-campus-france-maroc", ["fr"], true, "2026-10-30"),
  parcoursup: source("https://www.parcoursup.gouv.fr/", ["fr"], false, "2026-10-30"),
  // Health cover, retirement, social aid
  cnops: source("https://www.cnops.org.ma/", ["fr", "ar"], false, "2026-10-30"),
  rsu: source("https://www.rsu.ma/", ["fr", "ar"], false, "2026-10-30"),
  rnp: source("https://www.rnp.ma/", ["fr", "ar"], false, "2026-10-30"),
  asd: source("https://www.asd.ma/", ["fr", "ar"], false, "2026-10-30"),
  "daam-sakane": source("https://www.daamsakane.ma/", ["fr", "ar"], false, "2026-10-30"),
  cmr: source("https://www.cmr.gov.ma/", ["fr", "ar"], false, "2026-10-30"),
  "rcar-affiliation": source("https://www.rcar.ma/fr/affiliation", ["fr", "ar"], true, "2026-10-30"),
  "cimr-pension": source("https://www.cimr.ma/prestations/pension-principale/", ["fr"], true, "2026-10-30"),
  // Water and electricity (regional multiservice companies, former delegated operators, ONEE)
  "srm-casablanca": source("https://www.srm-cs.ma/", ["fr", "ar"], false, "2026-10-30"),
  "redal-particuliers": source("https://www.redal.ma/fr/client-redal/client-particulier", ["fr"], true, "2026-10-30"),
  "amendis-abonnement": source("https://www.amendis.ma/fr/nos-activites/relation-client/client-particulier/branchement-abonnement-particulier", ["fr"], true, "2026-10-30"),
  "amendis-gestion": source("https://www.amendis.ma/fr/nos-activites/relation-client/client-particulier/gestion-abonnements", ["fr"], true, "2026-10-30"),
  onee: source("https://www.one.org.ma/", ["fr", "ar"], false, "2026-10-30"),
  // Insurance
  acaps: source("https://www.acaps.ma/fr", ["fr", "ar"], true, "2026-10-30"),
  "acaps-reclamation": source("https://reclamation-assurance.acaps.ma/", ["fr", "ar"], false, "2026-10-30"),
  // Military service
  tajnid: source("https://www.tajnid.ma/", ["fr", "ar"], false, "2026-10-30"),
  // Visas (owner, 2026-11-11). Read on 11 Nov 2026, by a person in a browser where the site refuses
  // automated clients (france-visas.gouv.fr, the US pages, consulat.ma, acces-maroc.ma).
  "schengen-demande": source("https://home-affairs.ec.europa.eu/policies/schengen/visa-policy/applying-schengen-visa_en", ["en"], true, "2026-11-11"),
  "france-visas": source("https://france-visas.gouv.fr/fr/maroc", ["fr", "en", "es", "ar"], true, "2026-11-11"),
  "france-visa-maroc": source("https://ma.diplomatie.gouv.fr/fr/demander-un-visa", ["fr", "ar"], true, "2026-11-11"),
  "espagne-visa-rabat": source("https://www.exteriores.gob.es/Consulados/rabat/es/ServiciosConsulares/Paginas/Procedimiento-de-solicitudes-de-visado.aspx", ["es"], true, "2026-11-11"),
  "uk-check-visa": source("https://www.gov.uk/check-uk-visa", ["en"], true, "2026-11-11"),
  "uk-standard-visitor": source("https://www.gov.uk/standard-visitor", ["en"], true, "2026-11-11"),
  "us-visas-maroc": source("https://ma.usembassy.gov/visas/", ["en", "fr", "ar"], true, "2026-11-11"),
  "us-visitor": source("https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html", ["en"], true, "2026-11-11"),
  "canada-visite": source("https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada.html", ["en", "fr"], true, "2026-11-11"),
  "canada-ave": source("https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility/eta-x.html", ["en", "fr"], true, "2026-11-11"),
  "maroc-evisa": source("https://www.acces-maroc.ma/", ["fr", "ar", "en"], true, "2026-11-11"),
  // Hajj: the ministry portal (under maintenance on 11 Nov 2026; it announces each season's registration).
  habous: source("https://www.habous.gov.ma/", ["ar", "fr"], true, "2026-11-11"),
  // Driving licence: the NARSA exam page (read) links the services portal, unreachable from outside
  // Morocco on 11 Nov 2026 like the electoral lists and the equivalences platform (confirmed: false).
  "narsa-examen": source("https://www.narsa-securiteroutiere.ma/fr/examen-du-permis-de-conduire/", ["fr", "ar"], true, "2026-11-11"),
  "narsa-permis-premier": source("https://khadamatnarsa.ma/fr/services/obtention-de-mon-permis-de-conduire-1ere-fois", ["fr"], false, "2026-11-11"),
  "narsa-permis-duplicata": source("https://khadamatnarsa.ma/fr/services/duplicata-de-mon-permis-de-conduire", ["fr"], false, "2026-11-11"),
  equivalence: source("https://equivalence.men.gov.ma/", ["fr"], false, "2026-11-11"),
  "listes-electorales": source("https://www.listeselectorales.ma/fr/", ["fr", "ar"], false, "2026-11-11"),
  // Consular pages, read in a browser on 11 Nov 2026 (consulat.ma refuses automated clients).
  "consulat-mariage-adoulaire": source("https://www.consulat.ma/fr/etablissement-dun-acte-de-mariage-adoulaire-aupres-des-services-consulaires", ["fr", "ar", "en"], true, "2026-11-11"),
  "consulat-mariage-civil": source("https://www.consulat.ma/fr/enregistrement-du-mariage-civil-aupres-des-services-consulaires", ["fr", "ar", "en"], true, "2026-11-11"),
  "consulat-succession": source("https://www.consulat.ma/fr/ayants-droits-vivant-au-maroc-ou-dans-un-pays-autre-que-celui-de-residence-du-defunt", ["fr", "ar", "en"], true, "2026-11-11"),
  "consulat-certificat-vie": source("https://www.consulat.ma/fr/certificat-de-vie-individuel-ou-collectif-ou-fiche-familiale-detat-civil", ["fr", "ar", "en"], true, "2026-11-11"),
  "consulat-dispense-visa": source("https://www.consulat.ma/fr/liste-des-pays-dont-les-ressortissants-sont-dispenses-du-visa-dentree-au-maroc", ["fr", "ar", "en"], true, "2026-11-11"),
} as const satisfies Record<string, GuideSource>;
export type GuideSourceId = keyof typeof GUIDE_SOURCES;
export const GUIDE_SOURCE_IDS = Object.keys(GUIDE_SOURCES) as GuideSourceId[];

export function isGuideSourceId(value: string): value is GuideSourceId {
  return Object.hasOwn(GUIDE_SOURCES, value);
}

export function isOfficialHost(host: string): host is OfficialHost {
  return Object.hasOwn(OFFICIAL_HOSTS, host);
}

/** The authority running a source's host. */
export function sourceAuthority(id: GuideSourceId): string {
  return OFFICIAL_HOSTS[new URL(GUIDE_SOURCES[id].url).hostname as OfficialHost];
}

/** The host as shown to visitors (without "www."). */
export function sourceDomain(id: GuideSourceId): string {
  return new URL(GUIDE_SOURCES[id].url).hostname.replace(/^www\./, "");
}
