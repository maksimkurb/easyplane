/**
 * MagicDNS naming rules.
 *
 * EasyTier's MagicDNS is per instance: `enable_magic_dns` in NetworkConfig maps
 * to the `accept_dns` flag, and the DNS server answers `<hostname>.<zone>` with
 * the peer's virtual IPv4. The zone itself lives in the client's flags
 * (`--tld-dns-zone`, default `et.net.`) and is NOT part of NetworkConfig, so
 * EasyPlane names devices in a per-network zone but cannot push that zone to a
 * client. See docs/POLICY.md ("MagicDNS").
 */

export const DEFAULT_MAGIC_DNS_ZONE = "et.net.";

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lowercases, strips a trailing dot and validates a DNS zone. */
export function normalizeDnsZone(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const withoutTrailing = trimmed.endsWith(".")
    ? trimmed.slice(0, -1)
    : trimmed;
  if (withoutTrailing === "") {
    throw new Error("DNS zone must not be empty");
  }
  const labels = withoutTrailing.split(".");
  if (labels.length < 2) {
    throw new Error("DNS zone must have at least two labels, e.g. et.net.");
  }
  for (const label of labels) {
    if (!LABEL_RE.test(label)) {
      throw new Error(`invalid DNS zone label: "${label}"`);
    }
  }
  if (withoutTrailing.length > 200) {
    throw new Error("DNS zone is too long");
  }
  return `${withoutTrailing}.`;
}

/**
 * Turns an arbitrary client hostname into a DNS label.
 *
 * EasyTier itself accepts almost anything and only logs an error for an
 * invalid record name, so the control plane normalises it: lowercase,
 * non-alphanumerics collapsed to "-", at most 63 characters.
 */
export function toDnsLabel(raw: string): string {
  const label = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return label;
}

export function isValidDnsLabel(value: string): boolean {
  return LABEL_RE.test(value);
}

/**
 * Allocates a unique label inside one network: the requested label when free,
 * otherwise `label`, `label-2`, `label-3`, ... `taken` must be lowercase.
 */
export function allocateDnsLabel(
  requested: string,
  taken: Iterable<string>,
  fallback = "device",
): string {
  const base = toDnsLabel(requested) || fallback;
  const used = new Set(Array.from(taken, (entry) => entry.toLowerCase()));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, 63 - String(suffix).length - 1)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`cannot allocate a unique DNS name for "${requested}"`);
}

export interface ResolvedName {
  hostname: string;
  zone: string;
  fqdn: string;
  ipv4: string | null;
}

export function magicDnsName(
  hostname: string,
  zone: string,
): { hostname: string; zone: string; fqdn: string } {
  const normalizedZone = normalizeDnsZone(zone);
  return {
    hostname,
    zone: normalizedZone,
    fqdn: `${hostname}.${normalizedZone}`,
  };
}
