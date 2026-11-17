#!/bin/sh
# The owner's "PC on the LAN": a plain host with no EasyTier, whose only route
# into the overlay is the EasyTier subnet router 192.168.55.2. Docker puts the
# default route on the bridge gateway (.1), so replace it with the router.
set -eu

ip route replace default via 192.168.55.2
exec sleep infinity
