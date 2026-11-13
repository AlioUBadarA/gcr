# Journal de développement du Cockpit Commercial PFS

> Ce journal résume chaque jour les travaux du projet.
> Il se met à jour chaque nuit à minuit.

---

## 08 juin 2026

### Lancement du projet
- **Initial commit.** Le dépôt `gcr` est créé. Il contient le backend Node/Express et PostgreSQL.
- **Frontend initial.** La première version du frontend React sort. Elle utilise Vite et Tailwind.
- **Système Superadmin.** Il gère les rôles et la suspension des comptes. Il tient un journal d'audit.
- La migration se lance au démarrage. Ce choix convient à l'offre gratuite de Render.
- La variable d'environnement `SUPERADMIN_EMAIL` définit le compte superadmin.
- Une règle de rewrite corrige le routage SPA sur Render.

---

## 09 juin 2026

### Sécurité & Accès
- **Inscription publique désactivée.** Seul le superadmin crée les comptes.
- **Impersonation.** Le superadmin peut entrer dans l'espace d'un rizier. Il n'a pas besoin de son mot de passe.
- À la connexion, le superadmin arrive sur `/admin`.
- Le premier démarrage crée les colonnes `role` et `suspended`. Il crée aussi la table `audit_logs`.
- Fix proxy Render (`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`)

---

## 11 juin 2026

### Ajout des modules métier principaux
- **Nouvelles pages** : Équipe, Forecast, Prospection, Actions, Rentabilité
- **Rôle Vendeur.** Le vendeur voit seulement ses clients et ses ventes.
- **Emplois & Contrats.** Ajout des routes backend et des migrations.
- **Hiérarchie des comptes.** L'admin crée tous les comptes. Les riziers gèrent leur équipe.
- **Restructuration de la navigation.** Elle compte 5 sections : Dashboard, Ventes, CRM, Pilotage, Équipe.
- Ordre des onglets Pilotage : Planning → Actions → Forecast → Argumentaire
- Restructuration admin : onglets Rizeries + Comptes
- Le top clients n'affiche plus NaN. Il utilise `ca_total` au lieu de `total`.
- Les bundles vendor sont découpés. Les alertes de taille baissent.

---

## 12 juin 2026

### Dashboard Admin
- **Table Rizeries.** Une nouvelle section de l'admin crée et supprime les rizeries.
- L'interface admin sépare le formulaire rizerie et le formulaire compte.

---

## 20 juin 2026

### Correctifs de périmètre & données
- Fix du périmètre vendeur sur les routes client/vente individuelles
- La suppression d'un vendeur garde ses données historiques. Elles passent à son parent.
- Extraction des helpers `withTransaction` et `reassignVendeurData` pour dédupliquer la logique
- Pilotage recharge bien les données. Les données ne restent plus bloquées. Les messages d'erreur s'affichent.

---

## 22 juin 2026

### Rebranding & Identité visuelle
- **Rebranding complet.** Le nouveau nom est "Cockpit Commercial — Filière Riz · PFS".
- L'identité visuelle change. Elle reprend le logo PFS, une palette de couleurs et une typographie.
- Le projet devient `cockpit-pfs` dans package.json et sur Render.
- Les messages d'erreur s'affichent dans les modals admin.
- Ajout du sélecteur de pays/région pour les rizeries

---

## 23 juin 2026

### Journée majeure : modules complets et sécurité

#### Navigation & Architecture
- La navigation suit le HTML de référence Cockpit Commercial.
- Sidebar restructurée : Pilotage, Clients & Ventes, Analyse, Décision, Référentiel

#### Managers
- La page Managers donne les KPIs de chaque équipe : CA, atteinte, forecast, marge, créances.
- Un bouton supprime un manager. Ses vendeurs passent au rizier.
- AdminUserDetail crée et liste les managers de l'équipe d'un rizier.
- Badge "Manager" dans la topbar

#### Pilotage
- Le planning accepte **plusieurs visites client ou prospect par jour**. Chaque visite a ses notes d'action.

#### Produits, Encaissements & Guide
- **Page Produits.** Le catalogue dépend de la rizerie. Les commerciaux le lisent sans le modifier.
- **Page Encaissements.** Elle suit les tranches de paiement, le reste à encaisser et les reçus.
- **Page Guide d'utilisation**
- Réorganisation de la sidebar

