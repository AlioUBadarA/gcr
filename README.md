# PFS Backend - API Commerciale

Backend Node.js/Express pour la plateforme de pilotage commercial PFS.

> Le frontend (React/Vite) vit dans un dépôt séparé (`pfs-cockpit`). Ce backend est déjà déployé sur Render ; consultez votre dashboard Render pour les noms de service et URLs réels — les exemples ci-dessous utilisent des placeholders génériques.
>
> Cette doc ne liste qu'un sous-ensemble des endpoints (auth, clients, ventes, pilotage, dashboard) à titre d'exemple. Toutes les autres ressources (`routes/*.js` : produits, contrats, prospection, emplois, encaissements, admin, etc.) suivent le même pattern REST + JWT.

## Stack

- **Node.js** + **Express** - serveur API REST
- **PostgreSQL** - base de donnees (hebergee sur Render)
- **JWT** - authentification stateless
- **bcryptjs** - hachage des mots de passe

---

## Deploiement sur Render (etape par etape)

### 1. Creer un compte GitHub et pousser le code

```bash
# Dans le dossier du projet
git init
git add .
git commit -m "Initial commit - PFS Backend"

# Creer un repo sur github.com puis :
git remote add origin https://github.com/VOTRE_USER/pfs-backend.git
git push -u origin main
```

### 2. Creer la base de donnees PostgreSQL sur Render

1. Aller sur [render.com](https://render.com) > **New** > **PostgreSQL**
2. Nom : `pfs-db`
3. Plan : **Free**
4. Cliquer **Create Database**
5. Copier l'**Internal Database URL** (commence par `postgresql://`)

### 3. Deployer le backend sur Render

1. **New** > **Web Service**
2. Connecter votre repo GitHub backend
3. Parametres :
   - **Name** : au choix (ex: `pfs-api`)
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : Free
4. Dans **Environment Variables**, ajouter :
   - `DATABASE_URL` : coller l'Internal Database URL copiee a l'etape 2
   - `JWT_SECRET` : une chaine aleatoire longue (ex: generer sur [randomkeygen.com](https://randomkeygen.com))
   - `NODE_ENV` : `production`
   - `FRONTEND_URL` : URL de votre frontend (ou `*` pour tout autoriser)
5. Cliquer **Create Web Service**

Le schema SQL s'initialise automatiquement au premier demarrage.

---

## Endpoints API

### Authentification

| Methode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/api/auth/register` | Désactivé — renvoie 403 (les comptes sont créés par le superadmin via `/api/admin/users`) |
| POST | `/api/auth/login` | Se connecter |
| GET | `/api/auth/me` | Profil courant |
| PUT | `/api/auth/me` | Modifier profil |

### Clients

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/clients` | Liste (filtres: statut, type, search) |
| POST | `/api/clients` | Ajouter |
| GET | `/api/clients/:id` | Detail |
| PUT | `/api/clients/:id` | Modifier |
| PATCH | `/api/clients/:id/statut` | Changer statut |
| DELETE | `/api/clients/:id` | Supprimer |

### Ventes

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/ventes` | Liste (filtres: mois, annee, statut, client_id) |
| POST | `/api/ventes` | Enregistrer une vente |
| GET | `/api/ventes/:id` | Detail |
| PUT | `/api/ventes/:id` | Modifier |
| PATCH | `/api/ventes/:id/statut` | Changer statut paiement |
| DELETE | `/api/ventes/:id` | Supprimer |

### Pilotage

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/pilotage/:semaine` | Plan de la semaine |
| PUT | `/api/pilotage/:semaine` | Sauvegarder le plan (6 jours) |
| GET | `/api/pilotage/:semaine/actions` | Actions correctives |
| PUT | `/api/pilotage/:semaine/actions` | Sauvegarder actions |

### Dashboard

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/dashboard` | KPIs, CA mensuel, top clients, creances |

### Health check

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/health` | Statut du serveur |

---

## Exemples de requetes

Remplacez `https://votre-backend.onrender.com` par l'URL réelle de votre service Render.

### Login
```bash
curl -X POST https://votre-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"mamadou@example.com","password":"secret123"}'
```

### Ajouter un client (avec token)
```bash
curl -X POST https://votre-backend.onrender.com/api/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer VOTRE_TOKEN" \
  -d '{"nom":"Modou Diop","type":"Grossiste","statut":"Prospect","zone":"Marche Tilene","volume_estime":2000}'
```

### Enregistrer une vente
```bash
curl -X POST https://votre-backend.onrender.com/api/ventes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer VOTRE_TOKEN" \
  -d '{"client_nom":"Modou Diop","date_vente":"2026-06-08","produit":"Riz blanc 25kg","quantite":100,"prix_unitaire":450,"statut_paiement":"En cours"}'
```

---

## Variables d'environnement requises

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | URL de connexion PostgreSQL |
| `JWT_SECRET` | Cle secrete pour signer les tokens JWT |
| `NODE_ENV` | `production` sur Render |
| `FRONTEND_URL` | URL du frontend (CORS) |

---

## Developpement local

```bash
cp .env.example .env
# Remplir les valeurs dans .env

npm install
npm run dev
```
