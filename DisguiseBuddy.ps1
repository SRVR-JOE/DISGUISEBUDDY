# DisguiseBuddy.ps1 - DISGUISE BUDDY Server Configuration Manager
# Main application entry point
# Version 1.0

#Requires -Version 5.1

# ============================================================================
# INITIALIZATION
# ============================================================================

# Load Windows Forms and Drawing assemblies
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Enable visual styles for modern look
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

# Set DPI awareness for high-DPI displays
try {
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    public class DPIAware {
        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();
    }
"@
    [DPIAware]::SetProcessDPIAware() | Out-Null
} catch {
    # Non-critical - continue without DPI awareness
}

# ============================================================================
# DOT-SOURCE MODULES (order matters: Theme -> UIComponents -> everything else)
# ============================================================================

$modulesPath = Join-Path -Path $PSScriptRoot -ChildPath 'modules'

# Foundation modules (must load first)
. (Join-Path $modulesPath 'Theme.ps1')
. (Join-Path $modulesPath 'UIComponents.ps1')

# Feature modules (order doesn't matter)
. (Join-Path $modulesPath 'ProfileManager.ps1')
. (Join-Path $modulesPath 'NetworkConfig.ps1')
. (Join-Path $modulesPath 'SMBConfig.ps1')
. (Join-Path $modulesPath 'ServerIdentity.ps1')
. (Join-Path $modulesPath 'Discovery.ps1')
. (Join-Path $modulesPath 'SoftwareInstaller.ps1')
. (Join-Path $modulesPath 'Dashboard.ps1')

Write-AppLog -Message 'DISGUISE BUDDY starting up' -Level 'INFO'

# ============================================================================
# APPLICATION STATE
# ============================================================================

if (-not $script:AppState) {
    $script:AppState = @{
        LastAppliedProfile = ''
        LastScanResults    = @()
        CurrentView        = 'Dashboard'
    }
}

# ============================================================================
# MAIN FORM
# ============================================================================

$mainForm = New-Object System.Windows.Forms.Form
$mainForm.Text = 'DISGUISE BUDDY - Server Configuration Manager'
$mainForm.Size = New-Object System.Drawing.Size(1280, 850)
$mainForm.MinimumSize = New-Object System.Drawing.Size(1100, 700)
$mainForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$mainForm.BackColor = $script:Theme.Background
$mainForm.ForeColor = $script:Theme.Text
$mainForm.Font = New-Object System.Drawing.Font('Segoe UI', 10)

# Remove default Windows title bar style for a cleaner look
$mainForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable

# Set application icon (if available)
try {
    $iconPath = Join-Path $PSScriptRoot 'icon.ico'
    if (Test-Path $iconPath) {
        $mainForm.Icon = New-Object System.Drawing.Icon($iconPath)
    }
} catch { }

# ============================================================================
# NAVIGATION SIDEBAR (Left Panel - 250px)
# ============================================================================

$navPanel = New-Object System.Windows.Forms.Panel
$navPanel.Dock = [System.Windows.Forms.DockStyle]::Left
$navPanel.Width = 250
$navPanel.BackColor = $script:Theme.NavBackground
$navPanel.Padding = New-Object System.Windows.Forms.Padding(0)

# --- App title/logo area at top of nav ---
$logoPanel = New-Object System.Windows.Forms.Panel
$logoPanel.Dock = [System.Windows.Forms.DockStyle]::Top
$logoPanel.Height = 80
$logoPanel.BackColor = $script:Theme.NavBackground
$logoPanel.Padding = New-Object System.Windows.Forms.Padding(15, 15, 15, 10)

$appTitleLabel = New-Object System.Windows.Forms.Label
$appTitleLabel.Text = 'DISGUISE BUDDY'
$appTitleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$appTitleLabel.ForeColor = $script:Theme.Primary
$appTitleLabel.Location = New-Object System.Drawing.Point(15, 15)
$appTitleLabel.AutoSize = $true
$logoPanel.Controls.Add($appTitleLabel)

$appSubtitleLabel = New-Object System.Windows.Forms.Label
$appSubtitleLabel.Text = 'Server Configuration Manager'
$appSubtitleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
$appSubtitleLabel.ForeColor = $script:Theme.TextMuted
$appSubtitleLabel.Location = New-Object System.Drawing.Point(15, 45)
$appSubtitleLabel.AutoSize = $true
$logoPanel.Controls.Add($appSubtitleLabel)

$navPanel.Controls.Add($logoPanel)

# --- Separator line under logo ---
$navSeparator = New-Object System.Windows.Forms.Panel
$navSeparator.Dock = [System.Windows.Forms.DockStyle]::Top
$navSeparator.Height = 1
$navSeparator.BackColor = $script:Theme.Border
$navPanel.Controls.Add($navSeparator)

