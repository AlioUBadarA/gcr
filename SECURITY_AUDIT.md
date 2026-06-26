# SECURITY_AUDIT.md - Cockpit Commercial PFS

Suivi de la mise en conformite securite. Ce fichier est la source de verite de l'avancement. Il est mis a jour a la fin de chaque session.

## Convention d'etat

Cocher la case quand le point est termine et teste.

- [ ] = a faire
- [x] = fait et teste
- Ajouter "(EN COURS)" en fin de ligne pour un point demarre mais non termine.
- Ajouter "(HORS PERIMETRE)" pour un point repousse, avec une note dans la section Risques ouverts.

Stack : Node.js / Express, PostgreSQL, React 18 / Vite, Render.
Roles : vendeur, manager, directeur, rizier, support, superadmin.

---

## Suivi des bugs connus

| # | Severite | Description | Fichier | Etat |
|---|---|---|---|---|
| B1 | Critique | GET /api/auth/me ne retourne pas le role | routes/auth.js:57 | **Corrige** (session 1) |
| B2 | Critique | DELETE /api/ventes/:id, support non autorise | routes/ventes.js:213 | **Corrige** (session 1) |
| B3 | Moyenne | Scope recursif, directeur sous directeur exclu | middleware/scope.js:17 | **Corrige** (session 2) |
| B4 | Moyenne | Vendeur accede a /pilotage via URL directe | src/App.jsx:73 | **Corrige** (session 1) |
| B5 | Moyenne | PUT /api/ventes/:id, manager modifie les ventes de ses vendeurs | routes/ventes.js:110 | **Corrige** (session 2) |
| B6 | Elevee | CORS retombe sur "*" si FRONTEND_URL absent en prod | server.js:14 | **Corrige** (session 1) |

---

## Session 1 - Controle d'acces serveur et configuration

Branche : securite/session-1

- [x] B6 corrige : echec au demarrage si FRONTEND_URL absent en production, plus aucun repli sur CORS "*"
- [x] B1 corrige : le role est inclus dans la reponse de /api/auth/me
- [x] Module unique de permissions cree (matrice role x action) comme source de verite (middleware/permissions.js)
- [x] Tous les endpoints branches sur la matrice, plus aucune liste de roles ecrite a la main
- [x] B2 corrige via la matrice (support reintegre dans ventes:delete)
- [x] B4 corrige : verification d'acces cote serveur pour /pilotage (requirePerm) + ManagerRoute cote frontend
- [x] Repli de role par defaut neutralise : "|| 'rizier'" supprime ; role absent ou invalide → 401 (fail closed)
- [x] Endpoints sensibles restreints par role : POST /api/ventes/:id/versements et PATCH /api/ventes/:id/statut
- [x] /register desactivee cote serveur (403) et redirige vers /login cote frontend — deja en place, confirme
- [x] Acces verifie par role (vendeur, manager, directeur, rizier, support, superadmin)
- [x] Tests ajoutes et rejouables (tests/session1_security.sh)
- [x] Rapport de fin de session redige

---

## Session 2 - Autorisation au niveau objet et perimetre des donnees

Branche : securite/session-2

- [x] B5 corrige : vendeur et manager limites a leurs propres ventes sur PUT ; directeur+ garde le scope complet
- [x] B3 corrige : CTE recursive repare (u.role inclut desormais 'directeur' dans la partie recursive)
- [x] Controle de propriete (anti-IDOR) verifie sur ventes, clients, contrats, encaissements, equipe — scopeIds ou rizerieId filtrent toutes les operations
- [x] Un compte support ne peut pas modifier, suspendre, reinitialiser le mdp ou supprimer un superadmin (403)
- [x] scopeIds applique sur toutes les lectures et ecritures — verifie route par route
- [x] Lacune S1 corrigee : POST /api/encaissements/:type/:id/versements maintenant restreint a manager+ via la matrice
- [x] Tests ajoutes et rejouables (tests/session2_security.sh)
- [x] Rapport de fin de session redige

---

## Session 3 - Validation des entrees et anti-injection

Branche : securite/session-3

