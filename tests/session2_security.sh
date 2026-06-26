#!/usr/bin/env bash
# ============================================================
# Tests de sécurité Session 2 — Autorisation objet et périmètre
# Usage : BASE_URL=http://localhost:3000 bash tests/session2_security.sh
# Prérequis : jq, serveur démarré, variables d'environnement renseignées.
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
  curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r '.token // ""'
}

auth() { echo "Authorization: Bearer $1"; }

# Identifiants à configurer
VENDEUR_EMAIL="${VENDEUR_EMAIL:-vendeur@test.com}"
VENDEUR_PASS="${VENDEUR_PASS:-password}"
MANAGER_EMAIL="${MANAGER_EMAIL:-manager@test.com}"
MANAGER_PASS="${MANAGER_PASS:-password}"
DIRECTEUR_EMAIL="${DIRECTEUR_EMAIL:-directeur@test.com}"
DIRECTEUR_PASS="${DIRECTEUR_PASS:-password}"
SUPPORT_EMAIL="${SUPPORT_EMAIL:-support@test.com}"
SUPPORT_PASS="${SUPPORT_PASS:-password}"
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-admin@test.com}"
SUPERADMIN_PASS="${SUPERADMIN_PASS:-password}"

# IDs de test à configurer
VENTE_VENDEUR_ID="${VENTE_VENDEUR_ID:-}"        # vente appartenant au vendeur
VENTE_AUTRE_ID="${VENTE_AUTRE_ID:-}"            # vente appartenant à un autre vendeur (hors scope du manager)
SUPERADMIN_USER_ID="${SUPERADMIN_USER_ID:-}"    # UUID d'un autre compte superadmin

TOK_VENDEUR=$(login "$VENDEUR_EMAIL" "$VENDEUR_PASS")
TOK_MANAGER=$(login "$MANAGER_EMAIL" "$MANAGER_PASS")
TOK_DIRECTEUR=$(login "$DIRECTEUR_EMAIL" "$DIRECTEUR_PASS")
TOK_SUPPORT=$(login "$SUPPORT_EMAIL" "$SUPPORT_PASS")
TOK_SUPERADMIN=$(login "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASS")

echo "=== B5 : PUT /api/ventes/:id — manager limité à ses propres ventes ==="
if [ -n "$TOK_MANAGER" ] && [ -n "$VENTE_VENDEUR_ID" ]; then
  # Un manager qui tente de modifier la vente d'un de ses vendeurs doit obtenir 404 (pas trouvée sous son userId)
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    -H "$(auth "$TOK_MANAGER")" \
    -H "Content-Type: application/json" \
    -d '{"client_nom":"Test","date_vente":"2026-01-01","produit":"Riz","quantite":10,"prix_unitaire":500,"statut_paiement":"En cours"}' \
    "$BASE_URL/api/ventes/$VENTE_VENDEUR_ID")
  check "Manager ne peut pas modifier la vente d'un vendeur (404)" "404" "$STATUS"
fi

echo ""
echo "=== B5 : PUT /api/ventes/:id — directeur peut modifier les ventes de son équipe ==="
if [ -n "$TOK_DIRECTEUR" ] && [ -n "$VENTE_VENDEUR_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    -H "$(auth "$TOK_DIRECTEUR")" \
    -H "Content-Type: application/json" \
    -d '{"client_nom":"Test","date_vente":"2026-01-01","produit":"Riz","quantite":10,"prix_unitaire":500,"statut_paiement":"En cours"}' \
    "$BASE_URL/api/ventes/$VENTE_VENDEUR_ID")
  check "Directeur peut modifier la vente d'un vendeur (200)" "200" "$STATUS"
fi

echo ""
echo "=== B3 : scope directeur sous directeur ==="
echo "  Vérification manuelle : créer directeur_A → directeur_B → manager → vendeur."
echo "  directeur_A doit voir les ventes du vendeur via GET /api/ventes."
echo "  (non automatisable sans seed spécifique)"

echo ""
echo "=== Anti-IDOR : support ne peut pas supprimer un superadmin ==="
if [ -n "$TOK_SUPPORT" ] && [ -n "$SUPERADMIN_USER_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    -H "$(auth "$TOK_SUPPORT")" \
    "$BASE_URL/api/admin/users/$SUPERADMIN_USER_ID")
  check "Support ne peut pas supprimer un superadmin (403)" "403" "$STATUS"
fi

echo ""
echo "=== Anti-IDOR : support ne peut pas suspendre un superadmin ==="
if [ -n "$TOK_SUPPORT" ] && [ -n "$SUPERADMIN_USER_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    -H "$(auth "$TOK_SUPPORT")" \
    -H "Content-Type: application/json" \
    -d '{"suspended":true,"reason":"test"}' \
    "$BASE_URL/api/admin/users/$SUPERADMIN_USER_ID/suspend")
  check "Support ne peut pas suspendre un superadmin (403)" "403" "$STATUS"
fi

echo ""
echo "=== Anti-IDOR : support ne peut pas réinitialiser le mdp d'un superadmin ==="
if [ -n "$TOK_SUPPORT" ] && [ -n "$SUPERADMIN_USER_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    -H "$(auth "$TOK_SUPPORT")" \
    -H "Content-Type: application/json" \
    -d '{"new_password":"nouveaumotdepasse123"}' \
    "$BASE_URL/api/admin/users/$SUPERADMIN_USER_ID/password")
  check "Support ne peut pas réinitialiser le mdp d'un superadmin (403)" "403" "$STATUS"
fi

echo ""
echo "=== Anti-IDOR : superadmin peut modifier un autre superadmin (200) ==="
if [ -n "$TOK_SUPERADMIN" ] && [ -n "$SUPERADMIN_USER_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    -H "$(auth "$TOK_SUPERADMIN")" \
    -H "Content-Type: application/json" \
    -d '{"suspended":false}' \
    "$BASE_URL/api/admin/users/$SUPERADMIN_USER_ID/suspend")
  check "Superadmin peut suspendre un autre superadmin (200)" "200" "$STATUS"
fi

echo ""
echo "=== encaissements : vendeur refusé sur POST versement ==="
if [ -n "$TOK_VENDEUR" ] && [ -n "$VENTE_VENDEUR_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"montant":100,"mode":"Espèces"}' \
    "$BASE_URL/api/encaissements/vente/$VENTE_VENDEUR_ID/versements")
  check "Vendeur refusé sur POST /encaissements/:type/:id/versements (403)" "403" "$STATUS"
fi

echo ""
echo "=== encaissements : manager autorisé sur POST versement ==="
if [ -n "$TOK_MANAGER" ] && [ -n "$VENTE_VENDEUR_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_MANAGER")" \
    -H "Content-Type: application/json" \
    -d '{"montant":1,"mode":"Espèces"}' \
    "$BASE_URL/api/encaissements/vente/$VENTE_VENDEUR_ID/versements")
  check "Manager autorisé sur POST /encaissements/:type/:id/versements (201 ou 404)" "201" "$STATUS"
fi

echo ""
echo "======================================="
echo "Résultat : $PASS OK / $FAIL KO"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
