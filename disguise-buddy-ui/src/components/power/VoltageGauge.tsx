interface VoltageGaugeProps {
  label: string
  value: number
  nominal: number
  unit?: string
}

// Known nominal voltages for disguise gx 3+ BMC rails
const KNOWN_NOMINALS: Record<string, number> = {
  'PAY_12-VOL': 12,
  'PAY_5-VOL': 5,
  'SB_5-VOL': 5,
  'AUX_5-VOL': 5,
  'PAY_3_3-VOL': 3.3,
  'SB_3_3-VOL': 3.3,
  'AUX_3_3-VOL': 3.3,
  'BAT_3_0-VOL': 3.0,
  'SLOT_3_3-VOL': 3.3,
  'VDD_3_3_DUAL-VOL': 3.3,
  'X710_1_8_AUX-VOL': 1.8,
  'VDD_1_8_DUAL-VOL': 1.8,
  'AUX_1_05-VOL': 1.05,
  'X710_1_AUX-VOL': 1.0,
  'X710_0_9_AUX-VOL': 0.9,
}

// Tolerance: ±5% = green, ±10% = amber, beyond = red
function getDeviationColor(value: number, nominal: number): { color: string; bg: string; pct: number } {
  if (nominal <= 0) return { color: 'text-textMuted', bg: 'bg-textMuted/20', pct: 0 }
  const pct = Math.abs((value - nominal) / nominal) * 100
  if (pct <= 5) return { color: 'text-success', bg: 'bg-success', pct }
  if (pct <= 10) return { color: 'text-warning', bg: 'bg-warning', pct }
  return { color: 'text-error', bg: 'bg-error', pct }
}

// Friendly label: "PAY_12-VOL" → "12V Main"
function friendlyLabel(label: string): string {
  const map: Record<string, string> = {
    'PAY_12-VOL': '12V Payload',
    'PAY_5-VOL': '5V Payload',
    'SB_5-VOL': '5V Standby',
    'AUX_5-VOL': '5V Auxiliary',
    'PAY_3_3-VOL': '3.3V Payload',
    'SB_3_3-VOL': '3.3V Standby',
    'AUX_3_3-VOL': '3.3V Auxiliary',
    'BAT_3_0-VOL': '3.0V Battery',
    'SLOT_3_3-VOL': '3.3V Slot',
    'VDD_3_3_DUAL-VOL': '3.3V VDD Dual',
    'X710_1_8_AUX-VOL': '1.8V X710 Aux',
    'VDD_1_8_DUAL-VOL': '1.8V VDD Dual',
    'AUX_1_05-VOL': '1.05V Auxiliary',
    'X710_1_AUX-VOL': '1.0V X710 Aux',
    'X710_0_9_AUX-VOL': '0.9V X710 Aux',
  }
  return map[label] || label.replace(/_/g, ' ').replace(/-VOL$/, '')
}

export function VoltageGauge({ label, value, nominal: nominalProp, unit = 'V' }: VoltageGaugeProps) {
  const nominal = nominalProp > 0 ? nominalProp : (KNOWN_NOMINALS[label] ?? 0)
  const { color, bg, pct } = getDeviationColor(value, nominal)

  // Bar fill: map value to percentage of nominal (clamped 50%-150%)
  const fillPct = nominal > 0 ? Math.min(100, Math.max(0, (value / nominal) * 100)) : 50
  // Center marker at 100% nominal position
  const nominalPos = nominal > 0 ? Math.min(100, (nominal / (nominal * 1.5)) * 100) : 50

  return (
    <div className="flex items-center gap-3 py-1.5">
      {/* Label */}
      <div className="w-[130px] shrink-0">
        <span className="text-[11px] text-textSecondary truncate block">{friendlyLabel(label)}</span>
      </div>

      {/* Bar */}
      <div className="flex-1 relative h-4 bg-surface rounded-full border border-border overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${bg} transition-all duration-500 ease-out`}
          style={{ width: `${fillPct}%`, opacity: 0.35 }}
        />
        {/* Nominal marker */}
        {nominal > 0 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-textMuted/40"
            style={{ left: `${nominalPos}%` }}
          />
        )}
      </div>

      {/* Value */}
      <div className="w-[80px] shrink-0 text-right">
        <span className={`text-[12px] font-mono font-bold ${color}`}>
          {value.toFixed(2)}{unit}
        </span>
        {nominal > 0 && (
          <span className="text-[9px] text-textMuted ml-1">
            ({pct < 0.1 ? '0.0' : pct.toFixed(1)}%)
          </span>
        )}
      </div>
    </div>
  )
}
