import { motion } from 'framer-motion'
import { Monitor, Wifi } from 'lucide-react'
import { GlassCard, Badge } from '@/components/ui'
import type { DiscoveredServer } from '@/lib/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ServerTileProps {
  server: DiscoveredServer
  selected: boolean
  onSelect: () => void
  /** Stagger index for entrance animation */
  index: number
}

// ─── Response time badge ──────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'error'

function responseVariant(ms: number): BadgeVariant {
  if (ms < 50) return 'success'
  if (ms < 200) return 'warning'
  return 'error'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ServerTile({ server, selected, onSelect, index }: ServerTileProps) {
  const hostname = server.Hostname || 'Unknown'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: index * 0.06 }}
    >
      {/* Outer wrapper handles the selection border glow */}
      <div
        className={[
          'rounded-xl transition-all duration-200 cursor-pointer',
          selected
            ? 'ring-2 ring-primary shadow-[0_0_20px_rgba(124,58,237,0.35)]'
            : 'ring-1 ring-transparent',
        ].join(' ')}
        onClick={onSelect}
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select server ${hostname} at ${server.IPAddress}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            onSelect()
          }
        }}
      >
        <GlassCard className="h-full" accent={selected ? '#7C3AED' : undefined}>
          <div className="flex flex-col gap-3">
            {/* ── Top row: checkbox + icon ── */}
            <div className="flex items-start justify-between gap-2">
              {/* Checkbox */}
              <div
                className={[
                  'w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors duration-150',
                  selected
                    ? 'bg-primary border-primary'
                    : 'bg-transparent border-borderLight',
                ].join(' ')}
                aria-hidden="true"
              >
                {selected && (
                  <svg
                    width="10"
                    height="8"
                    viewBox="0 0 10 8"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M1 4L3.5 6.5L9 1"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>

              {/* Server icon */}
              <div
                className={[
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                  server.IsDisguise ? 'bg-primary/20' : 'bg-surface',
                ].join(' ')}
                aria-hidden="true"
              >
                {server.IsDisguise ? (
                  <Monitor size={16} className="text-primary" />
                ) : (
                  <Wifi size={16} className="text-textMuted" />
                )}
              </div>
            </div>

            {/* ── Hostname ── */}
            <div className="min-w-0">
              <p
                className="text-sm font-bold text-text truncate leading-tight"
                title={hostname}
              >
                {hostname}
              </p>
              <p className="font-mono text-xs text-textSecondary mt-0.5">
                {server.IPAddress}
              </p>
            </div>

            {/* ── Response time + disguise badge ── */}
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <Badge variant={responseVariant(server.ResponseTimeMs)}>
                {server.ResponseTimeMs}ms
              </Badge>

              {server.IsDisguise && (
                <Badge variant="info">
                  disguise{server.APIVersion ? ` v${server.APIVersion}` : ''}
                </Badge>
              )}
            </div>

            {/* ── Open port pills ── */}
            {server.Ports.length > 0 && (
              <div className="flex flex-wrap gap-1" aria-label="Open ports">
                {server.Ports.map((port) => (
                  <span
                    key={port}
                    className="px-1.5 py-0.5 rounded text-xs font-mono bg-surface text-textMuted border border-border"
                  >
                    {port}
                  </span>
                ))}
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </motion.div>
  )
}
