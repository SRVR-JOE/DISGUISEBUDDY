# COMPILE.ps1 - Run this on Windows to compile the merged script into an .exe
# Usage: .\COMPILE.ps1
#Requires -Version 5.1

$ErrorActionPreference = 'Stop'

Write-Host "`nDISGUISE BUDDY - Compile to EXE`n" -ForegroundColor Cyan

# Install ps12exe if needed
if (-not (Get-Module -ListAvailable -Name ps12exe)) {
    Write-Host "Installing ps12exe..." -ForegroundColor Yellow
    $nuget = Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue
    if (-not $nuget -or $nuget.Version -lt [Version]'2.8.5.201') {
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
    }
    Install-Module -Name ps12exe -Scope CurrentUser -Force -AllowClobber
}

Import-Module ps12exe -ErrorAction Stop

$mergedScript = Join-Path $PSScriptRoot 'DisguiseBuddy-merged.ps1'
$exeOutput = Join-Path $PSScriptRoot 'DisguiseBuddy.exe'
$iconPath = Join-Path $PSScriptRoot 'icon.ico'

if (-not (Test-Path $mergedScript)) {
    Write-Error "DisguiseBuddy-merged.ps1 not found in $PSScriptRoot"
}

$params = @{
    inputFile    = $mergedScript
    outputFile   = $exeOutput
    requireAdmin = $true
    noConsole    = $true
    title        = 'DisguiseBuddy'
    description  = 'DISGUISE BUDDY - Server Configuration Manager'
    version      = '1.0.0.0'
    company      = 'disguise'
    copyright    = "Copyright $((Get-Date).Year)"
    product      = 'DisguiseBuddy'
    x64          = $true
    DPIAware     = $true
}

if (Test-Path $iconPath) { $params['iconFile'] = $iconPath }

Write-Host "Compiling..." -ForegroundColor Yellow
Invoke-ps2exe @params

if (Test-Path $exeOutput) {
    $size = [math]::Round((Get-Item $exeOutput).Length / 1MB, 1)
    Write-Host "`nSUCCESS: DisguiseBuddy.exe ($size MB)" -ForegroundColor Green
    Write-Host "Double-click to run (UAC will prompt for admin)`n" -ForegroundColor White
} else {
    Write-Error "Compilation failed - no .exe produced"
}
