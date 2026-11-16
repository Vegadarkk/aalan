# VM spare-micro-1 (sonde et copie hors Cloudflare)

La deuxième VM gratuite d'Oracle (E2.1.Micro : 1 Go de mémoire, 1/8 de cœur garanti, disque de 50 Go,
`eu-paris-1`, compartiment du projet) travaille pour Aalan depuis le 11 novembre 2026. Code :
`infra/micro/`, commandes : `scripts/micro-vm.ts`. `spare-micro-2` n'est jamais touchée.

## Ce qu'elle fait

- **Sonde de aalan.ma, chaque minute** : `/api/health` (doit répondre `"status":"ok"`), le guide
  `/fr/demarches`, la redirection de `www` et la porte Access de `admin`. Elle tourne chez Oracle, donc
  hors de Cloudflare Workers (où tourne la sonde principale) et hors de `aalan-vm` : elle voit une
  panne que la sonde principale manquerait si son Worker s'arrêtait. Historique : 35 jours.
- **Copie de secours, chaque nuit à 05:15 UTC** (après la sauvegarde de 03:30) :
  - les sauvegardes Firestore et Auth (`backups/` du bucket privé de production), **déjà chiffrées**
    avec age : la VM ne les déchiffre jamais, la clé reste chez vous hors ligne. Gardées 98 jours,
    comme sur R2.
  - les photos publiques (bucket média de production). Une photo effacée sur R2 reste 30 jours dans la
    copie, puis disparaît (les suppressions demandées par les membres finissent par s'appliquer).
  - Plafond : 30 Go sur la VM.
  - Pourquoi : R2 est dans le compte Cloudflare partagé avec Punk Records. Une erreur sur ce compte, un
    blocage ou une suppression par erreur n'emporte plus tout.
- **Rapport** : `node scripts/micro-vm.ts report` donne les résultats de la sonde sur 24 h, l'état de la
  copie, le certificat de aalan.ma, le disque et les mises à jour, puis `verdict ok` ou
  `verdict ALERT <raisons>`. Le fil « Surveiller les alertes du site » le lit.

## Sécurité

- Aucun port ouvert : la liste de sécurité du VCN n'a aucune règle d'entrée. Aucune clé SSH sur la VM,
  mot de passe SSH désactivé.
- Seul accès : OCI Run Command (le compte de service `ocarun`, sans sudo), réservé par Oracle IAM au
  compte de Claude, dans le compartiment du projet.
- Aucun lien avec `aalan-vm` : pas de clé partagée, pas de flux entre elles (aucune règle d'entrée).
- Un seul secret : une clé R2 en **lecture seule**, limitée aux buckets `aalan-prod-private` et
  `aalan-prod-media` et à l'adresse IP de la VM, dans un fichier lisible par `ocarun` seulement. Elle
  peut lire tout le bucket privé (pièces des comptes Pro comprises : R2 ne limite pas un jeton à un
  préfixe), mais la copie ne prend que `backups/`.
- Mises à jour de sécurité automatiques d'Ubuntu (déjà actives). Le redémarrage quand le noyau le
  demande : `node scripts/micro-vm.ts reboot --apply` (le rapport l'indique).
- `rclone` est une version publiée vérifiée par SHA-256 (`infra/micro/install.sh`).

## Restaurer depuis la copie

La répétition de restauration et une restauration normale lisent R2 (voir [backups.md](backups.md)). La
copie de la VM sert seulement si R2 ou Cloudflare ne répond plus.

Dans ce cas, la VM n'a aucun port ouvert. Il faut donc qu'elle envoie elle-même le dossier
`/var/lib/ocarun/aalan/mirror/backups` vers un dépôt temporaire hors Cloudflare. Le plus simple est
Oracle Object Storage (gratuit jusqu'à 20 Go), par une URL d'écriture à durée courte (« pre-authenticated
request ») :

1. Nav crée dans le compartiment du projet un bucket privé `aalan-restore-<date>` et deux URL
   pré-authentifiées valables 24 h : une en écriture (pour la VM), une en lecture (pour le PC2).
2. Claude lance sur la VM, par OCI Run Command, un `tar` du dossier envoyé avec `curl -T` vers l'URL d'écriture. Les
   fichiers sont déjà chiffrés : rien ne sort en clair.
3. Sur le PC2, Nav télécharge l'archive avec l'URL de lecture et la décompresse. Ensuite
   `restore-firestore.ts --identity <clé age> --from <dossier>`, comme dans backups.md.
4. Nav supprime ensuite les URL et le bucket.

## Commandes

```
NODE_USE_ENV_PROXY=1 node scripts/micro-vm.ts status
NODE_USE_ENV_PROXY=1 node scripts/micro-vm.ts sync --apply        # après un changement de infra/micro
NODE_USE_ENV_PROXY=1 node scripts/micro-vm.ts report
NODE_USE_ENV_PROXY=1 node scripts/micro-vm.ts r2-keys --apply     # AALAN_R2_MICRO_* dans l'environnement
NODE_USE_ENV_PROXY=1 node scripts/micro-vm.ts mirror-now --apply
NODE_USE_ENV_PROXY=1 node scripts/micro-vm.ts reboot --apply
```
