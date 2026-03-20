import {
  Fragment,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type FocusEvent,
} from 'react'
import {
  Save,
  RotateCcw,
  Table2,
  Wand2,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Profile } from '@/lib/types'
import { SectionHeader, Button } from '@/components/ui'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Adapter columns shown in the spreadsheet, ordered by adapter index. */
const ADAPTER_COLUMNS = [
  { index: 0, role: 'd3Net',   label: 'A - d3Net',   color: 'bg-blue-500/20',   borderColor: 'border-blue-500/30',   hasSubnet: true,  dhcpDefault: false },
  { index: 1, role: 'sACN',    label: 'B - sACN',     color: 'bg-purple-500/20', borderColor: 'border-purple-500/30', hasSubnet: true,  dhcpDefault: false },
  { index: 2, role: 'Media',   label: 'C - Media',    color: 'bg-green-500/20',  borderColor: 'border-green-500/30',  hasSubnet: true,  dhcpDefault: false },
  { index: 3, role: 'NDI',     label: 'D - NDI',      color: 'bg-orange-500/20', borderColor: 'border-orange-500/30', hasSubnet: false, dhcpDefault: true  },
  { index: 4, role: '100G-E',  label: 'E - 100G',     color: 'bg-cyan-500/20',   borderColor: 'border-cyan-500/30',   hasSubnet: false, dhcpDefault: true  },
  { index: 5, role: '100G-F',  label: 'F - 100G',     color: 'bg-zinc-500/20',   borderColor: 'border-zinc-500/30',   hasSubnet: false, dhcpDefault: true  },
] as const

/** Total number of sub-columns per adapter (IP only vs IP+Subnet). */
function adapterSubCols(a: typeof ADAPTER_COLUMNS[number]) {
  return a.hasSubnet ? 2 : 1
}

/** Profile sort order: Director first, Actors numerically, Understudies numerically. */
function profileSortKey(name: string): [number, number] {
  const lower = name.toLowerCase()
  if (lower.includes('director')) return [0, 0]
  const actorMatch = lower.match(/actor\s*(\d+)/i)
  if (actorMatch) return [1, parseInt(actorMatch[1], 10)]
  const underMatch = lower.match(/understudy\s*(\d+)/i)
  if (underMatch) return [2, parseInt(underMatch[1], 10)]
  return [3, 0]
}

/** Basic IPv4 validation. */
function isValidIP(ip: string): boolean {
  if (!ip || ip.trim() === '') return true // empty is ok (not filled yet)
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => {
    const n = Number(p)
    return /^\d{1,3}$/.test(p) && n >= 0 && n <= 255
  })
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** A unique key identifying a single cell in the grid. */
type CellKey = string // "profileName::field"

/** Tracks edits keyed by profile name -> field -> value. */
interface EditMap {
  [profileName: string]: {
    serverName?: string
    adapters?: {
      [adapterIndex: number]: {
        ip?: string
        subnet?: string
        dhcp?: boolean
      }
    }
  }
}

// ─── Quick Fill defaults ─────────────────────────────────────────────────────

interface QuickFillValues {
  d3netBase: string
  d3netStart: number
  d3netSubnet: string
  sacnBase: string
  sacnStart: number
  sacnSubnet: string
  mediaBase: string
  mediaStart: number
  mediaSubnet: string
}

