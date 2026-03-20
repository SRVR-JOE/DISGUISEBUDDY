import React from 'react'
import { motion } from 'framer-motion'

interface GlassCardProps {
  children: React.ReactNode
  className?: string
  title?: string
  /** CSS color string for the 4px left border accent stripe */
  accent?: string
}

export function GlassCard({ children, className = '', title, accent }: GlassCardProps) {
  return (
    <motion.div
      className={`glass-card relative overflow-hidden ${className}`}
      style={accent ? { borderLeft: `4px solid ${accent}` } : undefined}
      whileHover={{
        y: -2,
        boxShadow:
          '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(124,58,237,0.15)',
      }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {title && (
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <h3 className="text-text font-bold text-sm tracking-wide">{title}</h3>
        </div>
      )}
      <div className="p-5">{children}</div>
    </motion.div>
  )
}
