#!/usr/bin/env python3
"""Test-only TCP relay for the M2 conformance topology.

Why this exists: the M2 test needs real easytier-core containers in *separate
network namespaces* (so each instance gets its own TUN device and routing table)
while the control plane runs in the vitest process on the host. On a host whose
firewall drops traffic from Docker bridges to host ports, a container cannot
dial the vitest listener at all, so the control channel is tunnelled:

    easytier-core --config-server ws://m2-relay:<client-port>/<token>
        -> relay (same compose network as the clients)
        -> a TCP connection the *host* opened towards <host-port> (allowed:
           host -> container works without firewall changes)

The relay is a dumb byte pump: the WebSocket handshake, the Noise upgrade and
every RPC are end-to-end between easytier-core and EasyPlane. Each client
connection (including the reconnect that carries the Noise handshake) consumes
one host connection, so the host pre-opens a small pool per tunnel.

Config: EASYPLANE_RELAY_PAIRS="client_port:host_port,client_port:host_port".
"""

import os
import queue
import socket
import sys
import threading

BUFFER = 64 * 1024


def pump(source: socket.socket, sink: socket.socket) -> None:
    try:
        while True:
            chunk = source.recv(BUFFER)
            if not chunk:
                break
            sink.sendall(chunk)
    except OSError:
        pass
    finally:
        try:
            sink.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def pair(left: socket.socket, right: socket.socket) -> None:
    threading.Thread(target=pump, args=(left, right), daemon=True).start()
    threading.Thread(target=pump, args=(right, left), daemon=True).start()


def listener(port: int) -> socket.socket:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", port))
    server.listen(64)
    return server


def run_pair(client_port: int, host_port: int) -> None:
    client_server = listener(client_port)
    host_server = listener(host_port)
    # LIFO: a client that is restarted pairs with the *newest* host socket.
    # Older queued sockets may have been closed by the control plane's HTTP
    # idle timeout, and a FIFO queue would make every restart burn through them
    # (one failed WebSocket handshake per dead socket).
    host_connections: "queue.LifoQueue[socket.socket]" = queue.LifoQueue()

    def accept_hosts() -> None:
        while True:
            conn, _ = host_server.accept()
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            host_connections.put(conn)

    def accept_clients() -> None:
        while True:
            conn, address = client_server.accept()
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            print(f"relay: client connection on {client_port} from {address}", flush=True)
            host = host_connections.get()
            pair(conn, host)

    threading.Thread(target=accept_hosts, daemon=True).start()
    threading.Thread(target=accept_clients, daemon=True).start()
    print(f"relay: {client_port} -> host pool {host_port}", flush=True)


def main() -> None:
    pairs = os.environ.get("EASYPLANE_RELAY_PAIRS", "23001:23011,23002:23012,23003:23013")
    for entry in pairs.split(","):
        entry = entry.strip()
        if not entry:
            continue
        client_port, host_port = entry.split(":")
        run_pair(int(client_port), int(host_port))
    print("relay: ready", flush=True)
    threading.Event().wait()


if __name__ == "__main__":
    sys.exit(main())
