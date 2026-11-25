# AquaSafe — Guide de développement backend (pilote, 12 semaines)

Sources : cahier des charges MOA v1.0 (20 oct. 2026), dossier AQUA-1 (6 nov. 2026), analyse de la plateforme (sept. 2026), notes de conception.
Tags de confiance : **[Certain]** = écrit dans les documents ; **[Likely]** = déduction solide ; **[Guessing]** = hypothèse à faire valider.

---

## 0. À lire avant d'écrire une ligne

1. **[Certain] Les 25 entités d'AQUA-1 ne couvrent pas le périmètre M du CDC.** Il manque : paiement, reçu, enveloppe/subvention, délégation de validation (EF-18), notification (EF-31), organisation (EF-33/34), document (EF-07), lignes de grille, lignes de résultat par paramètre, transitions de certificat. Le schéma Prisma livré contient les 25 + 12 extensions marquées `[EXT]`. Fais valider ce delta par la MOA **avant** le lot 1 : le CDC dit « tout ce qui n'y figure pas est hors du prix », et la liste de 25 y est citée comme engagement.
2. **[Certain] Le front Angular existe déjà** (aquasafe.enlighteninnovation.com, AQUA-1 : « Angular 21 existant »). Je n'ai pas pu inspecter ses appels réseau. Avant de figer l'API : ouvre l'onglet Réseau, liste les endpoints que le front appelle déjà (ou ses mocks), et aligne `openapi.yaml` dessus, ou documente l'écart pour le dev front. Sinon tu livres une API que personne ne consomme.
3. **[Certain] Des décisions MOA/MINEE bloquent des morceaux entiers** (§11). Le CDC lui-même repousse le démarrage tant qu'elles ne sont pas tranchées. Code autour avec des paramètres, jamais avec des valeurs en dur.

---

## 1. Stack (déjà arbitrée dans AQUA-1)

| Couche | Choix | Notes |
|---|---|---|
| API | NestJS (TypeScript), monolithe modulaire | `@nestjs/swagger` pour générer l'OpenAPI depuis le code |
| BD | PostgreSQL 16 + PostGIS | triggers d'intégrité : `prisma/sql/001_integrity.sql` |
| ORM | Prisma | Version actuelle = 7 : `url` dans `prisma.config.ts`, client avec adaptateur `@prisma/adapter-pg`. Les colonnes `geometry` passent par `$queryRaw` |
| Stockage | MinIO (S3) ou volume chiffré | clés d'objet opaques, URL signées courtes |
| Auth | JWT court + refresh rotatif, TOTP (otplib), codes SMS pour propriétaires | argon2id pour les mots de passe |
| PDF / QR | `pdf-lib` + `qrcode` | PDF filigrané FR/EN |
| Images | `sharp` (contrôle serveur, re-compression si > 200 Ko) | le client compresse déjà, ne lui fais pas confiance |
| Jobs | `@nestjs/schedule` + table `notifications` | pas de Redis : volume pilote, 1 serveur |
| Rate-limit | `@nestjs/throttler` (mémoire) | suffisant en mono-instance |
| Tests | Jest + Supertest + testcontainers (PostGIS) | 1 e2e par règle de la matrice (EF-01) |

Paquets : `@nestjs/{common,core,platform-express,config,swagger,jwt,schedule,throttler}`, `@prisma/client`, `@prisma/adapter-pg`, `class-validator`, `class-transformer`, `argon2`, `otplib`, `pdf-lib`, `qrcode`, `sharp`, `@aws-sdk/client-s3`, `csv-parse`, `exceljs`, `helmet`, `nestjs-pino`.

### Structure du dépôt

