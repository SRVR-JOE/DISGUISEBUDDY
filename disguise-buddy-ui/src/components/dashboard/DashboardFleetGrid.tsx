import { useMemo } from 'react'
import { CHART_COLORS } from '@/lib/metric-definitions'
import { sortServers } from '@/lib/server-sort'
import { DashboardServerCard } from './DashboardServerCard'

interface ServerSnapshot {
  hostname: string
  mgmtIp: string
  status: string
  [key: string]: any
}

interface DashboardFleetGridProps {
  servers: ServerSnapshot[]
  loading: boolean
}

export function DashboardFleetGrid({ servers, loading }: DashboardFleetGridProps) {
  const sorted = useMemo(() => sortServers(
    servers.filter(s => s.status !== 'offline')
  ), [servers])

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="glass-card h-[220px] animate-pulse bg-surface" />
        ))}
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="text-center py-8 text-textMuted">
        <p className="text-sm">No servers online. Waiting for telemetry data...</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {sorted.map((srv, i) => (
        <DashboardServerCard
          key={srv.mgmtIp}
          server={{
            hostname: srv.hostname || srv.mgmtIp,
            mgmtIp: srv.mgmtIp,
            status: srv.status,
            role: srv.role || '',
            serial: srv.serial || '',
            type: srv.type || '',
            powerStatus: srv.powerStatus || '',
            temperatures: srv.temperatures || [],
            fans: srv.fans || [],
            vfcs: srv.vfcs || [],
            ledColor: srv.ledColor || { r: 0, g: 0, b: 0 },
            ledMode: srv.ledMode || '',
            smcFirmware: srv.smcFirmware || '',
            smcPlatform: srv.smcPlatform || '',
          }}
          color={CHART_COLORS[i % CHART_COLORS.length]}
        />
      ))}
    </div>
  )
}
