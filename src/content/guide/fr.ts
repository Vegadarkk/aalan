import type { GuideLocaleContent } from "./catalog";

// Admin procedures guide, French (design guide-demarches G1). Says where a procedure is done and in
// what order, never a fee, a delay or a list of pieces the administration may change: the official
// page linked below each procedure states them.

export const GUIDE_FR: GuideLocaleContent = {
  rubrics: {
    visa: {
      title: "Visas et voyages",
      summary: "Visa Schengen, France, Espagne, Royaume-Uni, États-Unis, Canada : documents et rendez-vous. Venir au Maroc : e-visa et pays exemptés.",
      intro: "Un visa se demande auprès du pays de destination, sur ses sites officiels : ni {brand} ni aucun intermédiaire ne peut l'obtenir à votre place. Cette rubrique indique par où commencer pour les destinations les plus demandées, puis comment un étranger ou un proche vient au Maroc.",
    },
    hajj: {
      title: "Pèlerinage (Hajj)",
      summary: "Inscription au tirage au sort du Hajj auprès du ministère des Habous : conditions et période d'inscription.",
      intro: "Le ministère des Habous et des Affaires islamiques organise chaque année l'inscription au Hajj et le tirage au sort des pèlerins. N'avancez jamais d'argent à une personne qui promet une place : passez uniquement par le portail du ministère.",
    },
    etudiant: {
      title: "Étudiants",
      summary: "Orientation après le bac, bourses, logement, couverture médicale, études en France, équivalence de diplôme.",
      intro: "Les aides aux étudiants relèvent de l'ONOUSC (bourses, cités universitaires, couverture médicale) et du ministère de l'Enseignement supérieur. Les demandes se font en ligne, pendant des périodes ouvertes chaque année : surveillez les calendriers publiés.",
    },
    "auto-entrepreneur": {
      title: "Auto-entrepreneurs",
      summary: "S'inscrire au statut, déclarer son chiffre d'affaires, sa protection sociale.",
      intro: "Le statut d'auto-entrepreneur permet d'exercer une activité en nom propre avec des formalités allégées : inscription au registre national, déclaration du chiffre d'affaires et paiement de l'impôt, couverture médicale. Si vous vendez sur {brand} dans le cadre d'une activité, ouvrez un compte Pro.",
    },
    vehicule: {
      title: "Vendre ou acheter un véhicule",
      summary: "Mutation de la carte grise, vignette, permis de conduire (examen, duplicata, échange), véhicule d'un MRE.",
      intro: "Une vente de véhicule entre particuliers ne s'arrête pas à la remise des clés : le changement de propriétaire (mutation) se déclare à la NARSA et le droit de timbre se paie à la DGI. Tant que la mutation n'est pas faite, le vendeur reste le propriétaire inscrit.",
    },
    immobilier: {
      title: "Acheter, vendre ou louer un logement",
      summary: "Vérifier un bien titré, signer la vente, taxes locales, bail de location.",
      intro: "Avant d'acheter, vérifiez la situation juridique du bien auprès de la conservation foncière (ANCFCC). La vente se signe chez un notaire, des adouls ou un avocat habilité, puis les droits se paient à la DGI et la vente s'inscrit au titre foncier.",
    },
    mre: {
      title: "Marocains du monde (MRE)",
      summary: "Services consulaires, immatriculation, mariage, succession, retour définitif, procuration, envoi de colis.",
      intro: "Depuis l'étranger, la plupart des démarches passent par le consulat de votre pays de résidence et par les services en ligne du ministère chargé des Marocains résidant à l'étranger.",
    },
    "pro-cooperative": {
      title: "Sociétés et coopératives",
      summary: "Créer une société ou une coopérative, ICE, obligations fiscales et sociales.",
      intro: "Une société s'immatricule au registre du commerce (OMPIC) et reçoit un identifiant commun de l'entreprise (ICE) ; une coopérative relève de l'ODCO. Ces numéros vous seront demandés pour un compte Pro.",
    },
    identite: {
      title: "Identité et état civil",
      summary: "CNIE, passeport, acte de naissance, casier judiciaire, nationalité, service militaire, listes électorales.",
      intro: "Au Maroc, la CNIE et le passeport relèvent de la DGSN et l'acte de naissance du bureau d'état civil de la commune d'inscription. À l'étranger, le consulat s'en charge.",
    },
    sante: {
      title: "Couverture médicale (AMO)",
      summary: "AMO des salariés et des indépendants, AMO Tadamon (ex-RAMED), fonctionnaires.",
      intro: "Depuis la généralisation de la protection sociale, l'assurance maladie obligatoire (AMO) couvre les salariés, les indépendants et les personnes sans revenus. La CNSS gère la plupart des régimes ; le secteur public relève encore de la CNOPS pendant son transfert vers la CNSS.",
    },
    retraite: {
      title: "Retraite",
      summary: "Pension de la CNSS, de la CMR ou du RCAR, retraite complémentaire, certificat de vie à l'étranger.",
      intro: "Votre caisse de retraite dépend de votre employeur : la CNSS pour le secteur privé, la CMR pour les fonctionnaires titulaires et les militaires, le RCAR pour les contractuels et le personnel de nombreux établissements publics. Une retraite complémentaire (CIMR) peut s'y ajouter.",
    },
    "aides-sociales": {
      title: "Aides sociales (RSU)",
      summary: "Inscription au RSU, aide sociale directe, aide au logement.",
      intro: "Les aides de l'État passent par le registre social unifié (RSU) : l'inscription du foyer donne un indice socio-économique qui ouvre, ou non, l'aide sociale directe et l'AMO Tadamon. Méfiez-vous de quiconque demande de l'argent pour vous inscrire : passez uniquement par les portails officiels.",
    },
    "eau-electricite": {
      title: "Eau et électricité",
      summary: "Abonnement, changement de titulaire, résiliation, factures et réclamations.",
      intro: "La distribution de l'eau, de l'électricité et l'assainissement passent, région par région, à des sociétés régionales multiservices (SRM), qui reprennent les services de l'ONEE, des régies et des anciens délégataires comme Lydec. Dans certaines villes, l'ancien distributeur reste votre interlocuteur pendant la transition : le nom de votre distributeur figure sur votre facture.",
    },
    assurances: {
      title: "Assurances",
      summary: "Assurance auto obligatoire, accident, réclamation contre un assureur.",
      intro: "Les compagnies d'assurance sont contrôlées par l'ACAPS. En cas de désaccord avec votre assureur, adressez-lui d'abord une réclamation écrite ; si sa réponse ne vous convient pas, l'ACAPS reçoit les réclamations des assurés.",
    },
  },
  procedures: {
    "bourse-etudes": {
      title: "Demander une bourse d'études supérieures",
      body: ["La demande se dépose en ligne, en général dans les semaines qui suivent le baccalauréat. Les conditions de ressources, le calendrier et la liste des pièces sont publiés chaque année."],
    },
    "bourse-etranger": {
      title: "Bourse pour étudier à l'étranger",
      body: ["Certaines bourses financent des études hors du Maroc, dans le cadre d'accords avec d'autres pays. Les filières, les pays et les dates de dépôt changent d'une année à l'autre."],
    },
    "logement-universitaire": {
      title: "Logement en cité universitaire",
      body: ["Les places en cité universitaire s'attribuent sur demande, selon des critères publiés par l'ONOUSC."],
    },
    "amo-etudiant": {
      title: "Couverture médicale des étudiants",
      body: ["Les étudiants peuvent bénéficier de l'assurance maladie obligatoire (AMO) propre aux étudiants. L'inscription et les conditions sont expliquées sur la page officielle."],
    },
    massar: {
      title: "Suivre sa scolarité sur Massar",
      body: ["Massar est la plateforme du ministère de l'Éducation nationale : notes, résultats, et le code Massar que demandent de nombreuses démarches étudiantes."],
    },
    "ae-inscription": {
      title: "S'inscrire au statut d'auto-entrepreneur",
      body: ["L'inscription au registre national de l'auto-entrepreneur se fait sur le portail officiel du statut. Il présente aussi les activités éligibles et les plafonds de chiffre d'affaires."],
      prepare: ["Votre carte nationale (CNIE)", "La description de votre activité"],
    },
    "ae-impots": {
      title: "Déclarer et payer ses impôts",
      body: ["La DGI regroupe ses services en ligne sur un seul portail : déclarations, paiements, attestations fiscales."],
    },
    "ae-protection-sociale": {
      title: "Couverture médicale et protection sociale",
      body: ["L'assurance maladie des travailleurs non salariés, auto-entrepreneurs compris, est gérée par la CNSS."],
    },
    "ae-services": {
      title: "Toutes les démarches des entreprises",
      body: ["Les portails nationaux recensent les services en ligne destinés aux entreprises et aux professionnels."],
    },
    "vehicule-mutation": {
      title: "Changer le propriétaire (mutation)",
      body: [
        "Après la vente, la mutation inscrit l'acheteur comme nouveau propriétaire du véhicule. La NARSA explique les étapes et les pièces ; le droit de timbre de mutation se paie en ligne sur le portail de la DGI.",
        "Faites légaliser le contrat de vente et gardez-en une copie : il prouve la date à laquelle le véhicule a changé de mains.",
      ],
      prepare: ["Le contrat de vente signé par les deux parties", "La carte grise du véhicule", "Les cartes nationales du vendeur et de l'acheteur"],
    },
    "vehicule-vignette": {
      title: "Payer la vignette",
      body: ["La taxe annuelle sur les véhicules (vignette) se paie en ligne sur le portail de la DGI. Un acheteur peut demander la preuve du paiement de l'année en cours."],
    },
    "vehicule-permis": {
      title: "Échanger un permis de conduire étranger",
      body: ["Un permis obtenu à l'étranger peut s'échanger contre un permis marocain, sous conditions expliquées par la NARSA."],
    },
    "vehicule-mre": {
      title: "Venir au Maroc avec sa voiture (MRE)",
      body: ["Un Marocain résidant à l'étranger peut entrer au Maroc avec son véhicule sous le régime de l'admission temporaire. Un véhicule sous ce régime ne peut pas être vendu au Maroc sans dédouanement."],
    },
    "immo-verifier": {
      title: "Vérifier un bien avant d'acheter",
      body: ["Pour un bien titré, le certificat de propriété délivré par la conservation foncière indique le propriétaire inscrit et les charges (hypothèque, saisie). Demandez-le avant de verser quoi que ce soit."],
    },
    "immo-vente": {
      title: "Signer la vente et payer les droits",
      body: [
        "La vente d'un bien immobilier se conclut par un acte établi par un notaire, des adouls ou un avocat habilité. Les droits d'enregistrement et, pour le vendeur, l'impôt sur le profit immobilier se paient à la DGI.",
        "La vente est ensuite inscrite au titre foncier : c'est cette inscription qui rend l'acheteur propriétaire aux yeux de tous.",
      ],
    },
    "immo-taxes-locales": {
      title: "Taxe d'habitation et taxe de services communaux",
      body: ["Ces taxes locales sont émises par la Trésorerie générale du Royaume, qui permet de consulter et de payer ses avis en ligne."],
    },
    "immo-location-touristique": {
      title: "Louer un logement à des touristes",
      body: [
        "Louer un logement meublé à des touristes, même pour quelques nuits, relève de la loi 80-14 sur l'hébergement touristique : selon le type d'hébergement, une autorisation préalable d'exploitation et une assurance sont exigées. Le ministère du Tourisme publie la loi et ses textes d'application.",
        "L'exploitant vérifie l'identité de chaque client et déclare ses séjours chaque jour aux autorités. Il collecte aussi la taxe de séjour, qu'il reverse à la commune. Renseignez-vous auprès de votre commune avant la première location.",
      ],
    },
    "immo-location": {
      title: "Louer un logement",
      body: [
        "La location d'un logement est encadrée par la loi 67-12 : contrat écrit, état des lieux, dépôt de garantie plafonné. Faites légaliser les signatures du bail et gardez les reçus de loyer.",
        "Ne versez jamais d'argent pour réserver un logement que vous n'avez pas visité : c'est la première arnaque à la location.",
      ],
    },
    "mre-services": {
      title: "Services en ligne pour les MRE",
      body: ["Le ministère chargé des Marocains résidant à l'étranger regroupe les services consulaires, administratifs et judiciaires accessibles à distance."],
    },
    "mre-immatriculation": {
      title: "S'immatriculer au consulat",
      body: ["L'immatriculation consulaire est le point de départ de la plupart des démarches à l'étranger. L'annuaire officiel donne le consulat compétent pour votre adresse."],
    },
    "mre-retour": {
      title: "Retour définitif au Maroc",
      body: ["Un retour définitif ouvre droit à certaines facilités, notamment pour le déménagement et le véhicule, sous conditions détaillées par le consulat."],
    },
    "mre-colis": {
      title: "Envoyer un colis par transporteur",
      body: [
        "Un transporteur en fourgon relie l'Europe et le Maroc. Sur {brand}, le prix affiché est une estimation tirée de sa grille : il fixe le prix final après une pesée de contrôle, avant de prendre votre colis. Demandez-le par écrit et gardez le reçu ou la lettre de voiture.",
        "Vous restez responsable du contenu de votre envoi et de sa déclaration en douane. Des droits et taxes peuvent s'ajouter à l'arrivée, et des marchandises destinées à la revente relèvent du régime commercial : la douane (ADII) en fixe les règles. N'envoyez jamais de drogue, d'armes, de devises non déclarées, de médicaments sans ordonnance ni de drone sans autorisation.",
        "En cas de perte ou d'avarie, la responsabilité du transporteur est plafonnée par la convention CMR, sauf valeur déclarée : pour un objet de valeur, demandez-lui une assurance.",
      ],
    },
    "mre-procuration": {
      title: "Procuration pour vendre ou acheter un bien",
      body: ["Depuis l'étranger, vous pouvez donner procuration à une personne de confiance pour une transaction immobilière au Maroc. Lisez-la avant de signer : elle peut permettre de vendre en votre nom."],
    },
    "pro-societe": {
      title: "Créer une société",
      body: ["Le registre du commerce, tenu par l'OMPIC, immatricule les sociétés et les commerçants. L'OMPIC explique les étapes, de la réservation du nom à l'immatriculation."],
    },
    "pro-ice": {
      title: "Identifiant commun de l'entreprise (ICE)",
      body: ["L'ICE identifie l'entreprise auprès de toutes les administrations. Il figure sur ses factures et vous sera demandé pour un compte Pro."],
    },
    "pro-cooperative": {
      title: "Créer une coopérative",
      body: ["L'ODCO accompagne la création des coopératives, notamment agricoles et artisanales : statuts, cadre juridique, délégations régionales."],
    },
    "pro-obligations": {
      title: "Obligations fiscales et sociales",
      body: ["Une entreprise déclare ses impôts à la DGI et ses salariés à la CNSS, en ligne."],
    },
    "id-cnie": {
      title: "Carte nationale (CNIE)",
      body: ["Au Maroc, la CNIE se demande auprès de la DGSN, avec une prise de rendez-vous en ligne. À l'étranger, la demande passe par le consulat."],
    },
    "id-passeport": {
      title: "Passeport biométrique",
      body: ["Le passeport se demande en ligne auprès de la DGSN au Maroc, ou au consulat à l'étranger."],
    },
    "id-naissance": {
      title: "Acte de naissance",
      body: ["L'extrait ou la copie intégrale de l'acte de naissance se demande au bureau d'état civil de la commune où la naissance est inscrite, et à l'étranger au consulat."],
    },
    "id-livret": {
      title: "Livret de famille",
      body: ["Le livret de famille est délivré par l'état civil après le mariage ; à l'étranger, par le consulat."],
    },
    "id-casier": {
      title: "Extrait de casier judiciaire",
      body: ["L'extrait de casier judiciaire se demande en ligne auprès du ministère de la Justice. Le formulaire se remplit en arabe."],
    },
    "id-nationalite": {
      title: "Certificat de nationalité",
      body: ["Le certificat de nationalité se demande en ligne sur la plateforme du ministère de la Justice (en arabe)."],
    },
    "orientation-postbac": {
      title: "Candidater après le bac (écoles, médecine, classes préparatoires)",
      body: [
        "Les candidatures aux établissements à accès régulé (écoles d'ingénieurs et de commerce, médecine et pharmacie, EST, FST…) se déposent sur la plateforme nationale Cursussup, avec le code Massar. Les facultés à accès ouvert inscrivent directement leurs étudiants.",
        "Les classes préparatoires aux grandes écoles (CPGE) ont leur propre plateforme de candidature. Les calendriers sont publiés chaque année : notez les dates dès leur parution.",
      ],
      prepare: ["Votre code Massar", "Vos relevés de notes"],
    },
    "etudes-france": {
      title: "Étudier en France (Campus France, Parcoursup)",
      body: [
        "La plupart des étudiants marocains qui visent la France passent par Campus France Maroc : le parcours (plateforme Études en France ou Parcoursup) dépend de votre baccalauréat et de la formation visée. Les élèves des lycées français au Maroc candidatent en général sur Parcoursup.",
        "Une fois accepté, la demande de visa étudiant suit la procédure indiquée par Campus France.",
      ],
    },
    "amo-salaries": {
      title: "AMO des salariés et des indépendants",
      body: [
        "Les salariés du secteur privé sont déclarés à la CNSS par leur employeur ; les indépendants, les professions libérales et les auto-entrepreneurs s'immatriculent eux-mêmes et paient leurs cotisations à la CNSS.",
        "Les dossiers maladie se déposent en agence ou en ligne. Vérifiez que vos ayants droit (conjoint, enfants) sont bien déclarés.",
      ],
      prepare: ["Votre CNIE", "Votre numéro d'immatriculation à la CNSS"],
    },
    "amo-tadamon": {
      title: "AMO Tadamon (ex-RAMED)",
      body: [
        "L'AMO Tadamon a remplacé le RAMED : l'État paie la cotisation des personnes qui ne peuvent pas la payer. L'éligibilité dépend de l'indice socio-économique du foyer, calculé après l'inscription au RSU ; la CNSS gère ensuite la couverture.",
        "Si votre indice dépasse le seuil, l'AMO Achamil permet de vous affilier à la CNSS en payant vous-même la cotisation.",
      ],
    },
    "amo-fonctionnaires": {
      title: "AMO des fonctionnaires et agents publics",
      body: [
        "L'assurance maladie des fonctionnaires et agents de l'État relève de la CNOPS et des mutuelles du secteur public. La loi 54-23 transfère cette gestion à la CNSS : jusqu'à la date de transfert fixée par les textes, les dossiers restent traités par la CNOPS. Suivez les annonces officielles.",
      ],
    },
    "retraite-cnss": {
      title: "Retraite des salariés du privé (CNSS)",
      body: [
        "La CNSS verse la pension de vieillesse des salariés du secteur privé ; la demande se dépose auprès d'elle à l'approche de l'âge de départ. Le droit et le montant dépendent des jours déclarés : vérifiez régulièrement que votre employeur vous déclare.",
      ],
      prepare: ["Votre CNIE", "Votre numéro d'immatriculation à la CNSS", "Un relevé d'identité bancaire à votre nom"],
    },
    "retraite-public": {
      title: "Retraite des fonctionnaires et agents publics (CMR, RCAR)",
      body: [
        "Les fonctionnaires titulaires et les militaires cotisent à la Caisse marocaine des retraites (CMR). Les agents contractuels de l'État et des collectivités, ainsi que le personnel de nombreux établissements publics, relèvent du RCAR, géré par la CDG.",
        "Chaque caisse propose un espace en ligne pour suivre sa carrière, demander sa pension ou une pension de réversion.",
      ],
    },
    "retraite-complementaire": {
      title: "Retraite complémentaire (CIMR)",
      body: [
        "Si votre employeur adhère à la CIMR, une pension complémentaire s'ajoute à celle de la CNSS. La CIMR propose aussi une épargne retraite individuelle. La pension se demande auprès d'elle au moment du départ.",
      ],
    },
    "rsu-inscription": {
      title: "S'inscrire au RNP puis au RSU",
      body: [
        "Chaque membre du foyer s'inscrit d'abord au registre national de la population (RNP), qui délivre un identifiant numérique. Le chef de foyer inscrit ensuite le ménage au registre social unifié (RSU), en ligne ou dans un point d'enregistrement de sa commune ou de son caïdat.",
        "Le RSU calcule un indice socio-économique. Déclarez tout changement (naissance, déménagement, revenus) pour qu'il reste exact.",
      ],
      prepare: ["Les CNIE des membres majeurs du foyer", "Le livret de famille ou les actes de naissance des enfants"],
    },
    "aide-sociale-directe": {
      title: "Demander l'aide sociale directe",
      body: [
        "L'aide sociale directe verse une allocation mensuelle aux foyers éligibles selon leur indice RSU : aides liées aux enfants, à leur scolarité et à une naissance, ou montant forfaitaire par foyer. La demande se fait en ligne, une fois le foyer inscrit au RSU.",
      ],
    },
    "aide-logement": {
      title: "Aide directe à l'achat d'un logement",
      body: [
        "Le programme d'aide au logement verse une aide directe aux Marocains, résidents ou MRE, qui ne possèdent pas de logement au Maroc et achètent un logement neuf. La demande se dépose en ligne avant la signature de la vente ; l'aide est versée chez le notaire.",
        "Sur {brand}, vérifiez avec le vendeur que le logement entre dans le programme avant de vous engager.",
      ],
    },
    "energie-abonnement": {
      title: "S'abonner à l'eau et à l'électricité",
      body: [
        "L'abonnement se demande en agence ou sur l'agence en ligne du distributeur de votre ville (SRM, ancien délégataire ou ONEE selon la zone). Un logement neuf demande d'abord un branchement au réseau, à prévoir avant d'emménager.",
      ],
      prepare: ["Votre CNIE", "Le titre de propriété ou le contrat de bail", "Le numéro du compteur, s'il existe"],
    },
    "energie-gestion": {
      title: "Changer de titulaire, résilier, payer, réclamer",
      body: [
        "À un déménagement, une vente ou une location, demandez le changement de titulaire ou la résiliation de l'abonnement et relevez l'index du compteur avec l'autre partie : sinon, les consommations restent à votre nom.",
        "Les factures se consultent et se paient en ligne ; une contestation se dépose par écrit auprès du distributeur, en gardant une copie.",
      ],
    },
    "assurance-auto": {
      title: "Assurance auto : obligation et accident",
      body: [
        "L'assurance responsabilité civile est obligatoire pour tout véhicule qui circule. Après l'achat d'un véhicule sur {brand}, souscrivez votre propre contrat avant de rouler et gardez l'attestation dans le véhicule.",
        "En cas d'accident, remplissez un constat amiable avec l'autre conducteur et déclarez le sinistre à votre assureur dans le délai prévu par votre contrat.",
      ],
    },
    "assurance-reclamation": {
      title: "Réclamer contre un assureur",
      body: [
        "Adressez d'abord une réclamation écrite à votre assureur ou à son intermédiaire, en gardant une preuve d'envoi. Sans réponse ou en cas de désaccord, déposez une réclamation auprès de l'ACAPS sur sa plateforme en ligne.",
      ],
    },
    "id-service-militaire": {
      title: "Service militaire",
      body: [
        "Le service militaire concerne les jeunes de 19 à 25 ans. Lors de chaque campagne de recensement, les personnes concernées remplissent le formulaire en ligne puis reçoivent, le cas échéant, une convocation. Les cas de dispense et de report sont précisés sur le portail officiel.",
      ],
    },
    "visa-schengen": {
      title: "Visa Schengen : quel pays choisir et comment faire",
      body: [
        "Les Marocains ont besoin d'un visa pour un court séjour dans l'espace Schengen (jusqu'à 90 jours sur une période de 180 jours). Un seul visa vaut pour tout l'espace, mais la demande se dépose au consulat du pays de votre destination principale : celui où vous resterez le plus longtemps, ou, à durées égales, celui par lequel vous entrerez en premier.",
        "Chaque consulat confie la réception des dossiers à un centre de visas qu'il désigne. Ne payez jamais un intermédiaire qui vend des rendez-vous ou promet un visa : seul le consulat décide, et chaque étape se fait sur les sites officiels.",
        "À la frontière, le système européen d'entrée et de sortie (EES) enregistre vos empreintes et une photo : prévoyez plus de temps lors de votre premier passage.",
      ],
      prepare: ["Un passeport en cours de validité", "Les justificatifs de votre voyage : la liste exacte figure sur la page du consulat"],
    },
    "visa-france": {
      title: "Visa pour la France : documents et rendez-vous",
      body: [
        "La demande de visa pour la France se fait sur France-Visas, le portail officiel du gouvernement français. Son assistant indique d'abord si un visa est nécessaire, les documents à joindre et le tarif ; vous créez ensuite un compte et remplissez la demande en ligne.",
        "Vous déposez ensuite le dossier au centre de visas dont vous dépendez, sur rendez-vous : France-Visas indique à qui vous adresser. La demande se suit en ligne jusqu'à la décision du consulat. Pour des études, passez d'abord par Campus France (rubrique Étudiants).",
      ],
      prepare: ["Un passeport en cours de validité", "Les justificatifs indiqués par l'assistant de France-Visas"],
    },
    "visa-espagne": {
      title: "Visa pour l'Espagne : documents et rendez-vous",
      body: [
        "Chaque consulat d'Espagne au Maroc ne reçoit que les demandes des personnes dont le passeport a été délivré dans sa circonscription. La page officielle du consulat général d'Espagne à Rabat, en espagnol, détaille les cas et les étapes.",
        "Selon votre situation (premier visa, visas Schengen obtenus ces dernières années, études), le rendez-vous se prend sur le site du prestataire BLS désigné par le consulat. Méfiez-vous des faux sites et des revendeurs de rendez-vous : partez toujours de la page officielle du consulat.",
      ],
    },
    "visa-royaume-uni": {
      title: "Visa pour le Royaume-Uni (visiteur)",
      body: [
        "Selon la nationalité, il faut un visa, une autorisation électronique de voyage (ETA) ou rien pour entrer au Royaume-Uni : l'outil officiel du gouvernement britannique vous le dit en quelques questions.",
        "Le visa visiteur (Standard Visitor) couvre notamment le tourisme et les visites à la famille. Il se demande en ligne, avant le voyage. Le Royaume-Uni n'est pas dans l'espace Schengen : un visa Schengen n'y donne pas accès.",
      ],
    },
    "visa-etats-unis": {
      title: "Visa pour les États-Unis : formulaire DS-160 et entretien",
      body: [
        "Pour un voyage de tourisme ou de visite, la demande de visa commence par le formulaire en ligne DS-160, puis un entretien au consulat, sur rendez-vous. La page de l'ambassade des États-Unis au Maroc décrit les étapes et la prise de rendez-vous.",
        "Seul le consulat décide de la délivrance du visa : méfiez-vous des sites qui proposent de remplir le formulaire contre paiement.",
      ],
    },
    "visa-canada": {
      title: "Visa pour le Canada : visa de visiteur ou AVE",
      body: [
        "Les Marocains ont besoin d'un visa de visiteur pour le Canada. Une autorisation de voyage électronique (AVE) suffit seulement si vous arrivez en avion et que vous avez eu un visa canadien ces dix dernières années, ou que vous avez un visa américain de non-immigrant valide.",
        "La demande se fait en ligne ; le questionnaire du gouvernement du Canada indique ce qu'il vous faut.",
      ],
    },
    "entrer-au-maroc": {
      title: "Venir au Maroc : e-visa et pays exemptés",
      body: [
        "Les ressortissants de nombreux pays entrent au Maroc sans visa pour un court séjour : le ministère des Affaires étrangères publie la liste. Pour les autres, le visa électronique (e-visa) se demande en ligne sur la plateforme officielle Accès Maroc, qui vérifie d'abord votre admissibilité ; sinon, la demande se fait au consulat du Maroc.",
        "Un proche de nationalité marocaine, même né à l'étranger, peut demander ses papiers marocains au consulat (rubrique Identité). Un conjoint de nationalité étrangère suit les règles de sa propre nationalité.",
        "Pour rester plus longtemps que la durée autorisée, un étranger demande une carte de séjour (carte d'immatriculation) auprès des services de la DGSN.",
      ],
    },
    "hajj-inscription": {
      title: "S'inscrire au tirage au sort du Hajj",
      body: [
        "Le ministère annonce chaque année la période d'inscription en ligne et les conditions, notamment l'âge minimum et le fait de ne pas avoir accompli le Hajj ces dernières années. L'inscription se confirme ensuite auprès de l'autorité locale, puis un tirage au sort désigne les pèlerins.",
        "Des agences de voyages agréées proposent aussi des places : vérifiez leur agrément auprès du ministère avant tout paiement.",
      ],
    },
    "permis-conduire": {
      title: "Permis de conduire : demande, examen, duplicata",
      body: [
        "Le permis s'obtient après une formation théorique et pratique, puis un examen. L'âge minimum dépend de la catégorie : 18 ans pour le permis B. L'examen théorique se passe au centre d'immatriculation de la NARSA, sur convocation, avec votre pièce d'identité originale ; l'épreuve pratique vient ensuite.",
        "Un permis perdu, volé ou abîmé se remplace par un duplicata, à demander sur le portail de services de la NARSA.",
      ],
    },
    "equivalence-diplomes": {
      title: "Faire reconnaître un diplôme étranger (équivalence)",
      body: [
        "Un diplôme obtenu à l'étranger doit souvent être reconnu par une équivalence pour poursuivre des études, passer un concours ou travailler dans la fonction publique au Maroc. La demande se dépose en ligne, avec un compte personnel, sur la plateforme officielle des équivalences, qui indique les pièces exactes.",
      ],
      prepare: ["Vos diplômes et relevés de notes, numérisés lisiblement"],
    },
    "mre-mariage": {
      title: "Se marier ou faire transcrire son mariage à l'étranger",
      body: [
        "À l'étranger, l'acte de mariage adoulaire peut être établi au consulat par les adouls consulaires ; dans certains cas, par exemple pour un mariage mixte, une autorisation du juge de la famille est nécessaire. Un mariage civil célébré à l'étranger se fait transcrire à l'état civil marocain par le consulat.",
      ],
    },
    "mre-succession": {
      title: "Succession d'un proche décédé",
      body: [
        "L'acte d'hérédité est établi par des adouls. Depuis l'étranger, le consulat peut aider à liquider une succession, notamment avec une procuration et l'original de l'acte d'hérédité : la page officielle précise à quel consulat s'adresser selon le lieu du décès et celui des héritiers.",
      ],
    },
    "certificat-vie": {
      title: "Certificat de vie pour une pension (à l'étranger)",
      body: [
        "Une caisse de retraite demande régulièrement aux retraités qui vivent à l'étranger de prouver qu'ils sont en vie. Le consulat délivre le certificat de vie, individuel ou collectif : le demandeur se présente en personne avec sa pièce d'identité.",
      ],
    },
    "listes-electorales": {
      title: "S'inscrire sur les listes électorales",
      body: [
        "Pour voter, il faut être inscrit sur les listes électorales. L'inscription se fait pendant la période de révision annoncée chaque année, en ligne sur le portail officiel ou auprès de l'administration ; les Marocains résidant à l'étranger peuvent aussi s'inscrire. Le portail permet de vérifier votre inscription.",
      ],
    },
  },
  sources: {
    "idarati-entreprises": "Services en ligne pour les entreprises (Idarati)",
    "idarati-logement": "Services en ligne logement et immobilier (Idarati)",
    "tourisme-hebergement": "Hébergement touristique : loi 80-14 et textes d'application (ministère du Tourisme)",
    "idarati-papiers": "Services en ligne papiers, famille et citoyenneté (Idarati)",
    "maroc-grand-public": "Services numériques pour les citoyens et les MRE",
    "maroc-entreprises": "Services numériques pour les entreprises",
    chikaya: "Réclamation auprès d'une administration",
    "dgi-teleservices": "Services en ligne de la DGI",
    "tgr-taxes-locales": "Taxe d'habitation et de services communaux",
    cnss: "Portail de la CNSS",
    "ae-portail": "Portail officiel de l'auto-entrepreneur",
    "onousc-bourses": "Les bourses de l'ONOUSC",
    "onousc-bourses-maroc": "Bourses de premier cycle au Maroc",
    "onousc-bourses-etranger": "Bourses pour les études à l'étranger",
    "onousc-logement": "Se loger dans une cité universitaire",
    "onousc-amo": "Couverture médicale des étudiants",
    mabourse: "Demande de bourse en ligne",
    massar: "Plateforme Massar",
    "narsa-mutation": "Mutation de véhicules (NARSA)",
    "narsa-permis": "Échange du permis de conduire",
    ancfcc: "Conservation foncière (ANCFCC)",
    "ancfcc-tarifs": "Tarifs de la conservation foncière",
    "mre-accueil": "Ministère des Marocains résidant à l'étranger",
    adii: "Administration des douanes et impôts indirects",
    "mre-consulaire": "Prestations consulaires en ligne",
    "mre-justice": "Services administratifs et judiciaires en ligne",
    "consulat-trouver": "Trouver son consulat",
    "consulat-immatriculation": "Attestation d'immatriculation consulaire",
    "consulat-retour": "Le retour définitif au Maroc",
    "consulat-voiture": "Admission temporaire des voitures",
    "consulat-procuration": "Procuration pour transactions immobilières",
    "consulat-naissance": "Extrait d'acte de naissance (consulat)",
    "consulat-copie-integrale": "Copie intégrale de l'acte de naissance (consulat)",
    "consulat-cnie": "Première CNIE (consulat)",
    "consulat-livret": "Livret de famille (consulat)",
    "consulat-casier": "Casier judiciaire (consulat)",
    casier: "Demande d'extrait de casier judiciaire",
    nationalite: "Demande de certificat de nationalité",
    cnie: "Carte nationale (DGSN)",
    passeport: "Passeport (DGSN)",
    "odco-creer": "Créer votre coopérative",
    "odco-cadre": "Cadre juridique des coopératives",
    "odco-delegations": "Délégations régionales de l'ODCO",
    "ompic-creation": "Création et vie de l'entreprise",
    "ompic-rcc": "Services du registre du commerce",
    "ompic-ice": "Identifiant commun de l'entreprise (ICE)",
    cursussup: "Candidatures post-bac aux établissements à accès régulé (Cursussup)",
    cpge: "Candidature aux classes préparatoires (CPGE)",
    "campusfrance-procedures": "Procédures pour étudier en France (Campus France Maroc)",
    parcoursup: "Plateforme Parcoursup",
    cnops: "Portail de la CNOPS",
    rsu: "Registre social unifié (RSU)",
    rnp: "Registre national de la population (RNP)",
    asd: "Aide sociale directe",
    "daam-sakane": "Aide directe au logement",
    cmr: "Caisse marocaine des retraites (CMR)",
    "rcar-affiliation": "Affiliation et prestations du RCAR",
    "cimr-pension": "Pension de retraite de la CIMR",
    "srm-casablanca": "SRM Casablanca-Settat",
    "redal-particuliers": "Espace clients particuliers de Redal",
    "amendis-abonnement": "Branchement et abonnement (Amendis)",
    "amendis-gestion": "Gestion d'un abonnement (Amendis)",
    onee: "Office national de l'électricité et de l'eau potable (ONEE)",
    acaps: "Autorité de contrôle des assurances et de la prévoyance sociale (ACAPS)",
    "acaps-reclamation": "Déposer une réclamation contre un assureur (ACAPS)",
    tajnid: "Portail du service militaire",
    "schengen-demande": "Demander un visa Schengen (Commission européenne)",
    "france-visas": "France-Visas, portail officiel des visas pour la France",
    "france-visa-maroc": "Demander un visa (consulats de France au Maroc)",
    "espagne-visa-rabat": "Demandes de visa (consulat général d'Espagne à Rabat)",
    "uk-check-visa": "Vérifier s'il vous faut un visa pour le Royaume-Uni",
    "uk-standard-visitor": "Visa visiteur (Standard Visitor)",
    "us-visas-maroc": "Visas (ambassade des États-Unis au Maroc)",
    "us-visitor": "Visa de visiteur (Département d'État)",
    "canada-visite": "Visiter le Canada",
    "canada-ave": "AVE pour les titulaires d'un visa (conditions)",
    "maroc-evisa": "Accès Maroc, plateforme officielle de l'e-visa",
    "consulat-dispense-visa": "Pays dispensés de visa pour le Maroc",
    habous: "Ministère des Habous et des Affaires islamiques",
    "narsa-examen": "Examen du permis de conduire (NARSA)",
    "narsa-permis-premier": "Obtenir son premier permis de conduire",
    "narsa-permis-duplicata": "Duplicata du permis de conduire",
    equivalence: "Plateforme des équivalences de diplômes",
    "consulat-mariage-adoulaire": "Acte de mariage adoulaire (consulat)",
    "consulat-mariage-civil": "Transcription d'un mariage civil (consulat)",
    "consulat-succession": "Liquidation d'une succession (consulat)",
    "consulat-certificat-vie": "Certificat de vie (consulat)",
    "listes-electorales": "Portail des listes électorales",
  },
};
