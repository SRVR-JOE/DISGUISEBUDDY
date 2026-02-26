import { useState, useEffect, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { RefreshCw, Plus, Trash2, TestTube, Copy, FolderOpen, Share2 } from 'lucide-react'
import {
  GlassCard,
  Badge,
  SectionHeader,
  Button,
  Input,
  Toggle,
  DataTable,
  ConfirmDialog,
} from '@/components/ui'
import type { Column } from '@/components/ui'
import { api } from '@/lib/api'
import type { SmbShare } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type Account = 'Administrators' | 'Everyone' | 'SYSTEM'
type AccessLevel = 'Full' | 'Change' | 'Read'

interface TableRow extends Record<string, unknown> {
  Name: string
  Path: string
  State: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toTableRows(shares: SmbShare[]): TableRow[] {
  return shares.map((s) => ({
    Name: s.Name,
    Path: s.Path,
    State: s.ShareState,
  }))
}

// ─── Column definitions ───────────────────────────────────────────────────────

const TABLE_COLUMNS: Column<TableRow>[] = [
  {
    key: 'Name',
    header: 'Name',
    width: '30%',
  },
  {
    key: 'Path',
    header: 'Path',
    width: '45%',
  },
  {
    key: 'State',
    header: 'State',
    width: '25%',
    render: (value) => {
      const state = String(value ?? '')
      const isActive = state.toLowerCase() === 'active' || state.toLowerCase() === 'ok'
      return (
        <Badge variant={isActive ? 'success' : 'neutral'}>
          {state || 'Unknown'}
        </Badge>
      )
    },
  },
]

// ─── SMBPage ──────────────────────────────────────────────────────────────────

export function SMBPage() {
  // ── Fetch state ──
  const [shares, setShares] = useState<SmbShare[]>([])
  const [hostname, setHostname] = useState('SERVER')
  const [loading, setLoading] = useState(true)

  // ── d3 Projects share form ──
  const [shareName, setShareName] = useState('d3 Projects')
  const [localPath, setLocalPath] = useState('D:\\d3 Projects')
  const [shareEnabled, setShareEnabled] = useState(false)
  const [account, setAccount] = useState<Account>('Administrators')
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('Full')
  const [applying, setApplying] = useState(false)

  // ── Additional shares table selection ──
  const [selectedShare, setSelectedShare] = useState<TableRow | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // ── Dialog state ──
  const [showRemoveD3Dialog, setShowRemoveD3Dialog] = useState(false)
  const [showRemoveSelectedDialog, setShowRemoveSelectedDialog] = useState(false)
  const [removeD3Loading, setRemoveD3Loading] = useState(false)
  const [removeSelectedLoading, setRemoveSelectedLoading] = useState(false)

  // ── Quick actions ──
  const [testStatus, setTestStatus] = useState('')
  const [testLoading, setTestLoading] = useState(false)

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [fetchedShares, identity] = await Promise.all([
        api.getSmb(),
        api.getIdentity(),
      ])
      setShares(fetchedShares)
      setHostname(identity.Hostname)

      // Seed the d3 Projects form from the first d3 share if present
      const d3Share = fetchedShares.find((s) => s.IsD3Share)
      if (d3Share) {
        setShareName(d3Share.Name)
        setLocalPath(d3Share.Path)
        setShareEnabled(d3Share.ShareState.toLowerCase() === 'active')
      }
    } catch (err) {
      toast.error(`Failed to load SMB data: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleApplyShare = async () => {
    setApplying(true)
    try {
      // Permissions are stored in Description field since the API does not have a SharePermissions field
      const result = await api.createShare({
        Name: shareName,
        Path: localPath,
        Description: `${account}:${accessLevel}`,
        IsD3Share: true,
      })
      if (result.success) {
        toast.success(result.message || 'Share settings applied')
        await loadData()
      } else {
        toast.error(result.message || 'Failed to apply share settings')
      }
    } catch (err) {
      toast.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setApplying(false)
    }
  }

  const handleRemoveD3Share = async () => {
    setRemoveD3Loading(true)
    try {
      const result = await api.deleteShare(shareName)
      if (result.success) {
        toast.success(result.message || 'Share removed')
        await loadData()
      } else {
        toast.error(result.message || 'Failed to remove share')
      }
    } catch (err) {
      toast.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRemoveD3Loading(false)
      setShowRemoveD3Dialog(false)
    }
  }

  const handleRefreshTable = async () => {
    setRefreshing(true)
    try {
      const fetched = await api.getSmb()
      setShares(fetched)
      setSelectedShare(null)
      toast.success('Shares refreshed')
    } catch (err) {
      toast.error(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreateNew = async () => {
    // Scaffold a new blank share — in a real flow this could open a modal
    const newShare: Omit<SmbShare, 'ShareState'> = {
      Name: 'NewShare',
      Path: 'C:\\NewShare',
      Description: '',
      IsD3Share: false,
    }
    try {
      const result = await api.createShare(newShare)
      if (result.success) {
        toast.success('New share created')
        await loadData()
      } else {
        toast.error(result.message || 'Failed to create share')
      }
    } catch (err) {
      toast.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRemoveSelected = async () => {
    if (!selectedShare) return
    setRemoveSelectedLoading(true)
    try {
      const result = await api.deleteShare(selectedShare.Name)
      if (result.success) {
        toast.success(`"${selectedShare.Name}" removed`)
        setSelectedShare(null)
        await loadData()
      } else {
        toast.error(result.message || 'Failed to remove share')
      }
    } catch (err) {
      toast.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRemoveSelectedLoading(false)
      setShowRemoveSelectedDialog(false)
    }
  }

  const handleTestAccess = async () => {
    setTestLoading(true)
    setTestStatus('')
    try {
      const fetched = await api.getSmb()
      const d3Share = fetched.find((s) => s.IsD3Share)
      if (d3Share && d3Share.ShareState.toLowerCase() === 'active') {
        setTestStatus('SUCCESS: Share is accessible and active.')
        toast.success('Share access test passed')
      } else {
        setTestStatus('WARNING: Share not found or inactive.')
        toast('Share is not currently active', { icon: '⚠️' })
      }
    } catch (err) {
      setTestStatus(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
      toast.error('Share access test failed')
    } finally {
      setTestLoading(false)
    }
  }

  const handleCopyUNC = () => {
    const unc = `\\\\${hostname}\\${shareName}`
    void navigator.clipboard.writeText(unc)
    toast.success('UNC path copied to clipboard')
  }

  // ─── Derived values ────────────────────────────────────────────────────────

  const additionalShares = shares.filter((s) => !s.IsD3Share)
  const d3Share = shares.find((s) => s.IsD3Share)
  const isD3ShareActive = d3Share?.ShareState?.toLowerCase() === 'active'
  const uncPath = `\\\\${hostname}\\${shareName}`

  const selectLabel =
    'px-3 py-2 rounded-lg text-sm bg-surface border border-border text-text ' +
    'focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 ' +
    'transition-colors duration-150 cursor-pointer'

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <span className="text-textMuted text-sm animate-pulse">Loading SMB configuration...</span>
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="SMB Sharing"
        subtitle="Manage Windows file shares for d3 project access"
      />

      {/* ── Card 1: d3 Projects Share ─────────────────────────────────────── */}
      <GlassCard accent="#7C3AED">
        {/* Card header row */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Share2 size={18} className="text-primary shrink-0" aria-hidden="true" />
            <h3 className="text-text font-bold text-sm tracking-wide">d3 Projects Share</h3>
          </div>
          <Badge variant={isD3ShareActive ? 'success' : 'error'} pulse={isD3ShareActive}>
            {isD3ShareActive ? 'ACTIVE' : 'INACTIVE'}
          </Badge>
        </div>

        <div className="flex flex-col gap-4">
          {/* Share name + local path inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Share Name"
              value={shareName}
              onChange={setShareName}
              placeholder="d3 Projects"
            />
            <Input
              label="Local Path"
              value={localPath}
              onChange={setLocalPath}
              placeholder="D:\d3 Projects"
            />
          </div>

          {/* Enable toggle */}
          <div className="flex items-center gap-3 py-1">
            <Toggle
              checked={shareEnabled}
              onChange={setShareEnabled}
              label="Share d3 Projects folder"
            />
          </div>

          {/* Permissions section */}
          <div>
            <p className="text-textSecondary font-medium text-sm mb-3">Permissions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-textSecondary font-medium text-sm" htmlFor="smb-account">
                  Account
                </label>
                <select
                  id="smb-account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value as Account)}
                  className={selectLabel}
                >
                  <option value="Administrators">Administrators</option>
                  <option value="Everyone">Everyone</option>
                  <option value="SYSTEM">SYSTEM</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-textSecondary font-medium text-sm" htmlFor="smb-access">
                  Access Level
                </label>
                <select
                  id="smb-access"
                  value={accessLevel}
                  onChange={(e) => setAccessLevel(e.target.value as AccessLevel)}
                  className={selectLabel}
                >
                  <option value="Full">Full</option>
                  <option value="Change">Change</option>
                  <option value="Read">Read</option>
                </select>
              </div>
            </div>
          </div>

          {/* Button row */}
          <div className="flex items-center gap-3 pt-1 flex-wrap">
            <Button
              variant="primary"
              onClick={() => { void handleApplyShare() }}
              loading={applying}
            >
              Apply Share Settings
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowRemoveD3Dialog(true)}
              disabled={applying}
            >
              Remove Share
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* ── Card 2: Additional Shares ─────────────────────────────────────── */}
      <GlassCard>
        <div className="flex items-center gap-3 mb-5">
          <FolderOpen size={18} className="text-primary shrink-0" aria-hidden="true" />
          <h3 className="text-text font-bold text-sm tracking-wide">Additional Shares</h3>
        </div>

        <DataTable<TableRow>
          columns={TABLE_COLUMNS}
          data={toTableRows(additionalShares)}
          onRowClick={(row) => setSelectedShare(row)}
        />

        <div className="flex items-center gap-3 pt-4 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { void handleRefreshTable() }}
            loading={refreshing}
          >
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void handleCreateNew() }}
          >
            <Plus size={14} />
            Create New
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!selectedShare}
            onClick={() => setShowRemoveSelectedDialog(true)}
          >
            <Trash2 size={14} />
            Remove Selected
          </Button>
        </div>

        {selectedShare && (
          <p className="mt-2 text-xs text-textMuted">
            Selected: <span className="font-mono text-textSecondary">{selectedShare.Name}</span>
          </p>
        )}
      </GlassCard>

      {/* ── Card 3: Quick Actions ─────────────────────────────────────────── */}
      <GlassCard>
        <h3 className="text-text font-bold text-sm tracking-wide mb-5">Quick Actions</h3>

        <div className="flex flex-col gap-4">
          {/* UNC path display */}
          <div className="flex flex-col gap-1.5">
            <p className="text-textSecondary font-medium text-sm">UNC Path</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border">
              <span className="font-mono text-sm text-text flex-1 select-all">{uncPath}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              onClick={() => { void handleTestAccess() }}
              loading={testLoading}
            >
              <TestTube size={14} />
              Test Share Access
            </Button>
            <Button variant="ghost" onClick={handleCopyUNC}>
              <Copy size={14} />
              Copy UNC Path
            </Button>
          </div>

          {/* Status feedback */}
          {testStatus && (
            <div
              className={[
                'px-3 py-2 rounded-lg text-sm font-mono border',
                testStatus.startsWith('SUCCESS')
                  ? 'bg-success/10 border-success/30 text-success'
                  : testStatus.startsWith('WARNING')
                  ? 'bg-warning/10 border-warning/30 text-warning'
                  : 'bg-error/10 border-error/30 text-error',
              ].join(' ')}
              role="status"
              aria-live="polite"
            >
              {testStatus}
            </div>
          )}
        </div>
      </GlassCard>

      {/* ── Confirm: Remove d3 Share ──────────────────────────────────────── */}
      <ConfirmDialog
        open={showRemoveD3Dialog}
        onCancel={() => setShowRemoveD3Dialog(false)}
        onConfirm={() => { void handleRemoveD3Share() }}
        title="Remove d3 Projects Share?"
        message={`This will remove the "${shareName}" SMB share from Windows. Any connected clients will lose access immediately. This action cannot be undone.`}
        confirmLabel={removeD3Loading ? 'Removing…' : 'Remove Share'}
        confirmVariant="destructive"
      />

      {/* ── Confirm: Remove Selected Share ───────────────────────────────── */}
      <ConfirmDialog
        open={showRemoveSelectedDialog}
        onCancel={() => setShowRemoveSelectedDialog(false)}
        onConfirm={() => { void handleRemoveSelected() }}
        title={`Remove "${selectedShare?.Name ?? ''}"?`}
        message="This will permanently remove the selected share from Windows. Connected clients will lose access immediately."
        confirmLabel={removeSelectedLoading ? 'Removing…' : 'Remove Share'}
        confirmVariant="destructive"
      />
    </div>
  )
}
