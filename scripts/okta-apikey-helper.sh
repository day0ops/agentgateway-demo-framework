#!/usr/bin/env bash
set -euo pipefail

# Claude Code apiKeyHelper for Okta device flow authentication.
#
# Required environment variables:
#   OKTA_DOMAIN      - Okta tenant domain, e.g. dev-12345.okta.com
#   OKTA_CLIENT_ID   - Native app client ID with Device Authorization grant enabled
#
# Token is cached at ~/.okta/claude-code-token and reused until expiry.
# Prompts (device flow URL + code) go to stderr.
# Stdout: plain Okta access token (Claude Code sends as Authorization: Bearer)

TOKEN_CACHE="${HOME}/.okta/claude-code-token"
SCOPE="openid profile"

: "${OKTA_DOMAIN:?OKTA_DOMAIN environment variable is required}"
: "${OKTA_CLIENT_ID:?OKTA_CLIENT_ID environment variable is required}"

DEVICE_URL="https://${OKTA_DOMAIN}/oauth2/default/v1/device/authorize"
TOKEN_URL="https://${OKTA_DOMAIN}/oauth2/default/v1/token"

is_token_valid() {
  local token_file="$1"
  [[ -f "$token_file" ]] || return 1

  local access_token
  access_token=$(jq -r '.access_token // empty' "$token_file" 2>/dev/null)
  [[ -n "$access_token" ]] || return 1

  # Decode JWT payload (base64url second segment)
  local payload
  payload=$(
    echo "$access_token" | cut -d. -f2 | tr '_-' '/+' |
      awk '{ pad = (4 - length($0) % 4) % 4; for (i=0;i<pad;i++) $0 = $0 "="; print }' |
      base64 -d 2>/dev/null
  ) || return 1

  local exp now
  exp=$(echo "$payload" | jq -r '.exp // 0')
  now=$(date +%s)
  [[ "$exp" -gt $((now + 60)) ]]
}

do_device_flow() {
  local resp device_code user_code verification_uri interval

  resp=$(curl -sf -X POST "$DEVICE_URL" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d "client_id=${OKTA_CLIENT_ID}&scope=${SCOPE}")

  device_code=$(echo "$resp" | jq -r '.device_code')
  user_code=$(echo "$resp" | jq -r '.user_code')
  verification_uri=$(echo "$resp" | jq -r '.verification_uri_complete // .verification_uri')
  interval=$(echo "$resp" | jq -r '.interval // 5')

  echo "" >&2
  echo "Opening browser for Okta authentication..." >&2
  echo "  URL: ${verification_uri}" >&2
  echo "  Code: ${user_code}" >&2
  echo "" >&2

  # Auto-open browser (macOS: open, Linux: xdg-open)
  if command -v open &>/dev/null; then
    open "$verification_uri" 2>/dev/null || true
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$verification_uri" 2>/dev/null || true
  fi

  echo "Waiting for authentication..." >&2

  while true; do
    sleep "$interval"

    local token_resp error
    token_resp=$(curl -s -X POST "$TOKEN_URL" \
      -H 'Content-Type: application/x-www-form-urlencoded' \
      -d "client_id=${OKTA_CLIENT_ID}&device_code=${device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code")

    error=$(echo "$token_resp" | jq -r '.error // empty')

    case "$error" in
      authorization_pending) continue ;;
      slow_down) interval=$((interval + 5)); continue ;;
      "")
        mkdir -p "$(dirname "$TOKEN_CACHE")"
        echo "$token_resp" >"$TOKEN_CACHE"
        echo "Authentication successful." >&2
        return 0
        ;;
      *)
        echo "Authentication error: $(echo "$token_resp" | jq -r '.error_description // .error')" >&2
        exit 1
        ;;
    esac
  done
}

if ! is_token_valid "$TOKEN_CACHE"; then
  do_device_flow
fi

# Output plain access token to stdout (Claude Code sends as Authorization: Bearer)
jq -r '.access_token' "$TOKEN_CACHE"
