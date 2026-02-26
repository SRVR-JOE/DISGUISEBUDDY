import React, { useId } from 'react'
import { motion } from 'framer-motion'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  const id = useId()

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onChange(!checked)
    }
  }

  return (
    <div className="inline-flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={handleKeyDown}
        className={[
          // Track
          'relative inline-flex items-center w-10 h-5 rounded-full shrink-0',
          'transition-colors duration-200 focus:outline-none focus-visible:ring-2',
          'focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          checked ? 'bg-primary' : 'bg-border',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Thumb */}
        <motion.span
          layout
          className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
          animate={{ x: checked ? 20 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>

      {label && (
        <label
          htmlFor={id}
          className={[
            'text-sm select-none',
            disabled ? 'text-textMuted cursor-not-allowed' : 'text-textSecondary cursor-pointer',
          ].join(' ')}
          onClick={() => !disabled && onChange(!checked)}
        >
          {label}
        </label>
      )}
    </div>
  )
}
