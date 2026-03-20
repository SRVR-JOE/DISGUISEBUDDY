import React, { useState, useCallback } from 'react'
import { Toaster } from 'react-hot-toast'
import { AppProvider } from './lib/AppContext'
import { Sidebar } from './components/layout/Sidebar'
import { PageTransition } from './components/layout/PageTransition'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { DashboardPage } from './pages/DashboardPage'
import { ProfilesPage } from './pages/ProfilesPage'
import { NetworkPage } from './pages/NetworkPage'
import { SMBPage } from './pages/SMBPage'
import { IdentityPage } from './pages/IdentityPage'
import { DeployPage } from './pages/DeployPage'
import { SoftwarePage } from './pages/SoftwarePage'
import { TerminalPage } from './pages/TerminalPage'
import { SpreadsheetPage } from './pages/SpreadsheetPage'
import { TelemetryPage } from './pages/TelemetryPage'
import { PowerVfcPage } from './pages/PowerVfcPage'
import { SMCDiscoveryPage } from './pages/SMCDiscoveryPage'

export default function App(): React.ReactElement {
  const [activeView, setActiveView] = useState('dashboard')

  const handleViewChange = useCallback((view: string) => {
    setActiveView(view)
  }, [])

  const handleRefresh = useCallback(() => {
    window.dispatchEvent(new Event('app-refresh'))
  }, [activeView])

  const handleDeploy = useCallback(() => {
    window.dispatchEvent(new Event('app-deploy'))
  }, [])

  useKeyboardShortcuts({
    onViewChange: handleViewChange,
    onRefresh: handleRefresh,
    currentView: activeView,
    onDeploy: handleDeploy,
  })

  function renderPage() {
    switch (activeView) {
      case 'dashboard': return <DashboardPage />
      case 'profiles':  return <ProfilesPage />
      case 'network':   return <NetworkPage />
      case 'smb':       return <SMBPage />
      case 'identity':  return <IdentityPage />
      case 'deploy':    return <DeployPage />
      case 'software':  return <SoftwarePage />
      case 'spreadsheet': return <SpreadsheetPage />
      case 'terminal':  return <TerminalPage />
      case 'telemetry': return <TelemetryPage />
      case 'power':     return <PowerVfcPage />
      case 'smc-discovery': return <SMCDiscoveryPage />
      default:          return <DashboardPage />
    }
  }

  return (
    <AppProvider>
      <div className="flex h-screen bg-bg overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />

        <main className="flex-1 overflow-y-auto">
          <PageTransition viewKey={activeView}>
            {renderPage()}
          </PageTransition>
        </main>

        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1E1E2E',
              color: '#E2E8F0',
              border: '1px solid #2A2A3C',
            },
          }}
        />
      </div>
    </AppProvider>
  )
}
