import React, { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Users,
  Network,
  FolderOpen,
  Server,
  Rocket,
  Sun,
  Moon,
  ChevronRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavItem {
  id: string
  label: string
  icon: React.ElementType
  shortcut: string
}

interface SidebarProps {
  activeView: string
  onViewChange: (view: string) => void
}

// ─── Nav config ───────────────────────────────────────────────────────────────

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard',       icon: LayoutDashboard, shortcut: 'Ctrl+1' },
  { id: 'profiles',  label: 'Profiles',        icon: Users,           shortcut: 'Ctrl+2' },
  { id: 'network',   label: 'Network',          icon: Network,         shortcut: 'Ctrl+3' },
  { id: 'smb',       label: 'SMB Sharing',      icon: FolderOpen,      shortcut: 'Ctrl+4' },
  { id: 'identity',  label: 'Server Identity',  icon: Server,          shortcut: 'Ctrl+5' },
  { id: 'deploy',    label: 'Network Deploy',   icon: Rocket,          shortcut: 'Ctrl+6' },
]

// ─── Constants ────────────────────────────────────────────────────────────────

const COLLAPSED_WIDTH = 60
const EXPANDED_WIDTH  = 240
const HOVER_DELAY_MS  = 200

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hover-expand with delay to prevent flickering on mouse-through
  const handleMouseEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => {
      setIsExpanded(true)
    }, HOVER_DELAY_MS)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setIsExpanded(false)
  }, [])

  const handleToggle = useCallback(() => {
    setIsExpanded(prev => !prev)
  }, [])

  const handleThemeToggle = useCallback(() => {
    setIsDark(prev => !prev)
    console.log('[Sidebar] Theme toggle clicked — dark:', !isDark)
  }, [isDark])

  return (
    <motion.nav
      layout
      animate={{ width: isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative flex flex-col h-full bg-nav border-r border-border overflow-hidden shrink-0"
      aria-label="Main navigation"
    >
      {/* ── Logo area ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-4 min-h-[64px]">
        {/* Monogram / wordmark */}
        <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-primary/20 border border-primary/30">
          <span className="text-primary font-bold text-sm leading-none select-none">DB</span>
        </div>

        {/* Expanded label block */}
        <motion.div
          animate={{ opacity: isExpanded ? 1 : 0, x: isExpanded ? 0 : -8 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="flex flex-col overflow-hidden whitespace-nowrap"
          aria-hidden={!isExpanded}
        >
          <span className="text-primary font-bold text-[14px] leading-tight tracking-wide">
            DISGUISE BUDDY
          </span>
          <span className="text-textMuted text-[10px] leading-tight mt-0.5">
            Server Configuration Manager
          </span>
        </motion.div>

        {/* Pin / collapse toggle — only visible when expanded */}
        <motion.button
          animate={{ opacity: isExpanded ? 1 : 0 }}
          transition={{ duration: 0.15 }}
          onClick={handleToggle}
          className="ml-auto shrink-0 p-1 rounded text-textMuted hover:text-text hover:bg-hover transition-colors duration-150"
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          tabIndex={isExpanded ? 0 : -1}
        >
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="block"
          >
            <ChevronRight size={14} />
          </motion.span>
        </motion.button>
      </div>

      {/* Separator */}
      <div className="h-px bg-border mx-3" />

      {/* ── Nav items ─────────────────────────────────────────────────────── */}
      <ul className="flex flex-col gap-0.5 px-2 py-3 flex-1" role="list">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id
          const Icon = item.icon

          return (
            <li key={item.id} role="listitem">
              <motion.button
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.1 }}
                onClick={() => onViewChange(item.id)}
                className={[
                  'relative flex items-center gap-3 w-full rounded-lg',
                  'h-11 px-3 transition-colors duration-150 cursor-pointer select-none',
                  isActive
                    ? 'bg-primary text-white font-bold'
                    : 'text-textSecondary hover:bg-hover hover:text-text',
                ].join(' ')}
                aria-current={isActive ? 'page' : undefined}
                title={!isExpanded ? `${item.label} (${item.shortcut})` : undefined}
              >
                {/* Active left-border accent */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-white/60 rounded-r-full"
                    aria-hidden="true"
                  />
                )}

                {/* Icon — always visible */}
                <span className="shrink-0">
                  <Icon size={20} aria-hidden="true" />
                </span>

                {/* Label — visible when expanded */}
                <motion.span
                  animate={{ opacity: isExpanded ? 1 : 0, x: isExpanded ? 0 : -4 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="text-sm whitespace-nowrap overflow-hidden"
                  aria-hidden={!isExpanded}
                >
                  {item.label}
                </motion.span>

                {/* Shortcut hint — right-aligned, expanded only */}
                <motion.span
                  animate={{ opacity: isExpanded ? 1 : 0 }}
                  transition={{ duration: 0.15 }}
                  className={[
                    'ml-auto text-[10px] font-mono whitespace-nowrap',
                    isActive ? 'text-white/50' : 'text-textMuted',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {item.shortcut}
                </motion.span>
              </motion.button>
            </li>
          )
        })}
      </ul>

      {/* ── Bottom section ────────────────────────────────────────────────── */}
      <div className="h-px bg-border mx-3" />

      <div className="flex items-center gap-3 px-3 py-3">
        {/* Theme toggle */}
        <button
          onClick={handleThemeToggle}
          className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg text-textSecondary hover:text-text hover:bg-hover transition-colors duration-150"
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </button>

        {/* Version label — visible when expanded */}
        <motion.span
          animate={{ opacity: isExpanded ? 1 : 0, x: isExpanded ? 0 : -4 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="text-textMuted text-[11px] font-mono whitespace-nowrap"
          aria-hidden={!isExpanded}
        >
          v2.0
        </motion.span>
      </div>
    </motion.nav>
  )
}