# --- Navigation buttons container ---
$navButtonsPanel = New-Object System.Windows.Forms.Panel
$navButtonsPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$navButtonsPanel.BackColor = $script:Theme.NavBackground
$navButtonsPanel.Padding = New-Object System.Windows.Forms.Padding(0, 10, 0, 0)
$navPanel.Controls.Add($navButtonsPanel)

# --- Theme toggle at bottom of nav ---
$navBottomPanel = New-Object System.Windows.Forms.Panel
$navBottomPanel.Dock = [System.Windows.Forms.DockStyle]::Bottom
$navBottomPanel.Height = 90
$navBottomPanel.BackColor = $script:Theme.NavBackground

$themeToggleBtn = New-Object System.Windows.Forms.Button
$themeToggleBtn.Text = 'Toggle Theme'
$themeToggleBtn.Location = New-Object System.Drawing.Point(15, 10)
$themeToggleBtn.Size = New-Object System.Drawing.Size(220, 30)
$themeToggleBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$themeToggleBtn.FlatAppearance.BorderSize = 1
$themeToggleBtn.FlatAppearance.BorderColor = $script:Theme.Border
$themeToggleBtn.BackColor = $script:Theme.NavBackground
$themeToggleBtn.ForeColor = $script:Theme.TextMuted
$themeToggleBtn.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
$themeToggleBtn.Cursor = [System.Windows.Forms.Cursors]::Hand

$versionLabel = New-Object System.Windows.Forms.Label
$versionLabel.Text = 'v1.0 | disguise Configuration Tool'
$versionLabel.Font = New-Object System.Drawing.Font('Segoe UI', 7.5)
$versionLabel.ForeColor = $script:Theme.TextMuted
$versionLabel.Location = New-Object System.Drawing.Point(15, 50)
$versionLabel.AutoSize = $true

$navBottomPanel.Controls.Add($themeToggleBtn)
$navBottomPanel.Controls.Add($versionLabel)
$navPanel.Controls.Add($navBottomPanel)

# ============================================================================
# CONTENT PANEL (Right side - fills remaining space)
# ============================================================================

$contentPanel = New-Object System.Windows.Forms.Panel
$contentPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$contentPanel.BackColor = $script:Theme.Background
$contentPanel.Padding = New-Object System.Windows.Forms.Padding(20)

# ============================================================================
# NAVIGATION BUTTON CREATION
# ============================================================================

# Navigation item definitions: Name, DisplayText, Unicode symbol
$navItems = @(
    @{ Name = 'Dashboard';      Display = 'Dashboard';           Symbol = [char]0x25A0 }  # ■
    @{ Name = 'Profiles';       Display = 'Profiles';            Symbol = [char]0x25C6 }  # ◆
    @{ Name = 'Network';        Display = 'Network Adapters';    Symbol = [char]0x25CB }  # ○
    @{ Name = 'SMB';            Display = 'SMB Sharing';         Symbol = [char]0x25A1 }  # □
    @{ Name = 'ServerIdentity'; Display = 'Server Identity';     Symbol = [char]0x25B6 }  # ▶
    @{ Name = 'Deploy';         Display = 'Network Deploy';      Symbol = [char]0x25C7 }  # ◇
    @{ Name = 'Software';       Display = 'Software Installer';  Symbol = [char]0x25B2 }  # ▲
)

# Store nav buttons for state management
$script:NavButtons = @{}

# Function to create a navigation button
function New-NavButton {
    param(
        [string]$Name,
        [string]$DisplayText,
        [char]$Symbol,
        [int]$YPosition
    )

    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = "  $Symbol  $DisplayText"
    $btn.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $btn.Location = New-Object System.Drawing.Point(0, $YPosition)
    $btn.Size = New-Object System.Drawing.Size(250, 42)
    $btn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $btn.FlatAppearance.BorderSize = 0
    $btn.FlatAppearance.MouseOverBackColor = $script:Theme.NavHover
    $btn.BackColor = $script:Theme.NavBackground
    $btn.ForeColor = $script:Theme.TextSecondary
    $btn.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $btn.Cursor = [System.Windows.Forms.Cursors]::Hand
    $btn.Tag = $Name

    # Hover effects
    $btn.Add_MouseEnter({
        if ($this.Tag -ne $script:AppState.CurrentView) {
            $this.BackColor = $script:Theme.NavHover
            $this.ForeColor = $script:Theme.Text
        }
    })
    $btn.Add_MouseLeave({
        if ($this.Tag -ne $script:AppState.CurrentView) {
            $this.BackColor = $script:Theme.NavBackground
            $this.ForeColor = $script:Theme.TextSecondary
        }
    })

    return $btn
}

# Create navigation buttons
$yPos = 5
foreach ($item in $navItems) {
    $navBtn = New-NavButton -Name $item.Name -DisplayText $item.Display -Symbol $item.Symbol -YPosition $yPos
    $script:NavButtons[$item.Name] = $navBtn
    $navButtonsPanel.Controls.Add($navBtn)
    $yPos += 44
}

