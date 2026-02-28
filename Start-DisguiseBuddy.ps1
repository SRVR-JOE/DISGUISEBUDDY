#Requires -Version 5.1
<#
.SYNOPSIS
    Launcher for DISGUISE BUDDY web UI.
.DESCRIPTION
    Checks for Node.js (installs if missing), installs npm dependencies,
    starts the API server and Vite dev server, waits for both to be ready,
    then opens the browser. Cleans up child processes on exit.
#>

# -----------------------------------------------------------------------------
# GLOBALS
# -----------------------------------------------------------------------------
$script:ApiProcess  = $null
$script:ViteProcess = $null
$script:UiDir       = Join-Path $PSScriptRoot 'disguise-buddy-ui'
$script:Running     = $true

# -----------------------------------------------------------------------------
# CLEANUP - kills both server processes and their children
# -----------------------------------------------------------------------------
function Stop-Servers {
    Write-Host ''
    Write-Host '  Shutting down servers...' -ForegroundColor Yellow

    foreach ($proc in @($script:ApiProcess, $script:ViteProcess)) {
        if ($null -ne $proc -and -not $proc.HasExited) {
            try {
                # Kill child processes first (npx spawns node underneath)
                Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                    Where-Object { $_.ParentProcessId -eq $proc.Id } |
                    ForEach-Object {
                        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
                    }
                $proc.Kill()
                $proc.WaitForExit(3000) | Out-Null
            } catch {
                # Process may have already exited
            }
        }
    }

    Write-Host '  Servers stopped.' -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# BANNER
# -----------------------------------------------------------------------------
Clear-Host
Write-Host ''
Write-Host '  ================================================' -ForegroundColor Cyan
Write-Host '       D I S G U I S E   B U D D Y' -ForegroundColor Cyan
Write-Host '       Web UI Launcher  v2.1' -ForegroundColor Cyan
Write-Host '  ================================================' -ForegroundColor Cyan
Write-Host ''

# -----------------------------------------------------------------------------
# HELPER: Refresh PATH from registry (call after any install)
# -----------------------------------------------------------------------------
function Update-PathFromRegistry {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path    = "$machinePath;$userPath"
}

# -----------------------------------------------------------------------------
# HELPER: Wait for an HTTP endpoint to respond 200
# -----------------------------------------------------------------------------
function Wait-ForServer {
    param(
        [string] $Url,
        [string] $Label,
        [System.Diagnostics.Process] $Process = $null,
        [int]    $MaxAttempts = 30,
        [int]    $DelaySeconds = 2
    )

    Write-Host "        Waiting for $Label..." -ForegroundColor Cyan

    for ($i = 1; $i -le $MaxAttempts; $i++) {
        # Early exit if the process has already died
        if ($null -ne $Process -and $Process.HasExited) {
            Write-Host "  ERROR: $Label process exited with code $($Process.ExitCode)." -ForegroundColor Red
            return $false
        }

        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($null -ne $response -and $response.StatusCode -eq 200) {
                Write-Host "        $Label is ready." -ForegroundColor Green
                return $true
            }
        } catch {
            # Server not up yet - expected during startup
        }

        $msg = "        Attempt $i / $MaxAttempts - retrying in $DelaySeconds s..."
        Write-Host $msg -ForegroundColor DarkGray
        Start-Sleep -Seconds $DelaySeconds
    }

    Write-Host "  ERROR: $Label did not respond after $MaxAttempts attempts." -ForegroundColor Red
    return $false
}

