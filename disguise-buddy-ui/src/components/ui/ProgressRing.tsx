import { useId } from 'react'
import { motion } from 'framer-motion'

interface ProgressRingProps {
  /** 0–100 */
  progress: number
  size?: number
  strokeWidth?: number
  /** Text to render in the center. Defaults to showing the percentage. */
  label?: string
}

export function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 8,
  label,
}: ProgressRingProps) {
  const gradientId = useId()

  const clampedProgress = Math.min(100, Math.max(0, progress))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  // Offset is calculated so 0% = full offset (hidden) and 100% = 0 offset (full circle)
  const targetOffset = circumference * (1 - clampedProgress / 100)

  const center = size / 2

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label={`Progress: ${clampedProgress}%`}
      role="img"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          {/* primary → accent gradient along the arc */}
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>

      {/* Track circle */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="#2A2A3C"
        strokeWidth={strokeWidth}
      />

      {/* Progress arc — starts from the top (−90°) */}
      <motion.circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: targetOffset }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{ rotate: '-90deg', transformOrigin: `${center}px ${center}px` }}
      />

      {/* Center text */}
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#E2E8F0"
        fontSize={size * 0.16}
        fontWeight="700"
        fontFamily="Inter, system-ui, sans-serif"
      >
        {label ?? `${Math.round(clampedProgress)}%`}
      </text>
    </svg>
  )
}
