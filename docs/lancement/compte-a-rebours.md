# Compte à rebours avant l'ouverture

Décision du propriétaire (5 nov. 2026) : la production est en ligne une dizaine de jours avant
l'ouverture, pendant la campagne sur les réseaux sociaux. Pendant ce temps le site est **fermé** :
l'accueil montre la porte d'Aalan, fermée, avec le temps restant ; à l'heure dite la porte s'ouvre
d'elle-même et le site apparaît. Pas de dépôt avant l'ouverture. Les inscriptions ouvrent 24 h avant
(décision du 16 novembre 2026) : création de compte, connexion, réglages, vérification du téléphone
et demandes Pro ; l'accueil montre alors « Créer mon compte ». Annonces, recherche et messagerie
attendent l'ouverture (`src/lib/launch/gate.ts`, phase `signup`). La liste d'ouverture reçoit ses
e-mails à J-7, J-1 (avec l'ouverture des inscriptions) et le jour J
(`src/worker/jobs/newsletter-campaigns.ts`).

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
| `OPENS_AT` | `2026-12-12T10:00:00+00:00` (date ISO avec fuseau ; ouverture le samedi 12 décembre, 10 h au Maroc) | Ferme le site jusqu'à cet instant. Vide = ouvert. Une valeur mal écrite empêche le démarrage. |
| `PREVIEW_SECRET` | 32 à 128 lettres et chiffres | Active l'aperçu de l'équipe (ci-dessous). Vide = aucun aperçu. |
| `PRO_INVITE_CODE` | 16 à 64 lettres et chiffres (exige `PREVIEW_SECRET`) | Active le lien d'invitation des boutiques Pro (ci-dessous). Vide = aucune invitation. |
| `BRAND_SOCIAL_LINKS` | `instagram=aalan_ma tiktok=@aalan_ma facebook=61596493192279 youtube=https://www.youtube.com/@aalan_ma x=Aalan_maroc` (dans l'ordre d'affichage) | Liens vers les comptes d'Aalan sous le compte à rebours. Vide = pas de liens. |

Les valeurs sont lues au démarrage du conteneur : après un changement, relancer le service `web`
(synchronisation `scripts/oracle-vm.ts`). Le Maroc est à UTC+0 depuis le 21 septembre 2026 (tzdata
2026e) : 10 h au Maroc = `10:00:00+00:00` = 11 h à Paris en hiver. Vérifier le fuseau en vigueur le
jour de l'ouverture avant d'écrire la date.

Facebook : la Page n'a pas encore de nom d'utilisateur. Le lien prend l'identifiant de profil de la
Page (`61596493192279`, celui de `facebook.com/profile.php?id=...`), jamais l'identifiant Graph
(`1494912697030724`), qui n'est pas l'adresse publique de la Page. Quand la Page aura un nom, écrire
`facebook=<nom>`.

## Aperçu de l'équipe avant l'ouverture

1. Ouvrir `https://aalan.ma/api/preview?cle=<PREVIEW_SECRET>` : un cookie `__Host-preview`
   (30 jours) laisse passer ce navigateur, site et API compris.
2. `https://aalan.ma/api/preview?fin` retire le cookie. Changer `PREVIEW_SECRET` révoque tous les
   aperçus.
3. Prérequis : la règle de cache Cloudflare qui ignore les requêtes portant ce cookie
   (`infra/cloudflare/cache-rules.json`, `node scripts/cloudflare.ts zone --apply`, appliquée le
   10 nov. 2026 sur les trois zones du projet ; `zone --check` le vérifie). Sans elle, une
   page vue en aperçu pourrait être mise en cache pour le public.

## Boutiques Pro invitées avant l'ouverture

Décision du 24 nov. 2026 : les boutiques qui acceptent l'invitation remplissent leur boutique avant
le 12 décembre.

1. Le mail de prospection porte `https://aalan.ma/api/preview?pro=<PRO_INVITE_CODE>` (ajouter
   `&langue=ar` pour l'arabe). Le lien pose le cookie `__Host-preview` (30 jours, même règle de
   cache que l'aperçu) puis ouvre l'inscription, et ensuite l'espace Pro.
2. Ce cookie ouvre seulement l'inscription, la connexion, les réglages, la vérification du
   téléphone (WhatsApp), l'espace Pro (demande, pièces, stock, flotte, départs), le dépôt et
   « Mes annonces ». La recherche, la messagerie, les favoris, le porte-monnaie et toutes les pages
   publiques (annonces, boutiques) restent fermés jusqu'à `OPENS_AT`.
3. Tant que le site est fermé, seul un compte Pro validé (dossier KYBC accepté dans l'admin) crée,
   duplique ou publie une annonce et envoie des photos. Un lien transféré à un particulier ne lui
   permet donc pas de publier (erreur `posting_closed`).
4. Une annonce publiée avant l'ouverture garde sa date de publication, mais sa durée de vie part de
   l'ouverture. Les 6 mois offerts d'une boutique validée avant l'ouverture partent eux aussi de
   l'ouverture.
5. Le cookie vaut pour un navigateur : un pro qui change d'appareil rouvre le lien du mail. Changer
   `PRO_INVITE_CODE` (ou `PREVIEW_SECRET`) révoque toutes les invitations.

## Le jour de l'ouverture

Rien à faire : à l'instant `OPENS_AT`, le site s'ouvre seul. Ensuite `OPENS_AT` peut être vidé à
la prochaine mise à jour de `app.env`.