const DEFAULT_QUICK_FILL: QuickFillValues = {
  d3netBase: '192.168.10',
  d3netStart: 11,
  d3netSubnet: '255.255.255.0',
  sacnBase: '10.0.1',
  sacnStart: 11,
  sacnSubnet: '255.0.0.0',
  mediaBase: '192.168.20',
  mediaStart: 11,
  mediaSubnet: '255.255.255.0',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deep-clone a profile so we can apply edits without mutation. */
function cloneProfile(p: Profile): Profile {
  return JSON.parse(JSON.stringify(p))
}

/** Get the effective value for a cell, preferring edits over originals. */
function getCellValue(
  profile: Profile,
  edits: EditMap,
  field: 'serverName' | { adapterIndex: number; sub: 'ip' | 'subnet' | 'dhcp' },
): string | boolean {
  const e = edits[profile.Name]
  if (field === 'serverName') {
    return e?.serverName ?? profile.ServerName
  }
  const adapter = profile.NetworkAdapters.find((a) => a.Index === field.adapterIndex)
  const adapterEdit = e?.adapters?.[field.adapterIndex]
  if (field.sub === 'dhcp') {
    return adapterEdit?.dhcp ?? adapter?.DHCP ?? false
  }
  if (field.sub === 'ip') {
    return adapterEdit?.ip ?? adapter?.IPAddress ?? ''
  }
  return adapterEdit?.subnet ?? adapter?.SubnetMask ?? ''
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SpreadsheetPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [edits, setEdits] = useState<EditMap>({})
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState('')
  const [quickFillOpen, setQuickFillOpen] = useState(false)
  const [quickFill, setQuickFill] = useState<QuickFillValues>(DEFAULT_QUICK_FILL)
  const tableRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadProfiles = useCallback(() => {
    setLoading(true)
    api
      .getProfiles()
      .then((data) => {
        setProfiles(data)
        setEdits({})
      })
      .catch(() => toast.error('Failed to load profiles'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  // ── Sorted profiles ───────────────────────────────────────────────────────

  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => {
      const ka = profileSortKey(a.Name)
      const kb = profileSortKey(b.Name)
      return ka[0] - kb[0] || ka[1] - kb[1]
    })
  }, [profiles])

  // ── Dirty tracking ────────────────────────────────────────────────────────

  const dirtyProfileNames = useMemo(() => {
    return new Set(Object.keys(edits).filter((name) => {
      const e = edits[name]
      if (!e) return false
      if (e.serverName !== undefined) return true
      if (e.adapters) {
        return Object.values(e.adapters).some(
          (a) => a.ip !== undefined || a.subnet !== undefined || a.dhcp !== undefined,
        )
      }
      return false
    }))
  }, [edits])

  const hasChanges = dirtyProfileNames.size > 0

  /** Set of CellKeys that are dirty. */
  const dirtyCells = useMemo(() => {
    const set = new Set<CellKey>()
    for (const name of Object.keys(edits)) {
      const e = edits[name]
      if (!e) continue
      if (e.serverName !== undefined) set.add(`${name}::serverName`)
      if (e.adapters) {
        for (const [idx, a] of Object.entries(e.adapters)) {
          if (a.ip !== undefined) set.add(`${name}::${idx}::ip`)
          if (a.subnet !== undefined) set.add(`${name}::${idx}::subnet`)
          if (a.dhcp !== undefined) set.add(`${name}::${idx}::dhcp`)
        }
      }
    }
    return set
  }, [edits])

  // ── Cell navigation ───────────────────────────────────────────────────────

  /** Pre-computed DHCP flags per profile per adapter, used to determine navigable cells. */
  const dhcpFlags = useMemo(() => {
    const flags: Record<string, Record<number, boolean>> = {}
    for (const p of sortedProfiles) {
      flags[p.Name] = {}
      for (const ac of ADAPTER_COLUMNS) {
        flags[p.Name][ac.index] = getCellValue(p, edits, { adapterIndex: ac.index, sub: 'dhcp' }) as boolean
      }
    }
    return flags
  }, [sortedProfiles, edits])

  /** Build a flat list of navigable cell keys per row (for Tab/Enter). */
  const cellGrid = useMemo(() => {
    return sortedProfiles.map((p) => {
      const cells: CellKey[] = [`${p.Name}::serverName`]
      for (const ac of ADAPTER_COLUMNS) {
        const isDhcp = dhcpFlags[p.Name]?.[ac.index] ?? false
        if (!isDhcp) {
          cells.push(`${p.Name}::${ac.index}::ip`)
          if (ac.hasSubnet) cells.push(`${p.Name}::${ac.index}::subnet`)
        }
      }
      return cells
    })
  }, [sortedProfiles, dhcpFlags])

  const focusCell = useCallback((key: CellKey) => {
    const el = cellRefs.current.get(key)
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  const handleCellKeyDown = useCallback((
    e: KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    cellKey: CellKey,
  ) => {
    const row = cellGrid[rowIdx]
    if (!row) return
    const colIdx = row.indexOf(cellKey)

    if (e.key === 'Tab') {
      e.preventDefault()
      const nextCol = e.shiftKey ? colIdx - 1 : colIdx + 1
      if (nextCol >= 0 && nextCol < row.length) {
        focusCell(row[nextCol])
      } else if (!e.shiftKey && rowIdx + 1 < cellGrid.length) {
        focusCell(cellGrid[rowIdx + 1][0])
      } else if (e.shiftKey && rowIdx - 1 >= 0) {
        const prevRow = cellGrid[rowIdx - 1]
        focusCell(prevRow[prevRow.length - 1])
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rowIdx + 1 < cellGrid.length) {
        const nextRow = cellGrid[rowIdx + 1]
        const targetCol = Math.min(colIdx, nextRow.length - 1)
        focusCell(nextRow[targetCol])
      }
    }
  }, [cellGrid, focusCell])

  // ── Cell editing ──────────────────────────────────────────────────────────

  function setEdit(
    profileName: string,
    field: 'serverName',
    value: string,
  ): void
  function setEdit(
    profileName: string,
    field: 'adapter',
    adapterIndex: number,
    sub: 'ip' | 'subnet',
    value: string,
  ): void
  function setEdit(
    profileName: string,
    field: 'dhcp',
    adapterIndex: number,
    value: boolean,
  ): void
  // any[] is intentional here — the overload signatures above enforce type safety at call sites
  function setEdit(
    profileName: string,
    field: string,
    ...args: any[]
  ) {
    setEdits((prev) => {
      const next = { ...prev }
      if (!next[profileName]) next[profileName] = {}
      const entry = { ...next[profileName] }

      if (field === 'serverName') {
        const original = profiles.find((p) => p.Name === profileName)
        const value = args[0] as string
        if (original && value === original.ServerName) {
          delete entry.serverName
        } else {
          entry.serverName = value
        }
      } else if (field === 'adapter') {
        const [adapterIndex, sub, value] = args as [number, 'ip' | 'subnet', string]
        const adapters = { ...entry.adapters }
        const adapterEntry = { ...adapters[adapterIndex] }
        const original = profiles.find((p) => p.Name === profileName)
        const origAdapter = original?.NetworkAdapters.find((a) => a.Index === adapterIndex)
        const origValue = sub === 'ip' ? origAdapter?.IPAddress : origAdapter?.SubnetMask
        if (value === origValue) {
          delete adapterEntry[sub]
        } else {
          adapterEntry[sub] = value
        }
        if (Object.keys(adapterEntry).length === 0) {
          delete adapters[adapterIndex]
        } else {
          adapters[adapterIndex] = adapterEntry
        }
        if (Object.keys(adapters).length === 0) {
          delete entry.adapters
        } else {
          entry.adapters = adapters
        }
      } else if (field === 'dhcp') {
        const [adapterIndex, value] = args as [number, boolean]
        const adapters = { ...entry.adapters }
        const adapterEntry = { ...adapters[adapterIndex] }
        const original = profiles.find((p) => p.Name === profileName)
        const origAdapter = original?.NetworkAdapters.find((a) => a.Index === adapterIndex)
        if (value === origAdapter?.DHCP) {
          delete adapterEntry.dhcp
        } else {
          adapterEntry.dhcp = value
        }
        // When switching to DHCP, remove any static IP edits
        if (value) {
          delete adapterEntry.ip
          delete adapterEntry.subnet
        }
        if (Object.keys(adapterEntry).length === 0) {
          delete adapters[adapterIndex]
        } else {
          adapters[adapterIndex] = adapterEntry
        }
        if (Object.keys(adapters).length === 0) {
          delete entry.adapters
        } else {
          entry.adapters = adapters
        }
      }

      // Clean up empty entries
      if (!entry.serverName && !entry.adapters) {
        delete next[profileName]
      } else {
        next[profileName] = entry
      }
      return next
    })
  }

  // ── Save all ──────────────────────────────────────────────────────────────

  async function handleSaveAll() {
    const toSave = sortedProfiles.filter((p) => dirtyProfileNames.has(p.Name))
    if (toSave.length === 0) return

    setSaving(true)
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < toSave.length; i++) {
      const profile = toSave[i]
      setSaveProgress(`Saving ${i + 1} of ${toSave.length}: ${profile.Name}...`)

      // Apply edits to a cloned profile
      const updated = cloneProfile(profile)
      const e = edits[profile.Name]
      if (e) {
        if (e.serverName !== undefined) updated.ServerName = e.serverName
        if (e.adapters) {
          for (const [idxStr, ae] of Object.entries(e.adapters)) {
            const idx = Number(idxStr)
            const adapter = updated.NetworkAdapters.find((a) => a.Index === idx)
            if (adapter) {
              if (ae.dhcp !== undefined) adapter.DHCP = ae.dhcp
              if (ae.ip !== undefined) adapter.IPAddress = ae.ip
              if (ae.subnet !== undefined) adapter.SubnetMask = ae.subnet
            }
          }
        }
      }

      try {
        const result = await api.saveProfile(updated)
        if (!result.success) throw new Error(result.message)
        successCount++
      } catch (err) {
        failCount++
        toast.error(
          `Failed to save "${profile.Name}": ${err instanceof Error ? err.message : 'Unknown error'}`,
        )
      }
    }

    setSaving(false)
    setSaveProgress('')

    if (failCount === 0) {
      toast.success(`Saved ${successCount} profile${successCount > 1 ? 's' : ''} successfully`)
    } else {
      toast.error(`${failCount} profile${failCount > 1 ? 's' : ''} failed to save`)
    }

    // Reload to get fresh data
    loadProfiles()
  }

  // ── Quick Fill ────────────────────────────────────────────────────────────

  function applyQuickFill() {
    setEdits((prev) => {
      const next = { ...prev }
      sortedProfiles.forEach((profile, i) => {
        const entry = { ...next[profile.Name] }
        const adapters = { ...entry.adapters }

        const hostOffset = quickFill.d3netStart + i
        const sacnOffset = quickFill.sacnStart + i
        const mediaOffset = quickFill.mediaStart + i

        // d3Net (index 0)
        adapters[0] = { ...adapters[0], ip: `${quickFill.d3netBase}.${hostOffset}`, subnet: quickFill.d3netSubnet }
        // sACN (index 1)
        adapters[1] = { ...adapters[1], ip: `${quickFill.sacnBase}.${sacnOffset}`, subnet: quickFill.sacnSubnet }
        // Media (index 2)
        adapters[2] = { ...adapters[2], ip: `${quickFill.mediaBase}.${mediaOffset}`, subnet: quickFill.mediaSubnet }

        entry.adapters = adapters
        next[profile.Name] = entry
      })
      return next
    })
    toast.success(`Quick Fill applied to ${sortedProfiles.length} profiles — review and Save All`)
    setQuickFillOpen(false)
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function registerRef(key: CellKey) {
    return (el: HTMLInputElement | null) => {
      if (el) cellRefs.current.set(key, el)
      else cellRefs.current.delete(key)
    }
  }

  function renderIPCell(
    profile: Profile,
    rowIdx: number,
    adapterCol: typeof ADAPTER_COLUMNS[number],
    sub: 'ip' | 'subnet',
  ) {
    const isDhcp = getCellValue(profile, edits, { adapterIndex: adapterCol.index, sub: 'dhcp' }) as boolean

    // For DHCP adapters, show a clickable badge
    if (isDhcp) {
      if (sub === 'subnet') return null // don't render subnet cell for DHCP
      return (
        <td
          key={`${profile.Name}::${adapterCol.index}::dhcp`}
          className="px-1.5 py-1 text-center"
          colSpan={adapterCol.hasSubnet ? 2 : 1}
        >
          <button
            type="button"
            onClick={() => setEdit(profile.Name, 'dhcp', adapterCol.index, false)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium
                       bg-amber-500/20 text-amber-300 border border-amber-500/30
                       hover:bg-amber-500/30 transition-colors cursor-pointer"
            title="Click to switch to Static IP"
          >
            DHCP
          </button>
        </td>
      )
    }

    const cellKey: CellKey = `${profile.Name}::${adapterCol.index}::${sub}`
    const value = getCellValue(profile, edits, { adapterIndex: adapterCol.index, sub }) as string
    const isDirty = dirtyCells.has(cellKey)
    const isInvalid = value.trim() !== '' && !isValidIP(value)

    return (
      <td key={cellKey} className="px-0.5 py-0.5">
        <input
          ref={registerRef(cellKey)}
          type="text"
          value={value}
          placeholder={sub === 'ip' ? '0.0.0.0' : '255.255.255.0'}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setEdit(profile.Name, 'adapter', adapterCol.index, sub, e.target.value)
          }
          onFocus={(e: FocusEvent<HTMLInputElement>) => e.target.select()}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) =>
            handleCellKeyDown(e, rowIdx, cellKey)
          }
          className={[
            'w-full px-1.5 py-1 rounded text-xs font-mono bg-zinc-800/80 text-zinc-100',
            'border outline-none transition-all duration-150',
            'focus:ring-1 focus:ring-primary focus:border-primary',
            'placeholder:text-zinc-600',
            isDirty && !isInvalid
              ? 'border-amber-500/60 bg-amber-500/10'
              : isInvalid
                ? 'border-red-500/60 bg-red-500/10'
                : 'border-zinc-700/50 hover:border-zinc-600',
          ].join(' ')}
          style={{ minWidth: 110 }}
        />
      </td>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex flex-col gap-6">
        <SectionHeader
          title="Profile Spreadsheet"
          subtitle="Edit IP addresses across all profiles"
        />
        <div className="flex items-center justify-center py-20 gap-3 text-textMuted">
          <Loader2 className="animate-spin" size={20} />
          <span className="text-sm">Loading profiles...</span>
        </div>
      </div>
    )
  }

  if (profiles.length === 0) {
    return (
      <div className="p-6 flex flex-col gap-6">
        <SectionHeader
          title="Profile Spreadsheet"
          subtitle="Edit IP addresses across all profiles"
        />
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-14 h-14 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <Table2 size={24} className="text-zinc-500" />
          </div>
          <p className="text-text font-semibold">No profiles found</p>
          <p className="text-textMuted text-sm">
            Create profiles on the Profiles page first, then come back here to edit IPs in bulk.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      {/* Header */}
      <SectionHeader
        title="Profile Spreadsheet"
        subtitle="Edit IP addresses across all profiles"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setQuickFillOpen((v) => !v)}
              disabled={saving}
            >
              <Wand2 size={14} />
              Quick Fill
              {quickFillOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEdits({})}
              disabled={!hasChanges || saving}
            >
              <RotateCcw size={14} />
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveAll}
              disabled={!hasChanges || saving}
              loading={saving}
            >
              <Save size={14} />
              {saving ? saveProgress : `Save All${hasChanges ? ` (${dirtyProfileNames.size})` : ''}`}
            </Button>
          </div>
        }
      />

      {/* Quick Fill panel */}
      {quickFillOpen && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/80 p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wand2 size={16} className="text-primary" />
              <span className="text-sm font-semibold text-text">Quick Fill — Auto-assign IPs</span>
            </div>
            <button
              type="button"
              onClick={() => setQuickFillOpen(false)}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <p className="text-xs text-textMuted leading-relaxed">
            Enter base network addresses and a starting host number. Each profile row will get an
            incrementing IP (Director = .{quickFill.d3netStart}, Actor 1 = .{quickFill.d3netStart + 1}, etc.).
            This is a preview — click Apply, then review and Save All.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* d3Net */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-blue-400">d3Net</label>
              <div className="flex gap-1.5 items-center">
                <input
                  type="text"
                  value={quickFill.d3netBase}
                  onChange={(e) => setQuickFill((v) => ({ ...v, d3netBase: e.target.value }))}
                  placeholder="192.168.10"
                  className="flex-1 px-2 py-1.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-primary"
                />
                <span className="text-zinc-500 text-xs">.</span>
                <input
                  type="number"
                  min={1}
                  max={254}
                  value={quickFill.d3netStart}
                  onChange={(e) => setQuickFill((v) => ({ ...v, d3netStart: Number(e.target.value) }))}
                  className="w-16 px-2 py-1.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-primary"
                />
              </div>
              <input
                type="text"
                value={quickFill.d3netSubnet}
                onChange={(e) => setQuickFill((v) => ({ ...v, d3netSubnet: e.target.value }))}
                placeholder="Subnet mask"
                className="px-2 py-1.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-primary"
              />
            </div>

            {/* sACN */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-purple-400">sACN</label>
              <div className="flex gap-1.5 items-center">
                <input
                  type="text"
                  value={quickFill.sacnBase}
                  onChange={(e) => setQuickFill((v) => ({ ...v, sacnBase: e.target.value }))}
                  placeholder="10.0.1"
                  className="flex-1 px-2 py-1.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-primary"
                />
                <span className="text-zinc-500 text-xs">.</span>
                <input
                  type="number"
                  min={1}
                  max={254}
                  value={quickFill.sacnStart}
                  onChange={(e) => setQuickFill((v) => ({ ...v, sacnStart: Number(e.target.value) }))}
                  className="w-16 px-2 py-1.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-primary"
                />
              </div>
              <input
                type="text"
                value={quickFill.sacnSubnet}
                onChange={(e) => setQuickFill((v) => ({ ...v, sacnSubnet: e.target.value }))}
                placeholder="Subnet mask"
                className="px-2 py-1.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-primary"
              />
            </div>

            {/* Media */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-green-400">Media</label>
              <div className="flex gap-1.5 items-center">
                <input
                  type="text"
                  value={quickFill.mediaBase}
                  onChange={(e) => setQuickFill((v) => ({ ...v, mediaBase: e.target.value }))}
                  placeholder="192.168.20"
                  className="flex-1 px-2 py-1.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-primary"
                />
                <span className="text-zinc-500 text-xs">.</span>
                <input
                  type="number"
                  min={1}
                  max={254}
                  value={quickFill.mediaStart}
                  onChange={(e) => setQuickFill((v) => ({ ...v, mediaStart: Number(e.target.value) }))}
                  className="w-16 px-2 py-1.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-primary"
                />
              </div>
              <input
                type="text"
                value={quickFill.mediaSubnet}
                onChange={(e) => setQuickFill((v) => ({ ...v, mediaSubnet: e.target.value }))}
                placeholder="Subnet mask"
                className="px-2 py-1.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setQuickFillOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={applyQuickFill}>
              <Wand2 size={13} />
              Apply to All Rows
            </Button>
          </div>
        </div>
      )}

      {/* Change summary bar */}
      {hasChanges && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
          <AlertCircle size={14} />
          <span>
            {dirtyProfileNames.size} profile{dirtyProfileNames.size > 1 ? 's' : ''} with unsaved
            changes
          </span>
          <span className="text-amber-500/60 mx-1">|</span>
          <span className="text-amber-400/70">{dirtyCells.size} cell{dirtyCells.size > 1 ? 's' : ''} modified</span>
        </div>
      )}

      {/* Spreadsheet table */}
      <div
        ref={tableRef}
        className="flex-1 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900/50"
      >
        <table className="w-full border-collapse text-xs">
          {/* Column group headers (adapter roles) */}
          <thead className="sticky top-0 z-20">
            {/* Top row: grouped adapter headers */}
            <tr>
              {/* Profile name spacer */}
              <th
                className="sticky left-0 z-30 bg-zinc-900 border-b border-r border-zinc-700 px-3 py-2"
                rowSpan={2}
              >
                <span className="text-zinc-400 font-semibold text-xs">Profile</span>
              </th>
              {/* Server name spacer */}
              <th
                className="bg-zinc-900 border-b border-r border-zinc-700 px-3 py-2"
                rowSpan={2}
              >
                <span className="text-zinc-400 font-semibold text-xs">Server Name</span>
              </th>
              {/* Adapter group spans */}
              {ADAPTER_COLUMNS.map((ac) => (
                <th
                  key={ac.role}
                  colSpan={ac.hasSubnet ? 2 : 1}
                  className={`${ac.color} border-b border-r border-zinc-700 px-3 py-1.5 text-center`}
                >
                  <span className="text-zinc-200 font-bold text-xs tracking-wide">
                    {ac.label}
                  </span>
                </th>
              ))}
            </tr>

            {/* Sub-header row: IP / Subnet labels */}
            <tr>
              {ADAPTER_COLUMNS.map((ac) => (
                ac.hasSubnet ? (
                  <Fragment key={ac.role}>
                    <th
                      className={`${ac.color} border-b border-r border-zinc-700/50 px-2 py-1 text-center`}
                    >
                      <span className="text-zinc-400 font-medium text-[10px] uppercase tracking-wider">IP</span>
                    </th>
                    <th
                      className={`${ac.color} border-b border-r border-zinc-700/50 px-2 py-1 text-center`}
                    >
                      <span className="text-zinc-400 font-medium text-[10px] uppercase tracking-wider">Subnet</span>
                    </th>
                  </Fragment>
                ) : (
                  <th
                    key={ac.role}
                    className={`${ac.color} border-b border-r border-zinc-700/50 px-2 py-1 text-center`}
                  >
                    <span className="text-zinc-400 font-medium text-[10px] uppercase tracking-wider">IP</span>
                  </th>
                )
              ))}
            </tr>
          </thead>

          <tbody>
            {sortedProfiles.map((profile, rowIdx) => {
              const isRowDirty = dirtyProfileNames.has(profile.Name)
              const serverNameKey: CellKey = `${profile.Name}::serverName`
              const serverNameValue = getCellValue(profile, edits, 'serverName') as string
              const serverNameDirty = dirtyCells.has(serverNameKey)

              return (
                <tr
                  key={profile.Name}
                  className={[
                    'transition-colors duration-100',
                    isRowDirty ? 'bg-amber-500/[0.03]' : 'hover:bg-zinc-800/40',
                    rowIdx % 2 === 0 ? '' : 'bg-zinc-800/20',
                  ].join(' ')}
                >
                  {/* Sticky profile name column */}
                  <td className="sticky left-0 z-10 bg-zinc-900 border-r border-zinc-700/50 px-3 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-200 font-semibold text-xs">{profile.Name}</span>
                      {isRowDirty && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      )}
                    </div>
                  </td>

                  {/* Server name */}
                  <td className="px-0.5 py-0.5">
                    <input
                      ref={registerRef(serverNameKey)}
                      type="text"
                      value={serverNameValue}
                      maxLength={15}
                      onChange={(e) => setEdit(profile.Name, 'serverName', e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => handleCellKeyDown(e, rowIdx, serverNameKey)}
                      className={[
                        'w-full px-1.5 py-1 rounded text-xs font-mono bg-zinc-800/80 text-zinc-100',
                        'border outline-none transition-all duration-150',
                        'focus:ring-1 focus:ring-primary focus:border-primary',
                        'placeholder:text-zinc-600',
                        serverNameDirty
                          ? 'border-amber-500/60 bg-amber-500/10'
                          : 'border-zinc-700/50 hover:border-zinc-600',
                      ].join(' ')}
                      style={{ minWidth: 120 }}
                      placeholder="hostname"
                    />
                  </td>

                  {/* Adapter cells */}
                  {ADAPTER_COLUMNS.map((ac) => {
                    const isDhcp = getCellValue(profile, edits, {
                      adapterIndex: ac.index,
                      sub: 'dhcp',
                    }) as boolean

                    if (isDhcp) {
                      // Render single DHCP cell spanning IP+Subnet columns
                      return (
                        <td
                          key={`${profile.Name}::${ac.index}::dhcp`}
                          className="px-1.5 py-1 text-center"
                          colSpan={ac.hasSubnet ? 2 : 1}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setEdit(profile.Name, 'dhcp', ac.index, false)
                            }
                            className={[
                              'inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
                              'bg-amber-500/15 text-amber-400 border border-amber-500/25',
                              'hover:bg-amber-500/25 hover:border-amber-500/40 transition-colors cursor-pointer',
                              dirtyCells.has(`${profile.Name}::${ac.index}::dhcp`)
                                ? 'ring-1 ring-amber-500/40'
                                : '',
                            ].join(' ')}
                            title="Click to switch to Static IP"
                          >
                            DHCP
                          </button>
                        </td>
                      )
                    }

                    // Static IP cells
                    const cells = [renderIPCell(profile, rowIdx, ac, 'ip')]
                    if (ac.hasSubnet) {
                      cells.push(renderIPCell(profile, rowIdx, ac, 'subnet'))
                    }

                    // Add a "switch to DHCP" context for adapters that default to DHCP
                    if (ac.dhcpDefault) {
                      return (
                        <td
                          key={`${profile.Name}::${ac.index}::static-wrap`}
                          className="px-0.5 py-0.5 relative group"
                          colSpan={ac.hasSubnet ? 2 : 1}
                        >
                          <div className="flex items-center gap-0.5">
                            <input
                              ref={registerRef(`${profile.Name}::${ac.index}::ip`)}
                              type="text"
                              value={
                                getCellValue(profile, edits, {
                                  adapterIndex: ac.index,
                                  sub: 'ip',
                                }) as string
                              }
                              placeholder="0.0.0.0"
                              onChange={(e) =>
                                setEdit(profile.Name, 'adapter', ac.index, 'ip', e.target.value)
                              }
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) =>
                                handleCellKeyDown(e, rowIdx, `${profile.Name}::${ac.index}::ip`)
                              }
                              className={[
                                'flex-1 px-1.5 py-1 rounded text-xs font-mono bg-zinc-800/80 text-zinc-100',
                                'border outline-none transition-all duration-150',
                                'focus:ring-1 focus:ring-primary focus:border-primary',
                                'placeholder:text-zinc-600',
                                dirtyCells.has(`${profile.Name}::${ac.index}::ip`)
                                  ? 'border-amber-500/60 bg-amber-500/10'
                                  : 'border-zinc-700/50 hover:border-zinc-600',
                              ].join(' ')}
                              style={{ minWidth: 100 }}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setEdit(profile.Name, 'dhcp', ac.index, true)
                              }
                              className="opacity-0 group-hover:opacity-100 px-1 py-0.5 text-[9px] rounded
                                         bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all"
                              title="Switch to DHCP"
                            >
                              DHCP
                            </button>
                          </div>
                        </td>
                      )
                    }

                    return cells
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer hint */}
      <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1">
        <span>
          Tab = next cell | Enter = move down | Click to select all text
        </span>
        <span>
          {sortedProfiles.length} profiles | {ADAPTER_COLUMNS.reduce(
            (sum, ac) => sum + adapterSubCols(ac),
            0,
          )}{' '}
          network columns
        </span>
      </div>
    </div>
  )
}
