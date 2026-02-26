# Disguise Buddy UI Modernization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite Disguise Buddy as a premium Electron + React desktop app with a modern "control room" dark-mode UI, preserving all existing PowerShell backend functionality via an Express API bridge.

**Architecture:** Electron shell wrapping a React SPA (Vite + TypeScript + Tailwind CSS + Framer Motion) that communicates with an Express.js API server in the main process. The Express server delegates system operations to PowerShell child processes. On non-Windows systems, mock responses are returned for development.

**Tech Stack:** Electron 33+, React 18, Vite, TypeScript, Tailwind CSS 3, Framer Motion, Express.js, node:child_process

---

## Task 1: Project Scaffolding

**Files:**
- Create: `disguise-buddy-ui/package.json`
- Create: `disguise-buddy-ui/tsconfig.json`
- Create: `disguise-buddy-ui/vite.config.ts`
- Create: `disguise-buddy-ui/tailwind.config.ts`
- Create: `disguise-buddy-ui/postcss.config.js`
- Create: `disguise-buddy-ui/index.html`
- Create: `disguise-buddy-ui/src/main.tsx`
- Create: `disguise-buddy-ui/src/App.tsx`
- Create: `disguise-buddy-ui/src/index.css`
- Create: `disguise-buddy-ui/electron/main.ts`
- Create: `disguise-buddy-ui/electron/preload.ts`

**Step 1: Initialize project**

```bash
cd /Users/Joseph.Bradley/DISGUISEBUDDY-audit
mkdir -p disguise-buddy-ui
cd disguise-buddy-ui
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install react react-dom framer-motion lucide-react react-hot-toast
npm install -D typescript @types/react @types/react-dom vite @vitejs/plugin-react tailwindcss postcss autoprefixer electron electron-builder concurrently wait-on express @types/express
```

**Step 3: Create config files**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

Create `vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  },
  server: { port: 5173 },
  build: { outDir: 'dist-renderer' }
})
```

Create `tailwind.config.ts`:
```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0F0F14', surface: '#1A1A24', card: '#1E1E2E', input: '#161622' },
        nav: { DEFAULT: '#0C0C16', hover: '#1A1A24', active: '#7C3AED' },
        primary: { DEFAULT: '#7C3AED', light: '#8B5CF6', dark: '#6D28D9' },
        accent: '#06B6D4',
        border: { DEFAULT: '#2A2A3C', light: '#3F3F5C' },
        txt: { DEFAULT: '#E2E8F0', secondary: '#94A3B8', muted: '#64748B' },
        success: { DEFAULT: '#10B981', bg: '#0D3B2E' },
        warning: { DEFAULT: '#F59E0B', bg: '#3B2E0D' },
        error: { DEFAULT: '#EF4444', bg: '#3B0D0D' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(124, 58, 237, 0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(124, 58, 237, 0.6)' },
        }
      }
    }
  },
  plugins: []
} satisfies Config
```

Create `postcss.config.js`:
```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} }
}
```

