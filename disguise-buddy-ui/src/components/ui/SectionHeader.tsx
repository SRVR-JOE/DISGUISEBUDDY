import React from 'react'

interface SectionHeaderProps {
  title: string
  subtitle?: string
  /** Optional ReactNode aligned to the right (e.g. an action Button) */
  action?: React.ReactNode
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="pb-4 mb-6 border-b border-border">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-text leading-tight">{title}</h2>
          {/* Purple accent underline — 60px wide, 2px tall */}
          <div className="h-0.5 w-15 bg-primary rounded-full mt-0.5" style={{ width: 60 }} />
          {subtitle && (
            <p className="text-textMuted text-sm mt-1 leading-relaxed">{subtitle}</p>
          )}
        </div>

        {action && (
          <div className="flex items-center shrink-0 pt-0.5">{action}</div>
        )}
      </div>
    </div>
  )
}
