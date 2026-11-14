/**
 * Small helpers shared by the server app and (later) the web app.
 * M0 only needs the byte/UUID helpers used by the protocol layer.
 */

/** RFC 4122 UUID <-> EasyTier `common.UUID` (four big-endian-less u32 halves). */
export interface ProtoUuid {
  part1: number;
  part2: number;
  part3: number;
  part4: number;
}

export function uuidToProto(uuid: string): ProtoUuid {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`invalid uuid: ${uuid}`);
  }
  return {
    part1: parseInt(hex.slice(0, 8), 16),
    part2: parseInt(hex.slice(8, 16), 16),
    part3: parseInt(hex.slice(16, 24), 16),
    part4: parseInt(hex.slice(24, 32), 16),
  };
}

export function protoToUuid(parts: ProtoUuid): string {
  const hex = [parts.part1, parts.part2, parts.part3, parts.part4]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function newUuid(): string {
  return crypto.randomUUID();
}
