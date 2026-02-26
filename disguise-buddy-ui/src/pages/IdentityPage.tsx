import { useState, useEffect, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { AlertTriangle, CheckCircle, XCircle, Monitor, Server } from 'lucide-react'
import {
  GlassCard,
  Badge,
  SectionHeader,
  Button,
  ConfirmDialog,
} from '@/components/ui'
import { api } from '@/lib/api'
import type { IdentityInfo } from '@/lib/types'

// ─── Validation ───────────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean
  error: string
}

function validateHostname(name: string): ValidationResult {
  if (!name) return { valid: false, error: 'Hostname cannot be empty' }
  if (name.length > 15) return { valid: false, error: `Exceeds 15 chars (${name.length})` }
  if (/\s/.test(name)) return { valid: false, error: 'Cannot contain spaces' }
  if (!/^[a-zA-Z0-9-]+$/.test(name)) return { valid: false, error: 'Only A-Z, 0-9, hyphens' }
  if (name.startsWith('-') || name.endsWith('-')) {
    return { valid: false, error: 'Cannot start/end with hyphen' }
  }
  return { valid: true, error: '' }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

interface InfoGridRowProps {
  label: string
  value: string
}

function InfoGridRow({ label, value }: InfoGridRowProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-textMuted uppercase tracking-wider font-medium">{label}</span>
      <span className="text-sm text-textSecondary font-mono">{value || '—'}</span>
    </div>
  )
}

// ─── IdentityPage ─────────────────────────────────────────────────────────────

