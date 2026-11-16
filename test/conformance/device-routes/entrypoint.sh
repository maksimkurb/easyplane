#!/bin/sh
# SPIKE ONLY: container entrypoint for the device-declared-routes spike.
#
# The router container must be reachable at an address inside the subnet it
# proxies (10.99.1.10) and at an "external" address only an exit node can reach
# (203.0.113.7). Both live on loopback; EasyTier forwards overlay packets to
# them like any other host-local destination.
set -e

if [ "${EASYPLANE_DR_ROLE:-}" = "router" ]; then
  ip addr add 10.99.1.10/32 dev lo 2>/dev/null || true
  ip addr add 203.0.113.7/32 dev lo 2>/dev/null || true
  python3 -m http.server 8080 --bind 10.99.1.10 >/tmp/http-subnet.log 2>&1 &
  python3 -m http.server 8081 --bind 203.0.113.7 >/tmp/http-exit.log 2>&1 &
fi

exec /usr/local/bin/easytier-core "$@"
