import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppContext } from '@/lib/AppContext'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package,
  Plus,
  Trash2,
  Server,
  Download,
  X,
  HardDrive,
  RefreshCw,
  AlertCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { DiscoveredServer, SoftwarePackage, InstallProgress, InstallResult } from '@/lib/types'
import {
  GlassCard,
  SectionHeader,
  Badge,
  Button,
  Input,
} from '@/components/ui'
import { ServerTile } from '@/components/deploy/ServerTile'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PackageInstallState {
  // keyed by packageId
  [packageId: string]: {
    step: InstallProgress['step']
    percent: number
    message: string
  }
}

interface ServerInstallState {
  status: 'pending' | 'installing' | 'done' | 'error'
  packages: PackageInstallState
  summary?: InstallResult
}

type NewPackageForm = {
  name: string
  version: string
  filename: string
  path: string
  silentArgs: string
  description: string
}

const EMPTY_FORM: NewPackageForm = {
  name: '',
  version: '',
  filename: '',
  path: '',
  silentArgs: '',
  description: '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function stepLabel(step: InstallProgress['step']): string {
  switch (step) {
    case 'copying':    return 'Copying'
    case 'installing': return 'Installing'
    case 'verifying':  return 'Verifying'
    case 'done':       return 'Done'
    case 'error':      return 'Error'
  }
}

function stepVariant(step: InstallProgress['step']): 'info' | 'success' | 'error' | 'warning' | 'neutral' {
  switch (step) {
    case 'copying':    return 'info'
    case 'installing': return 'warning'
    case 'verifying':  return 'info'
    case 'done':       return 'success'
    case 'error':      return 'error'
  }
}

// ─── Add Package Modal ────────────────────────────────────────────────────────

interface AddPackageModalProps {
  onClose: () => void
  onAdd: (pkg: NewPackageForm) => Promise<void>
  saving: boolean
}

function AddPackageModal({ onClose, onAdd, saving }: AddPackageModalProps) {
  const [form, setForm] = useState<NewPackageForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<NewPackageForm>>({})

  const set = useCallback((field: keyof NewPackageForm) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: '' }))
  }, [])

  const validate = (): boolean => {
    const errs: Partial<NewPackageForm> = {}
    if (!form.name.trim())     errs.name     = 'Name is required'
    if (!form.version.trim())  errs.version  = 'Version is required'
    if (!form.filename.trim()) errs.filename = 'Filename is required'
    if (!form.path.trim())     errs.path     = 'Path is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = useCallback(async () => {
    if (!validate()) return
    await onAdd(form)
  }, [form, onAdd])

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <motion.div
      key="add-package-modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add software package"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative w-full max-w-lg z-10"
      >
        <GlassCard>
          {/* Header */}
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                <Plus size={14} className="text-primary" aria-hidden="true" />
              </div>
              <h3 className="text-text font-bold text-sm tracking-wide">Add Software Package</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-textMuted hover:text-text hover:bg-hover transition-colors duration-150"
              aria-label="Close dialog"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {/* Form */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Name"
                value={form.name}
                onChange={set('name')}
                placeholder="disguise r19"
                error={errors.name}
                disabled={saving}
              />
              <Input
                label="Version"
                value={form.version}
                onChange={set('version')}
                placeholder="19.0.0"
                error={errors.version}
                disabled={saving}
              />
            </div>

            <Input
              label="Installer Filename"
              value={form.filename}
              onChange={set('filename')}
              placeholder="disguise_r19_setup.exe"
              error={errors.filename}
              disabled={saving}
            />

            <Input
              label="Local Path"
              value={form.path}
              onChange={set('path')}
              placeholder="C:\Installers\disguise_r19_setup.exe"
              error={errors.path}
              disabled={saving}
            />

            <Input
              label="Silent Install Args"
              value={form.silentArgs}
              onChange={set('silentArgs')}
              placeholder="/S /quiet /norestart"
              disabled={saving}
            />

            <Input
              label="Description"
              value={form.description}
              onChange={set('description')}
              placeholder="Optional description"
              disabled={saving}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-border">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              loading={saving}
              disabled={saving}
            >
              <Plus size={14} className="shrink-0" />
              Add Package
            </Button>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  )
}

// ─── Package Row ──────────────────────────────────────────────────────────────

interface PackageRowProps {
  pkg: SoftwarePackage
  selected: boolean
  onToggle: () => void
  onDelete: () => void
  deleting: boolean
  index: number
}

