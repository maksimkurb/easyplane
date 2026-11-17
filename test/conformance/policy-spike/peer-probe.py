#!/usr/bin/env python3
"""One-shot TCP probe: records the source address a destination really sees.

The policy spike needs to know whether a LAN host behind an EasyTier subnet
router arrives at the remote node with its LAN address or with the router's
overlay address (NAT). An HTTP server's access log is easy to lose, so this
probe accepts exactly one connection, writes the peer address to
/tmp/b-peer.log and answers with an empty HTTP 200.
"""

import socket

server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("0.0.0.0", 8099))
server.listen(1)
connection, address = server.accept()
with open("/tmp/b-peer.log", "w", encoding="utf-8") as handle:
    handle.write(address[0])
connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
connection.close()
server.close()
