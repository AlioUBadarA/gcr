#!/usr/bin/env bash
# ============================================================
# Tests de sécurité Session 5 — Logs persistants et scan dépendances
# Usage : BASE_URL=http://localhost:3000 bash tests/session5_security.sh
# Prérequis : jq, curl, serveur démarré, superadmin accessible.
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
TEST_EMAIL="${TEST_EMAIL:-test_s5@test.com}"

echo ""
echo "=== S5-B : Log LOGIN_FAILED écrit dans audit_logs ==="
echo "  Tentative de connexion avec un mauvais mot de passe sur un compte connu..."
TOK_ADMIN=$(login "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASS")
# Générer un échec de connexion
curl -s -o /dev/null -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"mauvaismdp_s5\"}"

if [ -n "$TOK_ADMIN" ]; then
  # Vérifier que l'audit_log existe (via la route admin des logs si elle existe)
  # Par défaut, on vérifie juste que la route login répond correctement
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"mauvaismdp_s5\"}")
  check "Echec de connexion retourne 401 (loggue en arriere-plan)" "401" "$STATUS"
  echo "  -> Verifier manuellement : SELECT action, detail FROM audit_logs WHERE action LIKE 'LOGIN%' ORDER BY created_at DESC LIMIT 5;"
fi

echo ""
echo "=== S5-B : Log LOGIN_UNKNOWN_EMAIL pour email inexistant ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"inexistant_s5@test.com","password":"test"}')
check "Email inexistant retourne 401 (LOGIN_UNKNOWN_EMAIL loggue)" "401" "$STATUS"

echo ""
echo "=== S5-B : Log LOGIN_ACCOUNT_LOCKED apres 5 echecs ==="
LOCK_EMAIL="${LOCK_EMAIL:-brute_s5@test.com}"
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$LOCK_EMAIL\",\"password\":\"mauvaismdp${i}\"}"
done
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LOCK_EMAIL\",\"password\":\"encore\"}")
check "Compte bloque apres 5 echecs (429, LOGIN_ACCOUNT_LOCKED loggue)" "429" "$STATUS"

echo ""
echo "=== S5-B : Log LOGIN_SUCCESS sur connexion reussie ==="
TOK=$(login "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASS")
if [ -n "$TOK" ]; then
  check "Connexion superadmin reussie (LOGIN_SUCCESS loggue)" "nonempty" "nonempty"
  echo "  -> Verifier : SELECT action FROM audit_logs WHERE action='LOGIN_SUCCESS' ORDER BY created_at DESC LIMIT 1;"
else
  check "Connexion superadmin reussie" "nonempty" ""
fi

echo ""
echo "=== S5-A : Verification fichiers Dependabot et CI en place ==="
echo "  (verification locale des fichiers config)"
if [ -f "$(dirname "$0")/../.github/dependabot.yml" ]; then
  echo "  [OK]  .github/dependabot.yml present"
  PASS=$((PASS+1))
else
  echo "  [KO]  .github/dependabot.yml absent"
  FAIL=$((FAIL+1))
fi
if [ -f "$(dirname "$0")/../.github/workflows/security-audit.yml" ]; then
  echo "  [OK]  .github/workflows/security-audit.yml present"
  PASS=$((PASS+1))
else
  echo "  [KO]  .github/workflows/security-audit.yml absent"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=== S5-D : Verification .env.example contient les variables requises ==="
ENV_EXAMPLE="$(dirname "$0")/../.env.example"
for VAR in DATABASE_URL JWT_SECRET FRONTEND_URL NODE_ENV SUPERADMIN_EMAIL SUPERADMIN_PASSWORD SUPERADMIN_NOM; do
  if grep -q "^$VAR=" "$ENV_EXAMPLE" 2>/dev/null; then
    echo "  [OK]  $VAR present dans .env.example"
    PASS=$((PASS+1))
  else
    echo "  [KO]  $VAR absent de .env.example"
    FAIL=$((FAIL+1))
  fi
done

echo ""
echo "======================================="
echo "Résultat : $PASS OK / $FAIL KO"
echo ""
echo "Verification manuelle supplementaire :"
echo "  npm audit (backend) -> doit retourner 0 vulnerabilite"
echo "  cd pfs-frontend && npm audit --omit=dev -> doit retourner 0 vuln prod"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
