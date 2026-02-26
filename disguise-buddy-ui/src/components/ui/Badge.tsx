import React from 'react'

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  /** Renders an animated pulse dot before content — use for live status indicators */
  pulse?: boolean
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-success/20 text-success border border-success/30',
  warning: 'bg-warning/20 text-warning border border-warning/30',
  error:   'bg-error/20 text-error border border-error/30',
  info:    'bg-accent/20 text-accent border border-accent/30',
  neutral: 'bg-surface text-textSecondary border border-border',
}

const dotColorClasses: Record<BadgeVariant, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error:   'bg-error',
  info:    'bg-accent',
  neutral: 'bg-textMuted',
}

export function Badge({ variant = 'neutral', children, pulse = false, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full',
        'text-xs font-semibold uppercase tracking-wider',
        variantClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {pulse && (
        <span
          className={[
            'w-1.5 h-1.5 rounded-full shrink-0 animate-pulse-slow',
            dotColorClasses[variant],
          ].join(' ')}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  )
}
