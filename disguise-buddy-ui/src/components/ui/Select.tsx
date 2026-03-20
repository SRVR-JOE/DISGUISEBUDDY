interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: { label: string; value: string }[]
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

export function Select({
  value,
  onChange,
  options,
  disabled = false,
  'aria-label': ariaLabel,
  className = '',
}: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={[
        'px-3 py-2 rounded-lg text-sm transition-colors duration-150 outline-none',
        'bg-surface border border-border text-text',
        'focus:border-primary focus:ring-1 focus:ring-primary/30',
        'appearance-none cursor-pointer',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
