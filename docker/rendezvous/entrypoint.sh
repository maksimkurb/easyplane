#!/bin/sh
# EasyPlane bundled rendezvous node.
#
# Runs a STOCK easytier-core as a public node whose job is to let devices find
# each other: initial contact, peer RPC, OSPF route exchange and NAT
# hole-punch coordination. It forwards user data only when explicitly allowed
# (RENDEZVOUS_RELAY_DATA=true), which CGNAT/symmetric-NAT users need.
#
# Private mode (default) is the who-may-use-it gate: a foreign network is
# admitted only when its handshake proves this node's network secret. Devices
# must therefore use the same EasyTier network_secret as the node (their own
# network_name still keeps networks isolated). The secret proof is exchanged in
# EasyTier secure mode, so secure mode is enabled here and the panel pushes it
# to devices in a network that opts in.
#
# Every setting is environment-driven; the secret is never printed and the
# generated TOML is mode 600 in a private directory.
set -eu

log() {
  printf '%s\n' "$*" >&2
}

fail() {
  log "rendezvous: error: $*"
  exit 1
}

# TOML basic-string escaping for values that come from the environment.
toml_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

bool_is_true() {
  case "$1" in
    1|true|TRUE|True|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

NETWORK_NAME="${RENDEZVOUS_NETWORK_NAME:-easyplane-rendezvous}"
NETWORK_SECRET="${RENDEZVOUS_NETWORK_SECRET:-}"
HOSTNAME="${RENDEZVOUS_HOSTNAME:-rendezvous}"
INSTANCE_NAME="${RENDEZVOUS_INSTANCE_NAME:-rendezvous}"
RELAY_DATA="${RENDEZVOUS_RELAY_DATA:-false}"
PRIVATE_MODE="${RENDEZVOUS_PRIVATE_MODE:-true}"
SECURE_MODE="${RENDEZVOUS_SECURE_MODE:-true}"
WHITELIST="${RENDEZVOUS_NETWORK_WHITELIST:-*}"
RELAY_ALL_PEER_RPC="${RENDEZVOUS_RELAY_ALL_PEER_RPC:-false}"
LISTENERS="${RENDEZVOUS_LISTENERS:-tcp://0.0.0.0:11010,udp://0.0.0.0:11010,ws://0.0.0.0:11011}"
MAPPED_LISTENERS="${RENDEZVOUS_MAPPED_LISTENERS:-}"
RPC_PORTAL="${RENDEZVOUS_RPC_PORTAL:-127.0.0.1:15888}"
FOREIGN_RELAY_BPS_LIMIT="${RENDEZVOUS_FOREIGN_RELAY_BPS_LIMIT:-}"

[ -n "$NETWORK_SECRET" ] || fail "RENDEZVOUS_NETWORK_SECRET is required (and must never be empty)"
case "$NETWORK_NAME" in
  *[!A-Za-z0-9._-]*) fail "RENDEZVOUS_NETWORK_NAME may contain only letters, digits, '.', '_' and '-'" ;;
esac
if printf '%s' "$NETWORK_SECRET" | grep -q '[[:cntrl:]]'; then
  fail "RENDEZVOUS_NETWORK_SECRET must not contain control characters"
fi
if [ -n "$FOREIGN_RELAY_BPS_LIMIT" ]; then
  case "$FOREIGN_RELAY_BPS_LIMIT" in
    *[!0-9]*) fail "RENDEZVOUS_FOREIGN_RELAY_BPS_LIMIT must be a number of bytes per second" ;;
  esac
fi

# RENDEZVOUS_RELAY_DATA=true means "allow data relay", while EasyTier's flag is
# the negative `disable_relay_data`.
if bool_is_true "$RELAY_DATA"; then
  DISABLE_RELAY_DATA=false
  log "rendezvous: data relay ENABLED (opt-in; this node will forward user traffic)"
else
  DISABLE_RELAY_DATA=true
  log "rendezvous: data relay disabled (rendezvous only)"
fi
if bool_is_true "$PRIVATE_MODE"; then
  PRIVATE_MODE_VALUE=true
  log "rendezvous: private mode ON (only networks proving this node's secret are admitted)"
else
  PRIVATE_MODE_VALUE=false
  log "rendezvous: private mode OFF (ANY network may use this node; ensure that is intended)"
fi
if bool_is_true "$SECURE_MODE"; then
  SECURE_MODE_VALUE=true
else
  SECURE_MODE_VALUE=false
  log "rendezvous: secure mode OFF (private mode's secret proof will not work)"
fi
if bool_is_true "$RELAY_ALL_PEER_RPC"; then
  RELAY_ALL_PEER_RPC_VALUE=true
else
  RELAY_ALL_PEER_RPC_VALUE=false
fi

CONFIG_DIR="$(mktemp -d /tmp/easyplane-rendezvous.XXXXXX)"
CONFIG_FILE="$CONFIG_DIR/config.toml"
trap 'rm -rf "$CONFIG_DIR"' EXIT INT TERM

{
  printf 'instance_name = "%s"\n' "$(toml_escape "$INSTANCE_NAME")"
  printf 'hostname = "%s"\n' "$(toml_escape "$HOSTNAME")"
  printf 'rpc_portal = "%s"\n\n' "$(toml_escape "$RPC_PORTAL")"

  printf 'listeners = [\n'
  printf '%s\n' "$LISTENERS" | tr ',' '\n' | while IFS= read -r listener; do
    listener="$(printf '%s' "$listener" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -n "$listener" ] || continue
    printf '  "%s",\n' "$(toml_escape "$listener")"
  done
  printf ']\n'
  if [ -n "$MAPPED_LISTENERS" ]; then
    printf 'mapped_listeners = [\n'
    printf '%s\n' "$MAPPED_LISTENERS" | tr ',' '\n' | while IFS= read -r listener; do
      listener="$(printf '%s' "$listener" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
      [ -n "$listener" ] || continue
      printf '  "%s",\n' "$(toml_escape "$listener")"
    done
    printf ']\n'
  fi

  printf '\n[network_identity]\n'
  printf 'network_name = "%s"\n' "$(toml_escape "$NETWORK_NAME")"
  printf 'network_secret = "%s"\n' "$(toml_escape "$NETWORK_SECRET")"

  printf '\n[flags]\n'
  printf 'no_tun = true\n'
  printf 'private_mode = %s\n' "$PRIVATE_MODE_VALUE"
  printf 'disable_relay_data = %s\n' "$DISABLE_RELAY_DATA"
  printf 'relay_network_whitelist = "%s"\n' "$(toml_escape "$WHITELIST")"
  printf 'relay_all_peer_rpc = %s\n' "$RELAY_ALL_PEER_RPC_VALUE"
  if [ -n "$FOREIGN_RELAY_BPS_LIMIT" ]; then
    printf 'foreign_relay_bps_limit = %s\n' "$FOREIGN_RELAY_BPS_LIMIT"
  fi
} >"$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

# easytier-core logs its effective config, but redacts network_secret.
exec easytier-core -c "$CONFIG_FILE" --secure-mode "$SECURE_MODE_VALUE" "$@"