# -----------------------------------------------------------------------------
# STEP 1 - Ensure Node.js is present
# -----------------------------------------------------------------------------
Write-Host '  [1/5] Checking for Node.js...' -ForegroundColor Cyan

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if ($null -ne $nodeCmd) {
    $nodeVer = & node --version 2>&1
    Write-Host "        Node.js $nodeVer detected." -ForegroundColor Green
} else {
    Write-Host '        Node.js not found. Installing...' -ForegroundColor Yellow
    Write-Host ''

    $installed = $false

    # -- Method 1: winget --
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($null -ne $wingetCmd) {
        Write-Host '        Trying winget...' -ForegroundColor Cyan
        try {
            $wingetArgs = @('install', 'OpenJS.NodeJS.LTS', '--silent',
                            '--accept-source-agreements', '--accept-package-agreements')
            $proc = Start-Process -FilePath 'winget.exe' -ArgumentList $wingetArgs `
                        -Wait -PassThru -NoNewWindow
            if ($proc.ExitCode -eq 0) {
                Update-PathFromRegistry
                if (Get-Command node -ErrorAction SilentlyContinue) {
                    $nodeVer = & node --version 2>&1
                    Write-Host "        Node.js $nodeVer installed via winget." -ForegroundColor Green
                    $installed = $true
                } else {
                    Write-Host '        winget finished but node not in PATH. Trying MSI...' -ForegroundColor Yellow
                }
            } else {
                Write-Host "        winget exited with code $($proc.ExitCode). Trying MSI..." -ForegroundColor Yellow
            }
        } catch {
            Write-Host "        winget failed: $_  Trying MSI..." -ForegroundColor Yellow
        }
    } else {
        Write-Host '        winget not available. Using MSI download...' -ForegroundColor Yellow
    }

    # -- Method 2: Direct MSI download from nodejs.org --
    if (-not $installed) {
        Write-Host ''
        Write-Host '        Querying nodejs.org for latest v22 LTS...' -ForegroundColor Cyan

        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

            $index   = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
            $release = $index | Where-Object { $_.lts -and $_.version -match '^v22' } |
                       Select-Object -First 1

            if ($null -eq $release) {
                throw 'Could not find a v22 LTS release in the Node.js index.'
            }

            $version = $release.version
            $arch    = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
            $msiUrl  = "https://nodejs.org/dist/$version/node-$version-$arch.msi"
            $msiPath = Join-Path $env:TEMP 'node-install.msi'

            Write-Host "        Downloading Node.js $version ($arch)..." -ForegroundColor Cyan
            Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing

            Write-Host '        Running installer...' -ForegroundColor Cyan

            # Try silent install first
            $msi = Start-Process -FilePath 'msiexec.exe' `
                       -ArgumentList "/i `"$msiPath`" /qn /norestart" `
                       -Wait -PassThru -NoNewWindow
            if ($msi.ExitCode -ne 0) {
                Write-Host '        Silent install needs elevation - launching UI installer...' -ForegroundColor Yellow
                Start-Process -FilePath 'msiexec.exe' `
                    -ArgumentList "/i `"$msiPath`" /passive /norestart" `
                    -Wait -Verb RunAs
            }

            Remove-Item $msiPath -Force -ErrorAction SilentlyContinue

            Update-PathFromRegistry
            $env:Path = "$env:ProgramFiles\nodejs;$env:Path"

            if (Get-Command node -ErrorAction SilentlyContinue) {
                $nodeVer = & node --version 2>&1
                Write-Host "        Node.js $nodeVer installed." -ForegroundColor Green
                $installed = $true
            } else {
                throw 'MSI install finished but node is still not in PATH.'
            }
        } catch {
            Write-Host ''
            Write-Host "  ERROR: Node.js installation failed: $_" -ForegroundColor Red
            Write-Host '         Install Node.js manually from https://nodejs.org and re-run.' -ForegroundColor Red
            Write-Host ''
            Read-Host '  Press Enter to exit'
            exit 1
        }
    }
}

# -----------------------------------------------------------------------------
# STEP 2 - Verify the UI folder exists
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '  [2/5] Locating UI directory...' -ForegroundColor Cyan

if (-not (Test-Path $script:UiDir -PathType Container)) {
    Write-Host ''
    Write-Host "  ERROR: UI directory not found: $script:UiDir" -ForegroundColor Red
    Write-Host '         Make sure this script is in the DISGUISEBUDDY root folder.' -ForegroundColor Red
    Write-Host ''
    Read-Host '  Press Enter to exit'
    exit 1
}

Write-Host "        Found: $script:UiDir" -ForegroundColor Green

# -----------------------------------------------------------------------------
# STEP 3 - Kill stale processes BEFORE npm install
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '  [3/5] Clearing stale processes...' -ForegroundColor Cyan

# Kill stale node/tsx processes that lock files in node_modules
$staleProcs = Get-Process -Name 'node' -ErrorAction SilentlyContinue
if ($null -ne $staleProcs) {
    Write-Host "        Found $($staleProcs.Count) stale node process(es) - killing..." -ForegroundColor Yellow
    $staleProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
} else {
    Write-Host '        No stale node processes.' -ForegroundColor Green
}

# Also clear specific ports
foreach ($port in @(47100, 5173)) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($null -ne $conns) {
            $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($pid in $pids) {
                if ($pid -ne 0) {
                    Write-Host "        Killing process $pid on port $port" -ForegroundColor Yellow
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                }
            }
            Start-Sleep -Seconds 1
        }
    } catch {
        # Get-NetTCPConnection may not be available - that is fine
    }
}

Write-Host '        Ports clear.' -ForegroundColor Green

# -----------------------------------------------------------------------------
# STEP 4 - npm install
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '  [4/6] Checking npm dependencies...' -ForegroundColor Cyan

$nodeModules = Join-Path $script:UiDir 'node_modules'
$needsInstall = -not (Test-Path $nodeModules -PathType Container)

# Also check if tsx is missing (added in recent update)
if (-not $needsInstall) {
    $tsxCheck = Join-Path (Join-Path $nodeModules '.bin') 'tsx.cmd'
    if (-not (Test-Path $tsxCheck)) {
        Write-Host '        tsx missing - need to update dependencies...' -ForegroundColor Yellow
        $needsInstall = $true
    }
}