```
backend/
  prisma/ schema.prisma · sql/001_integrity.sql · seed.ts · migrations/
  src/
    main.ts · app.module.ts
    config/                      # validation des variables d'env (zod/joi), échec au démarrage si manquant
    common/
      guards/  jwt-auth · roles · scope (périmètre) · strong-auth (TOTP < 10 min)
      decorators/ @Roles() @Public() @StrongAuth() @CurrentUser() @Audited()
      filters/  problem-details.filter.ts   # RFC 7807 + code métier
      interceptors/ audit.interceptor.ts · no-store.interceptor.ts
      i18n/ fr.json en.json
    prisma/ prisma.service.ts
    modules/
      auth/  users/  geo/  ouvrages/ (+ sie-import)  documents/ (storage)
      demandes/  tarifs/ (grilles)  paiements/  prelevements/ (+ sync)
      normes/  analyses/ (+ PV, amendements, contre-analyses)
      certificats/ (+ qr, pdf, transitions)  validations-minee/ (+ délégations)
      signalements/  subventions/  annuaire/ (laboratoires, organisations, rapports)
      notifications/ (+ providers sms/email)  dashboard/  audit/  public/  health/
      jobs/ (expiration, alertes, relances, purge)
  test/ e2e par exigence (ef01.e2e-spec.ts …)
  scripts/ backup.sh · restore.sh
```

---

## 2. Modèle de données — vue d'ensemble

Détail dans `prisma/schema.prisma`. Légende : ● AQUA-1 (25), ◐ extension à valider.

| Domaine | Entités |
|---|---|
| Comptes & sécurité | ● User, UserAuthCode, TotpSecret, BackupCode · ◐ UserCommuneScope |
| Référentiel géo | ● Region, Commune |
| Ouvrages | ● Ouvrage, SieImportHistory, DossierNumerique, OuvragePublicView (vue SQL) · ◐ Document |
| Chaîne | ● DemandeCertification, Laboratoire, Prelevement, PrelevementSyncQueue |
| Normes & analyses | ● NormeReferentiel, NormeSeuil, AnalyseResultat, ProcesVerbal, AnalyseAmendement, ContreAnalyse · ◐ AnalyseValeur |
| Certification | ● Certificat, QrToken · ◐ CertificatTransition |
| Alertes | ● Signalement · ◐ Notification |
| Finance | ● GrilleTarifaire · ◐ GrilleTarifaireLigne, Paiement, Recu, EnveloppeSubvention, Subvention |
| Acteurs | ◐ Organisation, RapportIntervention, DelegationValidation |
| Intégrité | ● AuditLog |

Points de conception à respecter :
- **Le certificat est l'objet central** (EF-19) : jamais de colonne « certifié » sur l'ouvrage comme source de vérité. `Ouvrage.status` est un cache recalculé par le service des certificats ; la vue publique recalcule depuis `certificats`.
- **« Expirant » n'est pas un état stocké** (le CDC liste 6 états sans lui) : champ dérivé `validUntil - now <= 60 j`.
- **Référentiel versionné** : `Certificat.referentielId` et `AnalyseResultat.referentielId` figent la version utilisée ; un trigger interdit de modifier les seuils d'une version publiée (EF-36).
- **Un seul certificat vivant par ouvrage** : index unique partiel (EMIS/ACTIF/SUSPENDU).
- **Argent en entiers FCFA**, jamais de flottants.
- **Snapshot du tarif** sur la demande à la soumission : une grille modifiée plus tard ne change pas une demande en cours.
- `OuvragePublicView` : liste fermée de champs, ne jamais l'élargir sans revue MOA (EF-06, EF-24).
- Les migrations Prisma ne créent ni la colonne `geometry`, ni les triggers, ni la vue, ni les séquences : après `prisma migrate dev --create-only`, colle `001_integrity.sql` dans la migration, puis applique.

---

## 3. Machines à états (à implémenter comme services à transitions explicites)

