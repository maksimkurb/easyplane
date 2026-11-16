#!/bin/sh
# Rendezvous leaf wrapper: forbid leaf-to-leaf *underlay* traffic, then run the
# stock easytier-core.
#
# Why: the "isolated pair" assertions (relay OFF must drop the data, relay ON
# must carry it, a non-whitelisted network gets no relay) only measure the
# node's relay decision if the two leaves have no direct path. That used to be
# provided implicitly by the docker daemon's inter-bridge isolation rules
# (DOCKER-ISOLATION-STAGE-*), which is ambient daemon/kernel state: when those
# rules are not effective on a runner, two containers on different bridges route
# to each other, easytier pairs them directly (route cost 1) and the relay
# assertions fail for a reason that has nothing to do with the node.
#
# EASYPLANE_UNDERLAY_BLOCK lists the underlay addresses (docker data and control
# addresses) of the *other* leaves in this test, comma separated. A `prohibit`
# route inside this container's own network namespace makes them unreachable
# before easytier starts, so the premise is enforced on every host and there is
# no window in which a direct peer connection can form. The node's own addresses
# are not listed, and relayed data arrives from the node's address, so relay ON
# is unaffected.
set -eu

if [ -n "${EASYPLANE_UNDERLAY_BLOCK:-}" ]; then
  printf '%s\n' "$EASYPLANE_UNDERLAY_BLOCK" | tr ',' '\n' | while IFS= read -r address; do
    [ -n "$address" ] || continue
    ip route replace prohibit "$address" || {
      echo "leaf-entrypoint: cannot prohibit $address" >&2
      exit 1
    }
  done
fi

exec easytier-core "$@"