#### Sécurité
- La page Register disparaît avant la livraison. C'était du code mort.
- Le mot de passe compte au moins 12 caractères.
- Endpoint d'inscription publique supprimé du backend

#### Superadmin
- L'onglet "Comptes superadmin" crée et supprime les comptes superadmin.

#### Backend
- Journal de caisse, RFM clients, alertes unifiées
- Numéros de transaction, auto-upsert client, encaissements, baselines rizerie
- Un contrat peut porter sur plusieurs produits (`produits TEXT[]`).
- La contrainte du statut de prospection est corrigée. Elle se détecte par colonne et non par texte.
- La route `PATCH /equipe/:id/role` promeut un vendeur en manager.

---

## 24 juin 2026

### Matin : rôle Directeur et fonctionnalités avancées

#### Rôle Directeur
- Le rôle `directeur` arrive dans la hiérarchie. Il se place entre rizier et manager.
- L'admin crée les directeurs. Le `rizerie_id` se transmet.
- Un directeur peut réaffecter un commercial vers un autre manager

#### Impression
- **Bon de commande, Facture, Reçu.** Ils s'impriment depuis les ventes et les encaissements.
- Le reçu couvre une tranche. La facture couvre une vente soldée.
- Le menu d'impression a une largeur fixe. Sa liste verticale est propre.

#### Catalogue Produits dans les Ventes
- Les formulaires Ventes et Contrats chargent le sélecteur de produits.
- Les résultats des encaissements donnent le détail des produits. Ce détail sert à l'impression.

#### Clients
- Le RBAC est renforcé. Une alerte signale les doublons à la création. La modification et la suppression sont limitées.
- Produits en lecture seule pour les commerciaux

#### UI/UX
- Nom de la rizerie affiché dans la topbar à côté du compte
- Argumentaire de vente adapté au pays de la rizerie
- L'interface admin exporte en CSV les ventes et les clients, par période ou par rizerie.

---

### Après-midi : dashboard admin et page Commerciaux

#### Refonte du dashboard admin
- **Groupement des comptes par rizerie.** Chaque section a une couleur, un drapeau et une ville.
- **Menu 3 points (⋮).** Il remplace les boutons inline dans l'admin.
  - Plusieurs corrections ont suivi. Le menu s'ouvre vers le haut. Il utilise un React Portal.
- **Impact RIZAO.** Ce tableau compare la performance de chaque rizerie avant et après RIZAO.
  - KPIs : CA généré, CA avant RIZAO, taux de recouvrement, emplois, clients, contrats
  - Graphique CA mensuel (12 derniers mois)
  - Les libellés sont corrigés : "avant RIZAO" et "CA généré via Cockpit".
  - Le tableau montre seulement les emplois créés grâce à RIZAO. Il ne montre pas le total.
- Le dashboard gagne deux cartes KPI : "Encaissé ce mois" et "Recouvrement".
- L'évolution du CA est corrigée dans la table des rizeries. Elle compare l'année N à l'année N-1.

#### Page Commerciaux : 3 fonctionnalités majeures
- **Groupement par manager.** Chaque équipe a sa section "Équipe de X" sur fond bleu. Une section "Sans manager" regroupe les autres.
- **Composant `KebabMenu.jsx` partagé.** Il sort d'AdminDashboard. Toutes les pages l'utilisent.
  - Vendeur : Éditer · Mot de passe · Assigner/Réassigner manager · Promouvoir · Supprimer
  - Manager : Voir l'équipe · Éditer · Mot de passe · Supprimer
- **Voir l'équipe.** Une grande modale donne les KPIs de l'équipe. Elle donne aussi un tableau par vendeur.
- **Assigner / Réassigner un manager.** Une modale propose une liste. Le rizier peut aussi utiliser cet endpoint.
- Le formulaire et le tableau Emplois gagnent le champ `periode_rizao` (Avant/Avec RIZAO).

#### Navigation Admin
- "Impact RIZAO" quitte l'onglet admin. Il devient une **page autonome dans la sidebar** (`/admin/impact-rizao`).
- "Comptes" renommé en **"Administration"** dans la sidebar

#### Corrections alignement
- La table Administration utilise `table-layout: fixed` et `colgroup`. Les colonnes s'alignent entre les cartes rizerie.
- Les en-têtes CA total et Ventes s'alignent à droite ou au centre.

