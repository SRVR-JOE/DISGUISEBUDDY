import { useState, useEffect } from 'react'
import { Monitor, RefreshCw, AlertCircle } from 'lucide-react'
import { GlassCard, SectionHeader, Badge, Button } from '@/components/ui'
import type { IdentityInfo } from '@/lib/types'

// ─── Page ─────────────────────────────────────────────────────────────────────

export function IdentityPage() {
  const [identity, setIdentity] = useState<IdentityInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchIdentity = () => {
    setLoading(true)
    setError('')
    fetch('http://localhost:47100/api/identity')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: IdentityInfo) => {
        setIdentity(data)
      })
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchIdentity()
  }, [])

  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Server Identity"
        subtitle="Machine identity and system information (read-only) — editing is done through Profiles"
      />

      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={fetchIdentity} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <GlassCard>
          <div className="flex flex-col gap-3" aria-busy="true">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-surface/50 animate-pulse rounded-lg" />
            ))}
          </div>
        </GlassCard>
      )}

      {/* Error state */}
      {!loading && error && (
        <GlassCard>
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <AlertCircle size={32} className="text-error" aria-hidden="true" />
            <p className="text-error text-sm font-medium">Failed to load identity</p>
            <p className="text-textMuted text-xs">{error}</p>
          </div>
        </GlassCard>
      )}

      {/* Identity card */}
      {!loading && !error && identity && (
        <GlassCard>
          <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border">
            <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
              <Monitor size={18} className="text-primary" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-text font-bold text-base">{identity.Hostname || 'Unknown'}</h3>
              <p className="text-textMuted text-xs">{identity.Model || 'Machine identity'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoRow label="Hostname" value={identity.Hostname} />
            <InfoRow
              label="Domain / Workgroup"
              value={identity.Domain}
              badge={identity.DomainType}
            />
            <InfoRow label="OS Version" value={identity.OSVersion} />
            <InfoRow label="Uptime" value={identity.Uptime} />
            <InfoRow label="Serial Number" value={identity.SerialNumber} />
            <InfoRow label="Model" value={identity.Model} />
          </div>
        </GlassCard>
      )}
    </div>
  )
}

// ─── Info row helper ──────────────────────────────────────────────────────────

function InfoRow({ label, value, badge }: { label: string; value?: string; badge?: string }) {
  return (
    <div className="flex flex-col gap-1 p-3 bg-surface/30 rounded-lg border border-border">
      <span className="text-textMuted text-xs font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-text text-sm font-mono">{value || '--'}</span>
        {badge && <Badge variant="neutral">{badge}</Badge>}
      </div>
    </div>
  )
}
