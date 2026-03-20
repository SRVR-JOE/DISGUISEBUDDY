import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppContext } from '@/lib/AppContext'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Terminal,
  Server,
  Trash2,
  RefreshCw,
  ChevronRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
// DiscoveredServer type is used via useAppContext()
import { GlassCard, SectionHeader, Badge, Button, Select } from '@/components/ui'

// ─── Types ────────────────────────────────────────────────────────────────────

type LineKind = 'stdout' | 'stderr' | 'meta' | 'prompt'

interface TerminalLine {
  id: number
  kind: LineKind
  text: string
}

// ─── Quick-action definitions ─────────────────────────────────────────────────

const QUICK_ACTIONS: { label: string; command: string; isPing?: boolean }[] = [
  { label: 'Ping',          command: 'ping',           isPing: true },
  { label: 'ipconfig',      command: 'ipconfig' },
  { label: 'Get-NetAdapter', command: 'Get-NetAdapter' },
  { label: 'hostname',      command: 'hostname' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TerminalPage() {
  // ── Shared context ─────────────────────────────────────────────────────────
  const { discoveredServers: servers } = useAppContext()

  // ── Server list ─────────────────────────────────────────────────────────────
  const [refreshingServers, setRefreshingServers] = useState(false)

  // ── Target selection ────────────────────────────────────────────────────────
  // "" means "local machine"
  const [selectedIP, setSelectedIP] = useState('')

  // ── Terminal output ─────────────────────────────────────────────────────────
  const [lines, setLines] = useState<TerminalLine[]>([])
  const lineIdRef = useRef(0)
  const outputRef = useRef<HTMLDivElement>(null)

  // ── Command input ────────────────────────────────────────────────────────────
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Command history ──────────────────────────────────────────────────────────
  const [history, setHistory] = useState<string[]>([])
  const historyIndexRef = useRef(-1)
  const pendingInputRef = useRef('')   // saves whatever the user was typing before cycling history

  // ── Active SSE ref ───────────────────────────────────────────────────────────
  const esRef = useRef<{ cancel: () => void } | null>(null)

  // ── Auto-scroll to bottom whenever lines update ──────────────────────────────
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  // ── Focus input on mount ────────────────────────────────────────────────────
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // ── Cleanup SSE on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      esRef.current?.cancel()
    }
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const nextId = useCallback((): number => {
    lineIdRef.current += 1
    return lineIdRef.current
  }, [])

  const appendLine = useCallback((kind: LineKind, text: string) => {
    setLines((prev) => [...prev, { id: nextId(), kind, text }])
  }, [nextId])

  // ── Refresh server list ──────────────────────────────────────────────────────
  const refreshServers = useCallback(() => {
    setRefreshingServers(true)
    toast('Scan for servers on the Dashboard page first', { icon: 'i' })
    setRefreshingServers(false)
  }, [])

  // ── Clear terminal ────────────────────────────────────────────────────────────
  const clearTerminal = useCallback(() => {
    setLines([])
  }, [])

  // ── Abort running command ────────────────────────────────────────────────────
  const abortCommand = useCallback(() => {
    esRef.current?.cancel()
    esRef.current = null
    appendLine('meta', '[Aborted]')
    setRunning(false)
    inputRef.current?.focus()
  }, [appendLine])

  // ── Execute a command via SSE ─────────────────────────────────────────────────
  const executeCommand = useCallback(
    (command: string, isPing = false) => {
      const cmd = command.trim()
      if (!cmd) return

      // Add to history (deduplicate consecutive same entries)
      setHistory((prev) => {
        if (prev[0] === cmd) return prev
        return [cmd, ...prev].slice(0, 100)
      })
      historyIndexRef.current = -1
      pendingInputRef.current = ''

      const targetServer = servers.find((s) => s.IPAddress === selectedIP)
      const targetLabel = targetServer
        ? `${targetServer.IPAddress} (${targetServer.Hostname || 'Unknown'})`
        : 'Local Machine'

      // Print prompt line
      appendLine('prompt', `${targetLabel} > ${cmd}`)

      setRunning(true)
      setInput('')

      const onOutput = (data: { line: string }) => {
        appendLine('stdout', data.line)
      }

      const onError = () => {
        esRef.current = null
        appendLine('stderr', 'Connection error — command may not have completed')
        setRunning(false)
        inputRef.current?.focus()
      }

      const onDone = (data: any) => {
        esRef.current = null
        try {
          const exitText = data.exitCode === 0
            ? `Completed in ${data.durationMs}ms (exit 0)`
            : `Exited with code ${data.exitCode} in ${data.durationMs}ms`
          appendLine('meta', exitText)
        } catch {
          appendLine('meta', 'Completed')
        }
        setRunning(false)
        inputRef.current?.focus()
      }

      if (isPing) {
        const pingTarget = selectedIP || '127.0.0.1'
        esRef.current = api.pingHost(pingTarget, 4, onOutput, onError, onDone)
      } else {
        esRef.current = api.executeCommand(cmd, selectedIP || undefined, undefined, undefined, onOutput, onError, onDone)
      }
    },
    [servers, selectedIP, appendLine],
  )

  // ── Handle Enter / arrow keys in the input ────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (!running && input.trim()) {
          executeCommand(input)
        }
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (history.length === 0) return
        if (historyIndexRef.current === -1) {
          // Save the current draft before cycling
          pendingInputRef.current = input
        }
        const nextIndex = Math.min(historyIndexRef.current + 1, history.length - 1)
        historyIndexRef.current = nextIndex
        setInput(history[nextIndex])
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndexRef.current === -1) return
        const nextIndex = historyIndexRef.current - 1
        historyIndexRef.current = nextIndex
        if (nextIndex === -1) {
          setInput(pendingInputRef.current)
        } else {
          setInput(history[nextIndex])
        }
        return
      }
    },
    [running, input, history, executeCommand],
  )

  // ── Derived values ────────────────────────────────────────────────────────────
  const selectedServer = servers.find((s) => s.IPAddress === selectedIP) ?? null

  const serverOptions: { label: string; value: string }[] = [
    { label: 'Local Machine', value: '' },
    ...servers.map((s) => ({
      label: s.Hostname ? `${s.Hostname} (${s.IPAddress})` : s.IPAddress,
      value: s.IPAddress,
    })),
  ]

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-6 h-full">
      <SectionHeader
        title="Terminal"
        subtitle="Remote command execution — run PowerShell commands against local or discovered servers"
      />

      {/* ── Card 1: Target Selection + Quick Actions ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0 }}
      >
        <GlassCard>
          <div className="flex flex-wrap items-end gap-4">
            {/* Target dropdown */}
            <div className="flex flex-col gap-1.5 flex-1 min-w-56">
              <span className="text-textSecondary font-medium text-sm">Target</span>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedIP}
                  onChange={(v) => setSelectedIP(v)}
                  options={serverOptions}
                  disabled={running}
                  aria-label="Select target machine"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={refreshServers}
                  disabled={refreshingServers || running}
                  className={[
                    'p-2 rounded-lg border border-border transition-colors duration-150',
                    'text-textMuted hover:text-text hover:bg-hover',
                    refreshingServers || running ? 'opacity-40 cursor-not-allowed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label="Refresh server list"
                  title="Refresh server list"
                >
                  <RefreshCw
                    size={14}
                    className={refreshingServers ? 'animate-spin' : ''}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>

            {/* Selected server info badge */}
            <AnimatePresence>
              {selectedServer && (
                <motion.div
                  key={selectedServer.IPAddress}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="flex items-center gap-2 self-end pb-2"
                >
                  <Server size={13} className="text-textMuted" aria-hidden="true" />
                  <span className="font-mono text-xs text-textSecondary">
                    {selectedServer.IPAddress}
                  </span>
                  <span className="text-xs text-textMuted">
                    {selectedServer.Hostname || 'Unknown hostname'}
                  </span>
                  <Badge variant={selectedServer.IsDisguise ? 'success' : 'neutral'}>
                    {selectedServer.IsDisguise ? 'disguise' : 'generic'}
                  </Badge>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Spacer */}
            <div className="flex-1" aria-hidden="true" />

            {/* Quick action buttons */}
            <div className="flex items-end gap-2 flex-wrap">
              <span className="text-textSecondary font-medium text-sm self-center mr-1">
                Quick actions:
              </span>
              {QUICK_ACTIONS.map((action) => (
                <Button
                  key={action.command}
                  variant="outline"
                  size="sm"
                  disabled={running}
                  onClick={() => {
                    if (action.isPing) {
                      executeCommand(action.command, true)
                    } else {
                      executeCommand(action.command)
                    }
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ── Card 2: Terminal (flex-grow to fill remaining space) ── */}
      <motion.div
        className="flex-1 flex flex-col min-h-0"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.1 }}
      >
        <GlassCard className="flex-1 flex flex-col min-h-0 !overflow-visible">
          {/* Terminal card header */}
          <div className="flex items-center justify-between gap-4 pb-4 mb-0 border-b border-border">
            <div className="flex items-center gap-3">
              <div
                className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center"
                aria-hidden="true"
              >
                <Terminal size={14} className="text-primary" />
              </div>
              <h3 className="text-text font-bold text-sm tracking-wide">Output</h3>
              {running && (
                <Badge variant="info">Running</Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {running && (
                <Button variant="ghost" size="sm" onClick={abortCommand}>
                  Abort
                </Button>
              )}
              <button
                type="button"
                onClick={clearTerminal}
                disabled={lines.length === 0}
                className={[
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium',
                  'border border-border transition-colors duration-150',
                  lines.length === 0
                    ? 'opacity-40 cursor-not-allowed text-textMuted'
                    : 'text-textMuted hover:text-text hover:bg-hover cursor-pointer',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label="Clear terminal output"
              >
                <Trash2 size={12} aria-hidden="true" />
                Clear
              </button>
            </div>
          </div>

          {/* Terminal output area */}
          <div
            ref={outputRef}
            role="log"
            aria-live="polite"
            aria-label="Terminal output"
            className={[
              'flex-1 overflow-y-auto font-mono text-sm leading-relaxed',
              'bg-[#0D1117] rounded-lg mt-3 p-4',
              'min-h-[200px]',
            ].join(' ')}
          >
            {/* Welcome message when empty */}
            {lines.length === 0 && (
              <p className="text-[#4B5563] select-none text-xs">
                No output yet. Select a target and run a command.
              </p>
            )}

            {lines.map((line) => {
              let colorClass = ''
              switch (line.kind) {
                case 'prompt':
                  colorClass = 'text-[#7C3AED] font-semibold'
                  break
                case 'stdout':
                  colorClass = 'text-[#E2E8F0]'
                  break
                case 'stderr':
                  colorClass = 'text-[#F87171]'
                  break
                case 'meta':
                  colorClass = 'text-[#6B7280] italic'
                  break
              }

              return (
                <div key={line.id} className={`whitespace-pre-wrap break-all ${colorClass}`}>
                  {line.kind === 'prompt' && (
                    <span className="text-[#7C3AED] mr-1 not-italic font-normal select-none">
                      <ChevronRight size={12} className="inline -mt-0.5" aria-hidden="true" />
                    </span>
                  )}
                  {line.text}
                </div>
              )
            })}

            {/* Blinking cursor when running */}
            {running && (
              <span
                className="inline-block w-2 h-4 bg-[#7C3AED] opacity-80 animate-pulse ml-0.5 align-middle"
                aria-hidden="true"
              />
            )}
          </div>

          {/* Command input bar */}
          <div className="flex items-center gap-0 mt-3 rounded-lg overflow-hidden border border-border bg-[#0D1117] focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30 transition-colors duration-150">
            {/* PS prompt indicator */}
            <span
              className="shrink-0 pl-3 pr-2 font-mono text-sm text-[#7C3AED] select-none"
              aria-hidden="true"
            >
              PS&gt;
            </span>

            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                // Reset history pointer on manual edit
                historyIndexRef.current = -1
              }}
              onKeyDown={handleKeyDown}
              disabled={running}
              placeholder={running ? 'Running…' : 'Enter a command…'}
              className={[
                'flex-1 bg-transparent outline-none font-mono text-sm',
                'text-[#E2E8F0] placeholder:text-[#4B5563]',
                'py-2.5',
                running ? 'cursor-not-allowed opacity-60' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label="Command input"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />

            {/* Run button */}
            <Button
              variant="primary"
              size="sm"
              disabled={running || !input.trim()}
              loading={running}
              onClick={() => executeCommand(input)}
              className="rounded-none rounded-r-none mr-0 border-0 border-l border-border px-4 self-stretch rounded-r-lg"
            >
              {running ? 'Running' : 'Run'}
            </Button>
          </div>

          {/* History hint */}
          {history.length > 0 && (
            <p className="text-textMuted/50 text-[10px] font-mono mt-1.5 pl-1">
              {history.length} command{history.length === 1 ? '' : 's'} in history — up/down arrows to cycle
            </p>
          )}
        </GlassCard>
      </motion.div>
    </div>
  )
}
