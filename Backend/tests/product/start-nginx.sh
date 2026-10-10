#!/bin/sh
set -eu

backend_host_ipv4="$(getent ahostsv4 backend-host.internal | awk 'NR == 1 { print $1 }')"
if [ -z "$backend_host_ipv4" ]; then
  echo "Unable to resolve backend-host.internal to an IPv4 address" >&2
  exit 1
fi

sed "s/__BACKEND_HOST_IPV4__/${backend_host_ipv4}/g" \
  /etc/nginx/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
