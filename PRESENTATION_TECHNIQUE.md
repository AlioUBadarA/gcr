# Cockpit Commercial PFS — Dossier Technique de Présentation

> Document préparé pour la présentation du projet — Juin 2026

---

## 1. Stack Technologique — Pourquoi ces choix ?

### Backend : Node.js + Express

**Pourquoi Node.js ?**
- **Performance événementielle** : Node.js gère les requêtes de façon non-bloquante (modèle asynchrone). Concrètement, quand 50 commerciaux consultent leur tableau de bord en même temps, le serveur répond à tous en parallèle sans file d'attente.
- **JavaScript universel** : le même langage côté serveur et côté client. L'équipe ne switche pas de langage, ce qui réduit les erreurs et accélère le développement.
- **Écosystème npm** : accès immédiat à des milliers de bibliothèques testées (sécurité, auth, validation…).
- **Léger à déployer** : un seul processus, consommation mémoire faible — parfait pour commencer sur Render Free.

**Pourquoi Express ?**
- Framework minimaliste et éprouvé (13+ ans, utilisé par Uber, IBM, Accenture).
- Permet de construire exactement ce dont on a besoin sans sur-ingénierie.
- Middleware chainable : sécurité, rate limiting, CORS, auth — chaque couche s'ajoute proprement.

---

### Base de données : PostgreSQL

