#!/usr/bin/env bash
# Pasang capstone.irsad.site: nginx vhost + ingress Cloudflare Tunnel.
# Jalankan: sudo bash deploy/setup-cloudflare.sh
set -euo pipefail
HOST=capstone.irsad.site
DIR="$(cd "$(dirname "$0")" && pwd)"
CFG=/etc/cloudflared/config.yml

# 1. nginx
cp "$DIR/nginx-capstone.irsad.site.conf" /etc/nginx/sites-available/capstone
ln -sf /etc/nginx/sites-available/capstone /etc/nginx/sites-enabled/capstone
nginx -t
systemctl reload nginx

# 2. ingress cloudflared (sisipkan sebelum aturan catch-all 404)
if ! grep -q "hostname: $HOST" "$CFG"; then
  cp "$CFG" "$CFG.bak-$(date +%Y%m%d%H%M%S)"
  sed -i "s|^  - service: http_status:404|  - hostname: $HOST\n    service: http://localhost:80\n  - service: http_status:404|" "$CFG"
fi
cloudflared tunnel ingress validate --config "$CFG"
systemctl restart cloudflared
echo "OK: $HOST -> nginx -> 127.0.0.1:8080"