export function IdentityPage() {
  // ── Fetch state ──
  const [identity, setIdentity] = useState<IdentityInfo | null>(null)
  const [loading, setLoading] = useState(true)

  // ── Hostname form ──
  const [newHostname, setNewHostname] = useState('')
  const [applying, setApplying] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadIdentity = useCallback(async () => {
    try {
      const data = await api.getIdentity()
      setIdentity(data)
    } catch (err) {
      toast.error(
        `Failed to load identity: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadIdentity()
  }, [loadIdentity])

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleApplyHostname = async () => {
    if (!validation.valid) return
    setApplying(true)
    try {
      const result = await api.setHostname(newHostname)
      if (result.success) {
        toast.success(result.message || 'Hostname change queued — restart required')
        await loadIdentity()
        setNewHostname('')
      } else {
        toast.error(result.message || 'Failed to set hostname')
      }
    } catch (err) {
      toast.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setApplying(false)
      setShowConfirm(false)
    }
  }

  // ─── Derived / validation ──────────────────────────────────────────────────

  const validation = validateHostname(newHostname)
  const charCount = newHostname.length
  const charCountColor =
    charCount >= 16 ? 'text-error' : charCount >= 13 ? 'text-warning' : 'text-textMuted'

  const isDomainJoined =
    identity?.DomainType?.toLowerCase() === 'domain' ||
    (identity?.Domain && !identity.Domain.toLowerCase().includes('workgroup'))

  const currentHostname = identity?.Hostname ?? ''

  const previewUNC = `\\\\${newHostname}\\d3 Projects`
  const previewD3Net = `${newHostname}.local`
  const previewAPI = `http://${newHostname}:47100/api/service/system`

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <span className="text-textMuted text-sm animate-pulse">Loading server identity...</span>
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Server Identity"
        subtitle="Manage hostname and system identification"
      />

      {/* ── Card 1: Current Identity ──────────────────────────────────────── */}
      <GlassCard accent="#7C3AED">
        <div className="flex items-start gap-4 mb-6">
          <div className="p-2.5 rounded-lg bg-primary/15 shrink-0">
            <Monitor size={22} className="text-primary" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-3xl font-bold text-primary leading-none tracking-tight truncate">
              {currentHostname || '—'}
            </p>
            <p className="text-sm text-textMuted">Server Hostname</p>
            <div className="mt-1">
              <Badge variant={isDomainJoined ? 'info' : 'warning'}>
                {isDomainJoined ? 'Domain' : 'Workgroup'}: {identity?.Domain ?? '—'}
              </Badge>
            </div>
          </div>
        </div>

        {/* System info grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-4 border-t border-border">
          <InfoGridRow label="OS" value={identity?.OSVersion ?? ''} />
          <InfoGridRow
            label={isDomainJoined ? 'Domain' : 'Workgroup'}
            value={identity?.Domain ?? ''}
          />
          <InfoGridRow label="Uptime" value={identity?.Uptime ?? ''} />
          <InfoGridRow label="Model" value={identity?.Model ?? ''} />
          <InfoGridRow label="Serial Number" value={identity?.SerialNumber ?? ''} />
        </div>
      </GlassCard>

      {/* ── Card 2: Change Hostname ───────────────────────────────────────── */}
      <GlassCard>
        <div className="flex items-center gap-3 mb-5">
          <Server size={18} className="text-primary shrink-0" aria-hidden="true" />
          <h3 className="text-text font-bold text-sm tracking-wide">Change Hostname</h3>
        </div>

        {/* Warning banner */}
        <div className="flex gap-3 px-4 py-3 rounded-lg bg-warning/10 border border-warning/30 mb-5">
          <AlertTriangle
            size={16}
            className="text-warning shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-0.5">
            <p className="text-warning font-bold text-xs uppercase tracking-wider">
              Restart Required
            </p>
            <p className="text-warning/80 text-xs leading-relaxed">
              Changing the hostname will disrupt d3Net connectivity and require a full system
              restart. All connected clients and services will be disconnected.
            </p>
          </div>
        </div>

        {/* Current hostname display */}
        <div className="flex flex-col gap-1.5 mb-4">
          <p className="text-textSecondary font-medium text-sm">Current Hostname</p>
          <div className="px-3 py-2 rounded-lg bg-surface border border-border">
            <span className="font-mono text-sm text-text">{currentHostname || '—'}</span>
          </div>
        </div>

        {/* New hostname input with character counter */}
        <div className="flex flex-col gap-1.5 mb-4">
          <div className="flex items-center justify-between">
            <label className="text-textSecondary font-medium text-sm" htmlFor="new-hostname-input">
              New Hostname
            </label>
            <span className={`text-xs font-mono tabular-nums ${charCountColor}`}>
              {charCount}/15
            </span>
          </div>
          <input
            id="new-hostname-input"
            type="text"
            value={newHostname}
            onChange={(e) => setNewHostname(e.target.value.toUpperCase())}
            placeholder="MYSHOW-D3-01"
            maxLength={20}
            aria-describedby="hostname-validation"
            className={[
              'w-full px-3 py-2 rounded-lg text-sm font-mono transition-colors duration-150',
              'bg-surface border placeholder:text-textMuted text-text outline-none',
              newHostname && !validation.valid
                ? 'border-error focus:border-error focus:ring-1 focus:ring-error/30'
                : newHostname && validation.valid
                ? 'border-success focus:border-success focus:ring-1 focus:ring-success/30'
                : 'border-border focus:border-primary focus:ring-1 focus:ring-primary/30',
            ].join(' ')}
          />

          {/* Validation feedback */}
          {newHostname && (
            <div
              id="hostname-validation"
              className={[
                'flex items-center gap-1.5 text-xs',
                validation.valid ? 'text-success' : 'text-error',
              ].join(' ')}
              role="alert"
              aria-live="polite"
            >
              {validation.valid ? (
                <>
                  <CheckCircle size={12} aria-hidden="true" />
                  Valid NetBIOS hostname
                </>
              ) : (
                <>
                  <XCircle size={12} aria-hidden="true" />
                  {validation.error}
                </>
              )}
            </div>
          )}
        </div>

        {/* Preview panel — only visible when valid */}
        {validation.valid && newHostname && (
          <div className="flex flex-col gap-2 px-4 py-3 rounded-lg bg-surface border border-border mb-5">
            <p className="text-xs text-textMuted uppercase tracking-wider font-medium mb-1">
              Preview
            </p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-textMuted w-20 shrink-0">UNC Path</span>
                <span className="font-mono text-xs text-text select-all">{previewUNC}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-textMuted w-20 shrink-0">d3Net Name</span>
                <span className="font-mono text-xs text-text select-all">{previewD3Net}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-textMuted w-20 shrink-0">API Access</span>
                <span className="font-mono text-xs text-accent select-all">{previewAPI}</span>
              </div>
            </div>
          </div>
        )}

        {/* Apply button */}
        <Button
          variant="primary"
          disabled={!validation.valid || !newHostname}
          loading={applying}
          onClick={() => setShowConfirm(true)}
        >
          Apply Hostname Change
        </Button>
      </GlassCard>

      {/* ── Card 3: Naming Conventions ────────────────────────────────────── */}
      <GlassCard>
        <h3 className="text-text font-bold text-sm tracking-wide mb-4">Naming Conventions</h3>

        {/* Recommended format */}
        <div className="flex flex-col gap-1.5 mb-4">
          <p className="text-textMuted text-xs uppercase tracking-wider font-medium">
            Recommended Format
          </p>
          <p
            className="font-mono text-sm text-accent px-3 py-2 rounded-lg bg-accent/10 border border-accent/20"
            aria-label="Recommended hostname format: SHOW-ROLE-NUMBER"
          >
            {'{SHOW}-{ROLE}-{NUMBER}'}
          </p>
        </div>

        {/* Examples */}
        <div className="flex flex-col gap-1.5 mb-5">
          <p className="text-textMuted text-xs uppercase tracking-wider font-medium">Examples</p>
          <div className="flex gap-2 flex-wrap">
            {['MYSHOW-D3-01', 'CONCERT-GX3-02', 'TOUR-D3-03'].map((ex) => (
              <span
                key={ex}
                className="font-mono text-xs px-2.5 py-1 rounded-md bg-surface border border-border text-textSecondary"
              >
                {ex}
              </span>
            ))}
          </div>
        </div>

        {/* Guidelines list */}
        <div className="flex flex-col gap-2">
          <p className="text-textMuted text-xs uppercase tracking-wider font-medium mb-1">
            Guidelines
          </p>
          {[
            'Maximum 15 characters (NetBIOS limit)',
            'Only letters (A–Z), digits (0–9), and hyphens',
            'Cannot start or end with a hyphen',
            'No spaces or special characters',
            'All-caps recommended for consistency',
            'Include role identifier (D3, GX3, SX) for clarity',
            'Append zero-padded number for multi-unit rigs (01, 02)',
          ].map((guideline) => (
            <div key={guideline} className="flex items-start gap-2.5">
              <span
                className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0"
                aria-hidden="true"
              />
              <span className="text-sm text-textSecondary leading-relaxed">{guideline}</span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* ── Confirm Dialog ────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={showConfirm}
        onCancel={() => setShowConfirm(false)}
        onConfirm={() => { void handleApplyHostname() }}
        title="Apply Hostname Change?"
        message={`This will rename the server from "${currentHostname}" to "${newHostname}". A system restart is required for the change to take effect. All d3Net connections and active sessions will be disrupted.`}
        confirmLabel={applying ? 'Applying…' : 'Apply & Schedule Restart'}
        confirmVariant="primary"
      />
    </div>
  )
}
