import type { TimeRange } from '@/lib/telemetry-types'

const RANGES: { value: TimeRange; label: string }[] = [
  { value: '30s', label: '30s' },
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
]

interface TimeRangeSelectorProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
  className?: string
}

export function TimeRangeSelector({ value, onChange, className = '' }: TimeRangeSelectorProps) {
  return (
    <div
      className={[
        'inline-flex rounded-lg border border-border overflow-hidden',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {RANGES.map((range) => {
        const isActive = value === range.value
        return (
          <button
            key={range.value}
            type="button"
            onClick={() => onChange(range.value)}
            className={[
              'px-3 py-1.5 text-xs font-mono font-semibold transition-colors',
              isActive
                ? 'bg-primary text-white'
                : 'text-textMuted hover:text-text bg-surface',
            ].join(' ')}
          >
            {range.label}
          </button>
        )
      })}
    </div>
  )
}
