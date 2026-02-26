import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { AdapterConfig } from '@/lib/types'
import { SectionHeader } from '@/components/ui'
import { AdapterCard } from '@/components/network/AdapterCard'

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function AdapterSkeleton() {
  return (
    <div
      className="glass-card p-5 flex flex-col gap-4"
      aria-hidden="true"
    >
      {/* Header row */}
      <div className="flex items-center gap-2.5">
        <div className="h-5 w-16 bg-surface/60 animate-pulse rounded-full" />
        <div className="h-2 w-2 bg-surface/60 animate-pulse rounded-full" />
        <div className="h-4 w-28 bg-surface/60 animate-pulse rounded-lg" />
      </div>
      {/* DHCP row */}
      <div className="flex items-center justify-between">
        <div className="h-4 w-12 bg-surface/60 animate-pulse rounded" />
        <div className="h-5 w-10 bg-surface/60 animate-pulse rounded-full" />
      </div>
      {/* IP fields */}
      <div className="h-9 bg-surface/60 animate-pulse rounded-lg" />
      <div className="h-9 bg-surface/60 animate-pulse rounded-lg" />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function NetworkPage() {
  const [adapters, setAdapters] = useState<AdapterConfig[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getAdapters().then(setAdapters).finally(() => setLoading(false))
  }, [])

  // Replace a single adapter in the list after a successful configureAdapter call
  const handleUpdate = useCallback((updated: AdapterConfig) => {
    setAdapters((prev) =>
      prev.map((a) => (a.Index === updated.Index ? updated : a)),
    )
  }, [])

  return (
    <>
      <div className="p-6 flex flex-col gap-6">
        <SectionHeader
          title="Network Adapters"
          subtitle="Configure 6 NIC slots for disguise media server roles"
        />

        {loading ? (
          /* Skeleton grid — mirrors the real grid layout */
          <div
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
            aria-label="Loading network adapters…"
            aria-busy="true"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <AdapterSkeleton key={i} />
            ))}
          </div>
        ) : adapters.length === 0 ? (
          <div className="glass-card p-10 flex flex-col items-center gap-3 text-center">
            <p className="text-textSecondary font-medium">No adapters found</p>
            <p className="text-textMuted text-sm">
              The API returned no network adapter data. Ensure the Disguise Buddy
              service is running.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {adapters.map((adapter, index) => (
              <AdapterCard
                key={adapter.Index}
                adapter={adapter}
                onUpdate={handleUpdate}
                animationDelay={index * 0.07}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
