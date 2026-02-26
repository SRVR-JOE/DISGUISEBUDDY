import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Network, Pencil, Trash2, Plus, Calendar } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Profile } from '@/lib/types'
import {
  GlassCard,
  Badge,
  SectionHeader,
  Button,
  ConfirmDialog,
} from '@/components/ui'
import { ProfileEditor } from '@/components/profiles/ProfileEditor'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ProfileCardSkeleton() {
  return (
    <div className="glass-card p-5 flex flex-col gap-3 animate-pulse">
      <div className="h-5 w-1/2 bg-surface rounded" />
      <div className="h-3 w-3/4 bg-surface rounded" />
      <div className="h-3 w-2/3 bg-surface rounded" />
      <div className="flex gap-2 mt-1">
        <div className="h-5 w-20 bg-surface rounded-full" />
        <div className="h-5 w-16 bg-surface rounded-full" />
      </div>
      <div className="h-8 w-full bg-surface rounded-lg mt-2" />
    </div>
  )
}

// ─── Profile card ─────────────────────────────────────────────────────────────

interface ProfileCardProps {
  profile: Profile
  isActive: boolean
  animationDelay: number
  onApply: (profile: Profile) => void
  onEdit: (profile: Profile) => void
  onDelete: (profile: Profile) => void
}

function ProfileCard({
  profile,
  isActive,
  animationDelay,
  onApply,
  onEdit,
  onDelete,
}: ProfileCardProps) {
  const [hovered, setHovered] = useState(false)

  const activeBorderClass = isActive
    ? 'border-primary shadow-[0_0_0_1px_rgba(124,58,237,0.4),0_0_20px_rgba(124,58,237,0.15)] animate-glow'
    : ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: animationDelay, ease: 'easeOut' }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="relative"
    >
      <GlassCard className={`flex flex-col h-full ${activeBorderClass}`}>
        {/* Edit / Delete hover actions */}
        <AnimatePresence>
          {hovered && (
            <motion.div
              key="actions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute top-3 right-3 flex items-center gap-1 z-10"
            >
              <button
                type="button"
                aria-label={`Edit ${profile.Name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(profile)
                }}
                className="p-1.5 rounded-md text-textMuted hover:text-text hover:bg-hover transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${profile.Name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(profile)
                }}
                className="p-1.5 rounded-md text-textMuted hover:text-error hover:bg-error/10 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-error"
              >
                <Trash2 size={13} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Card body — flex-col fills GlassCard's inner div */}
        <div className="flex flex-col gap-3 h-full">
          {/* Name + active badge */}
          <div className="pr-14">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-text leading-tight">
                {profile.Name}
              </h3>
              {isActive && (
                <Badge variant="success" pulse>
                  Active
                </Badge>
              )}
            </div>
          </div>

          {/* Description — 2-line clamp */}
          {profile.Description ? (
            <p
              className="text-sm text-textMuted leading-relaxed"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {profile.Description}
            </p>
          ) : (
            <p className="text-sm text-textMuted italic">No description</p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 flex-wrap">
            {profile.ServerName && (
              <Badge variant="neutral">{profile.ServerName}</Badge>
            )}
            <span className="inline-flex items-center gap-1 text-xs text-textMuted">
              <Network size={11} aria-hidden="true" />
              {profile.NetworkAdapters.length} adapters
            </span>
          </div>

          {/* Last modified */}
          <div className="flex items-center gap-1 text-xs text-textMuted mt-auto pt-1">
            <Calendar size={10} aria-hidden="true" />
            <span>Modified {formatDate(profile.Modified)}</span>
          </div>

          {/* Quick Apply */}
          <Button
            variant="primary"
            size="sm"
            className="w-full mt-1"
            onClick={() => onApply(profile)}
          >
            Quick Apply
          </Button>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-20 gap-4 text-center"
    >
      <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Plus size={24} className="text-primary" aria-hidden="true" />
      </div>
      <div>
        <p className="text-text font-semibold text-base">No profiles yet</p>
        <p className="text-textMuted text-sm mt-1">
          Create your first profile to get started.
        </p>
      </div>
      <Button variant="primary" size="md" onClick={onCreate}>
        <Plus size={14} />
        Create Profile
      </Button>
    </motion.div>
  )
}

// ─── Profiles page ────────────────────────────────────────────────────────────

export function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null)

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<Profile | undefined>(undefined)

  // Apply confirm
  const [applyTarget, setApplyTarget] = useState<Profile | null>(null)
  const [applying, setApplying] = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadProfiles = useCallback(() => {
    setLoading(true)
    api
      .getProfiles()
      .then(setProfiles)
      .catch(() => toast.error('Failed to load profiles'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  // ── Actions ─────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingProfile(undefined)
    setEditorOpen(true)
  }

  function openEdit(profile: Profile) {
    setEditingProfile(profile)
    setEditorOpen(true)
  }

  async function handleSave(profile: Profile) {
    try {
      const result = await api.saveProfile(profile)
      if (!result.success) throw new Error(result.message)
      toast.success(`Profile "${profile.Name}" saved`)
      setEditorOpen(false)
      loadProfiles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile')
    }
  }

  async function confirmApply() {
    if (!applyTarget) return
    setApplying(true)
    try {
      const result = await api.applyProfile(applyTarget.Name)
      if (!result.success) throw new Error(result.message)
      setActiveProfileName(applyTarget.Name)
      toast.success(`Profile "${applyTarget.Name}" applied successfully`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply profile')
    } finally {
      setApplying(false)
      setApplyTarget(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const result = await api.deleteProfile(deleteTarget.Name)
      if (!result.success) throw new Error(result.message)
      toast.success(`Profile "${deleteTarget.Name}" deleted`)
      loadProfiles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete profile')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Profiles"
        subtitle="Saved server configurations — apply a profile to push settings to this machine."
        action={
          <Button variant="primary" size="md" onClick={openCreate}>
            <Plus size={14} />
            Create New
          </Button>
        }
      />

      {/* Card grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <ProfileCardSkeleton key={i} />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map((profile, i) => (
            <ProfileCard
              key={profile.Name}
              profile={profile}
              isActive={profile.Name === activeProfileName}
              animationDelay={i * 0.05}
              onApply={(p) => setApplyTarget(p)}
              onEdit={openEdit}
              onDelete={(p) => setDeleteTarget(p)}
            />
          ))}
        </div>
      )}

      {/* Profile editor overlay */}
      <ProfileEditor
        profile={editingProfile}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
      />

      {/* Apply confirm dialog */}
      <ConfirmDialog
        open={applyTarget !== null && !applying}
        title={`Apply "${applyTarget?.Name ?? ''}"?`}
        message={`This will configure hostname, network adapters, and SMB shares on this machine using the "${applyTarget?.Name ?? ''}" profile.`}
        confirmLabel="Apply Profile"
        confirmVariant="primary"
        onConfirm={confirmApply}
        onCancel={() => setApplyTarget(null)}
      />

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={deleteTarget !== null && !deleting}
        title={`Delete "${deleteTarget?.Name ?? ''}"?`}
        message={`This will permanently remove the "${deleteTarget?.Name ?? ''}" profile. This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
