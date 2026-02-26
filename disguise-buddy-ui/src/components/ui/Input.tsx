import { useId } from 'react'

interface InputProps {
  label?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
  className?: string
  type?: string
}

export function Input({
  label,
  placeholder,
  value,
  onChange,
  error,
  disabled = false,
  className = '',
  type = 'text',
}: InputProps) {
  const id = useId()

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="text-textSecondary font-medium text-sm"
        >
          {label}
        </label>
      )}

      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={[
          'w-full px-3 py-2 rounded-lg text-sm transition-colors duration-150 outline-none',
          'bg-surface border placeholder:text-textMuted text-text',
          error
            ? 'border-error focus:border-error focus:ring-1 focus:ring-error/30 text-error'
            : 'border-border focus:border-primary focus:ring-1 focus:ring-primary/30',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      />

      {error && (
        <p id={`${id}-error`} className="text-error text-xs mt-0.5" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
