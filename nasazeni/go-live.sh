#!/usr/bin/env bash
# Kanban zakázek — infrastruktura pro go-live. Spouštět jako root:
#   sudo bash ~/kanban-stage/nasazeni/go-live.sh
# Idempotentní. Nedělá: hesla v config.php, cron, přepnutí kalkulátoru (viz NASAZENI.md).
set -euo pipefail

SRC=/home/cadmia/kanban-stage/nasazeni

echo "== 1/4 PHP-FPM pool =="
install -m 0644 "$SRC/kanban-pool.conf" /etc/php/8.3/fpm/pool.d/kanban.conf
php-fpm8.3 -t
systemctl restart php8.3-fpm
test -S /run/php/php8.3-fpm-kanban.sock && echo "  socket OK: /run/php/php8.3-fpm-kanban.sock"

echo "== 2/4 nginx =="
install -m 0644 "$SRC/kanban.conf" /etc/nginx/sites-available/kanban.conf
ln -sfn /etc/nginx/sites-available/kanban.conf /etc/nginx/sites-enabled/kanban.conf
nginx -t
systemctl restart nginx   # restart, ne reload — reload nepodchytí novou listen-sekci

echo "== 3/4 práva k datům =="
# pool běží jako cadmia, takže vlastník sedí; jen dovětšit skupinu a práva
chown -R cadmia:www-data /var/www/kanban-data
chmod 2770 /var/www/kanban-data /var/www/kanban-data/modely /var/www/kanban-data/zalohy
chmod 660 /var/www/kanban-data/kanban.sqlite 2>/dev/null || true
chown cadmia:www-data /var/www/kanban-app/config.php
chmod 640 /var/www/kanban-app/config.php

echo "== 4/4 smoke test HTTP =="
code=$(curl -s -o /dev/null -w '%{http_code}' 'http://localhost:8091/api.php?a=me')
echo "  GET /api.php?a=me -> HTTP $code  (200 = OK, vrací {\"ok\":true,\"uzivatel\":null})"
curl -s 'http://localhost:8091/api.php?a=me'; echo

cat <<'NEXT'

Hotovo. Zbývá ručně (NASAZENI.md kroky 4–7):
  - config.php: smtp.pass, imap.pass, verejnaUrl
  - crontab -e   (jako cadmia; vložit ~/kanban-stage/nasazeni/crontab.txt)
  - pricing.json kalkulátoru: orderEndpoint + shared secret
  - přihlásit se (admin / cadmia) a změnit heslo
NEXT
