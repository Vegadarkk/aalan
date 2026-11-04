# Test de charge : résultat (D17)

Procédure : `docs/lancement/charge-procedure.md`. Objectif initial (spec §10, critère de sortie de la
phase 6) : 40 pages/s hors cache avec un p95 sous 500 ms, 50 recherches/s avec un p95 sous 300 ms,
CPU de la VM sous 70 %. Si la VM n'y arrive pas, la marge mesurée fixe la bascule vers un VPS.

Décision du propriétaire, 3 novembre 2026 : l'objectif devient la capacité mesurée au n° 6, 14 pages/s
hors cache, avec une alerte à 8 pages rendues par seconde (seuil de bascule ci-dessous) ; l'ouverture
n'attend plus ce critère. La spec §10 est à jour. Les tests suivants mesurent la capacité après chaque
changement du rendu, sans bloquer le lancement.

## 30 octobre 2026

- Staging au commit `b087a23`, limites CPU et mémoire de la production (web 1,5 cœur, Meilisearch
  1 cœur), 5 001 documents Firestore et 50 166 documents dans l'index (jeu `zz`/`zy` plus les
  annonces du staging).
- Deux passages, workflow **Load test** : n° 1 à 09:44 UTC (run 41035573855), n° 2 à 10:19 UTC
  (run 41039874222), mesure CPU par conteneur pendant le n° 2. Règle Cloudflare, limites et jeu de
  données défaits après coup (index revenu à 166 documents).

| Scénario | Demandé | Envoyé | Réussi | Médiane | p95 | Seuil |
| --- | --- | --- | --- | --- | --- | --- |
| Pages hors cache, n° 1 | 40/s pendant 3 min | 3 681 | 65,2 % | 10,8 s | 60 s (délai k6) | p95 < 500 ms, échecs < 1 % |
| Pages hors cache, n° 2 | 40/s pendant 3 min | 3 667 | 65,4 % | 10,9 s | 60 s (délai k6) | idem |
| Recherches, n° 1 | 50/s pendant 3 min | 8 898 | 98,8 % | 149 ms | 814 ms | p95 < 300 ms, échecs < 1 % |
| Recherches, n° 2 | 50/s pendant 3 min | 8 888 | 98,8 % | 106 ms | 802 ms | idem |
| Accueil en cache (chauffe) | 5/s pendant 1 min | environ 300 | non vérifié | 159 ms | 228 ms | aucun |

Environ 3 600 itérations par passage ne sont pas parties (`droppedIterations`) : les 300 utilisateurs
virtuels attendaient tous une réponse.

CPU pendant le n° 2 (moyenne par minute, `load/sampler-read.sh`) :

| Minute | Phase | VM (2 cœurs) | web | Meilisearch | cloudflared |
| --- | --- | --- | --- | --- | --- |
| 2 | pages | 47 % | 0,73 | 0,05 | 0,06 |
| 3-4 | pages | 73 % | 1,07 | 0,16-0,17 | 0,08-0,09 |
| 5 | pages puis recherches | 65 % | 0,85 | 0,26 | 0,08 |
| 6-7 | recherches | 39 % | 0,30 | 0,29 | 0,07-0,08 |
| pic | | | 1,22 | 0,37 | 0,13 |

**Verdict : échec.** Aucun seuil ne tient.

## 31 octobre 2026 (n° 3, deux processus web)