**Pourquoi PostgreSQL plutôt que MySQL ou MongoDB ?**
- **Transactions ACID** : si un encaissement est enregistré, il est garantit complet ou annulé — jamais à moitié. Critique pour les données financières (ventes, créances, encaissements).
- **UUIDs natifs** : chaque enregistrement a un identifiant universel unique (`gen_random_uuid()`). Impossible de deviner ou d'énumérer les IDs depuis l'extérieur.
- **Contraintes de données** : le schéma garantit l'intégrité (rôles valides, clés étrangères, champs obligatoires) au niveau base de données, pas seulement au niveau applicatif.
- **Requêtes avancées** : agrégations complexes (CA par période, projection, marge, taux d'atteinte) en SQL pur, sans couche ORM qui masque les performances.
- **Hébergé sur Render** : sauvegarde automatique, SSL enforced, accès uniquement depuis notre backend.

---

### Frontend : React 18 + Vite + Tailwind CSS

**Pourquoi React ?**
- **Composants réutilisables** : les éléments (tableau, carte KPI, modal, menu) sont créés une fois et réutilisés partout. Le code reste cohérent et maintenable.
- **Interface réactive** : les données se mettent à jour sans recharger la page — l'expérience commerciale est fluide (ajout de vente, filtrage, navigation).
- **Écosystème mature** : React est le framework UI le plus utilisé au monde (Meta, Airbnb, Netflix). Des développeurs qualifiés sont disponibles pour faire évoluer le projet.

**Pourquoi Vite ?**
- Build ultra-rapide (3× plus rapide que Webpack). En développement, les modifications sont visibles en moins de 100ms.
- Bundle optimisé en production : le fichier final est minifié et découpé intelligemment pour un chargement rapide.

**Pourquoi Tailwind CSS ?**
- Design directement dans le code, sans fichier CSS séparé à gérer.
- Classes utilitaires prédéfinies → cohérence visuelle automatique (couleurs, espacements, typographie).
- Résultat : le fichier CSS final fait seulement **30 KB** (vs 200–500 KB pour Bootstrap).

---

### Hébergement : Render.com

**Pourquoi Render ?**
- **Déploiement automatique** : chaque `git push` met la plateforme à jour sans intervention manuelle.
- **SSL/HTTPS inclus** : certificat HTTPS gratuit et automatique sur tous les domaines.
- **Base PostgreSQL intégrée** : pas besoin de gérer un serveur de base de données séparé.
- **Plan gratuit viable** : permet de lancer et de valider le projet sans coût initial.
- **Scalabilité progressive** : on monte en gamme à la demande, sans migrer de plateforme.

---

### Bibliothèques de sécurité

| Bibliothèque | Rôle |
|---|---|
| `helmet` | Sécurise les en-têtes HTTP (XSS, clickjacking, MIME sniffing) |
| `bcryptjs` | Hachage des mots de passe — irréversible, salé, lent par design |
| `jsonwebtoken` | Authentification sans session serveur (JWT signé) |
| `express-rate-limit` | Limite les requêtes pour bloquer les attaques par force brute |
| `cors` | Autorise uniquement le domaine frontend connu |

---

## 2. Sécurité & Protection des Données

### 2.1 Authentification & Contrôle d'accès

#### Mots de passe
- **Hachage bcrypt** (coût 12) : même si la base de données est volée, les mots de passe sont mathématiquement impossibles à retrouver.
- Minimum **12 caractères** obligatoires.
- L'inscription publique est **désactivée** — seul un superadmin peut créer des comptes.

#### Tokens JWT
- Chaque connexion génère un token signé (`HS256`) valable une durée limitée.
- Le token est vérifi à chaque requête — une session expirée est automatiquement rejetée.
- Stocké côté client uniquement (pas de session serveur à pirater).

#### Hiérarchie des rôles (RBAC)
```
Superadmin → Rizier → Directeur → Manager → Vendeur
```
Chaque rôle a un périmètre strict :
- Un **vendeur** ne voit que ses propres clients et ventes.
- Un **manager** voit uniquement son équipe.
- Un **rizier** voit l'ensemble de sa rizerie.
- Le **superadmin** supervise toutes les rizeries sans accéder aux données métier.

### 2.2 Sécurité des APIs

#### Rate Limiting (limitation de débit)
- **300 requêtes / 15 minutes** par IP — limite globale.
- **20 tentatives / 15 minutes** sur l'endpoint de connexion — bloque les attaques par force brute.
- Un bot qui essaie des milliers de mots de passe est bloqué automatiquement.

#### En-têtes de sécurité HTTP (Helmet)
- `X-Content-Type-Options: nosniff` — empêche l'exécution de fichiers malveillants.
- `X-Frame-Options: DENY` — empêche le clickjacking (intégration dans un iframe piégé).
- `Strict-Transport-Security` — force HTTPS, interdit HTTP.
- `Content-Security-Policy` — restreint les sources de scripts autorisées.

#### CORS strict
- Seul le domaine officiel du frontend est autorisé à appeler l'API.
- Une page web tierce ne peut pas faire de requêtes à notre API.

### 2.3 Intégrité des données

#### Contraintes base de données
- Toutes les clés étrangères sont vérifiées (`REFERENCES … ON DELETE SET NULL`).
- Les rôles, statuts et valeurs critiques ont des contraintes `CHECK` au niveau SQL.
- Les transactions PostgreSQL (`BEGIN / COMMIT / ROLLBACK`) garantissent qu'une opération complexe (suppression d'un vendeur + réaffectation de ses données) est atomique.

#### Isolation par rizerie
- Chaque rizerie est isolée : un rizier ne peut pas voir les données d'une autre rizerie, même en manipulant les URLs.
- Le `scopeIds` middleware calcule et vérifie le périmètre autorisé à chaque requête.

#### Journal d'audit
- Toutes les actions sensibles (création/suspension de compte, connexion superadmin, impersonation) sont enregistrées avec horodatage, IP et utilisateur.

### 2.4 Protection des données personnelles

- **Données stockées** : nom, email, téléphone, données commerciales — aucune donnée bancaire, aucune pièce d'identité.
- **Accès restreint** : les données d'un vendeur ne sont jamais visibles par un commercial d'une autre rizerie.
- **Suppression propre** : la suppression d'un compte réaffecte les données historiques (ventes, clients) plutôt que de les effacer — l'historique commercial est préservé.
- **HTTPS obligatoire** : toutes les communications sont chiffrées en transit (TLS 1.2+).
- **Mots de passe jamais stockés en clair** : bcrypt rend l'extraction des mots de passe techniquement impossible même avec un accès direct à la base.

---

## 3. Capacité de la Plateforme — Version Actuelle (Render Free)

### 3.1 Limites du plan gratuit

