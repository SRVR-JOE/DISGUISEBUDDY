import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { DiscoveredServer, Profile } from './types'

interface AppState {
  discoveredServers: DiscoveredServer[]
  setDiscoveredServers: (servers: DiscoveredServer[]) => void
  addDiscoveredServers: (servers: DiscoveredServer[]) => void
  profiles: Profile[]
  setProfiles: (profiles: Profile[]) => void
  credUser: string
  setCredUser: (u: string) => void
  credPass: string
  setCredPass: (p: string) => void
  isDark: boolean
  toggleTheme: () => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [credUser, setCredUser] = useState('')
  const [credPass, setCredPass] = useState('')
  const [isDark, setIsDark] = useState(true)

  const addDiscoveredServers = useCallback((newServers: DiscoveredServer[]) => {
    setDiscoveredServers(prev => {
      const map = new Map(prev.map(s => [s.IPAddress, s]))
      newServers.forEach(s => map.set(s.IPAddress, s))
      return Array.from(map.values())
    })
  }, [])

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }, [])

  return (
    <AppContext.Provider value={{
      discoveredServers, setDiscoveredServers, addDiscoveredServers,
      profiles, setProfiles,
      credUser, setCredUser, credPass, setCredPass,
      isDark, toggleTheme,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}