- Staging au commit `c0f8b10` : deux serveurs Next.js par conteneur (`WEB_PROCESSES=2`, #232),
  mêmes limites que la production, 5 001 documents Firestore et 50 192 dans l'index. Entre-temps,
  le rendu a changé (#238 à #248 : rangée de catégories, pied de page listant catégories et
  régions, bulle de l'assistant, carte).
- Un passage à 09:35 UTC (run 41189279417), CPU mesuré pendant. Règle Cloudflare, limites et jeu de
  données défaits après coup.

| Scénario | Demandé | Envoyé | Réussi | Médiane | p95 | Seuil |
| --- | --- | --- | --- | --- | --- | --- |
| Pages hors cache | 40/s pendant 3 min | 2 523 | 60,3 % | 19,9 s | 60 s (délai k6) | p95 < 500 ms, échecs < 1 % |
| Recherches | 50/s pendant 3 min | 8 750 | 93,9 % | 142 ms | 3,47 s | p95 < 300 ms, échecs < 1 % |
| Accueil en cache (chauffe) | 5/s pendant 1 min | environ 300 | non vérifié | 157 ms | 407 ms | aucun |

4 931 itérations ne sont pas parties (300 utilisateurs virtuels atteints dans les deux scénarios).

| Minute | Phase | VM (2 cœurs) | web | Meilisearch | cloudflared |
| --- | --- | --- | --- | --- | --- |
| 2 | pages | 54 % | 0,86 | 0,06 | 0,07 |
| 3-4 | pages | 87-89 % | 1,44-1,46 | 0,11-0,13 | 0,08 |
| 5 | pages puis recherches | 79 % | 1,19 | 0,20 | 0,07 |
| 6-7 | recherches | 42-44 % | 0,36-0,38 | 0,30 | non relevé |
| pic | | | 1,58 | 0,40 | 0,13 |

**Verdict : échec**, et moins bon que le 30 octobre : environ **8,5 pages réussies par seconde**
(1 522 en 3 minutes) contre 13.

## 2 novembre 2026 (n° 4, après l'allègement du pied de page)

- Staging au commit `3e4b9cd`, sur sa nouvelle adresse `staging.aalan.ma` : deux serveurs Next.js
  par conteneur, mêmes limites que la production, 5 001 documents Firestore et 50 192 dans l'index.
  Depuis le n° 3 : pied de page en liens simples (#250), corrections de sécurité (#251), mises à
  jour de dépendances (#258), changement de marque (#269).
- Un passage à 18:55 UTC (run 41505079884), CPU mesuré pendant. Un premier passage à 18:19 UTC
  (run 41499381769) ne compte pas : la nouvelle adresse du staging ne répondait pas encore (zone
  `aalan.ma` en attente), toutes les requêtes ont échoué à la connexion. Règle Cloudflare, limites
  et jeu de données défaits après chaque passage.

| Scénario | Demandé | Envoyé | Réussi | Médiane | p95 | Seuil |
| --- | --- | --- | --- | --- | --- | --- |
| Pages hors cache | 40/s pendant 3 min | 2 817 | 63,5 % | 17,2 s | 37,6 s | p95 < 500 ms, échecs < 1 % |
| Recherches | 50/s pendant 3 min | 8 783 | 95,8 % | 133 ms | 2,82 s | p95 < 300 ms, échecs < 1 % |
| Accueil en cache (chauffe) | 5/s pendant 1 min | environ 300 | non vérifié | 174 ms | 433 ms | aucun |

4 603 itérations ne sont pas parties.

| Minute | Phase | VM (2 cœurs) | web | Meilisearch | cloudflared |
| --- | --- | --- | --- | --- | --- |
| 2 | chauffe puis pages | 22 % | 0,29 | 0,01 | 0,05 |
| 3-5 | pages | 88-89 % | 1,41-1,45 | 0,13-0,15 | 0,06-0,08 |
| 6-8 | recherches | 39-52 % | 0,32-0,55 | 0,28-0,31 | 0,07-0,08 |
| pic | | | 1,57 | 0,50 | 0,14 |

**Verdict : échec.** Environ **9,9 pages réussies par seconde** (1 789 en 3 minutes), contre 8,5
au n° 3 (+17 %) et 13 le 30 octobre. Le web utilise toute sa limite (1,4 cœur sur 1,5) ; chaque page
réussie coûte environ 145 ms de CPU sous charge, contre 170 au n° 3.

## 3 novembre 2026 (n° 5, après l'optimisation du rendu)

- Staging au commit `8d447a1`, qui contient l'optimisation du rendu (#280 : 64 à 50 ms de CPU par
  page en profil local, pages identiques). Mêmes limites que la production, 5 001 documents
  Firestore et 50 192 dans l'index.
- Un passage à 09:23 UTC (run 41610656700), CPU mesuré pendant. Règle Cloudflare, limites et jeu de
  données défaits après (index revenu à 192).

| Scénario | Demandé | Envoyé | Réussi | Médiane | p95 | Seuil |
| --- | --- | --- | --- | --- | --- | --- |
| Pages hors cache | 40/s pendant 3 min | 3 500 | 64,8 % | 14,1 s | 20,1 s | p95 < 500 ms, échecs < 1 % |
| Recherches | 50/s pendant 3 min | 8 892 | 97,5 % | 119 ms | 917 ms | p95 < 300 ms, échecs < 1 % |
| Accueil en cache (chauffe) | 5/s pendant 1 min | environ 300 | non vérifié | 170 ms | 1,16 s | aucun |

3 817 itérations ne sont pas parties.

| Minute | Phase | VM (2 cœurs) | web | Meilisearch | cloudflared |
| --- | --- | --- | --- | --- | --- |
| 2 | chauffe puis pages | 32 % | 0,45 | 0,03 | 0,06 |
| 3-5 | pages | 88-91 % | 1,32-1,44 | 0,17-0,20 | 0,09-0,11 |
| 6-8 | recherches | 34-45 % | 0,27-0,38 | 0,23-0,30 | 0,07-0,08 |
| pic | | | 1,56 | 0,36 | 0,21 |

**Verdict : échec.** Environ **12,6 pages réussies par seconde** (2 267 en 3 minutes), contre 9,9
au n° 4 (+27 %). Chaque page réussie coûte environ 110 ms de CPU sous charge, contre 145 au n° 4.
Les recherches s'améliorent aussi (p95 de 2,82 s à 917 ms, 2,5 % d'échecs contre 4,2 %).

## 3 novembre 2026 (n° 6, après la deuxième passe sur le rendu)

- Staging au commit `9c16a92` (#288 : traductions envoyées par page, empreintes CSP calculées sur
  les octets, cache des formats de traduction partagé ; 37 à 33 ms de CPU par page en profil local,
  pages identiques). Mêmes limites que la production, 5 001 documents Firestore et 50 192 dans
  l'index.
- Un passage à 13:59 UTC (run 41649297362), CPU mesuré pendant. Règle Cloudflare, limites et jeu de
  données défaits après (index revenu à 192).

| Scénario | Demandé | Envoyé | Réussi | Médiane | p95 | Seuil |
| --- | --- | --- | --- | --- | --- | --- |
| Pages hors cache | 40/s pendant 3 min | 3 830 | 66,1 % | 14,7 s | 18,8 s | p95 < 500 ms, échecs < 1 % |
| Recherches | 50/s pendant 3 min | 8 871 | 96,8 % | 159 ms | 1,50 s | p95 < 300 ms, échecs < 1 % |
| Accueil en cache (chauffe) | 5/s pendant 1 min | environ 300 | non vérifié | 174 ms | 452 ms | aucun |

3 501 itérations ne sont pas parties.

| Minute | Phase | VM (2 cœurs) | web | Meilisearch | cloudflared |
| --- | --- | --- | --- | --- | --- |
| 3 | chauffe puis pages | 55 % | 0,86 | 0,08 | 0,07 |
| 4-5 | pages | 91 % | 1,37-1,40 | 0,18-0,20 | 0,10 |
| 6 | fin des pages, recherches | 73 % | 0,98 | 0,25 | 0,11 |
| 7-8 | recherches | 41-43 % | 0,34-0,37 | 0,30 | 0,08 |
| pic | | | 1,59 | 0,33 | 0,17 |

**Verdict : échec.** Environ **14,1 pages réussies par seconde** (2 532 en 3 minutes), contre 12,6
au n° 5 (+12 %) et 9,9 au n° 4. Chaque page réussie coûte environ 99 ms de CPU sous charge, contre
110 au n° 5. Les recherches reculent un peu (p95 de 917 ms à 1,50 s, 3,2 % d'échecs contre 2,5 %) ;
une partie des échecs sont des connexions coupées entre k6 et Cloudflare (`connection reset by
peer`) pendant la phase de recherche, cause non établie.

## 4 novembre 2026 (n° 7, recherche seule)

- Staging au commit `657f126` (lot 7 de l'audit de la recherche inclus, #346). Mêmes limites que la
  production, 50 000 documents ajoutés à l'index seul (50 202 au total, aucune écriture Firestore),
  retirés après (index revenu à 202).
- Générateur `scripts/load-search.ts` lancé dans le conteneur worker, vers `web:3000` : l'origine
  seule, sans Cloudflare ni tunnel. Requêtes du jeu de données, une adresse `cf-connecting-ip`
  différente par requête, limiteurs actifs. Procédure : « Recherche seule » de
  `charge-procedure.md`.

| Débit demandé | Durée | Envoyé | Réussi | Médiane | p95 | p99 | Seuil p95 < 300 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 50/s | 3 min | 9 000 | 100 % | 12 ms | 51 ms | 78 ms | tenu |
| 100/s | 1 min | 6 000 | 100 % | 18 ms | 234 ms | 691 ms | tenu |
| 150/s | 1 min | 8 347 (653 non partis) | 85,9 % (1 179 réponses 503) | 1,64 s | 2,48 s | 4,14 s | échec |

p95 par tranche de 10 s : à 50/s, 229 ms la première (démarrage à froid) puis 50 à 53 ms ; à 100/s,
710 ms la première puis 124 à 190 ms.

| Débit | VM (2 cœurs) | web | Meilisearch | worker (générateur) |
| --- | --- | --- | --- | --- |
| 50/s | 40-45 % | 0,34-0,42 | 0,30 | 0,05-0,07 |
| 100/s | 79 % | 0,75 (pic 0,93) | 0,59 (pic 0,65) | 0,11 |

**Verdict : objectif tenu à l'origine.** 50 recherches/s donnent un p95 de 51 ms, six fois sous le
seuil. La saturation arrive entre 100 et 150 recherches/s : à 100/s le web approche 1 cœur (son fil
JavaScript) et la VM dépasse 70 %.

## Lecture

- Le 30 octobre, le rendu des pages hors cache sature à environ **13 pages réussies par seconde** (2 400 en
  3 minutes). Au-delà, les requêtes s'empilent et partent en délai dépassé.
- Le goulot est le processus web, pas la VM ni Meilisearch : le web plafonne vers 1 cœur alors que
  sa limite est 1,5, Meilisearch n'utilise que 0,2 à 0,3 cœur sur 1, et la recherche seule répond en
  106 à 149 ms de médiane. Next.js tourne dans un seul processus Node : son fil JavaScript sature
  (déduction : la mesure de retard de la boucle d'événements n'existe pas encore). Les 2 216
  `SearchUnavailableError: meilisearch response interrupted` du web pendant le n° 1 en découlent :
  le délai de 2 s de Meilisearch court aussi pendant que la boucle est occupée.
- Le p95 des recherches dépasse le seuil parce que leur phase commence pendant que les pages en
  retard finissent (jusqu'à 60 s) ; la médiane reste bonne. Un passage de recherche seul n'a pas été
  fait.
- Coût par rendu repéré dans le code : une page d'annonce envoie 3 requêtes de 200 résultats
  (guide des prix, `src/lib/price-guide/service.ts`), mises en cache par annonce seulement ; une page
  catégorie ou ville en envoie 5, refaites pour chacune des trois langues. Avec un seul vendeur, le
  jeu de test n'atteint jamais 5 vendeurs distincts : le guide interroge toujours les 3 zones.
- La règle « CPU sous 70 % » ne suffit pas comme signal : la VM était à 73 % au plus fort, mais le
  web était déjà saturé.
- N° 3 : les deux processus utilisent bien toute la limite du conteneur (1,45 cœur sur 1,5 au plus
  fort, contre 1 cœur pour un seul processus), mais chaque page réussie coûte environ 170 ms de CPU
  contre 80 ms le 30 octobre (calcul : cœurs utilisés divisés par pages réussies par seconde ; les
  rendus abandonnés par k6 comptent aussi). Le rendu est donc devenu environ deux fois plus cher
  entre `b087a23` et `c0f8b10` ; la cause exacte n'est pas mesurée (déduction : contenu ajouté à
  chaque page). La VM passe aussi au-dessus de 70 % (89 %).
- Profil du 2 novembre (même mesure que le 30 octobre : un serveur web profilé dans le conteneur
  du staging aux limites de la production, 900 pages hors cache, 6 à la fois) : **78 ms de CPU par
  page contre 55 ms** (+42 %), 13,3 pages/s contre 19,1. La hausse vient du rendu React (Next
  compilé : 25,8 s contre 15,2 s ; ramasse-miettes : 7,9 s contre 3,8 s) ; le code de l'application
  reste stable (11,2 s contre 11,8 s). L'index ne compte plus que 192 annonces (50 166 le 30 octobre), ce qui allège plutôt les recherches. Cause principale probable : le nouveau pied de page : environ 150 liens
  `<Link>` (chacun un composant client avec ses props dans la charge RSC), 49 Ko de HTML sur les
  130 Ko de balisage d'une page d'annonce. Il passe en liens `<a>` simples, style posé sur la `<nav>`.
  Le reste de l'écart entre ce profil (+42 %) et le n° 3 (environ deux fois) est une déduction non
  mesurée : moins de mémoire par processus avec deux processus (ramasse-miettes plus fréquent).
- Après ce changement (#250, même mesure, 2 novembre) : **66 ms par page** (78 avant, 55 le
  30 octobre), 15,8 pages/s ; page d'annonce de 326 à 264 Ko de HTML, pied de page de 49 à 27 Ko.
  La moitié de la hausse est reprise ; le reste vient des autres ajouts au rendu (non détaillé).
- N° 4 : le gain du profil se retrouve sous charge (145 ms de CPU par page réussie au lieu de 170),
  mais la capacité reste loin de l'objectif. Tenir 40 pages/s hors cache sur 1,5 cœur demanderait
  environ 37 ms de CPU par page sous charge, soit quatre fois moins qu'aujourd'hui et moins que le
  rendu du 30 octobre (55 ms hors charge) : déduction, l'objectif de la spec n'est pas atteignable sur
  la VM gratuite sans changer la façon de rendre les pages.
- N° 5 : le gain du profil (-22 %) se retrouve sous charge (-24 % de CPU par page réussie). Il
  reste trois fois trop de CPU pour 40 pages/s hors cache. Les 219 recherches en échec viennent,
  par déduction, du même chevauchement qu'au n° 4 : la phase de recherche démarre pendant que les
  pages en retard finissent (jusqu'à 60 s), sur le même processus web ; seules, les recherches
  restent à 0,3 cœur de web et 119 ms de médiane. Pas de passage de recherche seul pour le prouver.
- N° 6 : le gain du profil (-11 %) se retrouve sous charge (-10 % de CPU par page réussie). À
  sortie identique, il ne reste que des gains marginaux : le coût suit la taille de ce que React
  sérialise et rend par page. Atteindre 40 pages/s demanderait de changer ce qui est rendu (cartes
  plus légères, annuaire du pied de page hors du flux React) ou le modèle (cache plus long en
  bordure, rendu en flux), ou plus de CPU : décision du propriétaire.
- N° 7 : seule, la recherche tient l'objectif avec une large marge (p95 51 ms à 50/s, 234 ms à
  100/s). Les p95 de 917 ms à 1,50 s des n° 4 à 6 ne viennent donc pas de la recherche elle-même,
  mais de son chevauchement avec les pages en retard sur le même processus web, et du trajet runner
  GitHub (États-Unis), Cloudflare puis tunnel, que ce passage ne mesure pas (déduction : les deux
  causes ne sont pas séparées). Aucun correctif de la recherche n'est nécessaire ; la capacité de
  recherche suit celle du fil JavaScript du web, environ 100 recherches/s.

## Seuil de bascule

La production met les pages publiques anonymes en cache chez Cloudflare (`infra/cloudflare/cache-rules.json`,
TTL de l'origine) et en ISR : seuls les premiers passages et les revalidations arrivent au rendu.
Seuil retenu, en attendant un nouveau test : préparer la bascule (ou les améliorations ci-dessous)
quand les pages rendues par l'origine (HTML en `MISS` ou `EXPIRED` dans Cloudflare) dépassent
**8 par seconde** en pointe, environ 60 % de la saturation mesurée le 3 novembre (n° 6 : 14,1 pages/s ;
le seuil était de 7 après le n° 5, 6 après le n° 4, 5 après le n° 3 et 8 après le 30 octobre). Estimation, à refaire après chaque changement du rendu.

## Pistes avant un nouveau test

1. ~~Deux processus web~~ : fait (#232), la capacité de rendu suit, mais le gain est mangé par le coût
   par page (n° 3).
2. ~~Guide des prix en cache par comparables et zone, plus seulement par annonce ; pages catégorie et
   ville en cache entre langues~~ : fait (#280), avec les autres allègements du rendu (n° 5).
3. Profiler un rendu (`--cpu-prof` sur le staging) : environ 170 ms de CPU par page au 31 octobre,
   80 ms au 30. Fait le 2 novembre (voir « Lecture ») : le pied de page, allégé (#250).