- [x] Audit complet des requetes SQL : toutes parametrees, aucune concatenation avec entree utilisateur (confirme)
- [x] Helper middleware/validate.js cree (isPositiveNumber, isNonNegativeNumber, isValidDate, isValidUUID, maxLen)
- [x] Validation numerique : quantite, prix_unitaire, montant, salaire, cout_unitaire — NaN et valeurs negatives rejetes (400)
- [x] Validation dates : date_vente, date_echeance, date_debut, date_fin, date — format YYYY-MM-DD exige (400)
- [x] Cas limite sur-versement gere — versement superieur au solde restant du rejete (400) dans ventes et encaissements
- [x] statut_paiement invalide refuse a la creation (POST /api/ventes) — alignement avec PATCH /statut
- [x] Bornes forecast : mois (1-12), annee (2015-2040), objectif_montant >= 0
- [x] Longueurs max sur champs texte : nom/client_nom/producteur_nom (200 chars), note (2000 chars), zone (200 chars)
- [x] limit GET /api/ventes plafonne a 500, offset force >= 0
- [x] UUID rizerie_id valide avant passage en base dans GET /api/admin/export (400 si invalide)
- [x] Rejet propre des entrees invalides — code 400 et message clair sur tous les points ci-dessus
- [x] Tests ajoutes et rejouables (tests/session3_security.sh)
- [x] Rapport de fin de session redige

---

## Session 4 - Gestion des sessions et authentification renforcee

Branche : securite/session-4

