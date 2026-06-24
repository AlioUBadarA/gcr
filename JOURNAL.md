# Journal de développement — Cockpit Commercial PFS

> Récap quotidien automatique des travaux effectués sur le projet.
> Mis à jour chaque nuit à minuit.

---

## 08 juin 2026

### Lancement du projet
- **Initial commit** — mise en place du dépôt `gcr` (backend Node/Express + PostgreSQL)
- **Frontend initial** — première release du frontend React (Vite + Tailwind)
- **Système Superadmin** — rôles, suspension de comptes, journal d'audit
- Migration auto-exécutée au démarrage (compatibilité Render free tier)
- Compte superadmin défini via variable d'environnement `SUPERADMIN_EMAIL`
- Correction du routing SPA sur Render (règle de rewrite)

---

## 09 juin 2026

### Sécurité & Accès
- **Inscription publique désactivée** — les comptes sont désormais créés uniquement par le superadmin
- **Impersonation** — le superadmin peut naviguer dans l'espace d'un rizier sans connaître son mot de passe
- Redirection automatique du superadmin vers `/admin` à la connexion
- Schéma garanti au premier boot : colonnes `role`, `suspended`, table `audit_logs`
- Fix proxy Render (`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`)

---

## 11 juin 2026

### Ajout des modules métier principaux
- **Nouvelles pages** : Équipe, Forecast, Prospection, Actions, Rentabilité
- **Rôle Vendeur** — périmètre limité à ses propres clients/ventes
- **Emplois & Contrats** — routes backend + migrations
- **Hiérarchie des comptes** — l'admin crée tout, les riziers gèrent leur équipe
- **Restructuration de la navigation** — 5 sections : Dashboard, Ventes, CRM, Pilotage, Équipe
- Ordre des onglets Pilotage : Planning → Actions → Forecast → Argumentaire
- Restructuration admin : onglets Rizeries + Comptes
- Fix NaN dans le top clients (utilisation de `ca_total` au lieu de `total`)
- Découpage des bundles vendor pour réduire les alertes de taille

---

## 12 juin 2026

### Dashboard Admin
- **Table Rizeries** — nouvelle section dédiée dans l'admin avec création/suppression
- Séparation claire des formulaires rizerie vs compte dans l'interface admin

---

## 20 juin 2026

