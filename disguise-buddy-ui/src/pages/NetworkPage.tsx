import { Network } from 'lucide-react'
import { GlassCard, SectionHeader } from '@/components/ui'

export function NetworkPage() {
  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Network Adapters"
        subtitle="Adapter configuration for disguise media servers"
      />

      <GlassCard>
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Network size={40} className="text-textMuted" aria-hidden="true" />
          <p className="text-text font-medium text-base">
            Adapter settings are managed through Profiles
          </p>
          <p className="text-textMuted text-sm text-center max-w-md leading-relaxed">
            Each profile contains full network adapter configuration (IP addresses, subnets,
            gateways, DNS) for all 6 NIC slots. Edit a profile on the Profiles page, then
            deploy it to a server from the Dashboard.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