- [x] Strategie de jeton choisie et justifiee : JWT 7j avec revocation cote serveur (token_revoked_at) comme defense principale
- [x] Revocation effective : colonne token_revoked_at sur users — positionne a NOW() lors d'une suspension ; authMiddleware verifie iat < token_revoked_at sur chaque requete
- [x] Rate limiting par compte : lockout 15min apres 5 echecs de connexion (login_attempts + locked_until sur users)
- [x] Verrouillage temporaire apres 5 echecs de connexion par compte (429 avec duree restante)
- [ ] MFA (TOTP) — HORS PERIMETRE SESSION 4 : necessite nouveau flux login 2 etapes, packages otplib+qrcode et UI frontend. A implémenter comme feature dédiée avant mise en production des comptes superadmin/support.
- [x] Impersonation durcie : superadmin et support ne peuvent pas etre impersonnes (403) ; token impersonation deja limite a 2h
- [x] Boucle de redirection 401 corrigee : api.js exclut les endpoints /api/auth/* et verifie pathname !== '/login' avant redirect
- [x] Logout propre : 5 cles localStorage videes (pfs_token, pfs_user, pfs_admin_token, pfs_admin_user, pfs_impersonating) — confirme
- [x] Tests ajoutes et rejouables (tests/session4_security.sh)
- [x] Rapport de fin de session redige

---

## Session 5 - Exploitation, robustesse et conformite

Branche : securite/session-5

- [ ] Scan automatique des dependances active (npm audit en CI, Dependabot ou equivalent)
- [ ] Vulnerabilites critiques des dependances traitees
- [ ] Logs de securite persistants en place (au-dela des 24h du plan Free)
- [ ] Alertes sur anomalies (echecs de connexion en serie, acces refuses repetes)
- [ ] Strategie de sauvegarde documentee et activee (PostgreSQL payant, sauvegardes quotidiennes, PITR)
- [ ] Rotation des secrets (cle JWT, identifiants base)
- [ ] Utilisateur base de donnees en moindre privilege
- [ ] Revue finale sur la grille OWASP Top 10 (section ci-dessous)
- [ ] Rapport de conformite redige
- [ ] Note protection des donnees personnelles (loi 2008-12, CDP Senegal) preparee

---

## Revue OWASP Top 10 (controle final, session 5)

- [ ] A01 Controle d'acces defaillant : autorisations cote serveur, anti-IDOR, scope par role
- [ ] A02 Defaillances cryptographiques : HTTPS force, bcrypt, secrets hors code
- [ ] A03 Injection : requetes SQL parametrees, validation des entrees
- [ ] A04 Conception non securisee : matrice de permissions centralisee, cas limites metier
- [ ] A05 Mauvaise configuration : CORS strict, en-tetes Helmet, pas de valeurs par defaut dangereuses
- [ ] A06 Composants vulnerables : scan de dependances, mises a jour
- [ ] A07 Identification et authentification : MFA, gestion des tokens, verrouillage brute force
- [ ] A08 Integrite logicielle et des donnees : transactions, contraintes, sauvegardes
- [ ] A09 Journalisation et supervision : logs persistants, alertes
- [ ] A10 SSRF : verifier les appels sortants si des integrations externes sont ajoutees

---

## Risques ouverts et points hors perimetre

Lister ici tout probleme identifie mais non traite dans la session en cours, avec la session cible.

- [Session 3 — CLOS] Validation et anti-injection : traite. Voir checklist Session 3.
- [Session 4 — HORS PERIMETRE] MFA (TOTP) pour superadmin et support : necessaire avant prod. Packages otplib+qrcode, flux login 2 etapes, page setup frontend. A implementer comme feature dédiée.
- [Session 4] Tokens JWT 14 jours sans revocation possible — risque si token vole
- [Session 1 — observation] routes/pilotage.js : PUT /visites/:id et DELETE /visites/:id filtrent sur req.userId uniquement. Correct pour un vendeur, a reconfirmer si un manager/directeur doit pouvoir modifier les visites de son equipe (Session 2 clos — hors perimetre actuel).
- [Session 1 — observation] Les tokens JWT ont une duree de vie de 14 jours sans revocation possible. Risque eleve si un token est vole. A traiter en Session 4.
- [Session 1 — observation] routes/pilotage.js : les routes PUT /visites/:id et DELETE /visites/:id filtrent sur req.userId mais n'utilisent pas scopeIds. Correct pour un vendeur qui modifie ses propres visites, a reconfirmer en Session 2.

---

## Historique des sessions

A completer a la fin de chaque session : date, branche, ce qui est fait, ce qui reste, tests ajoutes.

### Session 1

- Date : 2026-06-26
- Branche : securite/session-1
- Fait : B1, B2, B4, B6 corriges. Fallback rizier supprime. Module permissions.js cree. PATCH statut et POST versements restreints.
- Reste : B3, B5 (session 2). MFA, revocation token (session 4).
- Tests : tests/session1_security.sh — BASE_URL=http://localhost:3000 bash tests/session1_security.sh

### Session 2

- Date : 2026-06-26
- Branche : securite/session-2
- Fait : B3 et B5 corriges. Anti-IDOR support→superadmin (4 routes admin). Lacune S1 corrigee (encaissements versements). Verification scope sur toutes les routes.
- Reste : Session 3 (validation entrees, SQL), Session 4 (tokens, MFA).
- Tests : tests/session2_security.sh — BASE_URL=http://localhost:3000 bash tests/session2_security.sh

### Session 3

- Date : 2026-06-26
- Branche : securite/session-3
- Fait : Audit SQL confirme (aucune concatenation). Helper validate.js cree. Validation numerique (NaN, negatifs). Dates YYYY-MM-DD. Cap sur-versement (ventes + encaissements). statut_paiement valide a la creation. Bornes forecast. Longueurs max. limit plafonne. UUID export.
- Reste : Session 4 (tokens, MFA). Session 5 (logs, deps, conformite).
- Tests : tests/session3_security.sh — BASE_URL=http://localhost:3000 bash tests/session3_security.sh

### Session 4

- Date : 2026-06-26
- Branche : securite/session-4
- Fait : Revocation immediate (token_revoked_at + check authMiddleware). Lockout brute force (5 echecs = 15min, login_attempts + locked_until). TTL token 14j → 7j. Fix boucle 401 (api.js). Impersonation durcie (superadmin/support non impersonnables). Logout clean confirme.
- Reste : MFA TOTP (hors perimetre, voir risques ouverts). Session 5 (logs, deps, conformite OWASP).
- Tests : tests/session4_security.sh — BASE_URL=http://localhost:3000 bash tests/session4_security.sh

### Session 5

- Date :
- Branche : securite/session-5
- Fait :
- Reste :
- Tests :
