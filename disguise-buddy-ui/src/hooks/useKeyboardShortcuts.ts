import { useEffect } from 'react'

const VIEW_IDS = ['dashboard', 'profiles', 'network', 'smb', 'identity', 'deploy'] as const
type ViewId = typeof VIEW_IDS[number]

interface UseKeyboardShortcutsOptions {
  onViewChange: (view: string) => void
  onRefresh: () => void
  currentView: string
  onDeploy?: () => void
  onDismiss?: () => void
}

export function useKeyboardShortcuts({
  onViewChange,
  onRefresh,
  currentView,
  onDeploy,
  onDismiss,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Ctrl+1 through Ctrl+6: switch views
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        const digit = parseInt(e.key, 10)
        if (digit >= 1 && digit <= 6) {
          e.preventDefault()
          const viewId: ViewId = VIEW_IDS[digit - 1]
          onViewChange(viewId)
          return
        }

        // Ctrl+Enter: deploy (only on the deploy page)
        if (e.key === 'Enter' && currentView === 'deploy') {
          e.preventDefault()
          onDeploy?.()
          return
        }
      }

      // F5: refresh
      if (e.key === 'F5' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        onRefresh()
        return
      }

      // Escape: dismiss
      if (e.key === 'Escape') {
        onDismiss?.()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onViewChange, onRefresh, currentView, onDeploy, onDismiss])
}
