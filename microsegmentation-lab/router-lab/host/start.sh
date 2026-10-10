#!/bin/sh
set -eu

for network in $REMOTE_NETS; do
  ip route replace "$network" via "$ROUTER_IP"
done

# Hosts can reach only the lab subnets through R1. The Docker bridge gateway
# remains present for network setup but is not a host default route.
ip route del default 2>/dev/null || true

exec python3 -m http.server "$LISTEN_PORT" --bind 0.0.0.0 -d /srv