### Correctifs de périmètre & données
- Fix du périmètre vendeur sur les routes client/vente individuelles
- Conservation des données historiques à la suppression d'un vendeur (réaffectation vers le parent)
- Extraction des helpers `withTransaction` et `reassignVendeurData` pour dédupliquer la logique
- Fix du rechargement des données dans Pilotage (données bloquées, messages d'erreur perdus)

---

## 22 juin 2026

### Rebranding & Identité visuelle
- **Rebranding complet** vers "Cockpit Commercial — Filière Riz · PFS"
- Nouvelle identité visuelle : logo PFS, palette de couleurs, typographie
- Renommage du projet en `cockpit-pfs` (package.json + service Render)
- Fix des messages d'erreur invisibles dans les modals admin
- Ajout du sélecteur de pays/région pour les rizeries

---

## 23 juin 2026

### Journée majeure — Modules complets & Sécurité

#### Navigation & Architecture
- Refactorisation complète de la navigation selon le HTML de référence Cockpit Commercial
- Sidebar restructurée : Pilotage, Clients & Ventes, Analyse, Décision, Référentiel

#### Managers
- Page Managers avec KPIs agrégés par équipe (CA, atteinte, forecast, marge, créances)
- Bouton de suppression d'un manager (vendeurs réaffectés au rizier)
- AdminUserDetail : création/listing des managers pour l'équipe d'un rizier
- Badge "Manager" dans la topbar

#### Pilotage
- Support de **plusieurs visites client/prospect par jour** avec notes d'action par visite

#### Produits, Encaissements & Guide
- **Page Produits** — catalogue lié à la rizerie, lecture seule pour les commerciaux
- **Page Encaissements** — tranches de paiement, reste à encaisser, reçus
- **Page Guide d'utilisation**
- Réorganisation de la sidebar

#### Sécurité
- Suppression de la page Register (dead code) avant livraison client
- Mot de passe minimum renforcé (12 caractères)
- Endpoint d'inscription publique supprimé du backend

#### Superadmin
- Onglet "Comptes superadmin" dans l'admin : créer/supprimer des comptes superadmin

#### Backend
- Journal de caisse, RFM clients, alertes unifiées
- Numéros de transaction, auto-upsert client, encaissements, baselines rizerie
- Support contrats multi-produits (`produits TEXT[]`)
- Fix contrainte statut prospection (détection par colonne, pas par texte)
- Route `PATCH /equipe/:id/role` pour promouvoir un vendeur en manager

---

## 24 juin 2026

### Matin — Rôle Directeur & Fonctionnalités avancées

#### Rôle Directeur
- Nouveau rôle `directeur` dans la hiérarchie (entre rizier et manager)
- Création de directeurs depuis l'admin avec propagation du `rizerie_id`
- Un directeur peut réaffecter un commercial vers un autre manager

#### Impression
- **Bon de commande, Facture, Reçu** — impression depuis les ventes et encaissements
- Distinction reçu (par tranche) vs facture (vente soldée)
- Fix du layout dropdown impression (largeur fixe, liste verticale propre)

#### Catalogue Produits dans les Ventes
- Sélecteur produit auto-chargé dans les formulaires Ventes et Contrats
- Détails produits inclus dans les résultats encaissements (pour impression)

#### Clients
- RBAC renforcé : alerte doublon à la création, modification/suppression restreinte
- Produits en lecture seule pour les commerciaux

#### UI/UX
- Nom de la rizerie affiché dans la topbar à côté du compte
- Argumentaire de vente adapté au pays de la rizerie
- Export CSV depuis l'interface admin (ventes, clients par période/rizerie)

---

### Après-midi — Dashboard Admin & Page Commerciaux

#### Dashboard Admin — Refonte
- **Groupement des comptes par rizerie** — sections colorées avec drapeau et ville
- **Menu 3 points (⋮)** remplace les boutons inline dans l'admin
  - Corrections successives : clipping → ouverture vers le haut → React Portal
- **Impact RIZAO** — tableau de performance avant/après adoption par rizerie
  - KPIs : CA généré, CA avant RIZAO, taux recouvrement, emplois, clients, contrats
  - Graphique CA mensuel (12 derniers mois)
  - Labels corrigés ("avant RIZAO" / "CA généré via Cockpit")
  - Emplois : affichage uniquement des emplois créés via RIZAO (pas le total)
- KPI cards ajoutées au dashboard : "Encaissé ce mois" + "Recouvrement"
- Fix évolution CA dans la table rizeries (comparaison année N vs N-1)

#### Page Commerciaux — 3 fonctionnalités majeures
- **Groupement par manager** — sections "Équipe de X" (fond bleu) + "Sans manager"
- **Composant `KebabMenu.jsx` partagé** — extrait depuis AdminDashboard, utilisé partout
  - Vendeur : Éditer · Mot de passe · Assigner/Réassigner manager · Promouvoir · Supprimer
  - Manager : Voir l'équipe · Éditer · Mot de passe · Supprimer
- **Voir l'équipe** — modal large avec KPIs équipe + tableau individuel par vendeur
- **Assigner / Réassigner un manager** — modal avec dropdown, endpoint backend étendu au rôle rizier
- Champ `periode_rizao` (Avant/Avec RIZAO) dans le formulaire et tableau Emplois

#### Navigation Admin
- "Impact RIZAO" déplacé de l'onglet admin → **page autonome dans la sidebar** (`/admin/impact-rizao`)
- "Comptes" renommé en **"Administration"** dans la sidebar

#### Corrections alignement
- Table Administration : `table-layout: fixed` + `colgroup` pour aligner les colonnes entre cartes rizerie
- En-têtes alignés à droite/centre selon les colonnes (CA total, Ventes)

---

*Fichier généré automatiquement — dernière mise à jour : 24 juin 2026*
