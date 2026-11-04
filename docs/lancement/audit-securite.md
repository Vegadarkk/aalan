# Audit de sécurité avant lancement (D18)

Procédure : `docs/lancement/securite.md`. Audit du 4 novembre 2026, code de `main` à `293df8d`
(revue), corrections dans la PR #347.

## Synthèse

- **Scan ZAP actif du staging** : aucune alerte haute, aucune règle `FAIL` déclenchée.
- **Revue manuelle** (4 revues Opus en parallèle : comptes et rôles, paiements et Pro, contenus et
  accès aux objets, plateforme) : aucune faille critique ni haute. 9 moyennes, 19 basses et 5 notes ;
  15 sont corrigées dans la PR #347 et 3 dans la PR suivante, les autres sont justifiées ci-dessous ou attendent une
  décision.
- **HTTP Observatory** : à mesurer sur la production à l'ouverture (`scripts/launch-check.ts`).

## 1. Scan ZAP

| | Date | Run | Haute | Moyenne | Basse | Info | FAIL |
|---|---|---|---|---|---|---|---|
| Full scan actif, staging | 4 nov. 2026, 17:01-18:00 UTC | [41873433402](https://github.com/Vegadarkk/aalan/actions/runs/41873433402) | 0 | 2 | 8 | 9 | 0 |
| Dernier baseline passif, staging | 2 nov. 2026 | [41512570791](https://github.com/Vegadarkk/aalan/actions/runs/41512570791) | 0 | — | — | — | 0 |

- Code du scan : `main` à `293df8d`, image ZAP 2.17.0 épinglée.
- Sortie du scan : 138 règles passées, 4 avertissements nouveaux, 1 règle ignorée (`10202`,
  CSRF par en-tête), 0 `FAIL`.
- Les instances `FAIL` listées dans le journal (`10021`, `10035` sur `/cdn-cgi/styles/*` et
  `/sitemap.xml`) sont des réponses de Cloudflare hors périmètre (`.zap/rules.tsv`) : elles ne
  comptent pas, la règle `OUTOFSCOPE` les filtre.
- Limite : trois merges sur `main` (17:43 à 17:53 UTC) ont pu redéployer le staging pendant la
  fin du scan ; un redémarrage des conteneurs fait échouer les requêtes de ce moment-là.
  Un second scan actif après le merge de #347 confirme les corrections (section 5).
- Détail des 2 alertes moyennes : dans le rapport chiffré (artefact `zap-full-staging`, clé age des
  sauvegardes, PC2). Leur suite est ajoutée ici dès la lecture du rapport.

## 2. Revue manuelle : corrigé dans la PR #347

| Id | Niveau | Constat | Correction |
|---|---|---|---|
| A-1 | Moyen | Prise de compte avant activation : quelqu'un s'inscrit avec l'adresse d'un autre et son propre mot de passe ; le vrai titulaire clique le lien depuis un autre appareil et active un compte dont l'attaquant garde le mot de passe. | Depuis un autre appareil que celui de l'inscription, le lien demande le mot de passe du compte (mêmes verrous et Turnstile que la connexion) avant d'appliquer le code. Le vrai titulaire passe par « Mot de passe oublié », qui écrase le mot de passe de l'attaquant. |
| A-2 | Bas | La déconnexion acceptait un cookie révoqué et révoquait toutes les sessions (déconnexion forcée répétée avec un vieux cookie volé). | Vérification avec révocation avant de tout révoquer. |
| A-4 | Bas | Déconnexion, changement et réinitialisation du mot de passe ne fermaient pas le flux de messages ouvert (jusqu'à ~31 min). | `publishRevoked` après chaque révocation. |
| P-1 | Moyen | Un Pass Boutique en cours servait d'essai gratuit à n'importe quelle offre, avec les crédits accordés avant tout paiement (Pass Essentiel 299 DH → Business + 100 crédits, annulé avant la fin). | L'essai ne vaut que pour l'offre du pass ; une autre offre est facturée tout de suite. Un abonnement en essai n'accorde aucun crédit. Texte de la page des offres mis à jour (FR/AR/RIF). |
| P-2 | Moyen | Remboursement ou litige d'un Pass : le pass et ses crédits restaient. | `charge.refunded` et `charge.dispute.created` traités (PaymentIntent relu, `kind: pass`, environnement et compte vérifiés). Remboursement total : fin du pass, crédits remis à 0, alerte P1. Remboursement partiel ou litige : alerte P1, décision de l'équipe. |
| P-4 | Bas | Les événements Stripe de test d'un autre environnement levaient des alertes P1 « client inconnu » qui noyaient les vraies. | Événement d'un autre `env` écarté avant l'enregistrement. |
| C-1 | Moyen | La modification d'une annonce publiée ne repassait pas par la modération IA (publier propre, puis remplacer le texte ou les photos). | Écran IA relancé après une modification du contenu, et à la reprise d'une annonce en pause. |
| C-2 | Moyen | Une annonce signalée ou sous blocage légal pouvait être réécrite avant la revue (preuve perdue). | Contenu modéré gelé tant qu'un signalement ou un blocage est ouvert (409 `listing_under_review`, message FR/AR/RIF). |
| C-5 | Bas | Bloquer un acheteur n'empêchait pas d'afficher le téléphone du vendeur. | Blocage dans un sens ou l'autre : même réponse que « pas de numéro ». |
| C-6 | Bas | Les messages restaient livrés à un compte suspendu, banni ou fermé. | Livraison refusée (`conversation_unavailable`). |
| D-1 | Moyen | `/api/webhooks/*` échappait à la seule limite de débit (Cloudflare) et l'app n'en avait pas : inondation possible, jusqu'à 1 Mio lu avant la signature. | Limite Cloudflare rétablie pour les webhooks (sans défi navigateur) et limite app par IP (`webhook.ip`, 120/min) avant la lecture du corps. |
| D-4 | Bas | Le texte écrit dans une photo pouvait orienter la modération IA (images hors des balises « non fiables »). | Règle explicite : tout texte d'image est du contenu utilisateur ; `PROMPT_GENERATION` 3. |
| D-6 | Bas | `/api/health` public et non limité, 4 appels Valkey/Meilisearch par requête. | Résultat mis en cache 5 s. |
| D-7 | Bas | `/api/csp-report` : fenêtre d'échantillonnage partagée par tous, champs journalisés non typés. | Limite par IP (`csp.report.ip`) et champs typés et tronqués. |
| D-9 | Bas | `.dockerignore` sans une partie des motifs de secrets. | Motifs de `.gitignore` repris. |
| A-3 | Bas | Changer de mot de passe n'exigeait pas Turnstile après 20 échecs par heure sur le compte (test de mots de passe avec une session volée). | Changement refusé (429) jusqu'à la fin de l'heure ; la réinitialisation par mail reste possible. PR suivante. |
| A-5 | Bas | Les limites d'inscription « par appareil » ne tiennent pas face à un script (un cookie neuf à chaque requête). | Limite quotidienne par IP (`signup.ip.day`, 150/jour, réglable dans `config/abuse`). PR suivante. |
| D-5 | Bas | Un paramètre de requête au hasard contournait le cache sur l'accueil et les pages publiques non comptées (aide, textes légaux, tarifs…). | Redirection 308 vers l'adresse sans paramètre sur ces pages, comme pour les catégories. PR suivante. |
| — | — | Un test unitaire a appelé l'API Stripe avec une clé du shell cloud qui n'appartient pas à Aalan (lecture, clé expirée, refus 401, rien modifié). | Les tests unitaires effacent les variables de secrets au démarrage (`tests/unit/setup-env.ts`). |

## 3. Constats non corrigés

### Décisions à prendre

| Id | Niveau | Constat | Recommandation |
|---|---|---|---|
| C-4 | Moyen | Deux comptes neufs (appareil et IP différents) suffisent au signal « multi » d'un signalement : un signalement P0 « menace » restreint un compte et masque ses annonces ; un vendeur et un faux compte peuvent masquer un avis négatif. | Ne compter que les signaleurs vérifiés (âge du compte, téléphone ou historique), et aucune restriction automatique sur un profil ou un avis sans revue humaine. Écart à la spec §7 : accord du propriétaire. |
| C-3 | Moyen | Les photos des annonces refusées ou masquées restent publiques jusqu'à 12 mois (seules les annonces supprimées passent en privé), et le cache d'un an ne se purge pas. Les photos de brouillon sont publiques dès l'envoi, avec le seul contrôle ONNX. | Passer en privé les photos des annonces refusées et masquées, raccourcir le `max-age`, purger le cache Cloudflare au retrait (le #340 purge déjà les photos supprimées). |
| P-3 | Moyen | Le badge « agrément contrôlé » de location de voitures est accordé par l'IA seule ; la référence comparée est saisie par la boutique. | Confirmation par un modérateur. Le #350 exige déjà l'ICE pour le badge. Décision n° 5 du propriétaire : à revoir. |
| D-8 | Bas | `infra/targets.json` publie des identifiants internes (OCID, comptes et zones Cloudflare, tags Access, comptes Stripe) dans le dépôt public. Ce ne sont pas des secrets : aucun ne donne accès seul. | Accepter : les retirer maintenant ne les dépublie pas (forks, historique). Le dépôt redevient privé à l'ouverture. |

### Risques acceptés ou reportés

| Id | Niveau | Constat | Suite |
|---|---|---|---|
| C-7 | Bas | Un avis est « vérifié » dès une seule réponse du vendeur, sans âge de compte ni téléphone. | Avec C-4 (même règle de confiance). |
| P-5 | Bas | Un litige gagné sur un pack ne rend pas les crédits. | Correction manuelle par l'équipe d'ici là (rare). |
| P-6 | Bas | Retrait puis litige total : le compte n'est ni débité ni gelé. | Alerte RevenueCat ; à coder avant l'ouverture des ventes. |
| P-7 | Bas | Une page de paiement reste payable 24 h après la suspension d'une boutique. | Expirer les sessions ouvertes à la suspension, avant l'ouverture des ventes. |
| P-8 | Info | Les passes ne se terminent pas tant que les ventes sont fermées. | Voulu. |
| D-2 | Bas | Le DSN Sentry public (navigateur) permet d'épuiser le quota mensuel. | Limites par clé et protection contre les pics dans Sentry (Nav). |
| D-3 | Bas | Les hôtes AdSense (dont un joker) restent dans le `script-src` des pages à CSP par hash. | Ne gêne que si une injection HTML existe déjà ; à resserrer avec l'activation d'AdSense. |
| H-1 à H-4 | Info | Défense en profondeur : routes aux extensions statiques hors proxy, GET à effet de bord (lu, budget de lecture), pas de connexion récente pour les actions sensibles du personnel (Access vérifié à chaque requête), délai uniforme de 600 ms à l'inscription. | Aucun exploit aujourd'hui. |

## 4. Contrôles vérifiés et conformes

- **Rôles et sessions** : 137 fichiers de routes relus. Chaque écriture de membre passe par
  `requireUser({ mutation: true })` (Origin exact, jeton CSRF signé, révocation). Chaque route
  d'administration passe par `requireStaff` (hôte admin, JWT Access vérifié par l'app, rôles).
  Cookies `__Host-`, HttpOnly, Secure. Rôle `individual` seulement après vérification de
  l'adresse, `pro` seulement après décision KYBC du personnel. Règles Firestore : tout refusé.
- **Paiements** : signatures Stripe, RevenueCat, Svix et WhatsApp vérifiées sur le corps brut,
  en temps constant, avec tolérance de 300 s. Chaque événement n'est traité qu'une fois, et seul
  son id fait foi : l'état est relu chez Stripe ou RevenueCat. Prix lus côté serveur.
  `salesEnabled` contrôlé côté serveur sur chaque achat. Portefeuille transactionnel. Factures
  limitées au client Stripe de la boutique.
- **Contenus** : contrôle du propriétaire sur chaque route d'annonce (404) ; conversations,
  rendez-vous et réservations contrôlés dans la transaction. Le flux SSE est limité à
  l'utilisateur de la session. Envois de photos : URL présignée de 5 min, type réel lu dans les
  octets, `sharp` durci (pas de SVG, 64 MP au plus), EXIF et GPS retirés au réencodage.
  Recherche : valeurs échappées. JSON-LD échappé.
- **Plateforme** : CSP par nonce et `strict-dynamic` sur les pages privées, par hash sur les
  pages publiques, `default-src 'none'` sur l'API. HSTS preload, XFO, nosniff, CORP, COOP et
  Permissions-Policy présents. Aucun en-tête CORS. Routes `/api/dev` en 404 hors `APP_ENV=dev`.
  Liens des mails bâtis sur `SITE_URL`, jamais sur l'en-tête Host. Aucune requête vers une URL
  fournie par un utilisateur (pas de SSRF). Conteneurs non root, en lecture seule, sans port
  publié. Actions GitHub épinglées par SHA, pas de `pull_request_target`.

## 5. À faire après le merge

1. `scripts/cloudflare.ts zone --apply` : la limite de débit des webhooks sur l'edge. Ensuite,
   un webhook de test par fournisseur doit répondre 200.
2. Avant l'ouverture des ventes : `scripts/stripe-setup.ts <staging|prod> --apply` (clé
   `AALAN_STRIPE_SETUP_KEY` du propriétaire), pour que les webhooks reçoivent
   `charge.refunded` et `charge.dispute.created`.
3. Un second scan ZAP actif du staging, hors déploiements, pour confirmer les corrections.
4. HTTP Observatory sur la production à l'ouverture : note A ou A+.