if ($needsInstall) {
    Write-Host '        Running npm install...' -ForegroundColor Yellow
    Write-Host ''
    try {
        $npmProc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'install' `
                       -WorkingDirectory $script:UiDir `
                       -Wait -PassThru -NoNewWindow
        if ($npmProc.ExitCode -ne 0) {
            # Retry with --force if access denied
            Write-Host ''
            Write-Host '        First attempt failed - retrying with --force...' -ForegroundColor Yellow
            $npmProc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'install', '--force' `
                           -WorkingDirectory $script:UiDir `
                           -Wait -PassThru -NoNewWindow
            if ($npmProc.ExitCode -ne 0) {
                throw "npm install --force exited with code $($npmProc.ExitCode)."
            }
        }
        Write-Host ''
        Write-Host '        Dependencies installed.' -ForegroundColor Green
    } catch {
        Write-Host ''
        Write-Host "  ERROR: npm install failed: $_" -ForegroundColor Red
        Write-Host '         Close VS Code and any other editors, then try again.' -ForegroundColor Yellow
        Write-Host ''
        Read-Host '  Press Enter to exit'
        exit 1
    }
} else {
    Write-Host '        Dependencies up to date.' -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# STEP 5 - Start background servers
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '  [5/6] Starting servers...' -ForegroundColor Cyan

# Resolve local binaries (Join-Path only takes 2 args in PS 5.1)
$binDir  = Join-Path (Join-Path $script:UiDir 'node_modules') '.bin'
$tsxBin  = Join-Path $binDir 'tsx.cmd'
$viteBin = Join-Path $binDir 'vite.cmd'

if (Test-Path $tsxBin) {
    $tsxArgs = @('electron/dev-server.ts')
} else {
    $tsxBin = 'npx.cmd'
    $tsxArgs = @('--yes', 'tsx', 'electron/dev-server.ts')
}

if (Test-Path $viteBin) {
    $viteArgs = $null
} else {
    $viteBin = 'npx.cmd'
    $viteArgs = @('vite')
}

# -- API server (port 47100) --
Write-Host '        Starting API server  (http://localhost:47100)...' -ForegroundColor Cyan
try {
    $script:ApiProcess = Start-Process -FilePath $tsxBin `
        -ArgumentList $tsxArgs `
        -WorkingDirectory $script:UiDir `
        -PassThru -NoNewWindow
} catch {
    Write-Host "  ERROR: Could not start API server: $_" -ForegroundColor Red
    Read-Host '  Press Enter to exit'
    exit 1
}

# -- Vite dev server (port 5173) --
Write-Host '        Starting Vite dev server (http://localhost:5173)...' -ForegroundColor Cyan
try {
    if ($null -ne $viteArgs) {
        $script:ViteProcess = Start-Process -FilePath $viteBin `
            -ArgumentList $viteArgs `
            -WorkingDirectory $script:UiDir `
            -PassThru -NoNewWindow
    } else {
        $script:ViteProcess = Start-Process -FilePath $viteBin `
            -WorkingDirectory $script:UiDir `
            -PassThru -NoNewWindow
    }
} catch {
    Write-Host "  ERROR: Could not start Vite server: $_" -ForegroundColor Red
    Stop-Servers
    Read-Host '  Press Enter to exit'
    exit 1
}

# -----------------------------------------------------------------------------
# STEP 6 - Wait for both servers to respond
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '  [6/6] Waiting for servers to be ready...' -ForegroundColor Cyan

$apiReady  = Wait-ForServer -Url 'http://localhost:47100/api/dashboard' `
                            -Label 'API server (port 47100)' `
                            -Process $script:ApiProcess
$viteReady = Wait-ForServer -Url 'http://localhost:5173/' `
                            -Label 'Vite dev server (port 5173)' `
                            -Process $script:ViteProcess

if (-not $apiReady -or -not $viteReady) {
    Write-Host ''
    Write-Host '  One or more servers failed to start. Check the output above.' -ForegroundColor Red
    Stop-Servers
    Read-Host '  Press Enter to exit'
    exit 1
}

# -----------------------------------------------------------------------------
# READY - open browser and keep running
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host '  ================================================' -ForegroundColor Green
Write-Host '       DISGUISE BUDDY IS RUNNING' -ForegroundColor Green
Write-Host '' -ForegroundColor Green
Write-Host '       UI  : http://localhost:5173' -ForegroundColor Green
Write-Host '       API : http://localhost:47100' -ForegroundColor Green
Write-Host '' -ForegroundColor Green
Write-Host '       Close this window or press Ctrl+C to stop' -ForegroundColor Green
Write-Host '  ================================================' -ForegroundColor Green
Write-Host ''

# Open the default browser
try {
    Start-Process 'http://localhost:5173'
} catch {
    Write-Host '  (Could not open browser - go to http://localhost:5173 manually)' -ForegroundColor Yellow
}

# -----------------------------------------------------------------------------
# KEEP ALIVE - wait for user to close the window
# -----------------------------------------------------------------------------
try {
    Write-Host '  Press Ctrl+C or close this window to stop.' -ForegroundColor DarkGray
    Write-Host ''

    while ($script:Running) {
        Start-Sleep -Seconds 5
    }
} finally {
    Stop-Servers
}
