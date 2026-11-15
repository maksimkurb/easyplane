export function matchesNavHref(locationPath: string, href: string): boolean {
  if (href === "/") {
    return locationPath === "/" || locationPath === ""
  }

  return locationPath === href || locationPath.startsWith(`${href}/`)
}

/**
 * The most specific nav entry for the current path. Without this, a nested
 * route such as `/networks/import` would also highlight `/networks` because
 * `matchesNavHref` accepts descendants.
 */
export function findActiveNavHref(
  locationPath: string,
  hrefs: string[]
): string | null {
  let active: string | null = null
  for (const href of hrefs) {
    if (!matchesNavHref(locationPath, href)) continue
    if (active === null || href.length > active.length) active = href
  }
  return active
}
