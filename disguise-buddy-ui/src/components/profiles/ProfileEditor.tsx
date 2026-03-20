import { useState, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, X, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Toggle, ConfirmDialog } from '@/components/ui'
import type { Profile, AdapterConfig, SMBSettings, SmbShare } from '@/lib/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const ADAPTER_ROLES = ['d3Net', 'sACN / Art-Net', 'Media', 'NDI', 'Control', 'Internet'] as const

const ALL_ROLE_OPTIONS = [
  'd3Net',
  'Media',
  'sACN / Art-Net',
  'NDI',
  'Control',
  'Internet',
  '100G',
  'KVM',
  'Backup',
  'Management',
] as const

function buildDefaultProfile(): Profile {
  return {
    Name: '',
    Description: '',
    Created: new Date().toISOString(),
    Modified: new Date().toISOString(),
    ServerName: '',
    NetworkAdapters: Array.from({ length: 6 }, (_, i): AdapterConfig => ({
      Index: i,
      Role: ADAPTER_ROLES[i],
      DisplayName: `NIC ${String.fromCharCode(65 + i)}`,
      AdapterName: `NIC ${String.fromCharCode(65 + i)}`,
      IPAddress: '',
      SubnetMask: '',
      Gateway: '',
      DNS1: '',
      DNS2: '',
      DHCP: true,
      VLANID: null,
      Enabled: true,
    })),
    SMBSettings: {
      ShareD3Projects: true,
      ProjectsPath: 'D:\\d3 Projects',
      ShareName: 'd3 Projects',
      SharePermissions: 'Administrators:Full',
      AdditionalShares: [],
    },
    CustomSettings: {},
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** NetBIOS name: 1-15 chars, letters/digits/hyphens, no leading/trailing hyphen */
function validateServerName(name: string): string | undefined {
  if (!name) return undefined // empty is allowed (no value yet)
  if (name.length > 15) return 'Max 15 characters (NetBIOS limit)'
  if (!/^[A-Za-z0-9-]+$/.test(name)) return 'Letters, digits, and hyphens only'
  if (name.startsWith('-') || name.endsWith('-')) return 'Cannot start or end with a hyphen'
  return undefined
}

/** Validate IPv4 address: 4 octets, each 0-255, no leading zeros */
function isValidIP(ip: string): boolean {
  if (!ip) return true // empty is OK
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => {
    const n = parseInt(p, 10)
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p
  })
}


// ─── Sub-components ───────────────────────────────────────────────────────────

interface AdapterCardProps {
  adapter: AdapterConfig
  onChange: (updated: AdapterConfig) => void
}

function AdapterCard({ adapter, onChange }: AdapterCardProps) {
  const [expanded, setExpanded] = useState(false)

  function updateField<K extends keyof AdapterConfig>(key: K, value: AdapterConfig[K]) {
    onChange({ ...adapter, [key]: value })
  }

  // Field-level validation errors
  const ipError = !adapter.DHCP && !isValidIP(adapter.IPAddress) ? 'Invalid IP address' : undefined
  const subnetError = !adapter.DHCP && !isValidIP(adapter.SubnetMask) ? 'Invalid subnet mask' : undefined

  const nicLabel = `NIC ${String.fromCharCode(65 + adapter.Index)}`

  return (
    <div
      className={`rounded-lg border border-border bg-surface overflow-hidden transition-opacity duration-200 ${
        !adapter.Enabled ? 'opacity-50' : ''
      }`}
    >
      {/* Accordion header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-hover transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-bold text-primary w-10">{nicLabel}</span>
          <span className="text-sm font-medium text-text">{adapter.Role}</span>
          {!adapter.Enabled && (
            <span className="text-xs text-textMuted bg-hover px-1.5 py-0.5 rounded">Disabled</span>
          )}
          {adapter.Enabled && adapter.DHCP && (
            <span className="text-xs text-textMuted bg-hover px-1.5 py-0.5 rounded">DHCP</span>
          )}
          {adapter.Enabled && !adapter.DHCP && adapter.IPAddress && (
            <span className="text-xs font-mono text-textSecondary">{adapter.IPAddress}</span>
          )}
          {adapter.VLANID != null && (
            <span className="text-xs text-textMuted bg-hover px-1.5 py-0.5 rounded">VLAN {adapter.VLANID}</span>
          )}
        </div>
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.18 }}
          aria-hidden="true"
        >
          <ChevronDown size={14} className="text-textMuted" />
        </motion.div>
      </button>

      {/* Accordion body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 flex flex-col gap-3 border-t border-border">
              {/* Enabled toggle */}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-textSecondary font-medium">Enabled</span>
                <Toggle
                  checked={adapter.Enabled}
                  onChange={(v) => updateField('Enabled', v)}
                  label={adapter.Enabled ? 'On' : 'Off'}
                />
              </div>

              {/* Display Name */}
              <Input
                label="Display Name"
                value={adapter.DisplayName}
                onChange={(v) => updateField('DisplayName', v)}
                placeholder="e.g. NIC A"
              />

              {/* Role dropdown */}
              <div className="flex flex-col gap-1.5">
                <label className="text-textSecondary font-medium text-sm">Role</label>
                <select
                  value={adapter.Role}
                  onChange={(e) => updateField('Role', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm transition-colors duration-150 outline-none bg-surface border border-border text-text focus:border-primary focus:ring-1 focus:ring-primary/30 appearance-none cursor-pointer"
                >
                  {ALL_ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                  {/* If the current role is not in the standard list, show it as an option */}
                  {!ALL_ROLE_OPTIONS.includes(adapter.Role as typeof ALL_ROLE_OPTIONS[number]) && (
                    <option value={adapter.Role}>{adapter.Role} (custom)</option>
                  )}
                </select>
              </div>

              {/* DHCP toggle */}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-textSecondary font-medium">Use DHCP</span>
                <Toggle
                  checked={adapter.DHCP}
                  onChange={(v) => updateField('DHCP', v)}
                  label={adapter.DHCP ? 'On' : 'Off'}
                />
              </div>

              {/* Static IP fields -- disabled when DHCP */}
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="IP Address"
                  value={adapter.IPAddress}
                  onChange={(v) => updateField('IPAddress', v)}
                  placeholder="192.168.1.10"
                  disabled={adapter.DHCP}
                  error={ipError}
                />
                <Input
                  label="Subnet Mask"
                  value={adapter.SubnetMask}
                  onChange={(v) => updateField('SubnetMask', v)}
                  placeholder="255.255.255.0"
                  disabled={adapter.DHCP}
                  error={subnetError}
                />
              </div>

              {/* VLAN ID */}
              <div className="flex flex-col gap-1.5">
                <label className="text-textSecondary font-medium text-sm">VLAN ID</label>
                <input
                  type="number"
                  min={0}
                  max={4094}
                  value={adapter.VLANID ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === '') {
                      updateField('VLANID', null)
                    } else {
                      const n = parseInt(raw, 10)
                      if (!isNaN(n) && n >= 0 && n <= 4094) {
                        updateField('VLANID', n)
                      }
                    }
                  }}
                  placeholder="None"
                  className="w-full px-3 py-2 rounded-lg text-sm transition-colors duration-150 outline-none bg-surface border border-border placeholder:text-textMuted text-text focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </div>

              {/* Gateway + DNS -- collapsible via "Advanced" */}
              <AdvancedFields adapter={adapter} onChange={onChange} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface AdvancedFieldsProps {
  adapter: AdapterConfig
  onChange: (updated: AdapterConfig) => void
}

function AdvancedFields({ adapter, onChange }: AdvancedFieldsProps) {
  const [open, setOpen] = useState(false)

  function updateField<K extends keyof AdapterConfig>(key: K, value: AdapterConfig[K]) {
    onChange({ ...adapter, [key]: value })
  }

  const gatewayError = !adapter.DHCP && !isValidIP(adapter.Gateway) ? 'Invalid gateway address' : undefined
  const dns1Error = !adapter.DHCP && !isValidIP(adapter.DNS1) ? 'Invalid DNS address' : undefined
  const dns2Error = !adapter.DHCP && !isValidIP(adapter.DNS2) ? 'Invalid DNS address' : undefined

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-textMuted hover:text-textSecondary transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
      >
        <motion.div animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} aria-hidden="true">
          <ChevronDown size={12} />
        </motion.div>
        {open ? 'Hide' : 'Show'} Gateway & DNS
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="advanced"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 pt-3">
              <Input
                label="Gateway"
                value={adapter.Gateway}
                onChange={(v) => updateField('Gateway', v)}
                placeholder="192.168.1.1"
                disabled={adapter.DHCP}
                error={gatewayError}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Primary DNS"
                  value={adapter.DNS1}
                  onChange={(v) => updateField('DNS1', v)}
                  placeholder="8.8.8.8"
                  disabled={adapter.DHCP}
                  error={dns1Error}
                />
                <Input
                  label="Secondary DNS"
                  value={adapter.DNS2}
                  onChange={(v) => updateField('DNS2', v)}
                  placeholder="8.8.4.4"
                  disabled={adapter.DHCP}
                  error={dns2Error}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface ProfileEditorProps {
  profile?: Profile
  open: boolean
  onClose: () => void
  onSave: (profile: Profile) => void
}

export function ProfileEditor({ profile, open, onClose, onSave }: ProfileEditorProps) {
  const isNew = profile === undefined

  const [draft, setDraft] = useState<Profile>(() =>
    profile ? structuredClone(profile) : buildDefaultProfile(),
  )

  // Snapshot of the profile as it was when opened, for dirty detection
  const [originalSnapshot, setOriginalSnapshot] = useState<string>(() =>
    JSON.stringify(profile ? structuredClone(profile) : buildDefaultProfile()),
  )

  // Re-initialise when the profile prop changes (opening a different profile)
  const [lastProfile, setLastProfile] = useState(profile)
  if (profile !== lastProfile) {
    setLastProfile(profile)
    const next = profile ? structuredClone(profile) : buildDefaultProfile()
    setDraft(next)
    setOriginalSnapshot(JSON.stringify(next))
  }

  const [nameError, setNameError] = useState<string | undefined>()
  const [serverNameError, setServerNameError] = useState<string | undefined>()
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  // Dirty detection
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== originalSnapshot,
    [draft, originalSnapshot],
  )

  // ── Close with dirty guard ──────────────────────────────────────────────────

  const handleCloseAttempt = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true)
    } else {
      onClose()
    }
  }, [isDirty, onClose])

  const handleConfirmDiscard = useCallback(() => {
    setShowDiscardConfirm(false)
    onClose()
  }, [onClose])

  const handleCancelDiscard = useCallback(() => {
    setShowDiscardConfirm(false)
  }, [])

  // ── Field updaters ──────────────────────────────────────────────────────────

  const updateBasic = useCallback(<K extends keyof Pick<Profile, 'Name' | 'Description' | 'ServerName'>>(
    key: K,
    value: string,
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    if (key === 'Name') setNameError(value.trim() ? undefined : 'Name is required')
    if (key === 'ServerName') setServerNameError(validateServerName(value))
  }, [])

  const updateAdapter = useCallback((updated: AdapterConfig) => {
    setDraft((prev) => ({
      ...prev,
      NetworkAdapters: prev.NetworkAdapters.map((a) =>
        a.Index === updated.Index ? updated : a,
      ),
    }))
  }, [])

  const updateSMB = useCallback(<K extends keyof SMBSettings>(key: K, value: SMBSettings[K]) => {
    setDraft((prev) => ({
      ...prev,
      SMBSettings: { ...prev.SMBSettings, [key]: value },
    }))
  }, [])

  // ── Additional Shares ───────────────────────────────────────────────────────

  const addShare = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      SMBSettings: {
        ...prev.SMBSettings,
        AdditionalShares: [
          ...prev.SMBSettings.AdditionalShares,
          { Name: '', Path: '', Description: '', ShareState: 'New', IsD3Share: false } as SmbShare,
        ],
      },
    }))
  }, [])

  const updateShare = useCallback((index: number, field: keyof SmbShare, value: string) => {
    setDraft((prev) => ({
      ...prev,
      SMBSettings: {
        ...prev.SMBSettings,
        AdditionalShares: prev.SMBSettings.AdditionalShares.map((s, i) =>
          i === index ? { ...s, [field]: value } : s,
        ),
      },
    }))
  }, [])

  const removeShare = useCallback((index: number) => {
    setDraft((prev) => ({
      ...prev,
      SMBSettings: {
        ...prev.SMBSettings,
        AdditionalShares: prev.SMBSettings.AdditionalShares.filter((_, i) => i !== index),
      },
    }))
  }, [])

  // ── Custom Settings ─────────────────────────────────────────────────────────

  const customEntries = useMemo(
    () => Object.entries(draft.CustomSettings) as [string, unknown][],
    [draft.CustomSettings],
  )

  const addCustomSetting = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      CustomSettings: { ...prev.CustomSettings, '': '' },
    }))
  }, [])

  const updateCustomSettingKey = useCallback((_oldKey: string, newKey: string, index: number) => {
    setDraft((prev) => {
      const entries = Object.entries(prev.CustomSettings)
      // Replace at the specific index to handle duplicate empty keys
      entries[index] = [newKey, entries[index][1]]
      return { ...prev, CustomSettings: Object.fromEntries(entries) }
    })
  }, [])

  const updateCustomSettingValue = useCallback((index: number, value: string) => {
    setDraft((prev) => {
      const entries = Object.entries(prev.CustomSettings)
      entries[index] = [entries[index][0], value]
      return { ...prev, CustomSettings: Object.fromEntries(entries) }
    })
  }, [])

  const removeCustomSetting = useCallback((index: number) => {
    setDraft((prev) => {
      const entries = Object.entries(prev.CustomSettings)
      entries.splice(index, 1)
      return { ...prev, CustomSettings: Object.fromEntries(entries) }
    })
  }, [])

  // ── Save ────────────────────────────────────────────────────────────────────

  function handleSave() {
    if (!draft.Name.trim()) {
      setNameError('Name is required')
      return
    }
    const snErr = validateServerName(draft.ServerName)
    if (snErr) {
      setServerNameError(snErr)
      return
    }
    onSave({ ...draft, Modified: new Date().toISOString() })
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="editor-backdrop"
            className="fixed inset-0 bg-black/70 z-50"
            style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleCloseAttempt}
            aria-hidden="true"
          />

          {/* Panel */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="editor-panel"
              role="dialog"
              aria-modal="true"
              aria-label={isNew ? 'Create Profile' : 'Edit Profile'}
              className="glass-card w-full max-w-3xl max-h-[90vh] flex flex-col pointer-events-auto"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                <h2 className="text-lg font-bold text-text">
                  {isNew ? 'Create Profile' : `Edit Profile — ${profile.Name}`}
                </h2>
                <button
                  type="button"
                  onClick={handleCloseAttempt}
                  aria-label="Close editor"
                  className="p-1.5 rounded-lg text-textMuted hover:text-text hover:bg-hover transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-6">

                {/* ── Basic Info ─────────────────────────────────────────── */}
                <section aria-label="Basic Information">
                  <h3 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-3">
                    Basic Info
                  </h3>
                  <div className="flex flex-col gap-3">
                    <Input
                      label="Profile Name"
                      value={draft.Name}
                      onChange={(v) => updateBasic('Name', v)}
                      placeholder="e.g. Director Setup"
                      error={nameError}
                    />

                    {/* Description -- plain textarea, no dedicated component */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-textSecondary font-medium text-sm">
                        Description
                      </label>
                      <textarea
                        value={draft.Description}
                        onChange={(e) => setDraft((p) => ({ ...p, Description: e.target.value }))}
                        placeholder="Optional description…"
                        rows={2}
                        className="w-full px-3 py-2 rounded-lg text-sm resize-none transition-colors duration-150 outline-none bg-surface border border-border placeholder:text-textMuted text-text focus:border-primary focus:ring-1 focus:ring-primary/30"
                      />
                    </div>

                    <Input
                      label="Server Name (NetBIOS)"
                      value={draft.ServerName}
                      onChange={(v) => updateBasic('ServerName', v)}
                      placeholder="e.g. D3-DIRECTOR-01"
                      error={serverNameError}
                    />
                  </div>
                </section>

                {/* ── Network Adapters ───────────────────────────────────── */}
                <section aria-label="Network Adapters">
                  <h3 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-3">
                    Network Adapters
                  </h3>
                  <div className="flex flex-col gap-2">
                    {draft.NetworkAdapters.map((adapter) => (
                      <AdapterCard
                        key={adapter.Index}
                        adapter={adapter}
                        onChange={updateAdapter}
                      />
                    ))}
                  </div>
                </section>

                {/* ── SMB Settings ───────────────────────────────────────── */}
                <section aria-label="SMB Settings">
                  <h3 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-3">
                    SMB Settings
                  </h3>
                  <div className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-text">Share d3 Projects</p>
                        <p className="text-xs text-textMuted mt-0.5">
                          Expose the projects directory over SMB
                        </p>
                      </div>
                      <Toggle
                        checked={draft.SMBSettings.ShareD3Projects}
                        onChange={(v) => updateSMB('ShareD3Projects', v)}
                        label={draft.SMBSettings.ShareD3Projects ? 'Enabled' : 'Disabled'}
                      />
                    </div>

                    <Input
                      label="Projects Path"
                      value={draft.SMBSettings.ProjectsPath}
                      onChange={(v) => updateSMB('ProjectsPath', v)}
                      placeholder="D:\d3 Projects"
                      disabled={!draft.SMBSettings.ShareD3Projects}
                    />
                    <Input
                      label="Share Name"
                      value={draft.SMBSettings.ShareName}
                      onChange={(v) => updateSMB('ShareName', v)}
                      placeholder="d3 Projects"
                      disabled={!draft.SMBSettings.ShareD3Projects}
                    />
                    <Input
                      label="Permissions"
                      value={draft.SMBSettings.SharePermissions}
                      onChange={(v) => updateSMB('SharePermissions', v)}
                      placeholder="Administrators:Full"
                      disabled={!draft.SMBSettings.ShareD3Projects}
                    />
                  </div>
                </section>

                {/* ── Additional Shares ──────────────────────────────────── */}
                <section aria-label="Additional Shares">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-textSecondary uppercase tracking-wider">
                      Additional Shares
                    </h3>
                    <Button variant="ghost" size="sm" onClick={addShare}>
                      <Plus size={14} className="shrink-0" />
                      Add Share
                    </Button>
                  </div>

                  {draft.SMBSettings.AdditionalShares.length === 0 && (
                    <p className="text-xs text-textMuted italic">No additional shares configured.</p>
                  )}

                  <div className="flex flex-col gap-3">
                    {draft.SMBSettings.AdditionalShares.map((share, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-3 relative"
                      >
                        <button
                          type="button"
                          onClick={() => removeShare(idx)}
                          className="absolute top-3 right-3 p-1 rounded text-textMuted hover:text-red-400 hover:bg-red-400/10 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={`Remove share ${share.Name || idx + 1}`}
                        >
                          <Trash2 size={14} />
                        </button>

                        <Input
                          label="Name"
                          value={share.Name}
                          onChange={(v) => updateShare(idx, 'Name', v)}
                          placeholder="e.g. Notch Blocks"
                        />
                        <Input
                          label="Path"
                          value={share.Path}
                          onChange={(v) => updateShare(idx, 'Path', v)}
                          placeholder="e.g. D:\\Notch Blocks"
                        />
                        <Input
                          label="Description"
                          value={share.Description}
                          onChange={(v) => updateShare(idx, 'Description', v)}
                          placeholder="Optional description"
                        />
                      </div>
                    ))}
                  </div>
                </section>

                {/* ── Custom Settings ────────────────────────────────────── */}
                <section aria-label="Custom Settings">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-textSecondary uppercase tracking-wider">
                      Custom Settings
                    </h3>
                    <Button variant="ghost" size="sm" onClick={addCustomSetting}>
                      <Plus size={14} className="shrink-0" />
                      Add Setting
                    </Button>
                  </div>

                  {customEntries.length === 0 && (
                    <p className="text-xs text-textMuted italic">No custom settings configured.</p>
                  )}

                  <div className="flex flex-col gap-2">
                    {customEntries.map(([key, value], idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <div className="flex-1">
                          <input
                            type="text"
                            value={key}
                            onChange={(e) => updateCustomSettingKey(key, e.target.value, idx)}
                            placeholder="Key"
                            className="w-full px-3 py-2 rounded-lg text-sm transition-colors duration-150 outline-none bg-surface border border-border placeholder:text-textMuted text-text focus:border-primary focus:ring-1 focus:ring-primary/30"
                          />
                        </div>
                        <div className="flex-1">
                          <input
                            type="text"
                            value={String(value ?? '')}
                            onChange={(e) => updateCustomSettingValue(idx, e.target.value)}
                            placeholder="Value"
                            className="w-full px-3 py-2 rounded-lg text-sm transition-colors duration-150 outline-none bg-surface border border-border placeholder:text-textMuted text-text focus:border-primary focus:ring-1 focus:ring-primary/30"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCustomSetting(idx)}
                          className="p-2 rounded text-textMuted hover:text-red-400 hover:bg-red-400/10 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0 mt-0.5"
                          aria-label={`Remove setting ${key || idx + 1}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
                <Button variant="ghost" size="md" onClick={handleCloseAttempt}>
                  Cancel
                </Button>
                <Button variant="primary" size="md" onClick={handleSave}>
                  {isNew ? 'Create Profile' : 'Save Changes'}
                </Button>
              </div>
            </motion.div>
          </div>

          {/* Unsaved changes confirm dialog */}
          <ConfirmDialog
            open={showDiscardConfirm}
            onConfirm={handleConfirmDiscard}
            onCancel={handleCancelDiscard}
            title="Unsaved Changes"
            message="You have unsaved changes. Discard?"
            confirmLabel="Discard"
            confirmVariant="destructive"
          />
        </>
      )}
    </AnimatePresence>
  )
}
