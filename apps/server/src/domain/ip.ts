/** IPv4 CIDR helpers for the per-device virtual address allocator. */

export interface Ipv4Cidr {
  /** Network address as u32 (host byte order). */
  base: number;
  prefix: number;
  /** Number of usable host addresses. */
  size: number;
}

export function parseIpv4(value: string): number {
  const parts = value.trim().split(".");
  if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${value}`);
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`invalid IPv4 address: ${value}`);
    const octet = Number(part);
    if (octet < 0 || octet > 255) throw new Error(`invalid IPv4 address: ${value}`);
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

export function formatIpv4(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
    ".",
  );
}

export function parseCidr(value: string): Ipv4Cidr {
  const [address, prefixPart] = value.trim().split("/");
  if (!address || !prefixPart) throw new Error(`invalid CIDR: ${value}`);
  const prefix = Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) {
    throw new Error(`CIDR prefix must be between 8 and 30: ${value}`);
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const base = (parseIpv4(address) & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  return { base, prefix, size };
}

/**
 * Picks the lowest free host address in `cidr`, reserving the network address,
 * the broadcast address, `.1` (panel/gateway convention) and every address the
 * caller reports as used. Returns null when the pool is exhausted.
 */
export function allocateIpv4(cidr: string, used: Iterable<string>): string | null {
  const { base, size } = parseCidr(cidr);
  const taken = new Set<number>();
  for (const ip of used) {
    try {
      taken.add(parseIpv4(ip));
    } catch {
      // Ignore malformed rows instead of failing allocation for everyone.
    }
  }
  const first = 2;
  const last = size - 2;
  for (let offset = first; offset <= last; offset += 1) {
    const candidate = (base + offset) >>> 0;
    if (!taken.has(candidate)) return formatIpv4(candidate);
  }
  return null;
}

/** Prefix length encoded in a CIDR (e.g. 24 for 10.144.144.0/24). */
export function cidrPrefix(cidr: string): number {
  return parseCidr(cidr).prefix;
}
