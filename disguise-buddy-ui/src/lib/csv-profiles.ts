import type { Profile } from './types'

// ─── Adapter role definitions ────────────────────────────────────────────────

const ADAPTER_ROLES = [
  { index: 0, role: 'd3Net',  label: 'A-d3Net' },
  { index: 1, role: 'sACN',   label: 'B-sACN' },
  { index: 2, role: 'Media',  label: 'C-Media' },
  { index: 3, role: 'NDI',    label: 'D-NDI' },
  { index: 4, role: '100G-E', label: 'E-100G' },
  { index: 5, role: '100G-F', label: 'F-100G' },
] as const

/** Build the fixed CSV header row. */
function buildHeader(): string[] {
  const cols: string[] = ['Profile Name', 'Server Name']
  for (const a of ADAPTER_ROLES) {
    cols.push(`${a.label} IP`, `${a.label} Subnet`, `${a.label} DHCP`)
  }
  return cols
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

/** Escape a single CSV field — quote it if it contains commas, quotes, or newlines. */
function escapeField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

/** Encode an array of fields into one CSV line. */
function encodeLine(fields: string[]): string {
  return fields.map(escapeField).join(',')
}

/**
 * Parse a single CSV line, respecting quoted fields that may contain commas
 * and embedded double-quotes (RFC 4180).
 */
function parseLine(line: string): string[] {
  const fields: string[] = []
  let i = 0
  const len = line.length

  while (i <= len) {
    if (i === len) {
      // trailing comma produced an empty final field
      fields.push('')
      break
    }

    if (line[i] === '"') {
      // Quoted field
      let value = ''
      i++ // skip opening quote
      while (i < len) {
        if (line[i] === '"') {
          if (i + 1 < len && line[i + 1] === '"') {
            // escaped double-quote
            value += '"'
            i += 2
          } else {
            // closing quote
            i++ // skip closing quote
            break
          }
        } else {
          value += line[i]
          i++
        }
      }
      fields.push(value)
      // skip comma (or we're at end of line)
      if (i < len && line[i] === ',') i++
    } else {
      // Unquoted field
      const commaIdx = line.indexOf(',', i)
      if (commaIdx === -1) {
        fields.push(line.substring(i))
        break
      } else {
        fields.push(line.substring(i, commaIdx))
        i = commaIdx + 1
      }
    }
  }

  return fields
}

/**
 * Split raw CSV text into lines, handling fields that span multiple lines
 * when enclosed in quotes.
 */
function splitCSVLines(text: string): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // End of logical line
      if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        i++ // skip LF after CR
      }
      if (current.length > 0) {
        lines.push(current)
      }
      current = ''
    } else {
      current += ch
    }
  }
  if (current.length > 0) {
    lines.push(current)
  }

  return lines
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

/** Sort profiles: Director first, then Actors numerically, then Understudies numerically, then everything else alphabetically. */
function sortProfiles<T extends { Name: string }>(profiles: T[]): T[] {
  return [...profiles].sort((a, b) => {
    const ra = sortRank(a.Name)
    const rb = sortRank(b.Name)
    if (ra.group !== rb.group) return ra.group - rb.group
    if (ra.num !== rb.num) return ra.num - rb.num
    return a.Name.localeCompare(b.Name)
  })
}

function sortRank(name: string): { group: number; num: number } {
  const lower = name.toLowerCase()
  if (lower === 'director') return { group: 0, num: 0 }

  const actorMatch = lower.match(/^actor\s*(\d+)$/i)
  if (actorMatch) return { group: 1, num: parseInt(actorMatch[1], 10) }

  const understudyMatch = lower.match(/^understudy\s*(\d+)$/i)
  if (understudyMatch) return { group: 2, num: parseInt(understudyMatch[1], 10) }

  return { group: 3, num: 0 }
}

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Export profiles to a CSV string.
 *
 * Columns: Profile Name, Server Name, then for each adapter (d3Net, sACN,
 * Media, NDI, Control, Internet): IP, Subnet, DHCP.
 *
 * DHCP adapters show "DHCP" in the IP column and an empty subnet.
 * Profiles are sorted: Director first, Actors numerically, Understudies
 * numerically, then alphabetical.
 */
