#!/bin/sh
# Rendezvous leaf wrapper: leave the leaf with no underlay path except its own
# docker networks, then run the stock easytier-core.
#
# Why: the "isolated pair" assertions (relay OFF must drop the data, relay ON
# must carry it, a non-whitelisted network gets no relay) only measure the
# node's relay decision if the two leaves cannot reach each other directly.
# EasyTier pairs any two peers it can address: a route cost of 1 means a direct
# peer connection that never touches the node, so relay OFF passes traffic and
# the assertion fails for a reason that has nothing to do with the node.
#
# Two mechanisms are removed here, both outside the node's control:
#
#  * another docker bridge. That is supposed to be blocked by the daemon's
#    DOCKER-ISOLATION-STAGE-* rules, which is ambient daemon/kernel state.
#  * anything else the host can route, in particular an address of the *host*
#    itself. EasyTier discovers public/interface addresses (STUN, peer RPC) and
#    a hosted runner's public address is a local address on the host, so two
#    containers behind the same NAT can hairpin through it. That path survives
#    any address blacklist and appears as an ordinary direct peer.
#
# So a leaf keeps only its directly connected subnets (its data network with the
# node, its control network with the relay) and loses the default route, plus a
# `prohibit` route for each of the other leaves' docker addresses (diagnostics in
# `ip route show`, and no window before EasyTier starts). The node's own
# addresses are untouched, and relayed data arrives from the node, so relay ON
# still works.
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

ip route del default 2>/dev/null || true
ip -6 route del default 2>/dev/null || true

exec easytier-core "$@"
