import { Monitor } from 'lucide-react'
import { GlassCard, SectionHeader } from '@/components/ui'

export function IdentityPage() {
  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Server Identity"
        subtitle="Hostname and system identification"
      />

      <GlassCard>
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Monitor size={40} className="text-textMuted" aria-hidden="true" />
          <p className="text-text font-medium text-base">
            Hostname is managed through Profiles
          </p>
          <p className="text-textMuted text-sm text-center max-w-md leading-relaxed">
            Each profile contains a ServerName that gets applied as the hostname during
            deployment. Edit a profile on the Profiles page, then deploy it to a server
            from the Dashboard.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
