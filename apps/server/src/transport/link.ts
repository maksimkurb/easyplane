import {
  NOISE_MAGIC,
  NOISE_PROLOGUE,
  PEER_MANAGER_HEADER_SIZE,
  PacketType,
  SECURE_ACCEPT_TIMEOUT_MS,
} from "../protocol/constants.js";
import { noiseRespond } from "../protocol/noise.js";
import { buildTunnelPayload } from "../protocol/peer-header.js";
import { SecureDatagramSession } from "../protocol/secure-datagram.js";
import type { FrameTransport } from "./frames.js";

/**
 * One accepted config-server connection: framed transport plus optional
 * web-secure (Noise + AES-GCM) layer.
 *
 * The negotiation mirrors `web_security::accept_or_upgrade_server_tunnel`:
 * wait up to 3 s for the first tunnel payload; if it starts with
 * `ET_WEB_NOISE_V1:` treat it as Noise msg1, otherwise the connection stays in
 * legacy/plain mode and the first packet is replayed to the RPC layer.
 */
export interface TunnelLink {
  readonly transportKind: FrameTransport["kind"];
  readonly label: string;
  readonly remoteAddress: string;
  readonly secure: boolean;
  nextPacket(): Promise<Buffer | null>;
  sendPacket(tunnelPayload: Buffer): void;
  close(): void;
}

class Link implements TunnelLink {
  private pendingFirst: Buffer | null;

  constructor(
    private readonly transport: FrameTransport,
    private readonly session: SecureDatagramSession | null,
    firstPacket: Buffer | null,
  ) {
    this.pendingFirst = firstPacket;
  }

  get transportKind(): FrameTransport["kind"] {
    return this.transport.kind;
  }

  get label(): string {
    return this.transport.label;
  }

  get remoteAddress(): string {
    return this.transport.remoteAddress;
  }

  get secure(): boolean {
    return this.session !== null;
  }

  async nextPacket(): Promise<Buffer | null> {
    const first = this.pendingFirst;
    if (first) {
      this.pendingFirst = null;
      return first;
    }
    const raw = await this.transport.frames.next();
    if (raw === null) return null;
    return this.session ? this.session.open(raw) : raw;
  }

  sendPacket(tunnelPayload: Buffer): void {
    this.transport.sendFrame(this.session ? this.session.seal(tunnelPayload) : tunnelPayload);
  }

  close(): void {
    this.transport.close();
  }
}

export interface AcceptedLink {
  link: TunnelLink;
  /** True when this connection completed the web-secure handshake. */
  secure: boolean;
}

export async function acceptLink(transport: FrameTransport): Promise<AcceptedLink> {
  let first: Buffer | null = null;
  try {
    first = await transport.frames.next(SECURE_ACCEPT_TIMEOUT_MS);
  } catch {
    // Upstream falls back to a plain tunnel when no first packet arrives within
    // the secure-accept timeout; the RPC layer will simply keep waiting.
    first = null;
  }

  const payloadOffset = PEER_MANAGER_HEADER_SIZE;
  const isNoise =
    first !== null &&
    first.length > payloadOffset + NOISE_MAGIC.length &&
    first.subarray(payloadOffset, payloadOffset + NOISE_MAGIC.length).equals(NOISE_MAGIC);

  if (first === null || !isNoise) {
    return { link: new Link(transport, null, first), secure: false };
  }

  const msg1 = first.subarray(payloadOffset + NOISE_MAGIC.length);
  const { message, rootKey } = noiseRespond(msg1, NOISE_PROLOGUE);
  transport.sendFrame(
    buildTunnelPayload(Buffer.concat([NOISE_MAGIC, message]), {
      fromPeerId: 0,
      toPeerId: 0,
      packetType: PacketType.Data,
    }),
  );

  return {
    link: new Link(transport, SecureDatagramSession.responder(rootKey), null),
    secure: true,
  };
}
