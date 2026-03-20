import { useState, useEffect, useCallback } from 'react'
import { Share2, FolderOpen, RefreshCw, AlertCircle } from 'lucide-react'
import { GlassCard, SectionHeader, Badge, Button } from '@/components/ui'
import { BASE_URL } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmbShareInfo {
  Name: string
  Path: string
  Description: string
  ShareState: string
  IsD3Share?: boolean
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SMBPage() {
  const [shares, setShares] = useState<SmbShareInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchShares = useCallback(() => {
    setLoading(true)
    setError('')
    fetch(`${BASE_URL}/api/smb`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: SmbShareInfo[]) => {
        setShares(data)
      })
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchShares()
  }, [fetchShares])

  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="SMB Sharing"
        subtitle="Current file shares on this machine (read-only) — editing is done through Profiles"
      />

      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={fetchShares} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <GlassCard>
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-14 bg-surface/50 animate-pulse rounded-xl" />
            ))}
          </div>
        </GlassCard>
      )}

      {/* Error state */}
      {!loading && error && (
        <GlassCard>
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <AlertCircle size={32} className="text-error" aria-hidden="true" />
            <p className="text-error text-sm font-medium">Failed to load shares</p>
            <p className="text-textMuted text-xs">{error}</p>
          </div>
        </GlassCard>
      )}

      {/* Empty state */}
      {!loading && !error && shares.length === 0 && (
        <GlassCard>
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Share2 size={32} className="text-textMuted" aria-hidden="true" />
            <p className="text-textMuted text-sm">No SMB shares found</p>
          </div>
        </GlassCard>
      )}

      {/* Shares list */}
      {!loading && !error && shares.length > 0 && (
        <GlassCard>
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border">
            <h3 className="text-text font-bold text-sm tracking-wide">Active Shares</h3>
            <Badge variant="info">{shares.length}</Badge>
          </div>

          <div className="flex flex-col gap-3">
            {shares.map((share, i) => {
              const isD3 = share.IsD3Share || share.Name?.toLowerCase().includes('d3') || share.Name?.toLowerCase().includes('projects')
              return (
                <div
                  key={share.Name || i}
                  className={[
                    'flex items-center gap-4 p-4 rounded-xl border transition-colors',
                    isD3
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-surface/30',
                  ].join(' ')}
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{
                    backgroundColor: isD3 ? 'rgba(124, 58, 237, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                  }}>
                    <FolderOpen size={16} className={isD3 ? 'text-primary' : 'text-textMuted'} aria-hidden="true" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text">{share.Name}</span>
                      {isD3 && <Badge variant="info">d3 Projects</Badge>}
                      <Badge variant={share.ShareState === 'Online' || share.ShareState === 'Active' ? 'success' : 'neutral'}>
                        {share.ShareState || 'Unknown'}
                      </Badge>
                    </div>
                    <p className="text-xs text-textMuted font-mono mt-1 truncate">{share.Path || '--'}</p>
                    {share.Description && (
                      <p className="text-xs text-textMuted mt-0.5">{share.Description}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </GlassCard>
      )}
    </div>
  )
}