export function profilesToCSV(profiles: Profile[]): string {
  const header = buildHeader()
  const rows: string[] = [encodeLine(header)]

  for (const profile of sortProfiles(profiles)) {
    const fields: string[] = [profile.Name, profile.ServerName]

    for (const def of ADAPTER_ROLES) {
      const adapter = profile.NetworkAdapters.find(a => a.Index === def.index)
      if (!adapter) {
        // Missing adapter — empty cells
        fields.push('', '', 'No')
      } else if (adapter.DHCP) {
        fields.push('DHCP', '', 'Yes')
      } else {
        fields.push(adapter.IPAddress || '', adapter.SubnetMask || '', 'No')
      }
    }

    rows.push(encodeLine(fields))
  }

  return rows.join('\r\n') + '\r\n'
}

// ─── Import ──────────────────────────────────────────────────────────────────

/** The shape returned for each profile row parsed from the CSV. */
export interface ProfileUpdate {
  Name: string
  ServerName: string
  adapters: Array<{
    index: number
    role: string
    ip: string
    subnet: string
    dhcp: boolean
  }>
}

/**
 * Parse a CSV string back into partial profile update objects.
 *
 * Returns an array of objects containing Name, ServerName, and adapter
 * configurations. The caller should merge these into existing Profile objects
 * to preserve fields not present in the CSV (Description, SMBSettings, etc.).
 *
 * Throws if the header row does not match expected columns.
 */
export function csvToProfileUpdates(csv: string): ProfileUpdate[] {
  const lines = splitCSVLines(csv.trim())
  if (lines.length === 0) {
    throw new Error('CSV is empty')
  }

  // Validate header
  const expectedHeader = buildHeader()
  const actualHeader = parseLine(lines[0])

  if (actualHeader.length < expectedHeader.length) {
    throw new Error(
      `CSV header has ${actualHeader.length} columns but expected ${expectedHeader.length}. ` +
      `Missing columns starting at "${expectedHeader[actualHeader.length]}".`
    )
  }

  for (let i = 0; i < expectedHeader.length; i++) {
    const expected = expectedHeader[i].trim().toLowerCase()
    const actual = (actualHeader[i] ?? '').trim().toLowerCase()
    if (expected !== actual) {
      throw new Error(
        `CSV header mismatch at column ${i + 1}: expected "${expectedHeader[i]}" but found "${actualHeader[i] ?? '(missing)'}".`
      )
    }
  }

  // Parse data rows
  const updates: ProfileUpdate[] = []

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const fields = parseLine(lines[rowIdx])

    // Skip completely empty rows
    if (fields.every(f => f.trim() === '')) continue

    const name = fields[0]?.trim() ?? ''
    const serverName = fields[1]?.trim() ?? ''

    if (!name) {
      throw new Error(`Row ${rowIdx + 1}: Profile Name is empty.`)
    }

    const adapters: ProfileUpdate['adapters'] = []

    for (let adapterIdx = 0; adapterIdx < ADAPTER_ROLES.length; adapterIdx++) {
      const baseCol = 2 + adapterIdx * 3
      const rawIP = (fields[baseCol] ?? '').trim()
      const rawSubnet = (fields[baseCol + 1] ?? '').trim()
      const rawDHCP = (fields[baseCol + 2] ?? '').trim().toLowerCase()

      const isDHCP = rawDHCP === 'yes' || rawIP.toUpperCase() === 'DHCP'

      adapters.push({
        index: ADAPTER_ROLES[adapterIdx].index,
        role: ADAPTER_ROLES[adapterIdx].role,
        ip: isDHCP ? '' : rawIP,
        subnet: isDHCP ? '' : rawSubnet,
        dhcp: isDHCP,
      })
    }

    updates.push({ Name: name, ServerName: serverName, adapters })
  }

  return updates
}

// ─── Browser file I/O ────────────────────────────────────────────────────────

/**
 * Trigger a CSV file download in the browser.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Open a file picker and read a CSV file.
 * Returns a promise that resolves with the CSV string content.
 */
export function pickAndReadCSV(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('No file selected'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    }
    input.oncancel = () => reject(new Error('File selection cancelled'))
    input.click()
  })
}
