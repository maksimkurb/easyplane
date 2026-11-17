#!/bin/sh
# Policy-spike router wrapper: attach the LAN and run stock easytier-core.
#
# The owner's case is: a PC behind a home router (an EasyTier device that
# advertises its LAN as a proxy CIDR) talks to a remote overlay node. The LAN
# lives on a dedicated docker bridge in this topology (see the compose file):
#
#   core-sp-lan 192.168.55.16  default route -> 192.168.55.2 (this container)
#   core-sp-r   192.168.55.2   the EasyTier subnet router
#
# Kernel forwarding is enabled with the compose `sysctls:` setting, because
# /proc/sys is read-only inside the container. Nothing here relies on the
# docker bridge gateway: the LAN host only reaches the overlay through the
# router's TUN, exactly like the owner's setup.
set -eu

# Loose reverse-path filtering would reject the LAN source arriving from the
# overlay side in some container runtimes; make it explicit rather than
# relying on the daemon default.
for value in /proc/sys/net/ipv4/conf/all/rp_filter /proc/sys/net/ipv4/conf/default/rp_filter; do
  [ -w "$value" ] && echo 0 >"$value" || true
done

exec easytier-core "$@"