| Paramètre | Valeur Free Tier |
|---|---|
| RAM serveur backend | 512 MB |
| CPU | Partagé (0.1 vCPU) |
| Mise en veille | Après **15 minutes** d'inactivité |
| RAM base PostgreSQL | 256 MB |
| Stockage PostgreSQL | 1 GB |
| Connexions PostgreSQL max | **97 connexions** simultanées |
| Bande passante mensuelle | 100 GB |

### 3.2 Capacité réelle en version gratuite

**Connexions simultanées :**
- Node.js + Express peut théoriquement gérer des milliers de connexions HTTP.
- La limite réelle vient de PostgreSQL : **97 connexions simultanées max**.
- En pratique, chaque utilisateur actif génère 1–3 requêtes en parallèle → **~30 à 50 utilisateurs actifs simultanément** confortablement.

**Connexions par jour :**
- Avec 15 minutes de mise en veille, le premier accès de la journée prend ~10–15 secondes (cold start).
- Une fois "réveillé", le serveur tient jusqu'à la prochaine inactivité.
- Estimé : **200 à 500 sessions utilisateur par jour** sans dégradation notable.

**Stockage :**
- 1 GB pour toutes les données (ventes, clients, contrats, emplois…).
- Pour une rizerie de taille moyenne avec 5 ans d'historique → ~50–100 MB.
- Le plan gratuit supporte **5 à 10 rizeries** confortablement.

---

## 4. Passage aux Plans Payants — Ce qui change

### 4.1 Render — Plans payants

#### Render Starter — Backend (7 $/mois ≈ 4 200 F/mois)

| Paramètre | Free | Starter ($7) |
|---|---|---|
| RAM | 512 MB | 512 MB |
| CPU | Partagé, limité | **Dédié 0.5 vCPU** |
| Mise en veille | Oui (15 min) | **Non — toujours actif** |
| Déploiements | Illimités | Illimités |
| SLA uptime | Aucun | 99.5 % garanti |

→ **Impact principal** : fini le cold start de 15 secondes. Le service est disponible 24h/24 instantanément.

#### Render Standard — Backend (25 $/mois ≈ 15 000 F/mois)

