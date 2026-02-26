import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from './Button'

type ConfirmVariant = 'primary' | 'destructive'

interface ConfirmDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  title: string
  message: string
  confirmLabel?: string
  confirmVariant?: ConfirmVariant
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
}: ConfirmDialogProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            className="fixed inset-0 bg-black/60 z-50"
            style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onCancel}
            aria-hidden="true"
          />

          {/* Dialog */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              aria-describedby="confirm-dialog-message"
              className="glass-card w-full max-w-md pointer-events-auto"
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div className="p-6 flex flex-col gap-4">
                <h2
                  id="confirm-dialog-title"
                  className="text-text font-bold text-lg leading-snug"
                >
                  {title}
                </h2>

                <p
                  id="confirm-dialog-message"
                  className="text-textSecondary text-sm leading-relaxed"
                >
                  {message}
                </p>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button variant="ghost" size="md" onClick={onCancel}>
                    Cancel
                  </Button>
                  <Button variant={confirmVariant} size="md" onClick={onConfirm}>
                    {confirmLabel}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
