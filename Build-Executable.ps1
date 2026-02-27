# Build-Executable.ps1
# DISGUISE BUDDY - Executable Build Script
#
# Run this on Windows with PowerShell 5.1+ in an Administrator session.
# It merges all .ps1 modules into a single compiled script, then packages
# it with ps12exe into a standalone .exe with UAC elevation and metadata.
#
# Usage:
#   .\Build-Executable.ps1
#   .\Build-Executable.ps1 -OutputDir "C:\MyBuilds"
#   .\Build-Executable.ps1 -SkipInstallCheck
#
# Output:
#   dist\
#     DisguiseBuddy.exe        <- double-click launcher
#     profiles\                <- shipped alongside exe (read/write at runtime)
#       Actor-01.json
#       ... (all 13 profiles)
#     DisguiseBuddy.bat        <- fallback launcher (no exe required)
#
# Prerequisites (installed automatically if missing):
#   ps12exe  (Install-Module ps12exe -Scope CurrentUser)

#Requires -Version 5.1

[CmdletBinding()]
param(
    # Where to write the finished build. Defaults to .\dist next to this script.
    [string]$OutputDir = (Join-Path $PSScriptRoot 'dist'),

    # Skip ps12exe availability check (useful if it is installed but not on PATH).
    [switch]$SkipInstallCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================================
# CONFIGURATION
# ============================================================================

$AppName        = 'DisguiseBuddy'
$AppVersion     = '1.0.0.0'
$AppDescription = 'DISGUISE BUDDY - Server Configuration Manager'
$AppCompany     = 'disguise'
$AppCopyright   = "Copyright $((Get-Date).Year) disguise"
$IconPath       = Join-Path $PSScriptRoot 'icon.ico'   # optional - skipped if absent
$MergedScript   = Join-Path $env:TEMP 'DisguiseBuddy_merged.ps1'
$ExeOutput      = Join-Path $OutputDir "$AppName.exe"

# Module load order matches DisguiseBuddy.ps1 dot-source order exactly.
$ModuleLoadOrder = @(
    'Theme.ps1'
    'UIComponents.ps1'
    'ProfileManager.ps1'
    'NetworkConfig.ps1'
    'SMBConfig.ps1'
    'ServerIdentity.ps1'
    'Discovery.ps1'
    'Dashboard.ps1'
)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Write-Step {
    param([string]$Message)
    Write-Host "`n  >> $Message" -ForegroundColor Cyan
}

function Write-OK {
    param([string]$Message)
    Write-Host "     OK  $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    Write-Host "     FAIL  $Message" -ForegroundColor Red
}

# ============================================================================
# STEP 1 - Verify ps12exe is available
# ============================================================================

Write-Step 'Checking for ps12exe'

if (-not $SkipInstallCheck) {
    if (-not (Get-Module -ListAvailable -Name ps12exe)) {
        Write-Host '     ps12exe not found. Installing from PSGallery...' -ForegroundColor Yellow

        # Ensure NuGet provider is available (required on fresh systems)
        $nuget = Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue
        if (-not $nuget -or $nuget.Version -lt [Version]'2.8.5.201') {
            Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
        }

        Install-Module -Name ps12exe -Scope CurrentUser -Force -AllowClobber
        Write-OK 'ps12exe installed'
    } else {
        Write-OK 'ps12exe already available'
    }
}

Import-Module ps12exe -ErrorAction Stop

# ============================================================================
# STEP 2 - Validate source files
# ============================================================================

Write-Step 'Validating source files'

$modulesDir  = Join-Path $PSScriptRoot 'modules'
$profilesDir = Join-Path $PSScriptRoot 'profiles'

foreach ($mod in $ModuleLoadOrder) {
    $path = Join-Path $modulesDir $mod
    if (-not (Test-Path $path)) {
        Write-Fail "Missing module: $path"
        exit 1
    }
}
Write-OK "All $($ModuleLoadOrder.Count) modules present"

$profiles = Get-ChildItem $profilesDir -Filter '*.json' -ErrorAction SilentlyContinue
if ($profiles.Count -eq 0) {
    Write-Fail "No .json profiles found in $profilesDir"
    exit 1
}
Write-OK "$($profiles.Count) profile(s) found"

# ============================================================================
# STEP 3 - Merge modules into a single .ps1
#
# ps12exe inlines the compiled script into the exe resource table. It cannot
# follow dot-source paths at compile time — the compiled exe has no filesystem
# layout to reference. The solution is to concatenate every module into one
# flat script before passing it to ps12exe.
#
# Path resolution fix:
#   $PSScriptRoot inside a compiled ps12exe refers to the directory containing
#   the .exe, which is exactly where we place the profiles/ folder. So the
#   normal Get-AppRootPath logic works as-is for Theme.ps1, Write-AppLog, etc.
#
#   ProfileManager.ps1 uses "$PSScriptRoot\.." which would be WRONG inside a
#   merged script (PSScriptRoot = modules/ in the source, but in a merged file
#   there is no modules/ — PSScriptRoot will be the exe's directory). We patch
#   that one call to use Get-AppRootPath instead.
#
# ============================================================================

Write-Step 'Merging modules into single script'

$sb = [System.Text.StringBuilder]::new()

# Header
[void]$sb.AppendLine('# DisguiseBuddy - Merged Build Script')
[void]$sb.AppendLine('# Generated by Build-Executable.ps1 on ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
[void]$sb.AppendLine('#Requires -Version 5.1')
[void]$sb.AppendLine('')

# ---- Inject $PSScriptRoot normalisation block ----
# When running as a compiled exe, ps12exe sets $PSScriptRoot to the exe's
# directory. We expose this as $script:AppRootPath so Get-AppRootPath (defined
# in Theme.ps1) returns the right value from the first call.
[void]$sb.AppendLine('# ---- Runtime path bootstrap (injected by build script) ----')
[void]$sb.AppendLine('if ($MyInvocation.MyCommand.CommandType -eq [System.Management.Automation.CommandTypes]::ExternalScript) {')
[void]$sb.AppendLine('    $script:AppRootPath = Split-Path -Parent $MyInvocation.MyCommand.Path')
[void]$sb.AppendLine('} elseif ($PSScriptRoot) {')
[void]$sb.AppendLine('    $script:AppRootPath = $PSScriptRoot')
[void]$sb.AppendLine('} else {')
[void]$sb.AppendLine('    $script:AppRootPath = (Get-Location).Path')
[void]$sb.AppendLine('}')
[void]$sb.AppendLine('')

# ---- Inline each module ----
foreach ($modFile in $ModuleLoadOrder) {
    $modPath    = Join-Path $modulesDir $modFile
    $modContent = Get-Content -Path $modPath -Raw -Encoding UTF8

    [void]$sb.AppendLine("# ============================================================")
    [void]$sb.AppendLine("# MODULE: $modFile")
    [void]$sb.AppendLine("# ============================================================")

    # Patch ProfileManager: replace the bad PSScriptRoot path with Get-AppRootPath
    # Original:  $profilesDir = Join-Path -Path "$PSScriptRoot\.." -ChildPath 'profiles'
    # Patched:   $profilesDir = Join-Path -Path (Get-AppRootPath) -ChildPath 'profiles'
    if ($modFile -eq 'ProfileManager.ps1') {
        $before = $modContent
        $modContent = $modContent -replace [regex]::Escape('Join-Path -Path "$PSScriptRoot\.." -ChildPath ''profiles'''),
                                           'Join-Path -Path (Get-AppRootPath) -ChildPath ''profiles'''
        if ($modContent -eq $before) {
            Write-Host "     WARNING: ProfileManager PSScriptRoot patch did not match. Verify Get-ProfilesDirectory manually." -ForegroundColor Yellow
        } else {
            Write-OK 'ProfileManager.ps1 path patched'
        }
    }

    # Patch NetworkConfig: replace profile import path
    # Original:  Join-Path (Split-Path $PSScriptRoot -Parent) 'profiles'
    # Patched:   Join-Path (Get-AppRootPath) 'profiles'
    if ($modFile -eq 'NetworkConfig.ps1') {
        $before = $modContent
        $modContent = $modContent -replace [regex]::Escape('Join-Path (Split-Path $PSScriptRoot -Parent) ''profiles'''),
                                           'Join-Path (Get-AppRootPath) ''profiles'''
        if ($modContent -eq $before) {
            Write-Host "     WARNING: NetworkConfig PSScriptRoot patch did not match. Verify profile import path manually." -ForegroundColor Yellow
        } else {
            Write-OK 'NetworkConfig.ps1 path patched'
        }
    }

    [void]$sb.AppendLine($modContent)
    [void]$sb.AppendLine('')
}

# ---- Inline main entry point (everything after the dot-source block) ----
$mainContent = Get-Content -Path (Join-Path $PSScriptRoot 'DisguiseBuddy.ps1') -Raw -Encoding UTF8

# Strip the dot-source lines — modules are now inline above.
# Also strip the $modulesPath declaration since it is no longer needed.
$mainContent = $mainContent -replace '(?m)^\$modulesPath\s*=.*$\n?', ''
$mainContent = $mainContent -replace '(?m)^\.\s+\(Join-Path\s+\$modulesPath\s+''[^'']+\.ps1''\)\s*$\n?', ''

[void]$sb.AppendLine("# ============================================================")
[void]$sb.AppendLine("# ENTRY POINT: DisguiseBuddy.ps1")
[void]$sb.AppendLine("# ============================================================")
[void]$sb.AppendLine($mainContent)

# Write merged script to temp
$mergedContent = $sb.ToString()
[System.IO.File]::WriteAllText($MergedScript, $mergedContent, [System.Text.Encoding]::UTF8)

Write-OK "Merged script written to $MergedScript ($([math]::Round((Get-Item $MergedScript).Length / 1KB))KB)"

# ============================================================================
# STEP 4 - Prepare output directory
# ============================================================================

Write-Step 'Preparing output directory'

if (Test-Path $OutputDir) {
    Remove-Item $OutputDir -Recurse -Force
}
New-Item -Path $OutputDir -ItemType Directory -Force | Out-Null

# Copy profiles directory (must ship alongside exe — writable at runtime)
$destProfiles = Join-Path $OutputDir 'profiles'
Copy-Item -Path $profilesDir -Destination $destProfiles -Recurse -Force
Write-OK "Copied profiles/ ($($profiles.Count) files)"

# Copy icon if present
if (Test-Path $IconPath) {
    Copy-Item -Path $IconPath -Destination (Join-Path $OutputDir 'icon.ico') -Force
    Write-OK 'Copied icon.ico'
}

# ============================================================================
# STEP 5 - Compile with ps12exe
# ============================================================================

Write-Step 'Compiling with ps12exe'

$compileParams = @{
    inputFile       = $MergedScript
    outputFile      = $ExeOutput
    requireAdmin    = $true        # Embeds UAC manifest: requestedExecutionLevel = requireAdministrator
    noConsole       = $true        # Hides the console window (GUI app)
    title           = $AppName
    description     = $AppDescription
    version         = $AppVersion
    company         = $AppCompany
    copyright       = $AppCopyright
    product         = $AppName
    # x64 is correct for disguise servers; change to x86 only if targeting 32-bit systems
    x64             = $true
    # DPI-aware manifest entry so the form renders crisp on high-DPI displays
    DPIAware        = $true
}

if (Test-Path $IconPath) {
    $compileParams['iconFile'] = $IconPath
}

try {
    Invoke-ps2exe @compileParams
    Write-OK "Compiled: $ExeOutput"
} catch {
    Write-Fail "Compilation failed: $_"
    exit 1
}

# ============================================================================
# STEP 6 - Write fallback .bat launcher
#
# The .bat is a zero-dependency fallback: no compilation needed, works on any
# Windows machine with PowerShell 5.1. Also useful for troubleshooting when
# the exe behaves unexpectedly — run the .bat to see console output.
# ============================================================================

Write-Step 'Writing .bat fallback launcher'

$batPath    = Join-Path $OutputDir "$AppName.bat"
$batContent = @'
@echo off
:: DISGUISE BUDDY - Fallback Launcher
:: Requires PowerShell 5.1+ and Administrator privileges.
:: Use this if the .exe fails or for troubleshooting (console output is visible).

:: Check if already elevated
net session >nul 2>&1
if %errorLevel% == 0 (
    goto :run
) else (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0DisguiseBuddy.ps1"
'@

[System.IO.File]::WriteAllText($batPath, $batContent, [System.Text.Encoding]::ASCII)
Write-OK "Written: $batPath"

# Also copy the source .ps1 so the .bat can find it in the same dist/ folder
Copy-Item -Path (Join-Path $PSScriptRoot 'DisguiseBuddy.ps1') -Destination (Join-Path $OutputDir 'DisguiseBuddy.ps1') -Force
# Copy modules/ so the .bat-based launcher can dot-source them
$destModules = Join-Path $OutputDir 'modules'
Copy-Item -Path $modulesDir -Destination $destModules -Recurse -Force
Write-OK 'Copied source .ps1 and modules/ for .bat fallback'

# ============================================================================
# STEP 7 - Cleanup and summary
# ============================================================================

Remove-Item $MergedScript -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '  BUILD COMPLETE' -ForegroundColor Green
Write-Host ''
Write-Host "  Output directory : $OutputDir"
Write-Host ''
Write-Host '  Contents:'
Get-ChildItem $OutputDir | ForEach-Object {
    $size = if ($_.PSIsContainer) { "(dir)" } else { "$([math]::Round($_.Length / 1KB))KB" }
    Write-Host "    $($_.Name.PadRight(30)) $size"
}
Write-Host ''
Write-Host '  Distribute the entire dist\ folder — the .exe requires profiles\ alongside it.'
Write-Host '  Users double-click DisguiseBuddy.exe; Windows UAC will prompt for elevation.'
Write-Host ''
