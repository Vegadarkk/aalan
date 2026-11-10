# Compte à rebours avant l'ouverture

Décision du propriétaire (5 nov. 2026) : la production est en ligne une dizaine de jours avant
l'ouverture, pendant la campagne sur les réseaux sociaux. Pendant ce temps le site est **fermé** :
l'accueil montre la porte d'Aalan, fermée, avec le temps restant ; à l'heure dite la porte s'ouvre
d'elle-même et le site apparaît. Pas d'inscription ni de dépôt avant l'ouverture.

Code : `src/lib/launch/gate.ts` (règles), `src/proxy.ts` (application), page
`src/app/[locale]/(closed)/ouverture`, composants `src/components/launch/`.

## Pendant la fermeture

| Demande | Réponse |
|---|---|
| `/fr`, `/ar`, `/rif` | La porte et le compte à rebours (gardés 1 min par Cloudflare) |
| `/{langue}/legal/...` | Les textes légaux, comme d'habitude |
| Toute autre page | Redirection 307 vers l'accueil de la langue, jamais mise en cache |
| API publique | 503 `{"error":"closed"}`, sauf `health`, `config`, `csp-report`, `preview`, `webhooks/*`, `auth/logout` |
| `admin.aalan.ma` | Inchangé : modération, back-office et graines d'annonces restent possibles |

À zéro, la page joue l'ouverture de la porte puis se recharge. Si Cloudflare sert encore l'ancienne
copie (une minute au plus), la page affiche « La porte s'ouvre… » et réessaie seule.

## Réglages (fichier `app.env` de la production, sans nouvelle image)

| Variable | Valeur | Effet |
|---|---|---|
| `OPENS_AT` | `2026-11-20T10:00:00+01:00` (date ISO avec fuseau) | Ferme le site jusqu'à cet instant. Vide = ouvert. Une valeur mal écrite empêche le démarrage. |
| `PREVIEW_SECRET` | 32 à 128 lettres et chiffres | Active l'aperçu de l'équipe (ci-dessous). Vide = aucun aperçu. |
| `BRAND_SOCIAL_LINKS` | `instagram=aalan_ma tiktok=@aalan_ma facebook=61596493192279 x=Aalan_maroc` (les comptes de la page d'attente) | Liens vers les comptes d'Aalan sous le compte à rebours. Vide = pas de liens. |

Les valeurs sont lues au démarrage du conteneur : après un changement, relancer le service `web`
(synchronisation `scripts/oracle-vm.ts`). Le Maroc est à UTC+1 hors ramadan, UTC+0 pendant : écrire
le fuseau en vigueur le jour de l'ouverture.

## Aperçu de l'équipe avant l'ouverture

1. Ouvrir `https://aalan.ma/api/preview?cle=<PREVIEW_SECRET>` : un cookie `__Host-preview`
   (30 jours) laisse passer ce navigateur, site et API compris.
2. `https://aalan.ma/api/preview?fin` retire le cookie. Changer `PREVIEW_SECRET` révoque tous les
   aperçus.
3. Prérequis : la règle de cache Cloudflare qui ignore les requêtes portant ce cookie
   (`infra/cloudflare/cache-rules.json`, `node scripts/cloudflare.ts zone --apply`, appliquée le
   10 nov. 2026 sur joutiya.ma, aalan.ma et a3lan.ma ; `zone --check` le vérifie). Sans elle, une
   page vue en aperçu pourrait être mise en cache pour le public.

## Le jour de l'ouverture

Rien à faire : à l'instant `OPENS_AT`, le site s'ouvre seul. Ensuite `OPENS_AT` peut être vidé à
la prochaine mise à jour de `app.env`.