| Paramètre | Starter ($7) | Standard ($25) |
|---|---|---|
| RAM | 512 MB | **2 GB** |
| CPU | 0.5 vCPU | **1 vCPU dédié** |
| Connexions simultanées | ~50 users | **~300 users** |
| Autoscaling | Non | **Oui (jusqu'à 3 instances)** |

#### Render PostgreSQL Payant (7 $/mois ≈ 4 200 F/mois)

| Paramètre | Free | Payant ($7) |
|---|---|---|
| RAM | 256 MB | **1 GB** |
| Stockage | 1 GB | **10 GB** |
| Connexions max | 97 | **197** |
| Sauvegardes | Non | **Quotidiennes automatiques** |
| Point-in-time recovery | Non | **Oui (7 jours)** |
| Haute disponibilité | Non | **Oui (réplication)** |

### 4.2 Comparaison capacité : Free vs Payant

| Scénario | Free Tier | Starter ($14/mois) | Standard ($32/mois) |
|---|---|---|---|
| Utilisateurs simultanés | ~30–50 | ~80–120 | **~300–500** |
| Sessions/jour | ~200–500 | ~1 000–3 000 | **~10 000+** |
| Rizeries supportées | 5–10 | 20–50 | **100+** |
| Temps de réponse | Variable | < 300 ms | **< 100 ms** |
| Disponibilité | ~95 % | 99.5 % | **99.9 %** |
| Cold start | 10–15 sec | **Aucun** | **Aucun** |
| Sauvegardes BDD | Aucune | Quotidiennes | **Quotidiennes + PITR** |

### 4.3 Ce que le payant améliore côté sécurité

- **Sauvegardes automatiques** : en cas de défaillance ou d'erreur humaine, retour en arrière possible jusqu'à 7 jours.
- **Haute disponibilité PostgreSQL** : la base est répliquée — même si un serveur tombe, les données restent accessibles.
- **IP dédiée** : possibilité de whitelister l'IP du backend pour n'autoriser que lui à se connecter à la base de données.
- **Support prioritaire** : en cas d'incident de sécurité, accès à l'équipe Render sous 4h (vs. communauté uniquement en Free).
- **Logs persistants** : conservation des logs d'accès et d'erreur sur 30 jours (vs. 24h en Free).

---

## 5. Possibilités d'Évolution de la Plateforme

### 5.1 Court terme — Fonctionnalités métier

#### Module de reporting exportable
- Export PDF des rapports de performance (par commercial, par période, par manager).
- Envoi automatique par email hebdomadaire aux managers et riziers.

#### Application mobile (PWA)
- Le frontend React peut être transformé en **Progressive Web App** installable sur téléphone sans passer par un App Store.
- Les commerciaux terrain pourraient saisir leurs visites et ventes hors ligne (synchronisation à la connexion).

#### Notifications en temps réel
- Alertes push dès qu'une créance dépasse un seuil, qu'un objectif est atteint, ou qu'un contrat expire.
- Implémentation via WebSockets (technologie déjà supportée par Node.js/Express).

#### Gestion documentaire
- Stockage et prévisualisation des contrats signés (PDF) directement dans la plateforme.
- Intégration avec Google Drive ou AWS S3 pour le stockage des fichiers.

---

### 5.2 Moyen terme — Scalabilité & Multi-pays

#### Multi-devises
- Ajout d'un champ devise par rizerie (XOF, XAF, GHS, NGN…).
- Conversion automatique pour les rapports consolidés.

#### Multi-langues (i18n)
- Interface traduite en anglais et en portugais pour les marchés Ghana, Nigeria, Mozambique.
- Architecture React facilement adaptable avec `react-i18next`.

#### API publique pour intégrations tierces
- Exposer une API documentée (Swagger) pour permettre l'intégration avec des ERP existants (Sage, Odoo) ou des plateformes de paiement mobile (Wave, Orange Money).

#### Tableau de bord consolidé groupe
- Vue superadmin avec agrégation de toutes les rizeries sur une même carte géographique.
- Comparaison performance inter-pays et inter-rizeries.

---

### 5.3 Long terme — Intelligence & Automatisation

#### Prévisions par IA
- Modèle de prévision des ventes basé sur l'historique (saison, zone géographique, profil client).
- Suggestion automatique d'objectifs mensuels réalistes par commercial.

#### Scoring client automatique (RFM évolué)
- Identification automatique des clients à risque de départ (churn) ou à potentiel de croissance.
- Recommandation d'actions commerciales ciblées.

#### Intégration paiements mobiles
- Connexion directe à Wave, Orange Money, MTN Mobile Money pour réconciliation automatique des encaissements.

#### Mode offline pour terrain
- Service Worker + base de données locale (IndexedDB) permettant la saisie sans connexion internet.
- Synchronisation automatique à la reconnexion.

---

### 5.4 Architecture cible à grande échelle

Si la plateforme est déployée sur **50+ rizeries** avec **500+ utilisateurs actifs** :

```
[Clients Web/Mobile]
        ↓
[CDN — Cloudflare]          ← Cache, protection DDoS, WAF
        ↓
[Load Balancer]             ← Répartition de charge
        ↓
[3 × instances Node.js]     ← Haute disponibilité
        ↓
[PostgreSQL Primary]        ← Réplication
[PostgreSQL Read Replica]   ← Lectures distribuées
        ↓
[Redis Cache]               ← Sessions, données fréquentes
```

Cette architecture supporte **10 000+ utilisateurs simultanés** avec un temps de réponse < 50 ms.

---

## Résumé des coûts selon l'ambition

| Scénario | Coût mensuel | Capacité |
|---|---|---|
| **Pilote (actuel)** | **0 €** | 5–10 rizeries, 30 users simultanés |
| **Déploiement national** | **~14 $ / mois** | 20–50 rizeries, 150 users simultanés |
| **Déploiement régional** | **~100 $ / mois** | 100+ rizeries, 500 users simultanés |
| **Plateforme continentale** | **~500–1 000 $ / mois** | Illimité avec autoscaling |

---

*Document technique préparé pour la présentation Cockpit Commercial PFS — Juin 2026*