---

### Soir : corrections RBAC et encaissements

#### Fixes interface
- Le panel admin assigne bien un vendeur à un manager.

#### Sidebar vendeur
- Les vendeurs ne voient plus l'onglet "Direction". Il est réservé aux managers et au-dessus.
- Kebab menu ajouté sur les pages Produits, Recouvrement et Encaissements
- Fix kebab menu dans la page Ventes

#### Backend : encaissements
- **Nouvel endpoint** `GET /api/encaissements/mois`. Il donne les versements encaissés ce mois. Il filtre par scope.

#### Sécurité RBAC
- `DELETE /api/ventes/:id` est réservé aux managers et au-dessus. Un vendeur reçoit 403.
- Chaque rizerie a ses numéros de transaction. Un compteur atomique évite les race conditions.

---

## 25 juin 2026

*(aucun commit enregistré)*

---

## 8 septembre 2026

### Base de données
- **Fix contrainte de rôle.** La contrainte `users_role_check` de `schema.sql` acceptait 5 rôles. Les autres rôles étaient refusés. La contrainte couvre maintenant tous les rôles valides.

---

## 09 septembre 2026

*(aucun commit enregistré)*

---

## 10 septembre 2026

*(aucun commit enregistré)*

---

## 11 septembre 2026

*(aucun commit enregistré)*

---

## 12 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 11 septembre 2026.

---

## 13 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 12 septembre 2026.

---

## 14 septembre 2026

### Module Dépôt-Vente
- **Nouveau module dépôt-vente.** Certains distributeurs paient seulement ce qu'ils ont vendu. Ils le déclarent dans des rapports réguliers. Le module ajoute les tables `depots_vente` et `depot_mouvements`. Il ajoute aussi la route `routes/depots.js`.
- Le CA compte les quantités vendues, pas le dépôt initial. Ce CA entre dans les encaissements, le dashboard, le forecast et la rentabilité.
- **Délais de paiement B2B.** Les ventes institutionnelles ont trois nouvelles échéances : J+45, J+60 et J+90.

### Administration
- **Suppression forcée (superadmin).** Le superadmin peut supprimer un compte racine ou une rizerie. Cela marche même s'il reste des ventes, des emplois ou des clients.
- Avant la suppression, les données métier partent en snapshot JSON dans `deleted_data_archives`.
- `GET /api/admin/archives` permet de lire les archives.

### Interface
- **Sidebar repliable.** L'icône hamburger réduit la barre latérale. L'écran gagne de la place.

---

## 15 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 14 septembre 2026.

---

## 16 septembre 2026

*(aucun commit enregistré)*

---

## 17 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 16 septembre 2026.

---

## 18 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 17 septembre 2026.

---

## 19 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 18 septembre 2026.

---

## 20 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 19 septembre 2026.

---

## 21 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 20 septembre 2026.

---

## 22 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 21 septembre 2026.

---

## 23 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 22 septembre 2026.

---

## 24 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 23 septembre 2026.

---

## 25 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 24 septembre 2026.

---

## 26 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 25 septembre 2026.

---

## 27 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 26 septembre 2026.

---

## 28 septembre 2026

### Périmètre rizier : refonte du scope multi-rizier

- **Scope élargi à la rizerie entière.** Un rizier voit toute l'activité de sa rizerie. Cela couvre riziers, directeurs, managers et vendeurs. Avant, il voyait seulement sa hiérarchie `parent_id`.
- Le middleware `scope.js` est corrigé. Le périmètre couvre tous les comptes de la rizerie, à tous les niveaux.
- **Emplois partagés entre riziers.** Tous les riziers d'une rizerie voient ses fiches emplois (`routes/emplois.js`).

---

## 29 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 28 septembre 2026.

---

## 30 septembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 29 septembre 2026.

---

## 1er octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 30 septembre 2026.

---

## 2 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 1er octobre 2026.

---

## 3 octobre 2026

*(aucun commit enregistré)*

---

## 4 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 3 octobre 2026.

---

## 5 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 4 octobre 2026.

---

## 6 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 5 octobre 2026.

---

## 7 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 6 octobre 2026.

---

## 8 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 7 octobre 2026.

---

## 9 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 8 octobre 2026.

---

## 10 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 9 octobre 2026.

---

## 11 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 10 octobre 2026.

