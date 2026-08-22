#!/usr/bin/env bash
#
# Applies a generated runtime environment to the linked Vercel project.
#
#   bash infra/aira-runtime/set-vercel-env.sh /etc/aira/vercel.production.env
#
# Runs from a machine that has the Vercel CLI authenticated and the project
# linked (`vercel link`). It never prints a value, only a variable name and
# whether it was added or replaced, so a terminal transcript or CI log of this
# run contains no secret. Variables not present in the file are left untouched:
# nothing unrelated is deleted or rotated.

set -Eeuo pipefail

ENV_FILE="${1:-/etc/aira/vercel.production.env}"
TARGET="${VERCEL_TARGET:-production}"

[[ -r "$ENV_FILE" ]] || { echo "Cannot read $ENV_FILE" >&2; exit 1; }
command -v vercel >/dev/null || { echo "The Vercel CLI is not installed (npm i -g vercel)." >&2; exit 1; }
[[ -d .vercel ]] || { echo "This directory is not linked to a Vercel project. Run: vercel link" >&2; exit 1; }

vercel whoami >/dev/null || { echo "Vercel CLI is not authenticated. Run: vercel login" >&2; exit 1; }

existing="$(vercel env ls "$TARGET" 2>/dev/null || true)"

applied=0
while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  name="${line%%=*}"
  value="${line#*=}"
  [[ -n "$name" && -n "$value" ]] || continue

  if grep -qE "^[[:space:]]*${name}[[:space:]]" <<<"$existing"; then
    printf '  replace  %s\n' "$name"
    vercel env rm "$name" "$TARGET" --yes >/dev/null 2>&1 || true
  else
    printf '  add      %s\n' "$name"
  fi
  printf '%s' "$value" | vercel env add "$name" "$TARGET" >/dev/null
  applied=$((applied + 1))
done < "$ENV_FILE"

cat <<EOF

$applied variables applied to the $TARGET environment.

Vercel environment changes only take effect on a new deployment:
  vercel --prod

Then confirm, signed in, that /api/integrations/status reports
knowledge, deerflow and autogpt as configured.
EOF