Règle : toute transition = (garde de rôle/périmètre) + (précondition métier) + (écriture d'état) + (AuditLog) **dans une seule transaction**. Aucun `UPDATE status` hors du service propriétaire de l'entité.

### 3.1 Demande de certification
```
BROUILLON ──submit──▶ SOUMISE ──commune OK──▶ VALIDEE_COMMUNE ──┬─ tarif net = 0 ─────────────▶ PRELEVEMENT_PLANIFIE
   │                     └─ commune KO ─▶ REJETEE               └─ sinon ▶ EN_ATTENTE_PAIEMENT ─ règle de déblocage ▶ PRELEVEMENT_PLANIFIE
PRELEVEMENT_PLANIFIE ─ prélèvement ▶ PRELEVE ─ réception labo ▶ EN_ANALYSE ─ analyse soumise ▶ ANALYSE_SOUMISE
ANALYSE_SOUMISE ─ CONFORME ▶ EN_VALIDATION_MINEE ─ valider ▶ CERTIFIEE
                └─ NON_CONFORME ▶ NON_CONFORME ─ contre-analyse ▶ EN_CONTRE_ANALYSE ─ favorable ▶ EN_VALIDATION_MINEE
Annulation (ANNULEE) possible jusqu'à PRELEVE inclus ; rejet MINEE → REJETEE.
```
Étape affichée (1..6) = fonction pure de `status` (table de correspondance dans le code, pas en base). [Guessing] : Soumission · Validation commune · Paiement · Prélèvement · Analyse · Validation MINEE/certificat. Aligne avec le front.

Préconditions clés : `submit` exige un laboratoire choisi (EF-09), une grille ACTIVE (EF-10, sinon `GRID_INACTIVE`), pas d'autre demande active sur l'ouvrage.

### 3.2 Certificat
```
EMIS ──plaque confirmée──▶ ACTIF ──suspend──▶ SUSPENDU ──reactivate──▶ ACTIF
ACTIF|SUSPENDU ──job (validUntil dépassé)──▶ EXPIRE
tout état vivant ──withdraw──▶ RETIRE (définitif)
ACTIF ──nouveau certificat ACTIF (renouvellement)──▶ REMPLACE
```
Chaque transition : ligne `CertificatTransition` (de, vers, motif obligatoire, acteur ou `null` si job) + `AuditLog`. Suspension/retrait : `QrToken.status = REVOKED` dans la même transaction (EF-21, < 1 min est trivial si c'est synchrone).
Renouvellement (EF-22) : l'ancien jeton reste sur la plaque physique ; le résolveur public suit `replacedById` jusqu'au certificat courant. Ne réutilise pas le jeton d'un certificat à l'autre.

### 3.3 Analyse
`EN_SAISIE → SOUMISE` (verrou + verdict final) ; `SOUMISE → AMENDEE` uniquement via amendement approuvé (versionné, EF-16). Triggers SQL : les `analyse_valeurs` sont intouchables hors `EN_SAISIE`.

### 3.4 Paiement / Signalement
Paiement : `DECLARE → CONFIRME | REJETE`. `Demande.amountPaid` = somme des `CONFIRME`, recalculée en transaction. Signalement : `RECU → PRIS_EN_CHARGE → RESOLU | REJETE`, avec `ESCALADE_MINEE` automatique si gravité 3.

---

## 4. Règles de gestion à coder (calculs côté serveur uniquement)

**Verdict (EF-14)** — par paramètre obligatoire : conforme si `min ≤ valeur ≤ max` (bornes nulles ignorées) ; bactériologique « absence/présence » conforme si `presence = false`. Verdict global : un seul paramètre `isCritical` non conforme ⇒ `NON_CONFORME_GRAVE` ; sinon un paramètre non conforme ⇒ `NON_CONFORME` ; sinon `CONFORME`. Paramètre obligatoire manquant ⇒ impossible de soumettre. [Guessing] sur la définition de « grave » : c'est la décision D4 du MINEE. Les 20 cas de test de la MOA sont ton jeu de recette : écris-les en tests unitaires dès réception.

**Tarif (EF-10)** — `GrilleTarifaireLigne` par (type d'ouvrage × usage) de la grille ACTIVE. Net dû = tarif − subvention accordée. Aucune grille active ⇒ erreur, jamais de tarif par défaut.

**Paiement (EF-11)** — unicité `(canal, référence)` ; montant ≤ solde restant ; confirmation ⇒ reçu numéroté (`RC-AAAA-NNNNNN`) avec solde après règlement, y compris pour un paiement partiel. Idempotence par `Idempotency-Key`.

**Anti-doublon ouvrage (EF-04)** — refus si même `sieId`, ou même type à moins de `DUPLICATE_RADIUS_M` (15 m, paramétrable) via `ST_DWithin`. Réponse 409 avec l'ouvrage existant pour que l'UI propose de le rattacher.

**Numérotation** — séquences SQL. [Guessing] formats : ouvrage `AS-{codeRégion}-{seq6}`, demande `DC-AAAA-{seq6}`, certificat `CC-AAAA-{seq6}`. Ces numéros sont affichés publiquement (ouvrage, certificat) : ne mets aucune donnée privée dedans.

**QR (EF-20/21, EN-07)** — `crypto.randomBytes(16)` encodé base62 (≥ 22 car.), unique, sans lien calculable avec l'ouvrage. URL : `{PUBLIC_VERIFY_URL}/{token}`. Jamais de numéro séquentiel dans l'URL.

**Écran de vérification (EF-23/24)** — 5 états : `ACTIVE`, `SUSPENDED`, `EXPIRED`, `WITHDRAWN`, `UNKNOWN`. Toujours HTTP 200 (QR inconnu inclus, sinon l'écran n'a rien à afficher), `Cache-Control: no-store`, rate-limit par IP, et temps de réponse constant entre « inconnu » et « révoqué » (pas d'oracle). Contenu : nom, village, numéro de plaque, commune, dates, référentiel ; **jamais** propriétaire, téléphone, montants. Ajoute au payload l'identité de l'ouvrage pour détecter une plaque déplacée (risque du CDC).

**Prélèvement (EF-13)** — préconditions : demande `PRELEVEMENT_PLANIFIE`, agent avec `habilitationUntil` valide et commune dans son périmètre. Synchro : idempotente par `clientUuid`. Conflit si la demande a changé d'état depuis `clientTs` : la fiche va en file `PrelevementSyncQueue` avec `CONFLICT`, elle n'est jamais perdue ni appliquée aveuglément. L'horodatage client est conservé mais l'horodatage serveur fait foi pour l'audit.

**Contre-analyse (EF-17)** — laboratoire ≠ labo initial (service **et** trigger), payeur/délai/nombre paramétrables (décision D4b MINEE). Le certificat n'est émis que sur analyse conforme ou contre-analyse favorable.

**Audit (EF-37)** — le service insère `(actorId, actorRole, action, entityType, entityId, reason, before, after, ip)` et passe `prevHash=''`, `hash=''` : le trigger calcule la chaîne. Rends `AuditService.log(tx, …)` obligatoire dans chaque service de transition ; l'intercepteur HTTP `@Audited` ne sert qu'aux lectures sensibles (téléchargement de PDF, exports). `GET /audit-logs/verify-chain` appelle `audit_verify_chain()`.

**Données personnelles (EN-08)** — DTO de sortie publics en liste blanche (`PublicOuvrageDto`), jamais de `select *`. Journalise l'accès aux données privées. Durée de conservation à fixer (décision avec le conseil juridique).

---

## 5. Matrice RBAC (appliquée côté serveur)

Deux couches : `@Roles()` (qui) puis `ScopeGuard` (sur quoi). Un test automatique par cellule (EF-01).

| Action | Propriétaire | Entreprise/ONG | Agent communal | Préleveur | Labo | Entr. traitement | MINEE | Admin |
|---|---|---|---|---|---|---|---|---|
| Voir carte / vérifier QR / signaler | public | public | oui | oui | oui | oui | oui | oui |
| Déclarer un ouvrage | ses ouvrages | ceux qu'elle réalise | sa commune | — | — | — | tous | — |
| Déposer une demande | ses ouvrages | ses ouvrages | sa commune | — | — | — | — | — |
| Valider l'adhésion | — | — | sa commune | — | — | — | tous | — |
| Choisir le labo, payer | oui | oui | pour un propriétaire | — | — | — | — | — |
| Confirmer un paiement | — | — | ? (D2) | — | — | — | ? (D2) | ? (D2) |
| Enregistrer un prélèvement | — | — | — | habilité, sa zone | — | — | — | — |
| Saisir / soumettre analyse, PV | — | — | — | — | ses échantillons | — | — | — |
| Amender une analyse | — | — | — | — | demande | — | approuve | — |
| Émettre / valider certificat | — | — | — | — | — | — | oui (+ délégué) | — |
| Suspendre / retirer / réactiver | — | — | — | — | — | — | oui | — |
| Télécharger le PDF certificat | oui | — | oui (D11) | oui (D11) | — | — | oui | — |
| Instruire une subvention | demande | — | éligibilité | — | — | — | arbitre | — |
| Paramétrer norme / grille / agréments | — | — | — | — | — | — | oui | — |
| Dépôt rapport d'intervention | — | — | — | — | — | oui (sans effet certifiant) | — | — |
| Statistiques | siennes | siennes | commune | — | activité | — | nationales | — |
| Gérer comptes, exports système | — | — | — | — | — | — | — | oui |

Toute action sur un certificat, la norme ou un agrément exige un **second facteur récent** (`@StrongAuth()`) + AuditLog. Le MINEE et le laboratoire ont le 2FA obligatoire dès la première connexion (EF-03). L'admin technique n'a aucun droit métier de certification : séparation des pouvoirs.

---

## 6. Authentification

- **Propriétaire/entreprise** : téléphone E.164 → code à 6 chiffres haché (`UserAuthCode`), TTL 5 min, 5 essais, 3 envois/h/numéro. Réponse identique que le compte existe ou non (pas d'énumération).
- **Staff** : identifiant + mot de passe (argon2id) puis TOTP. Verrouillage progressif après échecs (`failedLogins`, `lockedUntil`). 10 codes de secours hachés, affichés une fois.
- **Tokens** : access 15 min ; refresh 30 j **rotatif** avec détection de réutilisation (révoque la famille). Stocke le haché du refresh.
- **Secrets TOTP** chiffrés AES-256-GCM (clé hors base).
- **Agent communal / préleveur** : comptes créés par l'admin ou le MINEE ; mot de passe initial à changer.
- Cas du propriétaire sans smartphone : la commune crée l'ouvrage et le dossier pour lui ; le compte est lié ensuite par son numéro. [Likely] nécessaire sur le terrain, absent du CDC : à confirmer.

---

## 7. Jobs planifiés

| Job | Fréquence | Action |
|---|---|---|
| Expiration | quotidien 02:00 | `ACTIF|SUSPENDU` avec `validUntil < now()` ⇒ `EXPIRE` (acteur `null`, motif auto) + recalcul `Ouvrage.status` + QR inchangé (état lu en base) |
| Alerte J-60 | quotidien 06:00 | notifie propriétaire + commune (SMS, e-mail, in-app), une seule fois par seuil (clé d'idempotence `CERT_EXPIRING_60:{certId}`) |
| Alerte expiré / non-conformité / dossier incomplet / changement de statut | événementiel | via `NotificationService.enqueue()` après commit |
| Dispatcher notifications | chaque minute | envoie `PENDING`, 3 essais avec backoff, puis `FAILED` |
| Plaque non confirmée | hebdo | certificat `EMIS` depuis > N jours ⇒ relance commune |
| Purge | quotidien | codes OTP expirés, refresh tokens expirés |
| Sauvegarde | quotidien | dump + GPG + copie hors hébergeur ; test de restauration avant recette (< 15 min) |

Les e-mails/SMS partent **après** commit de la transaction métier (pattern outbox : on écrit dans `notifications` dans la transaction, le dispatcher envoie ensuite).

---

## 8. Import SIE (EF-05)

Fichier CSV/XLSX (format à obtenir, décision D6). Pipeline : parse en flux → normalisation (trim, E.164, lat/lng dans la boîte du Cameroun) → upsert par `sieId` → ligne `SieImportHistory` avec compteurs et `errorReport` JSON. Idempotent (rejouer le même fichier ne crée rien). `dryRun=true` pour simuler. Rattachement à la commune par code officiel, sinon par `ST_Contains` sur le polygone, sinon erreur de ligne. Sur 37 852 lignes : traiter par lots de 500 en transaction, jamais ligne par ligne en requêtes séparées.

---

## 9. Plan de réalisation (12 semaines à partir de la tranche 1)

**Phase 0 (avant semaine 1, hors délai)** : décisions §11, accès dépôt pour la MOA, fichier SIE, communes et labo pilotes, jeu de 20 cas de test, audit des appels du front.

| Lot | Semaines | Contenu | Exigences |
|---|---|---|---|
| 1 — Socle | 1-4 | Projet NestJS, Docker, CI, Prisma + migration + SQL ; auth (OTP, staff, TOTP, refresh) ; RBAC + ScopeGuard + tests de matrice ; AuditService ; géo (régions, communes) ; ouvrages + anti-doublon ; import SIE ; documents/stockage ; demandes jusqu'à validation commune ; API publique recherche/carte/stats ; OpenAPI publiée | EF-01..09, EF-28, EN-08, EN-09 |
| **Démo 1** | fin S4 | | |
| 2 — Chaîne | 5-8 | Grille + tarif ; paiements manuels + reçus PDF ; prélèvements + sync hors-ligne ; normes versionnées ; analyses (valeurs, verdict, PV, amendements) ; contre-analyse ; file MINEE + délégations + validation par lot ; certificats (6 états, transitions) ; QR opaque + révocation ; PDF filigrané FR/EN ; vérification publique 5 états | EF-10..23, EF-36, EF-37 |
| **Démo 2 → tranche 2** | fin S8 | | |
| 3 — Alertes & pilotage | 9-12 | Signalements + routage + anti-abus ; alertes sanitaires ; notifications SMS/e-mail/in-app ; jobs ; dashboard MINEE minimal ; sauvegarde/restauration testée ; test de charge 50 000 ouvrages ; i18n FR/EN ; docs (manuels, admin, reprise) ; export de réversibilité ; recette | EF-24..26, EF-29, EF-31, EN-02..06, EN-11..13 |
| Au fil de l'eau (S) | — | EF-30 rapport communal, EF-32 annuaire, EF-33 espace entreprise, EF-34 rapports d'intervention, EF-35 subventions manuelles | si le temps le permet |
| Hors pilote (C) | — | EF-12 passerelle paiement, EF-27 SMS de vérification, EF-38 exports CSV/GeoJSON | **ne pas coder** |

**Risque [Likely]** : l'estimation est serrée. Deux développeurs, 25 entités, workflow complet, PDF bilingue, hors-ligne, tests de matrice et d'intrusion exclus. Les S ne rentreront probablement pas. Négocie par écrit dès la semaine 1 la liste de ce qui sort en cas de glissement (le CDC prévoit déjà les priorités M/S/C et la demande de changement chiffrée).

---

## 10. Tests de recette → à automatiser dès le lot concerné

| Exigence | Test |
|---|---|
| EF-01 | Une ligne de test par cellule de la matrice §5, y compris « aucune fuite entre périmètres » (commune A ne voit rien de la commune B) |
| EF-03 | Connexion staff impossible sans TOTP ; code de secours à usage unique |
| EF-04 | Doublon par `sieId` et par distance refusés |
| EF-05 | Import d'un fichier de test sans doublon, rapport d'erreurs correct, rejeu idempotent |
| EF-06/24 | Le JSON public ne contient aucune clé de la liste noire (owner, phone, amount…) : test de snapshot |
| EF-10 | Tarif bloqué si grille inactive ; modification de grille sans redéploiement |
| EF-11 | Partiel puis solde ; reçu à chaque règlement ; doublon de référence refusé |
| EF-13/EN-05 | Synchro idempotente, conflit conservé |
| EF-14 | 20 cas fournis par la MOA |
| EF-16 | UPDATE direct sur une analyse soumise échoue (SQL et API) |
| EF-17 | Même laboratoire refusé |
| EF-18/19 | Délégation créée puis utilisée ; toute transition horodatée, motivée, attribuée |
| EF-20 | Public ⇒ 403 sur PDF ; QR non devinable (entropie, aucune séquence) |
| EF-21 | Scan après retrait ⇒ message de retrait < 1 min |
| EF-22 | Ancien QR → certificat courant |
| EF-23 | 5 états, 5 messages |
| EF-25 | Signalement routé à la bonne commune ; 6e envoi/h bloqué |
| EF-31 | J-60 : une notification, pas de doublon |
| EF-36 | Nouvelle norme sans effet sur certificats émis |
| EF-37 | UPDATE/DELETE sur `audit_log` rejetés ; altération disque détectée par `verify-chain` |
| EN-06 | Restauration complète < 15 min |
| EN-11 | Test de charge, 50 000 ouvrages simulés, pics de scans |
| EN-12 | Export complet démontré |

---

## 11. Décisions à obtenir (bloquantes, par ordre d'impact)

| # | Décision | Qui | Impact si absente | Contournement en code |
|---|---|---|---|---|
| D1 | **Canal SMS pour les codes propriétaires** : le CDC exige le code par téléphone (EF-02) mais classe les SMS parmi les lignes « non incluses ». Aucun fournisseur choisi, aucun budget. [Certain] contradiction. | MOA | Aucun propriétaire ne peut se connecter | Interface `SmsProvider` + fournisseur `console` en dev ; en production sans SMS, repli temporaire par mot de passe créé à l'enrôlement par la commune |
| D2 | Qui **confirme** un paiement en option A (pas de passerelle) : MINEE, admin, commune ? | MOA + MINEE | EF-11 non démontrable | Rôle configurable ; implémente `ADMIN` par défaut |
| D3 | Durée de validité du certificat **et point de départ** (date d'analyse, d'émission, de pose de plaque) | MINEE | `validUntil` incalculable | `validityMonths` nul ⇒ **refus de publier** le référentiel ; départ = émission [Guessing] |
| D4 | Seuil de « non-conformité grave » + protocole d'alerte ; payeur, délai et nombre de contre-analyses | MINEE | Verdict grave et contre-analyse non codables | Flag `isCritical` par seuil, paramètres en base |
| D5 | Règle de déblocage du prélèvement : paiement intégral, première tranche, ou aucune condition ? Le CDC autorise le paiement partiel mais ne dit pas à partir de quoi on prélève. | MOA | Étape 3→4 du parcours ambiguë | Paramètre `minPaidPercentBeforeSampling` |
| D6 | Fichier SIE et **format de l'identifiant** ; hébergement des données accepté par le MINEE | MOA/MINEE | EF-05 non testable | Mapper de colonnes configurable |
| D7 | Intitulé, version et **seuils réels de NC 207** (le CDC dit de les faire vérifier) | MINEE | Aucun seed de norme possible | N'invente jamais de seuils : le seed crée un référentiel BROUILLON vide |
| D8 | Plafond de volumétrie et durée de conservation des données personnelles | MOA + conseil juridique | Purge non définie | Paramètre de rétention |
| D9 | Format des numéros publics (ouvrage, certificat) | MOA | Cosmétique mais figé une fois sur les plaques | §4, modifiable avant impression des plaques |
| D10 | Politique de visibilité publique des ouvrages **privés** (apparaissent-ils sur la carte ?) | MOA | Exposition de données | `Ouvrage.isPublic` à ajouter si la réponse est « au choix du propriétaire » |
| D11 | « L'agent » autorisé à imprimer (EF-20) : communal, préleveur, MINEE ? | MOA | Droit de téléchargement | Matrice §5 en configuration |

---

## 12. Sécurité — liste de contrôle

- Validation stricte de tous les DTO (`whitelist: true`, `forbidNonWhitelisted: true`) ; UUID validés ; pagination bornée.
- Upload : type MIME réel (magic bytes), taille ≤ 10 Mo, nom de fichier ignoré (clé d'objet aléatoire), antivirus (ClamAV) si l'hébergeur le permet.
- `helmet`, CORS en liste blanche, TLS via Traefik, en-têtes serveur masqués.
- Aucune donnée réelle dans les environnements de test (clause du CDC) ; jeux de données synthétiques générés par le seed.
- Secrets hors dépôt ; rotation documentée.
- Rôle PostgreSQL applicatif sans `UPDATE/DELETE` sur `audit_log`, `proces_verbaux`, `certificat_transitions`, `recus` (SQL §6 du fichier d'intégrité).
- Logs structurés sans PII (téléphones masqués), `traceId` renvoyé dans les erreurs.
- Test d'intrusion externe : **hors prix**, mais exigé avant généralisation (EN-07) : prévois-le dans tes remarques à la MOA.

---

## 13. Démarrage

```bash
cp .env.example .env              # renseigne les secrets
docker compose up -d db minio
npm i
npx prisma generate
npx prisma migrate dev --create-only --name init
#   → ouvre prisma/migrations/<ts>_init/migration.sql, ajoute à la fin le contenu de prisma/sql/001_integrity.sql
npx prisma migrate dev
npm run seed                      # 10 régions, admin initial, référentiel et grille BROUILLON vides
npm run start:dev                 # Swagger sur /api/docs
```

Seed minimal : 10 régions du Cameroun ; communes pilotes une fois choisies ; 1 compte ADMIN (mot de passe à changer, 2FA forcé) ; 1 référentiel et 1 grille en `BROUILLON` **sans valeurs**.

Ordre de lecture des fichiers : ce guide → `prisma/schema.prisma` → `prisma/sql/001_integrity.sql` → `docs/openapi.yaml`.
