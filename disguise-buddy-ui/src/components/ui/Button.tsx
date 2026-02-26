import React from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'

type ButtonVariant = 'primary' | 'ghost' | 'destructive' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  children: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  loading?: boolean
  className?: string
  type?: 'button' | 'submit' | 'reset'
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary hover:bg-primaryLight active:bg-primaryDark text-white border border-transparent',
  ghost:
    'bg-transparent hover:bg-hover border border-border hover:border-borderLight text-textSecondary hover:text-text',
  destructive:
    'bg-error hover:bg-error/80 active:bg-error/90 text-white border border-transparent',
  outline:
    'bg-transparent hover:bg-surface border border-border hover:border-borderLight text-text',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-md',
  md: 'px-4 py-2 text-sm gap-2 rounded-lg',
  lg: 'px-5 py-2.5 text-base gap-2.5 rounded-lg',
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  disabled = false,
  loading = false,
  className = '',
  type = 'button',
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.1 }}
      className={[
        'inline-flex items-center justify-center font-medium transition-all duration-150 select-none',
        variantClasses[variant],
        sizeClasses[size],
        isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading && (
        <Loader2
          className="animate-spin shrink-0"
          size={size === 'sm' ? 12 : size === 'lg' ? 18 : 14}
        />
      )}
      {children}
    </motion.button>
  )
}