---

## 12 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 11 octobre 2026.

---

## 13 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 12 octobre 2026.

---

## 14 octobre 2026

### Mode démo
- **Compte démo avec fausse API locale.** La page de connexion a un bouton « Essayer la démo ». Il passe l'application sur une API simulée dans le navigateur. Aucun appel ne part vers le serveur.
- Des données fictives décrivent une rizerie complète : équipe, clients, ventes, contrats, dépôts.
- **Bandeau démo.** Une barre reste en haut de l'écran. Un bouton remet les données à zéro. Un autre bouton quitte le mode démo.

---

## 15 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 14 octobre 2026.

---

## 16 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 15 octobre 2026.

---

## 17 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 16 octobre 2026.

---

## 18 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 17 octobre 2026.

---

## 19 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 18 octobre 2026.

---

## 20 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 19 octobre 2026.

---

## 21 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 20 octobre 2026.

---

## 22 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 21 octobre 2026.

---

## 23 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 22 octobre 2026.

---

## 24 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 23 octobre 2026.

---

## 25 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 24 octobre 2026.

---

## 26 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 25 octobre 2026.

---

## 27 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 26 octobre 2026.

---

## 28 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 27 octobre 2026.

---

## 29 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 28 octobre 2026.

---

## 30 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 29 octobre 2026.

---

## 31 octobre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 30 octobre 2026.

---

## 1er novembre 2026

### Maintenance
- **Journal quotidien.** Le journal reçoit l\'entrée du 31 octobre 2026.

---

## 2 novembre 2026

*(aucun commit enregistré)*

---

## 3 novembre 2026

*(aucun commit enregistré)*

---

## 5 novembre 2026

### Refonte de l'interface utilisateur
- **Page de connexion.** Le nouveau design a deux panneaux. L'identité est à gauche. La connexion est à droite. Sur ordinateur, la page tient sans défilement. Sur mobile, le formulaire prend tout l'écran. L'authentification, les validations et les redirections ne changent pas.
- **Sidebar repliable.** La barre latérale mesure 260 px ouverte et 80 px réduite. Elle a des sous-menus, des infobulles et un repère de page active. Elle se replie seule sur tablette. Sur mobile, elle devient un drawer.
- **Header fixe.** Il contient le fil d'Ariane et la recherche (Ctrl+K). Il contient aussi les notifications et le menu profil.
- Un seul fichier configure les menus. Il les filtre par rôle. Le contenu principal et le pied de page s'adaptent à l'écran.

---

## 6 novembre 2026

### Page de connexion & Identité visuelle
- **Refonte complète de la page de connexion Sales Cockpit.** Le panneau gauche a un dégradé vert-bleu PFS. Ce dégradé s'efface vers le formulaire. Un message accueille au nom de Partners In Food Solutions. Sur grand écran, le formulaire passe de 430 à 500 px.
- Le logo PFS passe à 72 px. Le nom « Partners In Food Solutions » tient sur une ligne, en gras. « Sales Cockpit » passe à 25 px.
- Le texte utilise Source Sans 3. Les titres utilisent Source Serif 4. Les chiffres sont tabulaires.
- L'application s'appelle maintenant « Sales Cockpit ».

### Corrections & Nettoyage
- **Notifications.** La cloche montre les vraies alertes à traiter (`/api/actions`). Avant, son compteur restait à 0. Les rôles admin et comptable ne la voient pas.
- **« Se souvenir de moi ».** L'identifiant est gardé seulement après une connexion réussie.
- **Statistiques de connexions (admin).** Le journal enregistre LOGIN_SUCCESS avec `actor_id = NULL`. L'utilisateur est dans `target_id`. Le nombre d'utilisateurs uniques restait donc à 0. Le calcul lit maintenant `target_id`.
- **Scripts e-mails de bienvenue supprimés.** Ils ne marchaient plus. Le chemin du logo manquait. Le mot de passe partait en clair. Les dépendances nodemailer et resend sont retirées.

---

## 12 novembre 2026

### Documentation & Textes de l'interface
- **Simplification des textes de l'interface.** Les textes d'aide, le Guide, les bannières et les messages sont réécrits. Ils sont plus courts et plus directs.
- La prose du README et du JOURNAL est allégée.

---

*Fichier généré automatiquement. Dernière mise à jour : 12 novembre 2026.*
