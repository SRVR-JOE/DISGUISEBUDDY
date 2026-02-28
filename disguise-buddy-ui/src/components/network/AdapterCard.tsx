import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import type { AdapterConfig } from '@/lib/types'
import {
  GlassCard,
  Button,
  Input,
  Toggle,
  StatusDot,
} from '@/components/ui'

// ─── Role color map ───────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  d3Net:   '#7C3AED',
  sACN:    '#06B6D4',
  Media:   '#10B981',
  NDI:     '#3B82F6',
  Control: '#F59E0B',
  '100G':  '#EC4899',
}

function getRoleColor(role: string): string {
  return ROLE_COLORS[role] ?? '#64748B'
}

// ─── IP validation ────────────────────────────────────────────────────────────

function isValidIP(ip: string): boolean {
  if (!ip) return true // empty is OK
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => {
    const n = parseInt(p, 10)
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p
  })
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AdapterCardProps {
  adapter: AdapterConfig
  /** Called after a successful configureAdapter API call with the updated config */
  onUpdate: (config: AdapterConfig) => void
  /** Stagger delay for entrance animation */
  animationDelay?: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdapterCard({ adapter, onUpdate, animationDelay = 0 }: AdapterCardProps) {
  // Local edit state — cloned from props so we never mutate upstream
  const [draft, setDraft] = useState<AdapterConfig>(() => ({ ...adapter }))
  const [expanded, setExpanded] = useState(false)
  const [applying, setApplying] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  // Derive dirty: does the draft differ from the last-applied adapter prop?
  const dirty =
    draft.DHCP !== adapter.DHCP ||
    draft.IPAddress !== adapter.IPAddress ||
    draft.SubnetMask !== adapter.SubnetMask ||
    draft.Gateway !== adapter.Gateway ||
    draft.DNS1 !== adapter.DNS1 ||
    draft.DNS2 !== adapter.DNS2

  // Field-level validation errors
  const ipError = !isValidIP(draft.IPAddress) ? 'Invalid IP address' : undefined
  const subnetError = !isValidIP(draft.SubnetMask) ? 'Invalid subnet mask' : undefined
  const gatewayError = !isValidIP(draft.Gateway) ? 'Invalid gateway address' : undefined
  const dns1Error = !isValidIP(draft.DNS1) ? 'Invalid DNS address' : undefined
  const dns2Error = !isValidIP(draft.DNS2) ? 'Invalid DNS address' : undefined
  const hasErrors = !!(ipError || subnetError || gatewayError || dns1Error || dns2Error)

  // Status dot: online if the adapter has an IP set OR is using DHCP, offline otherwise
  const dotStatus: 'online' | 'offline' =
    adapter.DHCP || adapter.IPAddress ? 'online' : 'offline'

  const roleColor = getRoleColor(draft.Role)

  // ── Field updaters ──────────────────────────────────────────────────────────

  const setField = useCallback(
    <K extends keyof AdapterConfig>(key: K, value: AdapterConfig[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const handleDHCPToggle = useCallback((checked: boolean) => {
    setDraft((prev) => ({ ...prev, DHCP: checked }))
  }, [])

  // ── Apply ───────────────────────────────────────────────────────────────────

  const handleApply = useCallback(async () => {
    if (hasErrors) return
    setApplying(true)
    try {
      // Adapter configuration is now handled through profile deployment
      onUpdate(draft)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 2000)
      toast.success(`Adapter ${draft.DisplayName} updated locally`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to configure adapter: ${message}`)
    } finally {
      setApplying(false)
    }
  }, [draft, hasErrors, onUpdate])

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: animationDelay }}
    >
      <GlassCard accent={roleColor} className="flex flex-col gap-4">
        {/* ── Header row ── */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Custom role badge with dynamic colour derived from ROLE_COLORS */}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border shrink-0"
            style={{
              color: roleColor,
              backgroundColor: `${roleColor}22`,
              borderColor: `${roleColor}55`,
            }}
          >
            {draft.Role}
          </span>
          <StatusDot status={dotStatus} className="shrink-0" />
          <span
            className="text-sm font-medium text-textSecondary truncate"
            title={draft.DisplayName}
          >
            {draft.DisplayName}
          </span>
        </div>

        {/* ── DHCP toggle row ── */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-textMuted font-medium">DHCP</span>
          <Toggle
            checked={draft.DHCP}
            onChange={handleDHCPToggle}
            label={draft.DHCP ? 'On' : 'Off'}
          />
        </div>

        {/* ── IP fields ── */}
        <div className="flex flex-col gap-3">
          <Input
            label="IP Address"
            placeholder="192.168.1.100"
            value={draft.IPAddress}
            onChange={(v) => setField('IPAddress', v)}
            error={ipError}
            disabled={draft.DHCP}
          />
          <Input
            label="Subnet Mask"
            placeholder="255.255.255.0"
            value={draft.SubnetMask}
            onChange={(v) => setField('SubnetMask', v)}
            error={subnetError}
            disabled={draft.DHCP}
          />
        </div>

        {/* ── Expandable advanced section ── */}
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-textMuted hover:text-textSecondary transition-colors duration-150 select-none cursor-pointer"
            aria-expanded={expanded}
          >
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="inline-flex"
            >
              <ChevronDown size={14} />
            </motion.span>
            {expanded ? 'Hide advanced' : 'Show advanced'}
          </button>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="advanced"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-3 pt-3">
                  <Input
                    label="Gateway"
                    placeholder="192.168.1.1"
                    value={draft.Gateway}
                    onChange={(v) => setField('Gateway', v)}
                    error={gatewayError}
                    disabled={draft.DHCP}
                  />
                  <Input
                    label="DNS 1"
                    placeholder="8.8.8.8"
                    value={draft.DNS1}
                    onChange={(v) => setField('DNS1', v)}
                    error={dns1Error}
                    disabled={draft.DHCP}
                  />
                  <Input
                    label="DNS 2"
                    placeholder="8.8.4.4"
                    value={draft.DNS2}
                    onChange={(v) => setField('DNS2', v)}
                    error={dns2Error}
                    disabled={draft.DHCP}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Apply button — only shown when dirty ── */}
        <AnimatePresence>
          {dirty && (
            <motion.div
              key="apply"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={handleApply}
                disabled={hasErrors}
                loading={applying}
              >
                {showSuccess ? (
                  <>
                    <Check size={13} className="shrink-0" />
                    Applied
                  </>
                ) : (
                  'Apply Changes'
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}
