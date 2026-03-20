/**
 * Canonical sort order for disguise servers:
 *   1. Director(s)
 *   2. Actor(s)  — sorted by number
 *   3. Understudy(ies) — sorted by number
 *   4. Everything else alphabetically
 */

function roleRank(hostname: string): number {
  const h = hostname.toUpperCase()
  if (h.startsWith('DIRECTOR')) return 0
  if (h.startsWith('ACTOR')) return 1
  if (h.startsWith('UNDERSTUDY')) return 2
  return 3
}

function trailingNumber(hostname: string): number {
  const m = hostname.match(/(\d+)$/)
  return m ? parseInt(m[1], 10) : 0
}

export function sortServers<T extends { hostname?: string }>(servers: T[]): T[] {
  return [...servers].sort((a, b) => {
    const ha = a.hostname || ''
    const hb = b.hostname || ''
    const ra = roleRank(ha)
    const rb = roleRank(hb)
    if (ra !== rb) return ra - rb
    const na = trailingNumber(ha)
    const nb = trailingNumber(hb)
    if (na !== nb) return na - nb
    return ha.localeCompare(hb)
  })
}
