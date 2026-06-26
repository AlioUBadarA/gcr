#!/usr/bin/env bash
# ============================================================
# Tests de sécurité Session 3 — Validation des entrées
# Usage : BASE_URL=http://localhost:3000 bash tests/session3_security.sh
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

MANAGER_EMAIL="${MANAGER_EMAIL:-manager@test.com}"
MANAGER_PASS="${MANAGER_PASS:-password}"
VENDEUR_EMAIL="${VENDEUR_EMAIL:-vendeur@test.com}"
VENDEUR_PASS="${VENDEUR_PASS:-password}"
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-admin@test.com}"
SUPERADMIN_PASS="${SUPERADMIN_PASS:-password}"

# IDs à configurer
VENTE_ID="${VENTE_ID:-}"             # vente existante, partiellement payée
VENTE_MONTANT="${VENTE_MONTANT:-}"   # montant total de cette vente (ex: 1000)
RIZERIE_ID_INVALIDE="pas-un-uuid"

TOK_MANAGER=$(login "$MANAGER_EMAIL" "$MANAGER_PASS")
TOK_VENDEUR=$(login "$VENDEUR_EMAIL" "$VENDEUR_PASS")
TOK_SUPERADMIN=$(login "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASS")

echo ""
echo "=== V1 : Quantite NaN refusee sur POST /api/ventes ==="
if [ -n "$TOK_VENDEUR" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"client_nom":"Test","date_vente":"2026-01-01","produit":"Riz","quantite":"abc","prix_unitaire":500}' \
    "$BASE_URL/api/ventes")
  check "quantite='abc' refusee (400)" "400" "$STATUS"
fi

echo ""
echo "=== V1 : prix_unitaire negatif refuse sur POST /api/ventes ==="
if [ -n "$TOK_VENDEUR" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"client_nom":"Test","date_vente":"2026-01-01","produit":"Riz","quantite":10,"prix_unitaire":-50}' \
    "$BASE_URL/api/ventes")
  check "prix_unitaire=-50 refuse (400)" "400" "$STATUS"
fi

echo ""
echo "=== V1 : date_vente invalide refusee sur POST /api/ventes ==="
if [ -n "$TOK_VENDEUR" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"client_nom":"Test","date_vente":"32-13-2026","produit":"Riz","quantite":10,"prix_unitaire":500}' \
    "$BASE_URL/api/ventes")
  check "date_vente invalide refusee (400)" "400" "$STATUS"
fi

echo ""
echo "=== V1 : statut_paiement invalide refuse sur POST /api/ventes ==="
if [ -n "$TOK_VENDEUR" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"client_nom":"Test","date_vente":"2026-01-01","produit":"Riz","quantite":10,"prix_unitaire":500,"statut_paiement":"Invalide"}' \
    "$BASE_URL/api/ventes")
  check "statut_paiement invalide refuse (400)" "400" "$STATUS"
fi

echo ""
echo "=== V1 : client_nom trop long refuse sur POST /api/ventes ==="
if [ -n "$TOK_VENDEUR" ]; then
  LONG_NOM=$(python3 -c "print('A'*201)" 2>/dev/null || printf 'A%.0s' {1..201})
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d "{\"client_nom\":\"$LONG_NOM\",\"date_vente\":\"2026-01-01\",\"produit\":\"Riz\",\"quantite\":10,\"prix_unitaire\":500}" \
    "$BASE_URL/api/ventes")
  check "client_nom > 200 chars refuse (400)" "400" "$STATUS"
fi

echo ""
echo "=== V2 : sur-versement refuse ==="
if [ -n "$TOK_MANAGER" ] && [ -n "$VENTE_ID" ] && [ -n "$VENTE_MONTANT" ]; then
  TROP=$(echo "$VENTE_MONTANT + 9999" | bc 2>/dev/null || echo "999999")
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_MANAGER")" \
    -H "Content-Type: application/json" \
    -d "{\"montant\":$TROP,\"mode\":\"Espèces\"}" \
    "$BASE_URL/api/ventes/$VENTE_ID/versements")
  check "Sur-versement refuse (400)" "400" "$STATUS"
fi

echo ""
echo "=== V2 : versement avec montant=0 refuse ==="
if [ -n "$TOK_MANAGER" ] && [ -n "$VENTE_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_MANAGER")" \
    -H "Content-Type: application/json" \
    -d '{"montant":0,"mode":"Espèces"}' \
    "$BASE_URL/api/ventes/$VENTE_ID/versements")
  check "montant=0 refuse (400)" "400" "$STATUS"
fi

echo ""
echo "=== V2 : versement encaissements avec montant NaN refuse ==="
if [ -n "$TOK_MANAGER" ] && [ -n "$VENTE_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_MANAGER")" \
    -H "Content-Type: application/json" \
    -d '{"montant":"abc"}' \
    "$BASE_URL/api/encaissements/vente/$VENTE_ID/versements")
  check "montant=abc refuse sur encaissements (400)" "400" "$STATUS"
fi

echo ""
echo "=== V5 : mois invalide refuse sur POST /api/forecast ==="
if [ -n "$TOK_VENDEUR" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"annee":2026,"mois":13,"objectif_montant":5000}' \
    "$BASE_URL/api/forecast")
  check "mois=13 refuse (400)" "400" "$STATUS"
fi

echo ""
echo "=== V5 : annee hors borne refusee sur POST /api/forecast ==="
if [ -n "$TOK_VENDEUR" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"annee":2100,"mois":6,"objectif_montant":5000}' \
    "$BASE_URL/api/forecast")
  check "annee=2100 refusee (400)" "400" "$STATUS"
fi

echo ""
echo "=== V5 : objectif negatif refuse sur POST /api/forecast ==="
if [ -n "$TOK_VENDEUR" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_VENDEUR")" \
    -H "Content-Type: application/json" \
    -d '{"annee":2026,"mois":6,"objectif_montant":-100}' \
    "$BASE_URL/api/forecast")
  check "objectif_montant=-100 refuse (400)" "400" "$STATUS"
fi

echo ""
echo "=== V7 : rizerie_id invalide sur GET /api/admin/export ==="
if [ -n "$TOK_SUPERADMIN" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "$(auth "$TOK_SUPERADMIN")" \
    "$BASE_URL/api/admin/export?rizerie_id=$RIZERIE_ID_INVALIDE")
  check "rizerie_id invalide refuse (400)" "400" "$STATUS"
fi

echo ""
echo "=== V6 : limit > 500 plafonne (reponse 200, pas d'erreur) ==="
if [ -n "$TOK_VENDEUR" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "$(auth "$TOK_VENDEUR")" \
    "$BASE_URL/api/ventes?limit=99999")
  check "GET /api/ventes?limit=99999 repond 200 (plafonne en interne)" "200" "$STATUS"
fi

echo ""
echo "======================================="
echo "Résultat : $PASS OK / $FAIL KO"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