function PackageRow({ pkg, selected, onToggle, onDelete, deleting, index }: PackageRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut', delay: index * 0.05 }}
      className={[
        'flex items-center gap-3 p-3 rounded-xl border transition-all duration-150 cursor-pointer',
        selected
          ? 'border-primary/60 bg-primary/10 shadow-[0_0_16px_rgba(124,58,237,0.2)]'
          : 'border-border bg-surface/30 hover:border-borderLight hover:bg-surface/50',
      ].join(' ')}
      onClick={onToggle}
      role="checkbox"
      aria-checked={selected}
      aria-label={`Select ${pkg.name} ${pkg.version}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onToggle()
        }
      }}
    >
      {/* Checkbox */}
      <div
        className={[
          'w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors duration-150',
          selected ? 'bg-primary border-primary' : 'bg-transparent border-borderLight',
        ].join(' ')}
        aria-hidden="true"
      >
        {selected && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
            <path
              d="M1 4L3.5 6.5L9 1"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* Package icon */}
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0" aria-hidden="true">
        <Package size={15} className="text-primary" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-text truncate">{pkg.name}</span>
          <Badge variant="info">{pkg.version}</Badge>
        </div>
        {pkg.description && (
          <p className="text-xs text-textMuted mt-0.5 truncate">{pkg.description}</p>
        )}
        <p className="text-xs text-textMuted/70 font-mono mt-0.5 truncate">{pkg.filename}</p>
      </div>

      {/* File size */}
      <div className="flex items-center gap-1 shrink-0 text-textMuted">
        <HardDrive size={12} aria-hidden="true" />
        <span className="text-xs font-mono">{formatBytes(pkg.size)}</span>
      </div>

      {/* Delete button — stop propagation so it doesn't toggle selection */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        disabled={deleting}
        className={[
          'shrink-0 p-1.5 rounded-lg transition-colors duration-150',
          deleting
            ? 'opacity-40 cursor-not-allowed'
            : 'text-textMuted hover:text-error hover:bg-error/10',
        ].join(' ')}
        aria-label={`Remove ${pkg.name}`}
        title="Remove package"
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </motion.div>
  )
}

// ─── Package Install Progress ─────────────────────────────────────────────────

interface ServerInstallProgressProps {
  server: DiscoveredServer
  state: ServerInstallState
  selectedPackages: SoftwarePackage[]
}

function ServerInstallProgress({ server, state, selectedPackages }: ServerInstallProgressProps) {
  const statusBadgeVariant =
    state.status === 'done'      ? 'success'
    : state.status === 'error'   ? 'error'
    : state.status === 'installing' ? 'info'
    : 'neutral'

  const statusLabel =
    state.status === 'done'         ? 'Done'
    : state.status === 'error'      ? 'Error'
    : state.status === 'installing' ? 'Installing'
    : 'Pending'

  return (
    <div className="flex flex-col gap-3 p-4 bg-surface/40 rounded-xl border border-border">
      {/* Server header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Server size={14} className="text-textMuted shrink-0" aria-hidden="true" />
          <span className="font-mono text-xs text-textSecondary shrink-0">{server.IPAddress}</span>
          <span className="text-xs text-textMuted truncate">{server.Hostname || 'Unknown'}</span>
        </div>
        <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
      </div>

      {/* Per-package progress rows */}
      <div className="flex flex-col gap-2 pl-4 border-l-2 border-border">
        {selectedPackages.map((pkg) => {
          const pkgState = state.packages[pkg.id]
          const percent = pkgState?.percent ?? 0
          const step = pkgState?.step
          const message = pkgState?.message ?? ''

          const barColor =
            step === 'done'  ? 'bg-success'
            : step === 'error' ? 'bg-error'
            : step           ? 'bg-primary'
            : 'bg-textMuted'

          return (
            <div key={pkg.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Package size={11} className="text-textMuted shrink-0" aria-hidden="true" />
                  <span className="text-xs text-textSecondary truncate">{pkg.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {message && (
                    <span className="text-xs text-textMuted">{message}</span>
                  )}
                  {step && (
                    <Badge variant={stepVariant(step)} className="text-[10px]">
                      {stepLabel(step)}
                    </Badge>
                  )}
                  {!step && (
                    <Badge variant="neutral" className="text-[10px]">Queued</Badge>
                  )}
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-full h-1 bg-surface rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${barColor}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Summary row (on completion) */}
      {state.summary && (
        <div className="flex items-center gap-4 pt-2 border-t border-border text-xs text-textMuted">
          {state.summary.installed.length > 0 && (
            <span className="text-success font-semibold">
              {state.summary.installed.length} installed
            </span>
          )}
          {state.summary.failed.length > 0 && (
            <span className="text-error font-semibold">
              {state.summary.failed.length} failed
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SoftwarePage() {
  // ── Shared context ──────────────────────────────────────────────────────────
  const { discoveredServers: servers } = useAppContext()

  // ── Packages state ──────────────────────────────────────────────────────────
  const [packages, setPackages] = useState<SoftwarePackage[]>([])
  const [packagesLoading, setPackagesLoading] = useState(true)
  const [packagesError, setPackagesError] = useState('')
  const [selectedPackageIds, setSelectedPackageIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  // ── Add package modal ────────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false)
  const [addingSoftware, setAddingSoftware] = useState(false)

  // ── Servers state ────────────────────────────────────────────────────────────
  const [serversLoading] = useState(false)
  const [selectedServerIPs, setSelectedServerIPs] = useState<Set<string>>(new Set())
  const [refreshingServers, setRefreshingServers] = useState(false)

  // ── Install state ────────────────────────────────────────────────────────────
  const [installing, setInstalling] = useState(false)
  const [installStates, setInstallStates] = useState<Record<string, ServerInstallState>>({})

  // Track completed count across parallel SSE streams
  const completedRef = useRef(0)

  // ── Load packages and servers on mount ──────────────────────────────────────
  useEffect(() => {
    api.getSoftware()
      .then((pkgs) => {
        setPackages(pkgs)
      })
      .catch((err: Error) => {
        setPackagesError(err.message)
        toast.error('Failed to load software packages')
      })
      .finally(() => {
        setPackagesLoading(false)
      })
  }, [])

  // ── Refresh servers ──────────────────────────────────────────────────────────
  const refreshServers = useCallback(() => {
    setRefreshingServers(true)
    // Servers must be discovered via the Dashboard scan - no static discovery endpoint
    toast('Scan for servers on the Dashboard page first', { icon: 'i' })
    setRefreshingServers(false)
  }, [])

  // ── Package selection ────────────────────────────────────────────────────────
  const togglePackage = useCallback((id: string) => {
    setSelectedPackageIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAllPackages = useCallback(() => {
    if (selectedPackageIds.size === packages.length) {
      setSelectedPackageIds(new Set())
    } else {
      setSelectedPackageIds(new Set(packages.map((p) => p.id)))
    }
  }, [selectedPackageIds.size, packages])

  // ── Server selection ─────────────────────────────────────────────────────────
  const toggleServer = useCallback((ip: string) => {
    setSelectedServerIPs((prev) => {
      const next = new Set(prev)
      if (next.has(ip)) next.delete(ip)
      else next.add(ip)
      return next
    })
  }, [])

  const toggleAllServers = useCallback(() => {
    if (selectedServerIPs.size === servers.length) {
      setSelectedServerIPs(new Set())
    } else {
      setSelectedServerIPs(new Set(servers.map((s) => s.IPAddress)))
    }
  }, [selectedServerIPs.size, servers])

  // ── Add package ──────────────────────────────────────────────────────────────
  const handleAddPackage = useCallback(async (form: NewPackageForm) => {
    setAddingSoftware(true)
    try {
      const result = await api.addSoftware(form)
      setPackages((prev) => [...prev, result.package])
      setShowAddModal(false)
      toast.success(`Package "${result.package.name}" added`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add package')
    } finally {
      setAddingSoftware(false)
    }
  }, [])

  // ── Delete package ────────────────────────────────────────────────────────────
  const handleDeletePackage = useCallback((id: string) => {
    setDeletingIds((prev) => new Set([...prev, id]))
    api
      .deleteSoftware(id)
      .then(() => {
        setPackages((prev) => prev.filter((p) => p.id !== id))
        setSelectedPackageIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        toast.success('Package removed')
      })
      .catch((err: Error) => toast.error(err.message || 'Failed to remove package'))
      .finally(() => {
        setDeletingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      })
  }, [])

  // ── Install ──────────────────────────────────────────────────────────────────
  const startInstall = useCallback(() => {
    if (selectedPackageIds.size === 0 || selectedServerIPs.size === 0) return

    const targetServers = servers.filter((s) => selectedServerIPs.has(s.IPAddress))
    const packageIds = [...selectedPackageIds]

    // Initialize all server states to pending
    const initialStates: Record<string, ServerInstallState> = {}
    for (const s of targetServers) {
      initialStates[s.IPAddress] = { status: 'pending', packages: {} }
    }
    setInstallStates(initialStates)
    setInstalling(true)
    completedRef.current = 0

    const total = targetServers.length

    for (const server of targetServers) {
      // Mark as installing immediately
      setInstallStates((prev) => ({
        ...prev,
        [server.IPAddress]: { status: 'installing', packages: {} },
      }))

      api.installSoftware(
        server.IPAddress,
        packageIds,
        undefined, // credUser
        undefined, // credPass
        // onProgress
        (data: InstallProgress) => {
          setInstallStates((prev) => {
            const current = prev[server.IPAddress] ?? { status: 'installing', packages: {} }
            return {
              ...prev,
              [server.IPAddress]: {
                ...current,
                status: 'installing',
                packages: {
                  ...current.packages,
                  [data.packageId]: {
                    step: data.step,
                    percent: data.percent,
                    message: data.message,
                  },
                },
              },
            }
          })
        },
        // onError
        () => {
          setInstallStates((prev) => ({
            ...prev,
            [server.IPAddress]: {
              ...(prev[server.IPAddress] ?? { packages: {} }),
              status: 'error',
            },
          }))
          toast.error(`Connection error for ${server.Hostname || server.IPAddress}`)
          completedRef.current++
          if (completedRef.current === total) setInstalling(false)
        },
        // onDone
        (result: InstallResult) => {
          setInstallStates((prev) => {
            const current = prev[server.IPAddress] ?? { status: 'done', packages: {} }
            return {
              ...prev,
              [server.IPAddress]: {
                ...current,
                status: result.success ? 'done' : 'error',
                summary: result,
              },
            }
          })

          if (result.success) {
            toast.success(`Installed on ${server.Hostname || server.IPAddress}`)
          } else {
            toast.error(
              `Install on ${server.Hostname || server.IPAddress}: ${result.failed.length} package${result.failed.length === 1 ? '' : 's'} failed`,
            )
          }

          completedRef.current++
          if (completedRef.current === total) setInstalling(false)
        },
      )
    }
  }, [selectedPackageIds, selectedServerIPs, servers])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const selectedPackages = packages.filter((p) => selectedPackageIds.has(p.id))
  const selectedServers  = servers.filter((s) => selectedServerIPs.has(s.IPAddress))
  const canInstall = selectedPackageIds.size > 0 && selectedServerIPs.size > 0 && !installing
  const hasInstallProgress = Object.keys(installStates).length > 0

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Software Installation"
        subtitle="Manage installer packages and deploy them to remote disguise servers"
      />

      {/* ── Section 1: Software Packages ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0 }}
      >
        <GlassCard>
          {/* Card header */}
          <div className="flex items-center justify-between gap-4 mb-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <h3 className="text-text font-bold text-sm tracking-wide">Software Packages</h3>
              <Badge variant={packages.length > 0 ? 'info' : 'neutral'}>
                {packagesLoading ? '...' : packages.length}
              </Badge>
            </div>

            <div className="flex items-center gap-3">
              {packages.length > 0 && !packagesLoading && (
                <button
                  type="button"
                  onClick={toggleAllPackages}
                  className="text-xs text-textMuted hover:text-textSecondary transition-colors duration-150 cursor-pointer select-none"
                >
                  {selectedPackageIds.size === packages.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowAddModal(true)}
                disabled={installing}
              >
                <Plus size={12} className="shrink-0" />
                Add Package
              </Button>
            </div>
          </div>

          {/* Loading state */}
          {packagesLoading && (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading packages">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 bg-surface/50 animate-pulse rounded-xl"
                  aria-hidden="true"
                />
              ))}
            </div>
          )}

          {/* Error state */}
          {!packagesLoading && packagesError && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <AlertCircle size={28} className="text-error" aria-hidden="true" />
              <p className="text-error text-sm font-medium">Failed to load packages</p>
              <p className="text-textMuted/70 text-xs">{packagesError}</p>
            </div>
          )}

          {/* Empty state */}
          {!packagesLoading && !packagesError && packages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Package size={32} className="text-textMuted" aria-hidden="true" />
              <p className="text-textMuted text-sm">No packages added yet</p>
              <p className="text-textMuted/60 text-xs">
                Click "Add Package" to register an installer
              </p>
            </div>
          )}

          {/* Package list */}
          {!packagesLoading && packages.length > 0 && (
            <div
              className="flex flex-col gap-2"
              role="group"
              aria-label="Software packages"
            >
              {packages.map((pkg, i) => (
                <PackageRow
                  key={pkg.id}
                  pkg={pkg}
                  selected={selectedPackageIds.has(pkg.id)}
                  onToggle={() => togglePackage(pkg.id)}
                  onDelete={() => handleDeletePackage(pkg.id)}
                  deleting={deletingIds.has(pkg.id)}
                  index={i}
                />
              ))}
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* ── Section 2: Target Servers ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.1 }}
      >
        <GlassCard>
          {/* Card header */}
          <div className="flex items-center justify-between gap-4 mb-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <h3 className="text-text font-bold text-sm tracking-wide">Target Servers</h3>
              <Badge variant={servers.length > 0 ? 'info' : 'neutral'}>
                {serversLoading ? '...' : servers.length}
              </Badge>
            </div>

            <div className="flex items-center gap-3">
              {servers.length > 0 && !serversLoading && (
                <button
                  type="button"
                  onClick={toggleAllServers}
                  className="text-xs text-textMuted hover:text-textSecondary transition-colors duration-150 cursor-pointer select-none"
                >
                  {selectedServerIPs.size === servers.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={refreshServers}
                disabled={refreshingServers || installing}
                loading={refreshingServers}
              >
                <RefreshCw size={12} className={refreshingServers ? 'animate-spin' : ''} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Loading state */}
          {serversLoading && (
            <div
              className="grid grid-cols-3 gap-3"
              aria-busy="true"
              aria-label="Loading servers"
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-36 bg-surface/50 animate-pulse rounded-xl"
                  aria-hidden="true"
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!serversLoading && servers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Server size={32} className="text-textMuted" aria-hidden="true" />
              <p className="text-textMuted text-sm">No servers discovered</p>
              <p className="text-textMuted/60 text-xs">
                Run a network scan on the Network Deploy page first
              </p>
            </div>
          )}

          {/* Server grid */}
          {!serversLoading && servers.length > 0 && (
            <div
              className="grid grid-cols-3 gap-3"
              role="group"
              aria-label="Target servers"
            >
              {servers.map((server, i) => (
                <ServerTile
                  key={server.IPAddress}
                  server={server}
                  selected={selectedServerIPs.has(server.IPAddress)}
                  onSelect={() => toggleServer(server.IPAddress)}
                  index={i}
                />
              ))}
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* ── Section 3: Install Controls ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.2 }}
      >
        <GlassCard>
          <div className="flex flex-col gap-4">
            {/* Summary + install button */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Summary text */}
              <div className="flex flex-col gap-1">
                <h3 className="text-text font-bold text-sm tracking-wide">Install Controls</h3>
                <p className="text-textMuted text-xs">
                  {selectedPackageIds.size === 0 && selectedServerIPs.size === 0
                    ? 'Select packages and servers above to begin installation'
                    : [
                        selectedPackageIds.size > 0
                          ? `${selectedPackageIds.size} package${selectedPackageIds.size === 1 ? '' : 's'} selected`
                          : 'No packages selected',
                        selectedServerIPs.size > 0
                          ? `${selectedServerIPs.size} server${selectedServerIPs.size === 1 ? '' : 's'} selected`
                          : 'No servers selected',
                      ].join(', ')
                  }
                </p>
              </div>

              {/* Selected badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Package size={13} className="text-textMuted" aria-hidden="true" />
                  <Badge variant={selectedPackageIds.size > 0 ? 'info' : 'neutral'}>
                    {selectedPackageIds.size} pkg{selectedPackageIds.size !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <span className="text-textMuted text-sm" aria-hidden="true">+</span>
                <div className="flex items-center gap-1.5">
                  <Server size={13} className="text-textMuted" aria-hidden="true" />
                  <Badge variant={selectedServerIPs.size > 0 ? 'info' : 'neutral'}>
                    {selectedServerIPs.size} server{selectedServerIPs.size !== 1 ? 's' : ''}
                  </Badge>
                </div>

                <Button
                  variant="primary"
                  onClick={startInstall}
                  disabled={!canInstall}
                  loading={installing}
                >
                  <Download size={14} className="shrink-0" />
                  {installing ? 'Installing...' : 'Install to Selected'}
                </Button>
              </div>
            </div>

            {/* Per-server install progress */}
            <AnimatePresence>
              {hasInstallProgress && (
                <motion.div
                  key="install-progress"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col gap-3 pt-4 border-t border-border">
                    <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider">
                      Installation Progress
                    </h4>

                    {selectedServers.map((server) => {
                      const state = installStates[server.IPAddress]
                      if (!state) return null
                      return (
                        <ServerInstallProgress
                          key={server.IPAddress}
                          server={server}
                          state={state}
                          selectedPackages={selectedPackages}
                        />
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </GlassCard>
      </motion.div>

      {/* ── Add Package Modal ── */}
      <AnimatePresence>
        {showAddModal && (
          <AddPackageModal
            onClose={() => setShowAddModal(false)}
            onAdd={handleAddPackage}
            saving={addingSoftware}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
