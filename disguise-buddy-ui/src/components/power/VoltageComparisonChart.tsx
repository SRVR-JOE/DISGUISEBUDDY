import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface ServerVoltageData {
  hostname: string
  mgmtIp: string
  voltages: { label: string; value: number; nominal: number }[]
  color: string
}

interface VoltageComparisonChartProps {
  servers: ServerVoltageData[]
  railFilter?: string
}

// Chart colors per server
const COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#06B6D4', '#F97316', '#84CC16']

// Key rails to compare (the most important ones)
const KEY_RAILS = ['PAY_12-VOL', 'PAY_5-VOL', 'SB_5-VOL', 'PAY_3_3-VOL', 'BAT_3_0-VOL']
const NOMINALS: Record<string, number> = {
  'PAY_12-VOL': 12, 'PAY_5-VOL': 5, 'SB_5-VOL': 5, 'AUX_5-VOL': 5,
  'PAY_3_3-VOL': 3.3, 'SB_3_3-VOL': 3.3, 'AUX_3_3-VOL': 3.3, 'BAT_3_0-VOL': 3.0,
}

function friendlyRail(label: string): string {
  const map: Record<string, string> = {
    'PAY_12-VOL': '12V Main', 'PAY_5-VOL': '5V Main', 'SB_5-VOL': '5V SB',
    'AUX_5-VOL': '5V Aux', 'PAY_3_3-VOL': '3.3V Main', 'SB_3_3-VOL': '3.3V SB',
    'AUX_3_3-VOL': '3.3V Aux', 'BAT_3_0-VOL': '3V Bat',
  }
  return map[label] || label
}

// Custom tooltip
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null
  return (
    <div className="bg-[#1a1a2e] border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs font-bold text-text mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="text-[11px]" style={{ color: entry.color }}>
          {entry.name}: <span className="font-mono font-bold">{entry.value?.toFixed(2)}V</span>
        </p>
      ))}
    </div>
  )
}

export function VoltageComparisonChart({ servers, railFilter }: VoltageComparisonChartProps) {
  const rails = railFilter ? [railFilter] : KEY_RAILS

  const chartData = useMemo(() => {
    return rails.map(rail => {
      const row: Record<string, any> = { rail: friendlyRail(rail), nominal: NOMINALS[rail] ?? 0 }
      for (const srv of servers) {
        const reading = srv.voltages.find(v => v.label === rail)
        row[srv.hostname] = reading?.value ?? null
      }
      return row
    })
  }, [servers, rails])

  if (servers.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="glass-card overflow-hidden"
    >
      <div className="px-5 pt-4 pb-3 border-b border-border">
        <h3 className="text-text font-bold text-sm tracking-wide">Voltage Comparison — Key Rails</h3>
        <p className="text-[10px] text-textMuted mt-0.5">Grouped bar chart comparing primary voltage rails across all servers</p>
      </div>
      <div className="p-4">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="rail"
              tick={{ fill: '#94A3B8', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            />
            <YAxis
              tick={{ fill: '#94A3B8', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
            {servers.map((srv, i) => (
              <Bar
                key={srv.hostname}
                dataKey={srv.hostname}
                fill={COLORS[i % COLORS.length]}
                radius={[3, 3, 0, 0]}
                maxBarSize={40}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  )
}
