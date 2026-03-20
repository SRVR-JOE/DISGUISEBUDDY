/**
 * Validates an IPv4 address string.
 *
 * - Empty / falsy strings return true (treat as "not filled yet").
 * - Rejects leading zeros (e.g. "01.02.03.04") to avoid ambiguity.
 * - Each octet must be 0-255.
 */
export function isValidIP(ip: string): boolean {
  if (!ip || ip.trim() === '') return true // empty is OK (not filled yet)
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => {
    const n = parseInt(p, 10)
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p
  })
}
