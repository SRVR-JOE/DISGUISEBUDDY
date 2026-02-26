import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, X } from 'lucide-react'
import { Button, Input, Toggle } from '@/components/ui'
import type { Profile, AdapterConfig, SMBSettings } from '@/lib/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const ADAPTER_ROLES = ['d3Net', 'sACN', 'Media', 'NDI', '100G', '100G'] as const

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

/** NetBIOS name: 1–15 chars, letters/digits/hyphens, no leading/trailing hyphen */
function validateServerName(name: string): string | undefined {
  if (!name) return undefined // empty is allowed (no value yet)
  if (name.length > 15) return 'Max 15 characters (NetBIOS limit)'
  if (!/^[A-Za-z0-9-]+$/.test(name)) return 'Letters, digits, and hyphens only'
  if (name.startsWith('-') || name.endsWith('-')) return 'Cannot start or end with a hyphen'
  return undefined
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

  const nicLabel = `NIC ${String.fromCharCode(65 + adapter.Index)}`

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
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
          {adapter.DHCP && (
            <span className="text-xs text-textMuted bg-hover px-1.5 py-0.5 rounded">DHCP</span>
          )}
          {!adapter.DHCP && adapter.IPAddress && (
            <span className="text-xs font-mono text-textSecondary">{adapter.IPAddress}</span>
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
              {/* Display Name */}
              <Input
                label="Display Name"
                value={adapter.DisplayName}
                onChange={(v) => updateField('DisplayName', v)}
                placeholder="e.g. NIC A"
              />

              {/* DHCP toggle */}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-textSecondary font-medium">Use DHCP</span>
                <Toggle
                  checked={adapter.DHCP}
                  onChange={(v) => updateField('DHCP', v)}
                  label={adapter.DHCP ? 'On' : 'Off'}
                />
              </div>

              {/* Static IP fields — disabled when DHCP */}
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="IP Address"
                  value={adapter.IPAddress}
                  onChange={(v) => updateField('IPAddress', v)}
                  placeholder="192.168.1.10"
                  disabled={adapter.DHCP}
                />
                <Input
                  label="Subnet Mask"
                  value={adapter.SubnetMask}
                  onChange={(v) => updateField('SubnetMask', v)}
                  placeholder="255.255.255.0"
                  disabled={adapter.DHCP}
                />
              </div>

              {/* Gateway + DNS — collapsible via "Advanced" */}
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
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Primary DNS"
                  value={adapter.DNS1}
                  onChange={(v) => updateField('DNS1', v)}
                  placeholder="8.8.8.8"
                  disabled={adapter.DHCP}
                />
                <Input
                  label="Secondary DNS"
                  value={adapter.DNS2}
                  onChange={(v) => updateField('DNS2', v)}
                  placeholder="8.8.4.4"
                  disabled={adapter.DHCP}
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
    profile ? { ...profile, NetworkAdapters: profile.NetworkAdapters.map((a) => ({ ...a })) } : buildDefaultProfile(),
  )

  // Re-initialise when the profile prop changes (opening a different profile)
  const [lastProfile, setLastProfile] = useState(profile)
  if (profile !== lastProfile) {
    setLastProfile(profile)
    setDraft(
      profile
        ? { ...profile, NetworkAdapters: profile.NetworkAdapters.map((a) => ({ ...a })) }
        : buildDefaultProfile(),
    )
  }

  const [nameError, setNameError] = useState<string | undefined>()
  const [serverNameError, setServerNameError] = useState<string | undefined>()

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
            onClick={onClose}
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
                  onClick={onClose}
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

                    {/* Description — plain textarea, no dedicated component */}
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
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
                <Button variant="ghost" size="md" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" size="md" onClick={handleSave}>
                  {isNew ? 'Create Profile' : 'Save Changes'}
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
