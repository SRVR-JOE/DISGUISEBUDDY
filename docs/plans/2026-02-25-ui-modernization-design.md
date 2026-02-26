# Disguise Buddy UI Modernization Design

## Goal
Modernize Disguise Buddy from PowerShell WinForms to a premium Electron + React desktop application while preserving all existing functionality. HTTP-based architecture, standalone Windows .exe.

## Tech Stack
- **Shell:** Electron (electron-builder for packaging)
- **Frontend:** React 18 + Vite + TypeScript
- **Styling:** Tailwind CSS 4 + Framer Motion
- **Backend:** Express.js (in Electron main process, port 47100)
- **System Bridge:** PowerShell child processes for Windows operations
- **Build:** electron-builder → Windows .exe installer

## Architecture

```
Electron Shell
├── Main Process
│   ├── Express API Server (localhost:47100)
│   └── PowerShell Bridge Service (child_process)
└── Renderer Process
    └── React SPA (Vite)
        ├── Tailwind CSS (dark-first theme)
        └── Framer Motion (animations)
```

## UI Design

### Theme
- Dark-mode-first "control room" aesthetic
- Deep charcoal backgrounds (#0F0F14)
- Purple accent (#7C3AED) matching brand
- Glassmorphism cards with backdrop blur
- Pulsing status indicators (green/amber/red)
- Inter or Geist font family

### Navigation
- Collapsible sidebar: icon rail (60px) ↔ full labels (240px)
- Active page: purple glow accent bar
- Keyboard shortcuts: Ctrl+1-6, F5 refresh
- Theme toggle at bottom

### Pages (6 views)

1. **Dashboard** — 4 status cards, adapter summary table, quick actions, recent activity
2. **Profiles** — 3-column card grid, hover lift/glow, quick-apply, CRUD modals, import/export
3. **Network Adapters** — 2x3 slot cards per adapter, inline IP editing, DHCP toggle
4. **SMB Sharing** — Share management panel, d3 Projects path config, permissions
5. **Server Identity** — Hostname display + rename input, validation feedback
6. **Network Deploy** — Subnet scan with progress ring, server tiles, profile deploy with SSE progress

### Animations
- Page transitions: slide + fade (Framer Motion AnimatePresence)
- Card hover: lift + subtle glow
- Progress: animated rings for scans/deploys
- Toasts: slide in from top-right
- Status dots: gentle pulse animation

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/adapters | List network adapters |
| POST | /api/adapters/:id/configure | Set IP/DHCP config |
| GET | /api/profiles | List all profiles |
| POST | /api/profiles | Create/update profile |
| POST | /api/profiles/:name/apply | Apply profile locally |
| DELETE | /api/profiles/:name | Delete profile |
| GET | /api/smb | Get SMB configuration |
| POST | /api/smb/shares | Create/manage shares |
| DELETE | /api/smb/shares/:name | Remove share |
| GET | /api/identity | Get current hostname |
| POST | /api/identity | Set hostname |
| POST | /api/discovery/scan | Scan subnet (SSE progress) |
| POST | /api/deploy | Deploy to server (SSE progress) |

## Error Handling
- Toast notifications for success/warning/error
- Modal confirmations for destructive actions
- Retry mechanisms for network operations
- Graceful PowerShell process management

## Packaging
- electron-builder → Windows .exe/.msi
- Admin elevation via app manifest
- PowerShell scripts bundled in resources/
- Profile JSON files in user data directory
