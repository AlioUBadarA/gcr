#!/usr/bin/env bash
# ============================================================
# Tests de sécurité Session 4 — Gestion des sessions et auth renforcée
# Usage : BASE_URL=http://localhost:3000 bash tests/session4_security.sh
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

SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-admin@test.com}"
SUPERADMIN_PASS="${SUPERADMIN_PASS:-password}"
SUPPORT_EMAIL="${SUPPORT_EMAIL:-support@test.com}"
SUPPORT_PASS="${SUPPORT_PASS:-password}"
VENDEUR_EMAIL="${VENDEUR_EMAIL:-vendeur@test.com}"
VENDEUR_PASS="${VENDEUR_PASS:-password}"

# IDs à configurer
RIZIER_USER_ID="${RIZIER_USER_ID:-}"           # UUID d'un compte rizier (cible légitime d'impersonation)
SUPERADMIN_USER_ID="${SUPERADMIN_USER_ID:-}"   # UUID d'un autre superadmin (cible interdite)
SUPPORT_USER_ID="${SUPPORT_USER_ID:-}"         # UUID d'un compte support (cible interdite)

TOK_SUPERADMIN=$(login "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASS")
TOK_VENDEUR=$(login "$VENDEUR_EMAIL" "$VENDEUR_PASS")

echo ""
echo "=== S4-B : Lockout brute force ==="
echo "  5 tentatives avec un mauvais mot de passe sur un compte test..."
BRUTE_EMAIL="${BRUTE_EMAIL:-brute_test@test.com}"
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$BRUTE_EMAIL\",\"password\":\"mauvaismdp${i}\"}"
done
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$BRUTE_EMAIL\",\"password\":\"encoreunessai\"}")
check "6eme tentative bloquee apres 5 echecs (429)" "429" "$STATUS"

echo ""
echo "=== S4-A : Token révoqué après suspension ==="
echo "  (test manuel recommandé)"
echo "  1. Créer un compte test, récupérer son token"
echo "  2. Suspendre le compte via PATCH /api/admin/users/:id/suspend"
echo "  3. Utiliser le token sur GET /api/auth/me -> doit retourner 401"
echo "  4. Réactiver le compte -> le token reste invalide (token_revoked_at conservé)"
echo "  5. Nouveau login -> nouveau token -> 200"

echo ""
echo "=== S4-D : Impersonation superadmin interdite ==="
if [ -n "$TOK_SUPERADMIN" ] && [ -n "$SUPERADMIN_USER_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_SUPERADMIN")" \
    "$BASE_URL/api/admin/users/$SUPERADMIN_USER_ID/impersonate")
  check "Impersonation superadmin -> superadmin interdite (403)" "403" "$STATUS"
fi

echo ""
echo "=== S4-D : Impersonation support interdite ==="
if [ -n "$TOK_SUPERADMIN" ] && [ -n "$SUPPORT_USER_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_SUPERADMIN")" \
    "$BASE_URL/api/admin/users/$SUPPORT_USER_ID/impersonate")
  check "Impersonation superadmin -> support interdite (403)" "403" "$STATUS"
fi

echo ""
echo "=== S4-D : Impersonation rizier autorisee ==="
if [ -n "$TOK_SUPERADMIN" ] && [ -n "$RIZIER_USER_ID" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "$(auth "$TOK_SUPERADMIN")" \
    "$BASE_URL/api/admin/users/$RIZIER_USER_ID/impersonate")
  check "Impersonation superadmin -> rizier autorisee (200)" "200" "$STATUS"
fi

echo ""
echo "=== S4-F : TTL token — vérification que le token est bien signé 7j ==="
if [ -n "$TOK_VENDEUR" ]; then
  # Décoder le payload JWT (base64 url-encoded)
  PAYLOAD=$(echo "$TOK_VENDEUR" | cut -d'.' -f2 | sed 's/-/+/g; s/_/\//g')
  # Padding
  PADDED=$(printf '%s' "$PAYLOAD" | awk '{l=length($0)%4; if(l==2) print $0"=="; else if(l==3) print $0"="; else print $0}')
  EXP=$(echo "$PADDED" | base64 -d 2>/dev/null | jq -r '.exp // 0')
  IAT=$(echo "$PADDED" | base64 -d 2>/dev/null | jq -r '.iat // 0')
  if [ "$EXP" != "0" ] && [ "$IAT" != "0" ]; then
    DUREE=$(( (EXP - IAT) / 86400 ))
    check "Token expire en $DUREE jours (attendu 7)" "7" "$DUREE"
  else
    echo "  [SKIP] Impossible de décoder le token JWT"
  fi
fi

echo ""
echo "=== S4-C : Pas de boucle 401 (test frontend manuel) ==="
echo "  1. Ouvrir /login dans un navigateur sans token valide"
echo "  2. Entrer des identifiants incorrects"
echo "  3. Vérifier qu'il n'y a pas de redirect infini (reste sur /login avec message d'erreur)"

echo ""
echo "======================================="
echo "Résultat : $PASS OK / $FAIL KO"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
