# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DISGUISE BUDDY is a Windows Forms GUI application written in PowerShell for configuring **disguise (d3) media servers**. It manages server hostnames, network adapter IPs, SMB file shares, and can discover/deploy configuration profiles to remote d3 servers across a network.

**Target environment:** Windows (requires PowerShell 5.1+, Administrator privileges for system changes). Uses `System.Windows.Forms` and `System.Drawing` for the GUI — no external dependencies.

## Running the Application

```powershell
# Must run on Windows with PowerShell 5.1+
# Right-click PowerShell → Run as Administrator (needed for network/hostname changes)
.\DisguiseBuddy.ps1
```

There are no build steps, tests, or linting tools configured.

## Architecture

### Entry Point & Module Loading

`DisguiseBuddy.ps1` is the entry point. It initializes `$script:AppState`, then dot-sources modules from `modules/` in a specific order:

1. **Theme.ps1** → must load first (defines `$script:Theme`, `$script:DarkTheme`, `$script:LightTheme`, `Write-AppLog`)
2. **UIComponents.ps1** → must load second (provides `New-Styled*` factory functions used by all views)
3. **All other modules** → order doesn't matter (ProfileManager, NetworkConfig, SMBConfig, ServerIdentity, Discovery, Dashboard)

### Module Pattern

Each feature module follows a consistent pattern:
- **Backend functions** at the top (data access, system operations, validation) — return `[PSCustomObject]@{ Success; Message }` for operations
- **UI view function** at the bottom (`New-*View -ContentPanel $panel`) — builds the WinForms controls for that navigation tab
- Module-scoped state via `$script:` variables

### Navigation & Views

The main form has a left sidebar with 6 nav buttons. `Set-ActiveView` in `DisguiseBuddy.ps1` switches views by clearing the content panel and calling the appropriate `New-*View` function:

| Nav Item | View Function | Module |
|---|---|---|
| Dashboard | `New-DashboardView` | Dashboard.ps1 |
| Profiles | `New-ProfilesView` | ProfileManager.ps1 |
| Network Adapters | `New-NetworkView` | NetworkConfig.ps1 |
| SMB Sharing | `New-SMBView` | SMBConfig.ps1 |
| Server Identity | `New-ServerIdentityView` | ServerIdentity.ps1 |
| Network Deploy | `New-DeployView` | Discovery.ps1 |

### Profile System

Profiles are JSON files stored in `profiles/`. Each profile contains:
- `ServerName` — hostname (NetBIOS, max 15 chars)
- `NetworkAdapters` — array of 6 adapter configs (Index 0-5) with Role, IP, SubnetMask, DHCP, etc.
- `SMBSettings` — d3 Projects share configuration
- `CustomSettings` — extensible key-value store

Standard adapter roles: d3Net (0), Media (1), sACN/Art-Net (2), NDI (3), Control (4), Internet (5). Profiles may override these roles (see Director.json, Actor profiles).

### Network Discovery & Deployment

`Discovery.ps1` provides `Find-DisguiseServers` (parallel subnet scan using runspace pools), `Test-DisguiseServer` (single-host probe), and `Push-ProfileToServer` (remote deployment via `Invoke-Command`). Discovery probes TCP ports 80, 873, 9864 and the disguise REST API at `/api/service/system`.

### Shared State

`$script:AppState` (defined in DisguiseBuddy.ps1) holds:
- `LastAppliedProfile` — name of most recently applied profile
- `LastScanResults` — array from last network scan
- `CurrentView` — active navigation tab name

### Logging

`Write-AppLog` (in Theme.ps1) writes to `logs/disguisebuddy.log` with levels: INFO, WARN, ERROR, DEBUG.

## Key Conventions

- All UI factory functions are in UIComponents.ps1 and prefixed `New-Styled*` or `New-Section*` / `New-Status*`
- Theme colors are accessed via `$script:Theme.PropertyName` (e.g., `$script:Theme.Primary`, `$script:Theme.Background`)
- Backend functions that modify the system return `[PSCustomObject]@{ Success = [bool]; Message = [string] }`
- Profile filenames are sanitized: `[\\/:*?"<>|]` replaced with `_`
- IP validation uses `Test-IPAddressFormat`; subnet validation uses `Test-SubnetMaskFormat` (both in NetworkConfig.ps1)
