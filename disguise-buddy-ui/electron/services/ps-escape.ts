/** Escape a string for use inside a PowerShell double-quoted string */
export function escapePsDouble(s: string): string {
  return s.replace(/[`$"]/g, '`$&')
}

/** Escape a string for use inside a PowerShell single-quoted string */
export function escapePsSingle(s: string): string {
  return s.replace(/'/g, "''")
}
