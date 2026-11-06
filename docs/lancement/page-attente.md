# Page d'attente d'aalan.ma (avant la production)

Le lien aalan.ma est déjà publié sur TikTok, Instagram et Facebook depuis le 6 nov. 2026, alors
que la production ne tourne pas encore : le tunnel de production n'a pas de serveur et Cloudflare
répondait « 530 ». En attendant, un petit Worker Cloudflare, `aalan-attente`, sert une page fixe sur
`aalan.ma/*`, devant le tunnel :

- la porte d'Aalan fermée, « Bienvenue sur Aalan », « Bientôt » à la place du compte à rebours,
  les liens TikTok et Instagram, en français (`/`, `/fr`) et en arabe (`/ar`) ;
- l'éditeur, l'hébergeur de la page (Cloudflare) et le contact `reseaux@aalan.ma` ; aucun cookie,
  aucun script, aucune donnée collectée ;
- toute autre adresse renvoie vers l'accueil de sa langue ; `/api/*` répond 404 ;
- `noindex` : les moteurs attendent le vrai site.

`admin.aalan.ma`, `staging.aalan.ma` et les autres sous-domaines ne passent pas par ce Worker.
`www.aalan.ma` redirige déjà vers `aalan.ma`. Gratuit (offre Workers Free, 100 000 requêtes par
jour).

## Fichiers

- `workers/holding-page/index.js` : le Worker (routes, en-têtes de sécurité).
- `workers/holding-page/site/` et `manifest.js` : la page, sa feuille de style et ses polices,
  générées par `workers/holding-page/build.mjs` à partir de la page de compte à rebours de
  l'application (`src/app/[locale]/(closed)/ouverture`) rendue par un `next dev` local avec
  `OPENS_AT` et `BRAND_SOCIAL_LINKS`.
- `scripts/holding-page.ts` : envoi du Worker et de la route (essai à blanc sans `--apply`).

## Commandes

```sh
NODE_USE_ENV_PROXY=1 node scripts/holding-page.ts            # essai à blanc
NODE_USE_ENV_PROXY=1 node scripts/holding-page.ts --apply    # publie ou met à jour
NODE_USE_ENV_PROXY=1 node scripts/holding-page.ts --remove --apply   # retire route et Worker
```

Jeton : `AALAN_CLOUDFLARE_API_TOKEN`. Le script ne touche qu'au Worker `aalan-attente` et à la route
`aalan.ma/*`, et refuse si la route pointe déjà ailleurs.

## À la mise en production

Retirer la page **avant** de vérifier la production sur aalan.ma : tant que la route existe, le
Worker répond à la place du tunnel (`--remove --apply`). La page de compte à rebours de
l'application (`docs/lancement/compte-a-rebours.md`) prend ensuite le relais.

## Changer un lien ou un texte

Les textes de la page d'attente sont dans `build.mjs` (`TEXT`) ; les liens des réseaux viennent de
`BRAND_SOCIAL_LINKS` au moment du rendu local. Régénérer, vérifier, puis `--apply`.
