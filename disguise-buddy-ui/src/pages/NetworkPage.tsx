import { useState, useEffect } from 'react'
import { Network, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { GlassCard, SectionHeader, Badge, Button } from '@/components/ui'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdapterInfo {
  Name: string
  Description: string
  Status: string
  MacAddress: string
  IPAddress: string
  SubnetMask: string
  Gateway: string
  DNS: string[]
  DHCP: boolean
  LinkSpeed: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function NetworkPage() {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchAdapters = () => {
    setLoading(true)
    setError('')
    fetch('http://localhost:47100/api/network/adapters')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: AdapterInfo[]) => {
        setAdapters(data)
      })
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchAdapters()
  }, [])

  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Network Adapters"
        subtitle="Live adapter state on this machine (read-only) — editing is done through Profiles"
      />

      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={fetchAdapters} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-48 bg-surface/50 animate-pulse rounded-xl" />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <GlassCard>
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <WifiOff size={32} className="text-error" aria-hidden="true" />
            <p className="text-error text-sm font-medium">Failed to load adapters</p>
            <p className="text-textMuted text-xs">{error}</p>
          </div>
        </GlassCard>
      )}

      {/* Empty state */}
      {!loading && !error && adapters.length === 0 && (
        <GlassCard>
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Network size={32} className="text-textMuted" aria-hidden="true" />
            <p className="text-textMuted text-sm">No network adapters found</p>
          </div>
        </GlassCard>
      )}

      {/* Adapter cards */}
      {!loading && !error && adapters.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {adapters.map((adapter, i) => {
            const isUp = adapter.Status?.toLowerCase() === 'up'
            return (
              <GlassCard key={adapter.Name || i}>
                {/* Header */}
                <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-border">
                  <div className="flex items-center gap-2 min-w-0">
                    {isUp ? (
                      <Wifi size={16} className="text-success shrink-0" aria-hidden="true" />
                    ) : (
                      <WifiOff size={16} className="text-textMuted shrink-0" aria-hidden="true" />
                    )}
                    <span className="text-text font-bold text-sm truncate">{adapter.Name}</span>
                  </div>
                  <Badge variant={isUp ? 'success' : 'neutral'}>{adapter.Status || 'Unknown'}</Badge>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {adapter.Description && (
                    <div className="col-span-2">
                      <span className="text-textMuted">Description</span>
                      <p className="text-textSecondary font-mono truncate">{adapter.Description}</p>
                    </div>
                  )}

                  <div>
                    <span className="text-textMuted">MAC Address</span>
                    <p className="text-textSecondary font-mono">{adapter.MacAddress || '--'}</p>
                  </div>

                  <div>
                    <span className="text-textMuted">IP Address</span>
                    <p className="text-textSecondary font-mono">{adapter.IPAddress || '--'}</p>
                  </div>

                  <div>
                    <span className="text-textMuted">Subnet Mask</span>
                    <p className="text-textSecondary font-mono">{adapter.SubnetMask || '--'}</p>
                  </div>

                  <div>
                    <span className="text-textMuted">Gateway</span>
                    <p className="text-textSecondary font-mono">{adapter.Gateway || '--'}</p>
                  </div>

                  <div>
                    <span className="text-textMuted">DNS</span>
                    <p className="text-textSecondary font-mono">
                      {adapter.DNS && adapter.DNS.length > 0 ? adapter.DNS.join(', ') : '--'}
                    </p>
                  </div>

                  <div>
                    <span className="text-textMuted">DHCP</span>
                    <p className="text-textSecondary">
                      <Badge variant={adapter.DHCP ? 'info' : 'neutral'}>
                        {adapter.DHCP ? 'Enabled' : 'Static'}
                      </Badge>
                    </p>
                  </div>

                  {adapter.LinkSpeed && (
                    <div>
                      <span className="text-textMuted">Link Speed</span>
                      <p className="text-textSecondary font-mono">{adapter.LinkSpeed}</p>
                    </div>
                  )}
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
