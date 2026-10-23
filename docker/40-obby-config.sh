#!/bin/sh
# Writes the network settings from the container environment into the page,
# so one image serves any network. Unset variables keep the build-time values.
set -eu

html=/usr/share/nginx/html
templates=/etc/obby/pwa

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

entries=""
for key in \
  VITE_DEFAULT_IRC_SERVER VITE_DEFAULT_IRC_SERVER_NAME VITE_DEFAULT_IRC_CHANNELS \
  VITE_HIDE_SERVER_LIST VITE_DEFAULT_OAUTH_PROVIDER_LABEL VITE_DEFAULT_OAUTH_ISSUER \
  VITE_DEFAULT_OAUTH_CLIENT_ID VITE_DEFAULT_OAUTH_SCOPES VITE_DEFAULT_OAUTH_REDIRECT_URI \
  VITE_DEFAULT_OAUTH_TOKEN_KIND VITE_DEFAULT_OAUTH_SERVER_PROVIDER \
  VITE_DEFAULT_OAUTH_AUTHORIZE_URL VITE_DEFAULT_OAUTH_TOKEN_URL; do
  eval "value=\${$key-}"
  [ -n "$value" ] || continue
  case "$key" in
    VITE_HIDE_SERVER_LIST)
      [ "$value" = "true" ] && json=true || json=false ;;
    VITE_DEFAULT_IRC_CHANNELS)
      json="[$(json_escape "$value" | tr -d "'" | sed 's/ *, */","/g; s/^ */"/; s/ *$/"/')]" ;;
    *)
      json="\"$(json_escape "$value")\"" ;;
  esac
  entries="$entries\"$key\":$json,"
done
printf 'globalThis.__OBBY_CONFIG__ = {%s};\n' "${entries%,}" > "$html/config.js"

if [ "${VITE_HIDE_SERVER_LIST-}" = "true" ] && ! grep -q 'rel="manifest"' "$html/index.html"; then
  name="${VITE_DEFAULT_IRC_SERVER_NAME:-Obby}"
  short=$(printf '%s' "$name" | cut -c1-12)
  json_name=$(json_escape "$name" | sed 's/[&|]/\\&/g')
  json_short=$(json_escape "$short" | sed 's/[&|]/\\&/g')
  html_short=$(printf '%s' "$short" | sed 's/"/\&quot;/g; s/[&|]/\\&/g')
  sed "s|__NETWORK_NAME__|$json_name|g; s|__SHORT_NAME__|$json_short|g" \
    "$templates/manifest.webmanifest" > "$html/manifest.webmanifest"
  sed "s|__SHORT_NAME__|$html_short|g" "$templates/head.html" > /tmp/obby-head.html
  awk '/<\/head>/ { while ((getline line < "/tmp/obby-head.html") > 0) print line } { print }' \
    "$html/index.html" > /tmp/obby-index.html
  cat /tmp/obby-index.html > "$html/index.html"
fi
