# Conformance test client: an UNMODIFIED easytier-core built from the pinned
# upstream commit (see scripts/build-test-client.sh).
#
# The binary is produced on the host and copied in because the brief forbids
# vendoring Rust sources into this repo; the Dockerfile is only a thin runtime.
# trixie (glibc 2.41) is required: the current toolchain links against
# GLIBC_2.39, which bookworm (2.36) does not provide.
#
# The extra packages are only test tooling used by test/conformance/*:
#   iproute2 (ip), iputils-ping, curl and python3 (traffic endpoints),
#   bind9-dnsutils (dig) for the MagicDNS assertions.
FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        iproute2 \
        iputils-ping \
        curl \
        python3 \
        bind9-dnsutils \
    && rm -rf /var/lib/apt/lists/*

COPY easytier-core /usr/local/bin/easytier-core

# easytier-core needs /dev/net/tun and CAP_NET_ADMIN to create a TUN device for
# the network instance the control plane pushes.
ENTRYPOINT ["/usr/local/bin/easytier-core"]
