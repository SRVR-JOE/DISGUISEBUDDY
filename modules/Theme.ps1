# Theme.ps1 - DISGUISE BUDDY Theme System

# Dark theme (default)
$script:DarkTheme = @{
    Background      = [System.Drawing.ColorTranslator]::FromHtml('#1E1E2E')
    Surface         = [System.Drawing.ColorTranslator]::FromHtml('#2A2A3C')
    SurfaceLight    = [System.Drawing.ColorTranslator]::FromHtml('#363650')
    Primary         = [System.Drawing.ColorTranslator]::FromHtml('#7C3AED')
    PrimaryLight    = [System.Drawing.ColorTranslator]::FromHtml('#8B5CF6')
    PrimaryDark     = [System.Drawing.ColorTranslator]::FromHtml('#6D28D9')
    Accent          = [System.Drawing.ColorTranslator]::FromHtml('#06B6D4')
    Text            = [System.Drawing.ColorTranslator]::FromHtml('#E2E8F0')
    TextSecondary   = [System.Drawing.ColorTranslator]::FromHtml('#94A3B8')
    TextMuted       = [System.Drawing.ColorTranslator]::FromHtml('#64748B')
    Success         = [System.Drawing.ColorTranslator]::FromHtml('#10B981')
    Warning         = [System.Drawing.ColorTranslator]::FromHtml('#F59E0B')
    Error           = [System.Drawing.ColorTranslator]::FromHtml('#EF4444')
    ErrorLight      = [System.Drawing.ColorTranslator]::FromHtml('#F87171')
    Border          = [System.Drawing.ColorTranslator]::FromHtml('#3F3F5C')
    NavBackground   = [System.Drawing.ColorTranslator]::FromHtml('#16162A')
    NavHover        = [System.Drawing.ColorTranslator]::FromHtml('#2A2A3C')
    NavActive       = [System.Drawing.ColorTranslator]::FromHtml('#7C3AED')
    CardBackground  = [System.Drawing.ColorTranslator]::FromHtml('#232338')
    InputBackground = [System.Drawing.ColorTranslator]::FromHtml('#1A1A2E')
}

# Light theme
$script:LightTheme = @{
    Background      = [System.Drawing.ColorTranslator]::FromHtml('#F8FAFC')
    Surface         = [System.Drawing.ColorTranslator]::FromHtml('#FFFFFF')
    SurfaceLight    = [System.Drawing.ColorTranslator]::FromHtml('#F1F5F9')
    Primary         = [System.Drawing.ColorTranslator]::FromHtml('#7C3AED')
    PrimaryLight    = [System.Drawing.ColorTranslator]::FromHtml('#8B5CF6')
    PrimaryDark     = [System.Drawing.ColorTranslator]::FromHtml('#6D28D9')
    Accent          = [System.Drawing.ColorTranslator]::FromHtml('#0891B2')
    Text            = [System.Drawing.ColorTranslator]::FromHtml('#1E293B')
    TextSecondary   = [System.Drawing.ColorTranslator]::FromHtml('#475569')
    TextMuted       = [System.Drawing.ColorTranslator]::FromHtml('#94A3B8')
    Success         = [System.Drawing.ColorTranslator]::FromHtml('#059669')
    Warning         = [System.Drawing.ColorTranslator]::FromHtml('#D97706')
    Error           = [System.Drawing.ColorTranslator]::FromHtml('#DC2626')
    ErrorLight      = [System.Drawing.ColorTranslator]::FromHtml('#EF4444')
    Border          = [System.Drawing.ColorTranslator]::FromHtml('#E2E8F0')
    NavBackground   = [System.Drawing.ColorTranslator]::FromHtml('#FFFFFF')
    NavHover        = [System.Drawing.ColorTranslator]::FromHtml('#F1F5F9')
    NavActive       = [System.Drawing.ColorTranslator]::FromHtml('#7C3AED')
    CardBackground  = [System.Drawing.ColorTranslator]::FromHtml('#FFFFFF')
    InputBackground = [System.Drawing.ColorTranslator]::FromHtml('#F8FAFC')
}

# Current active theme
$script:Theme = $script:DarkTheme

function Set-AppTheme {
    param([string]$ThemeName)
    if ($ThemeName -eq 'Light') {
        $script:Theme = $script:LightTheme
    } else {
        $script:Theme = $script:DarkTheme
    }
}

function Get-AppTheme {
    return $script:Theme
}

function Write-AppLog {
    <#
    .SYNOPSIS
        Writes a timestamped log message to the DISGUISE BUDDY log file.
    .DESCRIPTION
        Appends a formatted log entry with timestamp and severity level to
        logs/disguisebuddy.log relative to the script root directory.
    .PARAMETER Message
        The log message text to write.
    .PARAMETER Level
        The severity level of the log entry. Valid values: INFO, WARN, ERROR, DEBUG.
        Defaults to INFO.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [Parameter(Mandatory = $false)]
        [ValidateSet('INFO', 'WARN', 'ERROR', 'DEBUG')]
        [string]$Level = 'INFO'
    )

    # Use cached log path to avoid recalculating on every call
    if (-not $script:LogFilePath) {
        $scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { $PWD.Path }
        # If we're inside /modules, go up one level to the project root
        if ((Split-Path -Leaf $scriptRoot) -eq 'modules') { $scriptRoot = Split-Path -Parent $scriptRoot }
        $logDir = Join-Path -Path $scriptRoot -ChildPath 'logs'
        if (-not (Test-Path -Path $logDir)) {
            New-Item -Path $logDir -ItemType Directory -Force | Out-Null
        }
        $script:LogFilePath = Join-Path -Path $logDir -ChildPath 'disguisebuddy.log'
    }
    $logFile = $script:LogFilePath

    # Format the log entry with timestamp, level, and message
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    $logEntry = "[$timestamp] [$Level] $Message"

    # Rotate log if it exceeds 10 MB
    if (Test-Path -Path $logFile) {
        $logSize = (Get-Item -Path $logFile -ErrorAction SilentlyContinue).Length
        if ($logSize -gt 10MB) {
            $archivePath = "$logFile.1"
            try {
                if (Test-Path $archivePath) { Remove-Item $archivePath -Force }
                Rename-Item -Path $logFile -NewName (Split-Path $archivePath -Leaf) -Force
            } catch {
                # Rotation failed; continue writing to current log
            }
        }
    }

    # Append the entry to the log file
    # Retry with short delay to handle transient file lock contention
    $maxRetries = 2
    for ($attempt = 0; $attempt -le $maxRetries; $attempt++) {
        try {
            Add-Content -Path $logFile -Value $logEntry -Encoding UTF8 -ErrorAction Stop
            break
        } catch {
            if ($attempt -eq $maxRetries) {
                Write-Warning "Failed to write to log file: $_"
            } else {
                Start-Sleep -Milliseconds 50
            }
        }
    }
}
