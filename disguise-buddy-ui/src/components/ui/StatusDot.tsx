
type DotStatus = 'online' | 'offline' | 'warning' | 'scanning'

interface StatusDotProps {
  status: DotStatus
  className?: string
}

const dotConfig: Record<
  DotStatus,
  { colorClass: string; pulseClass: string; label: string }
> = {
  online:   { colorClass: 'bg-success',  pulseClass: 'animate-pulse-slow', label: 'Online' },
  offline:  { colorClass: 'bg-error',    pulseClass: '',                   label: 'Offline' },
  warning:  { colorClass: 'bg-warning',  pulseClass: 'animate-pulse-slow', label: 'Warning' },
  scanning: { colorClass: 'bg-primary',  pulseClass: 'animate-pulse',      label: 'Scanning' },
}

export function StatusDot({ status, className = '' }: StatusDotProps) {
  const { colorClass, pulseClass, label } = dotConfig[status]

  return (
    <span
      role="status"
      aria-label={label}
      className={[
        'inline-block w-2 h-2 rounded-full shrink-0',
        colorClass,
        pulseClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}
