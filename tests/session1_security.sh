#!/usr/bin/env bash
# ============================================================
# Tests de sécurité Session 1 — Contrôle d'accès serveur
# Usage : BASE_URL=http://localhost:3000 bash tests/session1_security.sh
# Prérequis : jq installé, serveur démarré, BASE_URL défini.
# ============================================================

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0; FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  [OK]  $label"
    PASS=$((PASS+1))
  else
    echo "  [KO]  $label  (attendu=$expected, obtenu=$actual)"
    FAIL=$((FAIL+1))
  fi
}

login() {
  local email="$1" pass="$2"
  curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}" \
    | jq -r '.token // ""'
}

auth_header() { echo "Authorization: Bearer $1"; }

echo "=== B6 : CORS — FRONTEND_URL obligatoire en production ==="
echo "  Vérification manuelle : lancer NODE_ENV=production sans FRONTEND_URL"
echo "  Attendu : le serveur refuse de démarrer (exit 1)."
echo "  (non automatisable sans relancer le processus)"

echo ""
echo "=== B1 : GET /api/auth/me retourne le role ==="
# Nécessite un compte vendeur valide. Adaptez email/password.
VENDEUR_EMAIL="${VENDEUR_EMAIL:-vendeur@test.com}"
VENDEUR_PASS="${VENDEUR_PASS:-password}"
TOK_VENDEUR=$(login "$VENDEUR_EMAIL" "$VENDEUR_PASS")
if [ -z "$TOK_VENDEUR" ]; then
  echo "  [SKIP] Impossible de se connecter en vendeur (vérifiez VENDEUR_EMAIL / VENDEUR_PASS)"
else
  ROLE=$(curl -s -H "$(auth_header "$TOK_VENDEUR")" "$BASE_URL/api/auth/me" | jq -r '.role // ""')
  check "GET /api/auth/me contient le champ role" "vendeur" "$ROLE"
fi

echo ""
echo "=== middleware/auth.js : fail closed (token sans role) ==="
# Forge un token sans champ role pour vérifier le rejet.
FAKE_TOKEN=$(node -e "
  const jwt = require('jsonwebtoken');
  console.log(jwt.sign({ userId: '00000000-0000-0000-0000-000000000000', nom: 'Test' }, process.env.JWT_SECRET || 'dev_secret'));
")
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $FAKE_TOKEN" "$BASE_URL/api/auth/me")
check "Token sans role → 401" "401" "$STATUS"

echo ""
echo "=== B2 : DELETE /api/ventes/:id — support autorisé ==="
SUPPORT_EMAIL="${SUPPORT_EMAIL:-support@test.com}"
SUPPORT_PASS="${SUPPORT_PASS:-password}"
TOK_SUPPORT=$(login "$SUPPORT_EMAIL" "$SUPPORT_PASS")
VENTE_ID="${VENTE_ID:-}"
if [ -z "$TOK_SUPPORT" ]; then
  echo "  [SKIP] Connexion support impossible (vérifiez SUPPORT_EMAIL / SUPPORT_PASS)"
elif [ -z "$VENTE_ID" ]; then
  echo "  [SKIP] Définissez VENTE_ID avec l'UUID d'une vente de test"
else
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    -H "$(auth_header "$TOK_SUPPORT")" \
    "$BASE_URL/api/ventes/$VENTE_ID")
  check "Support peut supprimer une vente (200 ou 404, pas 403)" "200" "$STATUS"
fi

echo ""
echo "=== B2 : DELETE — vendeur refusé (403) ==="
if [ -n "$TOK_VENDEUR" ] && [ -n "$VENTE_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    -H "$(auth_header "$TOK_VENDEUR")" \
    "$BASE_URL/api/ventes/$VENTE_ID")
  check "Vendeur ne peut pas supprimer (403)" "403" "$STATUS"
fi

echo ""
echo "=== B4 : GET /api/pilotage — vendeur refusé (403) ==="
SEMAINE="${SEMAINE:-2026-W26}"
if [ -n "$TOK_VENDEUR" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "$(auth_header "$TOK_VENDEUR")" \
    "$BASE_URL/api/pilotage/$SEMAINE")
  check "Vendeur n'accède pas à /api/pilotage (403)" "403" "$STATUS"
fi

echo ""
echo "=== B4 : GET /api/pilotage — manager autorisé (200) ==="
MANAGER_EMAIL="${MANAGER_EMAIL:-manager@test.com}"
MANAGER_PASS="${MANAGER_PASS:-password}"
TOK_MANAGER=$(login "$MANAGER_EMAIL" "$MANAGER_PASS")
if [ -z "$TOK_MANAGER" ]; then
  echo "  [SKIP] Connexion manager impossible (vérifiez MANAGER_EMAIL / MANAGER_PASS)"
else
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "$(auth_header "$TOK_MANAGER")" \
    "$BASE_URL/api/pilotage/$SEMAINE")
  check "Manager accède à /api/pilotage (200)" "200" "$STATUS"
fi

echo ""
echo "=== PATCH /api/ventes/:id/statut — vendeur refusé (403) ==="
if [ -n "$TOK_VENDEUR" ] && [ -n "$VENTE_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    -H "$(auth_header "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"statut_paiement":"Paye"}' \
    "$BASE_URL/api/ventes/$VENTE_ID/statut")
  check "Vendeur ne peut pas changer le statut (403)" "403" "$STATUS"
fi

echo ""
echo "=== POST /api/ventes/:id/versements — vendeur refusé (403) ==="
if [ -n "$TOK_VENDEUR" ] && [ -n "$VENTE_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth_header "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"montant":100,"mode":"Espèces"}' \
    "$BASE_URL/api/ventes/$VENTE_ID/versements")
  check "Vendeur ne peut pas enregistrer un versement (403)" "403" "$STATUS"
fi

echo ""
echo "=== Sans token — 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/me")
check "GET /api/auth/me sans token → 401" "401" "$STATUS"

echo ""
echo "=== /api/auth/register désactivé (403) ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"x@x.com","password":"abc"}' \
  "$BASE_URL/api/auth/register")
check "POST /api/auth/register → 403" "403" "$STATUS"

echo ""
echo "======================================="
echo "Résultat : $PASS OK / $FAIL KO"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