Create `index.html`:
```html
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DISGUISE BUDDY</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body class="bg-bg text-txt font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

**Step 4: Create entry files**

Create `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: #0F0F14; }
  ::-webkit-scrollbar-thumb { background: #2A2A3C; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #3F3F5C; }
  * { scrollbar-width: thin; scrollbar-color: #2A2A3C #0F0F14; }
}

.glass-card {
  @apply bg-bg-card/80 backdrop-blur-sm border border-border rounded-xl;
}
```

Create `src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
```

Create `src/App.tsx` (placeholder):
```tsx
export default function App() {
  return <div className="flex h-screen">App loading...</div>
}
```

**Step 5: Create Electron main process**

Create `electron/main.ts`:
```typescript
import { app, BrowserWindow } from 'electron'
import path from 'path'
import { startApiServer } from './api-server'

let mainWindow: BrowserWindow | null = null
const isDev = !app.isPackaged

async function createWindow() {
  await startApiServer()

  mainWindow = new BrowserWindow({
    width: 1280, height: 850, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0F0F14',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0C0C16', symbolColor: '#94A3B8', height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

Create `electron/preload.ts`:
```typescript
import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('appBridge', {
  platform: process.platform,
  apiBase: 'http://localhost:47100'
})
```

**Step 6: Add npm scripts to package.json**

```json
{
  "main": "dist-electron/main.js",
  "scripts": {
    "dev:renderer": "vite",
    "dev:electron": "tsc -p electron/tsconfig.json && electron .",
    "dev": "concurrently \"npm run dev:renderer\" \"wait-on http://localhost:5173 && npm run dev:electron\"",
    "build:renderer": "vite build",
    "build:electron": "tsc -p electron/tsconfig.json",
    "build": "npm run build:renderer && npm run build:electron",
    "pack": "npm run build && electron-builder"
  }
}
```

**Step 7: Verify Vite dev server starts**

```bash
cd /Users/Joseph.Bradley/DISGUISEBUDDY-audit/disguise-buddy-ui
npx vite --host
# Expected: Vite dev server running on http://localhost:5173
```

**Step 8: Commit**

```bash
git add disguise-buddy-ui/
git commit -m "feat: scaffold Electron + React + Vite + Tailwind project"
```

---

## Task 2: Express API Server + PowerShell Bridge

**Files:**
- Create: `disguise-buddy-ui/electron/api-server.ts`
- Create: `disguise-buddy-ui/electron/ps-bridge.ts`
- Create: `disguise-buddy-ui/electron/mock-data.ts`
- Create: `disguise-buddy-ui/src/lib/api.ts`

**Step 1: Create PowerShell bridge**

`electron/ps-bridge.ts` — executes PowerShell commands and returns JSON results. Falls back to mock data on non-Windows:

```typescript
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getMockResponse } from './mock-data'

const execFileAsync = promisify(execFile)
const isWindows = process.platform === 'win32'

export async function runPowerShell(scriptBlock: string): Promise<any> {
  if (!isWindows) return getMockResponse(scriptBlock)
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', `${scriptBlock} | ConvertTo-Json -Depth 10`
    ], { timeout: 30000 })
    return JSON.parse(stdout.trim() || 'null')
  } catch (err: any) {
    throw new Error(`PowerShell error: ${err.message}`)
  }
}
```

**Step 2: Create mock data for development**

`electron/mock-data.ts` — returns realistic mock data matching the profile JSON schema from `profiles/Director.json`. Must include: mock adapters (6 NICs with d3Net/sACN/Media/NDI/100G roles), mock profiles (Director, Actor-01 through Actor-04), mock SMB shares, mock hostname, mock system info, mock discovery results.

**Step 3: Create Express API server**

`electron/api-server.ts` — Express server on port 47100 with these endpoints:

| Method | Route | PowerShell Script | Returns |
|--------|-------|-------------------|---------|
| GET | /api/adapters | Get-NetAdapter | Adapter[] |
| POST | /api/adapters/:index/configure | Set-NetIPAddress / Set-NetIPInterface | {success, message} |
| GET | /api/profiles | Read profiles/*.json | Profile[] |
| POST | /api/profiles | Write to profiles/*.json | {success, message} |
| POST | /api/profiles/:name/apply | Calls Set-AdapterStaticIP, Set-ServerHostname, New-SmbShare per profile | {success, message} |
| DELETE | /api/profiles/:name | Delete profiles/*.json | {success, message} |
| GET | /api/smb | Get-SmbShare | Share[] |
| POST | /api/smb/shares | New-SmbShare | {success, message} |
| DELETE | /api/smb/shares/:name | Remove-SmbShare | {success, message} |
| GET | /api/identity | $env:COMPUTERNAME + Get-CimInstance Win32_ComputerSystem | IdentityInfo |
| POST | /api/identity | Rename-Computer | {success, message, restartRequired} |
| POST | /api/discovery/scan | Find-DisguiseServers (SSE stream) | EventSource |
| POST | /api/deploy/:server | Push-ProfileToServer (SSE stream) | EventSource |
| GET | /api/dashboard | Aggregated status | DashboardData |

For SSE endpoints (scan/deploy), use `res.writeHead(200, { 'Content-Type': 'text/event-stream' })` and emit progress events.

Profile file I/O reads/writes directly from `../../profiles/` directory (or app.getPath('userData') in production).

**Step 4: Create frontend API client**

`src/lib/api.ts`:
```typescript
const API_BASE = (window as any).appBridge?.apiBase || 'http://localhost:47100'

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

export const api = {
  getAdapters: () => fetchApi<Adapter[]>('/api/adapters'),
  configureAdapter: (index: number, config: AdapterConfig) =>
    fetchApi<Result>(`/api/adapters/${index}/configure`, { method: 'POST', body: JSON.stringify(config) }),
  getProfiles: () => fetchApi<Profile[]>('/api/profiles'),
  saveProfile: (profile: Profile) =>
    fetchApi<Result>('/api/profiles', { method: 'POST', body: JSON.stringify(profile) }),
  applyProfile: (name: string) =>
    fetchApi<Result>(`/api/profiles/${encodeURIComponent(name)}/apply`, { method: 'POST' }),
  deleteProfile: (name: string) =>
    fetchApi<Result>(`/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getSmb: () => fetchApi<SmbShare[]>('/api/smb'),
  createShare: (share: ShareConfig) =>
    fetchApi<Result>('/api/smb/shares', { method: 'POST', body: JSON.stringify(share) }),
  deleteShare: (name: string) =>
    fetchApi<Result>(`/api/smb/shares/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getIdentity: () => fetchApi<IdentityInfo>('/api/identity'),
  setHostname: (name: string) =>
    fetchApi<Result>('/api/identity', { method: 'POST', body: JSON.stringify({ hostname: name }) }),
  getDashboard: () => fetchApi<DashboardData>('/api/dashboard'),
  scanNetwork: (subnet: string, start: number, end: number) => {
    return new EventSource(`${API_BASE}/api/discovery/scan?subnet=${subnet}&start=${start}&end=${end}`)
  },
  deployProfile: (server: string, profileName: string) => {
    return new EventSource(`${API_BASE}/api/deploy/${encodeURIComponent(server)}?profile=${encodeURIComponent(profileName)}`)
  }
}
```

**Step 5: Create TypeScript types**

`src/lib/types.ts` — matching the profile JSON schema from `profiles/Director.json`:
```typescript
export interface Profile {
  Name: string; Description: string; Created: string; Modified: string;
  ServerName: string; NetworkAdapters: AdapterConfig[]; SMBSettings: SMBSettings; CustomSettings: Record<string, any>;
}
export interface AdapterConfig {
  Index: number; Role: string; DisplayName: string; AdapterName: string;
  IPAddress: string; SubnetMask: string; Gateway: string; DNS1: string; DNS2: string;
  DHCP: boolean; VLANID: number | null; Enabled: boolean;
}
export interface SMBSettings {
  ShareD3Projects: boolean; ProjectsPath: string; ShareName: string;
  SharePermissions: string; AdditionalShares: any[];
}
export interface SmbShare { Name: string; Path: string; Description: string; ShareState: string; IsD3Share: boolean; }
export interface IdentityInfo { Hostname: string; Domain: string; DomainType: string; OSVersion: string; Uptime: string; SerialNumber: string; Model: string; }
export interface DashboardData { activeProfile: string; adapterCount: string; shareCount: string; hostname: string; adapterSummary: AdapterSummary[]; }
export interface AdapterSummary { role: string; displayName: string; ip: string; status: string; }
export interface Result { success: boolean; message: string; }
export interface DiscoveredServer { IPAddress: string; Hostname: string; IsDisguise: boolean; ResponseTimeMs: number; Ports: number[]; APIVersion: string; }
```

**Step 6: Commit**

```bash
git add disguise-buddy-ui/electron/ disguise-buddy-ui/src/lib/
git commit -m "feat: add Express API server with PowerShell bridge and mock data"
```

---

## Task 3: Theme System + Shared UI Components

**Files:**
- Create: `src/components/ui/Card.tsx`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Input.tsx`
- Create: `src/components/ui/Badge.tsx`
- Create: `src/components/ui/Toast.tsx`
- Create: `src/components/ui/ProgressRing.tsx`
- Create: `src/components/ui/ConfirmDialog.tsx`
- Create: `src/components/ui/SectionHeader.tsx`

**Design tokens already in Tailwind config from Task 1.** These components apply the premium aesthetic:

**Card** — glass-morphism container:
```tsx
<motion.div className="glass-card p-6" whileHover={{ y: -2, boxShadow: '0 8px 30px rgba(124,58,237,0.15)' }}>
```

**Badge** — status pill (Success/Warning/Error/Info) with pulse animation for live status.

**ProgressRing** — SVG circular progress with animated stroke-dashoffset for scan/deploy operations.

**ConfirmDialog** — Framer Motion animated modal overlay with backdrop blur for destructive actions.

**SectionHeader** — Page title with purple accent underline (matching the PowerShell `New-SectionHeader`).

All components use Tailwind classes from the custom palette. No inline styles. Motion variants for enter/exit animations.

**Step 7: Commit**

```bash
git add disguise-buddy-ui/src/components/
git commit -m "feat: add shared UI component library with glass-card design system"
```

---

## Task 4: App Shell — Sidebar + Layout + Routing

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/layout/Sidebar.tsx`
- Create: `src/components/layout/PageTransition.tsx`
- Create: `src/hooks/useKeyboardShortcuts.ts`

**Sidebar design:**
- 60px collapsed icon rail ↔ 240px expanded with labels
- Active item: purple glow bar on left edge, white text, bold
- Icons from lucide-react: LayoutDashboard, Users, Network, FolderOpen, Server, Rocket
- Bottom section: theme toggle (Sun/Moon icon), version label "v2.0"
- Collapsible via hover or toggle button
- Framer Motion layout animation for expand/collapse

**Navigation items** (matching the 6 PowerShell views):
```typescript
const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'Ctrl+1' },
  { id: 'profiles', label: 'Profiles', icon: Users, shortcut: 'Ctrl+2' },
  { id: 'network', label: 'Network Adapters', icon: Network, shortcut: 'Ctrl+3' },
  { id: 'smb', label: 'SMB Sharing', icon: FolderOpen, shortcut: 'Ctrl+4' },
  { id: 'identity', label: 'Server Identity', icon: Server, shortcut: 'Ctrl+5' },
  { id: 'deploy', label: 'Network Deploy', icon: Rocket, shortcut: 'Ctrl+6' },
]
```

**Page transitions:** AnimatePresence with slide-fade on page change.

**Keyboard shortcuts** hook: Ctrl+1-6 for nav, F5 for refresh, Ctrl+Enter for deploy (matching existing PowerShell shortcuts).

**Step 8: Commit**

```bash
git add disguise-buddy-ui/src/
git commit -m "feat: add app shell with animated sidebar navigation and keyboard shortcuts"
```

---

## Task 5: Dashboard Page

**Files:**
- Create: `src/pages/DashboardPage.tsx`

**Port from:** `modules/Dashboard.ps1` (Get-ActiveAdapterCount, Get-ActiveShareCount, Get-AdapterSummaryData, New-DashboardView)

**Layout:**
1. **4 status cards** across top in grid: Active Profile, Adapters Online, SMB Shares, Hostname
   - Each card: icon, value, label, subtle glow on hover
   - Animate in staggered with Framer Motion
2. **Adapter summary table** — 6 rows for adapter roles (d3Net, sACN, Media, NDI, Control, Internet)
   - Columns: Role, Display Name, IP Address, Status (badge)
   - Role color dot matching `$script:AdapterRoles` colors from NetworkConfig.ps1
3. **Quick actions** — row of buttons: Apply Profile, Scan Network, Open Profiles
4. **Recent activity** — shows last applied profile from AppState

**Data source:** `GET /api/dashboard`

**Step 9: Commit**

```bash
git add disguise-buddy-ui/src/pages/DashboardPage.tsx
git commit -m "feat: add Dashboard page with status cards and adapter summary"
```

---

## Task 6: Profiles Page

**Files:**
- Create: `src/pages/ProfilesPage.tsx`
- Create: `src/components/profiles/ProfileCard.tsx`
- Create: `src/components/profiles/ProfileEditor.tsx`

**Port from:** `modules/ProfileManager.ps1` — New-ProfilesView, profile CRUD, quick-apply

**Layout:**
1. **Section header** "Profiles" with "Create New" button + Import/Export buttons
2. **Card grid** (3 columns, responsive) — each profile card shows:
   - Profile name (bold), description (muted), server hostname
   - Adapter count badge, last modified date
   - Quick-apply button (primary) on each card
   - Edit/Delete actions on hover
   - Framer Motion: hover lifts card, active profile has glow border
3. **Profile editor modal** — create/edit form with:
   - Name, Description, ServerName inputs
   - 6 adapter config sections (matching profile JSON schema)
   - SMB settings section
   - Save/Cancel buttons

**Data source:** `GET/POST/DELETE /api/profiles`, `POST /api/profiles/:name/apply`

**Step 10: Commit**

```bash
git add disguise-buddy-ui/src/pages/ProfilesPage.tsx disguise-buddy-ui/src/components/profiles/
git commit -m "feat: add Profiles page with card grid and editor modal"
```

---

## Task 7: Network Adapters Page

**Files:**
- Create: `src/pages/NetworkPage.tsx`
- Create: `src/components/network/AdapterCard.tsx`

**Port from:** `modules/NetworkConfig.ps1` — adapter roles, IP validation, New-NetworkView

**Layout:**
1. **Section header** "Network Adapters" with "Detect Adapters" button
2. **2x3 grid** of adapter slot cards — each card:
   - Role badge with color (d3Net=purple, sACN=cyan, Media=green, NDI=blue, Control=amber, 100G=pink)
   - Display name (NIC A, NIC B, etc.)
   - IP Address input (inline editable)
   - Subnet Mask input
   - DHCP toggle switch
   - Gateway, DNS fields (collapsible)
   - Apply button per card
   - Status indicator: connected (green dot), disconnected (red dot)
3. **Validation:** real-time IP format validation matching `Test-IPAddressFormat` from NetworkConfig.ps1

**Data source:** `GET /api/adapters`, `POST /api/adapters/:index/configure`

Adapter role definitions (from `$script:AdapterRoles` in NetworkConfig.ps1):
```
Index 0: d3Net    (#7C3AED) - d3 Network
Index 1: sACN     (#06B6D4) - Lighting (sACN/Art-Net)
Index 2: Media    (#10B981) - Media Network
Index 3: NDI      (#3B82F6) - NDI Video
Index 4: Control  (#F59E0B) - Control/OSC
Index 5: 100G     (#EC4899) - 100G
```

**Step 11: Commit**

```bash
git add disguise-buddy-ui/src/pages/NetworkPage.tsx disguise-buddy-ui/src/components/network/
git commit -m "feat: add Network Adapters page with 6-slot adapter cards"
```

---

## Task 8: SMB Sharing Page

**Files:**
- Create: `src/pages/SMBPage.tsx`

**Port from:** `modules/SMBConfig.ps1` — New-SMBView, share CRUD, permissions

**Layout:**
1. **Card 1: d3 Projects Share** — status badge (Active/Inactive), share name input, local path input with browse hint, share enabled toggle, permissions section (account dropdown, access level dropdown, update button), Apply/Remove buttons
2. **Card 2: Additional Shares** — data grid showing all system shares (Name, Path, State), Refresh/Create New/Remove Selected buttons
3. **Card 3: Quick Actions** — Test Share Access, Copy UNC Path buttons, status feedback area

**Data source:** `GET/POST/DELETE /api/smb`

**Step 12: Commit**

```bash
git add disguise-buddy-ui/src/pages/SMBPage.tsx
git commit -m "feat: add SMB Sharing page with share management"
```

---

## Task 9: Server Identity Page

**Files:**
- Create: `src/pages/IdentityPage.tsx`

**Port from:** `modules/ServerIdentity.ps1` — New-ServerIdentityView, hostname validation, system info

**Layout:**
1. **Card 1: Current Identity** — large hostname display (primary color), domain/workgroup badge, system info grid (OS, Uptime, Model, Serial)
2. **Card 2: Change Hostname** — restart warning banner (amber), current hostname display, new hostname input with real-time character count (0/15) and validation feedback, preview panel showing UNC path + d3Net name + API access changes, Apply button with confirmation dialog
3. **Card 3: Naming Conventions** — recommended format `{SHOW}-{ROLE}-{NUMBER}`, guidelines list

**Hostname validation** (matching `Test-ServerHostname` from ServerIdentity.ps1):
- Max 15 chars (NetBIOS)
- Only A-Z, 0-9, hyphens
- Cannot start/end with hyphen
- Real-time feedback as user types

**Data source:** `GET/POST /api/identity`

**Step 13: Commit**

```bash
git add disguise-buddy-ui/src/pages/IdentityPage.tsx
git commit -m "feat: add Server Identity page with hostname management"
```

---

## Task 10: Network Deploy Page

**Files:**
- Create: `src/pages/DeployPage.tsx`
- Create: `src/components/deploy/ServerTile.tsx`
- Create: `src/components/deploy/ScanProgress.tsx`

**Port from:** `modules/Discovery.ps1` — Find-DisguiseServers, Push-ProfileToServer, New-DeployView

**Layout:**
1. **Scan section** — subnet base input (default 192.168.10), IP range inputs (1-254), timeout selector, Scan Network button
2. **Progress ring** during scan (animated SVG circle) with server count updating in real-time via SSE
3. **Discovered servers grid** — interactive tiles, each showing:
   - Hostname, IP address, response time
   - Port badges (80, 873, 9864)
   - disguise badge if `IsDisguise` is true
   - API version if detected
   - Selectable with checkbox
4. **Deploy section** — profile selector dropdown, Deploy button (Ctrl+Enter shortcut)
5. **Deploy progress** — SSE stream showing per-server deployment status with progress bars

**SSE integration:** `POST /api/discovery/scan` returns EventSource with events: `progress` (percent, serversFound), `server` (discovered server data), `complete`. Same pattern for deploy.

**Step 14: Commit**

```bash
git add disguise-buddy-ui/src/pages/DeployPage.tsx disguise-buddy-ui/src/components/deploy/
git commit -m "feat: add Network Deploy page with scan and SSE progress"
```

---

## Task 11: Integration + Polish

**Files:**
- Modify: `src/App.tsx` — wire all pages together
- Create: `src/hooks/useApi.ts` — shared data fetching hook with loading/error states
- Create: `src/context/AppContext.tsx` — global state (active profile, theme, scan results)

**Step 1:** Wire all 6 pages into App.tsx with sidebar navigation and page transitions.

**Step 2:** Add toast notifications (react-hot-toast) for all API success/error responses.

**Step 3:** Add loading skeletons for each page while data fetches.

**Step 4:** Test full navigation flow: click each sidebar item, verify page renders with mock data.

**Step 5: Commit**

```bash
git add disguise-buddy-ui/src/
git commit -m "feat: integrate all pages with navigation, toasts, and loading states"
```

---

## Task 12: Electron Packaging

**Files:**
- Create: `disguise-buddy-ui/electron-builder.yml`
- Modify: `disguise-buddy-ui/package.json` (build config)

**electron-builder.yml:**
```yaml
appId: com.disguise.buddy
productName: DISGUISE BUDDY
copyright: Copyright 2026
directories:
  output: release
  buildResources: build
files:
  - dist-renderer/**/*
  - dist-electron/**/*
  - node_modules/**/*
win:
  target: [nsis]
  requestedExecutionLevel: requireAdministrator
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerIcon: build/icon.ico
extraResources:
  - from: ../modules/
    to: powershell/modules/
  - from: ../profiles/
    to: powershell/profiles/
```

**Step 6:** Build and verify:
```bash
cd disguise-buddy-ui
npm run build
npm run pack
```

**Step 7: Commit**

```bash
git add disguise-buddy-ui/electron-builder.yml disguise-buddy-ui/package.json
git commit -m "feat: add Electron packaging for Windows .exe installer"
```

---

## Parallelization Map

Tasks that can run in parallel after dependencies are met:

```
Task 1 (Scaffold)
  ├── Task 2 (API Server) ──────────────────┐
  ├── Task 3 (UI Components) ───────────────┤
  └── Task 4 (App Shell) ──────────────────┤
                                             │
  After Tasks 2-4 complete:                  │
  ├── Task 5 (Dashboard)    ─── parallel ───┤
  ├── Task 6 (Profiles)     ─── parallel ───┤
  ├── Task 7 (Network)      ─── parallel ───┤
  ├── Task 8 (SMB)          ─── parallel ───┤
  ├── Task 9 (Identity)     ─── parallel ───┤
  └── Task 10 (Deploy)      ─── parallel ──┤
                                             │
  After Tasks 5-10 complete:                 │
  ├── Task 11 (Integration) ────────────────┤
  └── Task 12 (Packaging) ─────────────────┘
```
