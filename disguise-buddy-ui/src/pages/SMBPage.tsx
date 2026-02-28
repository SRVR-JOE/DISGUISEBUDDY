import { Share2 } from 'lucide-react'
import { GlassCard, SectionHeader } from '@/components/ui'

export function SMBPage() {
  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="SMB Sharing"
        subtitle="File share configuration for disguise media servers"
      />

      <GlassCard>
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Share2 size={40} className="text-textMuted" aria-hidden="true" />
          <p className="text-text font-medium text-base">
            SMB settings are managed through Profiles
          </p>
          <p className="text-textMuted text-sm text-center max-w-md leading-relaxed">
            Each profile includes SMB share configuration (d3 Projects share, additional
            shares, permissions). Edit a profile on the Profiles page, then deploy it to
            a server from the Dashboard.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