# ============================================================================
# VIEW SWITCHING LOGIC
# ============================================================================

function Set-ActiveView {
    param([string]$ViewName)

    # Update visual state of nav buttons
    foreach ($key in $script:NavButtons.Keys) {
        $btn = $script:NavButtons[$key]
        if ($key -eq $ViewName) {
            # Active button styling
            $btn.BackColor = $script:Theme.NavActive
            $btn.ForeColor = [System.Drawing.Color]::White
            $btn.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
        } else {
            # Inactive button styling
            $btn.BackColor = $script:Theme.NavBackground
            $btn.ForeColor = $script:Theme.TextSecondary
            $btn.Font = New-Object System.Drawing.Font('Segoe UI', 10)
        }
    }

    # Update state
    $script:AppState.CurrentView = $ViewName

    # Load the requested view into the content panel
    $contentPanel.SuspendLayout()
    $contentPanel.Controls.Clear()

    # Create an inner panel that respects padding
    $innerPanel = New-Object System.Windows.Forms.Panel
    $innerPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
    $innerPanel.BackColor = $script:Theme.Background
    $innerPanel.AutoScroll = $true
    $contentPanel.Controls.Add($innerPanel)

    switch ($ViewName) {
        'Dashboard'      { New-DashboardView -ContentPanel $innerPanel }
        'Profiles'       { New-ProfilesView -ContentPanel $innerPanel }
        'Network'        { New-NetworkView -ContentPanel $innerPanel }
        'SMB'            { New-SMBView -ContentPanel $innerPanel }
        'ServerIdentity' { New-ServerIdentityView -ContentPanel $innerPanel }
        'Deploy'         { New-DeployView -ContentPanel $innerPanel }
        'Software'       { New-SoftwareInstallerView -ContentPanel $innerPanel }
    }

    $contentPanel.ResumeLayout()

    Write-AppLog -Message "Switched to view: $ViewName" -Level 'DEBUG'
}

# Wire up click events for each nav button
foreach ($key in $script:NavButtons.Keys) {
    $btn = $script:NavButtons[$key]
    $btn.Add_Click({
        Set-ActiveView -ViewName $this.Tag
    })
}

# ============================================================================
# THEME TOGGLE
# ============================================================================

$themeToggleBtn.Add_Click({
    if ($script:Theme -eq $script:DarkTheme) {
        Set-AppTheme -ThemeName 'Light'
    } else {
        Set-AppTheme -ThemeName 'Dark'
    }

    # Refresh the entire UI with new theme colors
    $mainForm.BackColor = $script:Theme.Background
    $mainForm.ForeColor = $script:Theme.Text
    $navPanel.BackColor = $script:Theme.NavBackground
    $logoPanel.BackColor = $script:Theme.NavBackground
    $appTitleLabel.ForeColor = $script:Theme.Primary
    $appSubtitleLabel.ForeColor = $script:Theme.TextMuted
    $navSeparator.BackColor = $script:Theme.Border
    $navButtonsPanel.BackColor = $script:Theme.NavBackground
    $navBottomPanel.BackColor = $script:Theme.NavBackground
    $themeToggleBtn.BackColor = $script:Theme.NavBackground
    $themeToggleBtn.ForeColor = $script:Theme.TextMuted
    $themeToggleBtn.FlatAppearance.BorderColor = $script:Theme.Border
    $versionLabel.ForeColor = $script:Theme.TextMuted
    $contentPanel.BackColor = $script:Theme.Background

    # Re-render current view with new theme
    Set-ActiveView -ViewName $script:AppState.CurrentView

    Write-AppLog -Message "Theme toggled to: $(if ($script:Theme -eq $script:DarkTheme) { 'Dark' } else { 'Light' })" -Level 'INFO'
})

# ============================================================================
# FORM ASSEMBLY
# ============================================================================

# Add panels to form (order matters for docking)
$mainForm.Controls.Add($contentPanel)  # Fill - must be added first
$mainForm.Controls.Add($navPanel)      # Left dock

# ============================================================================
# STARTUP
# ============================================================================

# Load default view
Set-ActiveView -ViewName 'Dashboard'

# Handle form closing
$mainForm.Add_FormClosing({
    Write-AppLog -Message 'DISGUISE BUDDY shutting down' -Level 'INFO'
})

# Handle resize for responsive layout
$mainForm.Add_Resize({
    # Re-render current view on significant resize
    if ($mainForm.WindowState -ne [System.Windows.Forms.FormWindowState]::Minimized) {
        # Views will auto-adjust via docking/anchoring
    }
})

Write-AppLog -Message 'DISGUISE BUDDY initialized successfully' -Level 'INFO'

# ============================================================================
# RUN APPLICATION
# ============================================================================

[System.Windows.Forms.Application]::Run($mainForm)
