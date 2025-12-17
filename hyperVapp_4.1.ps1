# ============================================================================
# Hyper-V Network Manager - Version 3.0 - FIXED
# Purpose: Manage Hyper-V VLANs and NICs with comprehensive validation
# ============================================================================

# Platform compatibility check
if (-not ([System.Environment]::OSVersion.Platform -eq 'Win32NT')) {
    Write-Error "This script requires Windows. Current platform: $([System.Environment]::OSVersion.Platform)"
    exit 1
}

# Auto-elevate if not running as Administrator
If (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $myArgs = "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Start-Process powershell -Verb runAs -ArgumentList $myArgs
    exit
}

# Import required assemblies
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ============================================================================
# Global Variables and Configuration
# ============================================================================
$script:DebugMode = $false
$script:LogFile = Join-Path $PSScriptRoot "hyperv_debug.log"

# Initialize ToolTip control
$script:toolTip = New-Object System.Windows.Forms.ToolTip

# Modern UI Theme Configuration
$script:CurrentTheme = "Dark"  # "Dark" or "Light"
$script:Themes = @{
    Dark = @{
        Background = [System.Drawing.Color]::FromArgb(45, 45, 48)
        Surface = [System.Drawing.Color]::FromArgb(37, 37, 38)
        Primary = [System.Drawing.Color]::FromArgb(0, 122, 204)
        Secondary = [System.Drawing.Color]::FromArgb(104, 104, 104)
        Text = [System.Drawing.Color]::White
        TextSecondary = [System.Drawing.Color]::FromArgb(200, 200, 200)
        Accent = [System.Drawing.Color]::FromArgb(0, 153, 255)
        Success = [System.Drawing.Color]::FromArgb(76, 175, 80)
        Warning = [System.Drawing.Color]::FromArgb(255, 152, 0)
        Error = [System.Drawing.Color]::FromArgb(244, 67, 54)
        GridHeader = [System.Drawing.Color]::FromArgb(60, 60, 60)
        GridAlternate = [System.Drawing.Color]::FromArgb(50, 50, 52)
        GridSelection = [System.Drawing.Color]::FromArgb(0, 122, 204)
        Border = [System.Drawing.Color]::FromArgb(68, 68, 70)
    }
    Light = @{
        Background = [System.Drawing.Color]::FromArgb(250, 250, 250)
        Surface = [System.Drawing.Color]::White
        Primary = [System.Drawing.Color]::FromArgb(0, 122, 204)
        Secondary = [System.Drawing.Color]::FromArgb(108, 117, 125)
        Text = [System.Drawing.Color]::FromArgb(33, 37, 41)
        TextSecondary = [System.Drawing.Color]::FromArgb(108, 117, 125)
        Accent = [System.Drawing.Color]::FromArgb(0, 123, 255)
        Success = [System.Drawing.Color]::FromArgb(40, 167, 69)
        Warning = [System.Drawing.Color]::FromArgb(255, 193, 7)
        Error = [System.Drawing.Color]::FromArgb(220, 53, 69)
        GridHeader = [System.Drawing.Color]::FromArgb(233, 236, 239)
        GridAlternate = [System.Drawing.Color]::FromArgb(248, 249, 250)
        GridSelection = [System.Drawing.Color]::FromArgb(0, 122, 204)
        Border = [System.Drawing.Color]::FromArgb(222, 226, 230)
    }
}

# Global hashtable for custom VLAN names - Exact match to IPSCHEME.csv
$script:CustomVLANNames = @{
    # Core Infrastructure VLANs (1-100) - Direct mapping from IPSCHEME.csv
    1 = "Management"
    2 = "AVB (Dynamic audio VLAN)"
    3 = "Internet from Solotech"
    4 = "VPN access"
    10 = "D3 Net"
    11 = "OmniCal"
    12 = "Designers"
    13 = "CUE PILOT"
    20 = "Media (Content)"
    30 = "NDI"
    40 = "KVM"
    50 = "ST-2110/AES67"
    60 = "CAMERA SYSTEM (Flypacks)"
    100 = "Control Video"
    
    # High VLANs (200-2000) - Group mapping from IPSCHEME.csv
    200 = "MA-Net 2 (sACN, PSN)"
    300 = "ART Net"
    400 = "MA-Net 3"
    500 = "P3 Net (Sceptron)"
    600 = "Camera (CCTV/RoboCAM)"
    700 = "Dante Timecode"
    800 = "NDI"
    1000 = "Control LX"
    1100 = "AVB"
    1200 = "COMM/AES67/Riedel"
    1300 = "Dante Primary"
    1400 = "Dante Secondary"
    2000 = "INTERNET from the venue"
}

# ============================================================================
# Utility Functions
# ============================================================================

function Get-ThemeColor {
    param([string]$ColorName)
    return $script:Themes[$script:CurrentTheme][$ColorName]
}

function Set-ModernTheme {
    param([string]$ThemeName = "Dark")
    $script:CurrentTheme = $ThemeName
    Write-Log "Theme changed to: $ThemeName" -Severity Information
}

function Set-ModernStyling {
    param([System.Windows.Forms.Control]$Control)
    
    $currentTheme = $script:Themes[$script:CurrentTheme]
    
    switch ($Control.GetType().Name) {
        "Form" {
            $Control.BackColor = $currentTheme.Background
            $Control.ForeColor = $currentTheme.Text
        }
        "GroupBox" {
            $Control.BackColor = $currentTheme.Background
            $Control.ForeColor = $currentTheme.Text
            $Control.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
        }
        "Label" {
            $Control.BackColor = $currentTheme.Background
            $Control.ForeColor = $currentTheme.Text
        }
        "TextBox" {
            $Control.BackColor = $currentTheme.Surface
            $Control.ForeColor = $currentTheme.Text
            $Control.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
        }
        "ComboBox" {
            $Control.BackColor = $currentTheme.Surface
            $Control.ForeColor = $currentTheme.Text
            $Control.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
        }
        "Button" {
            $Control.BackColor = $currentTheme.Primary
            $Control.ForeColor = [System.Drawing.Color]::White
            $Control.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
            $Control.FlatAppearance.BorderSize = 0
            $Control.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
        }
        "DataGridView" {
            Set-ModernDataGridStyling $Control
        }
        "RichTextBox" {
            $Control.BackColor = $currentTheme.Surface
            $Control.ForeColor = $currentTheme.Text
            $Control.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
        }
        "Panel" {
            $Control.BackColor = $currentTheme.Surface
        }
    }
    
    # Apply to all child controls recursively
    foreach ($child in $Control.Controls) {
        Set-ModernStyling $child
    }
}

function Set-ModernDataGridStyling {
    param([System.Windows.Forms.DataGridView]$DataGrid)
    
    $theme = $script:Themes[$script:CurrentTheme]
    
    # Basic styling
    $DataGrid.BackgroundColor = $theme.Background
    $DataGrid.ForeColor = $theme.Text
    $DataGrid.GridColor = $theme.Border
    $DataGrid.BorderStyle = [System.Windows.Forms.BorderStyle]::None
    $DataGrid.CellBorderStyle = [System.Windows.Forms.DataGridViewCellBorderStyle]::SingleHorizontal
    
    # Header styling with enhanced readability
    $DataGrid.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(52, 58, 64)  # Dark gray
    $DataGrid.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::White  # White text
    $DataGrid.ColumnHeadersDefaultCellStyle.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)  # Larger font
    $DataGrid.ColumnHeadersDefaultCellStyle.Alignment = [System.Windows.Forms.DataGridViewContentAlignment]::MiddleLeft
    $DataGrid.ColumnHeadersDefaultCellStyle.Padding = New-Object System.Windows.Forms.Padding(10, 8, 10, 8)
    $DataGrid.ColumnHeadersHeight = 40  # Increased height
    $DataGrid.ColumnHeadersBorderStyle = [System.Windows.Forms.DataGridViewHeaderBorderStyle]::Single
    
    # Row styling with better contrast
    $DataGrid.DefaultCellStyle.BackColor = [System.Drawing.Color]::White
    $DataGrid.DefaultCellStyle.ForeColor = [System.Drawing.Color]::Black
    $DataGrid.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(0, 123, 255)  # Bright blue
    $DataGrid.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
    $DataGrid.DefaultCellStyle.Font = New-Object System.Drawing.Font("Segoe UI", 10)  # Larger font
    $DataGrid.DefaultCellStyle.Padding = New-Object System.Windows.Forms.Padding(8, 6, 8, 6)
    $DataGrid.RowTemplate.Height = 36  # Increased row height
    
    # Alternating row colors with high contrast
    $DataGrid.AlternatingRowsDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(248, 249, 250)  # Light gray
    $DataGrid.AlternatingRowsDefaultCellStyle.ForeColor = [System.Drawing.Color]::Black
    
    # Row header styling (if visible) with good contrast
    $DataGrid.RowHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(52, 58, 64)
    $DataGrid.RowHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::White
    
    # Enable double buffering for smooth scrolling
    $DataGrid.GetType().InvokeMember("DoubleBuffered", 
        [System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::SetProperty, 
        $null, $DataGrid, $true)
}

function New-ModernButton {
    param(
        [string]$Text,
        [System.Drawing.Point]$Location,
        [System.Drawing.Size]$Size,
        [string]$Style = "Primary"  # Primary, Secondary, Success, Warning, Error
    )
    
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Location = $Location
    $button.Size = $Size
    $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = 1
    $button.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)  # Increased font size
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $button.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    
    switch ($Style) {
        "Primary" {
            $button.BackColor = [System.Drawing.Color]::FromArgb(0, 123, 255)  # Bright blue
            $button.ForeColor = [System.Drawing.Color]::White
            $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(0, 86, 179)
        }
        "Secondary" {
            $button.BackColor = [System.Drawing.Color]::FromArgb(108, 117, 125)  # Gray
            $button.ForeColor = [System.Drawing.Color]::White
            $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(90, 98, 104)
        }
        "Success" {
            $button.BackColor = [System.Drawing.Color]::FromArgb(40, 167, 69)  # Green
            $button.ForeColor = [System.Drawing.Color]::White
            $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(34, 142, 58)
        }
        "Warning" {
            $button.BackColor = [System.Drawing.Color]::FromArgb(255, 193, 7)  # Yellow/Orange
            $button.ForeColor = [System.Drawing.Color]::Black  # Black text for better contrast on yellow
            $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(217, 164, 6)
        }
        "Error" {
            $button.BackColor = [System.Drawing.Color]::FromArgb(220, 53, 69)  # Red
            $button.ForeColor = [System.Drawing.Color]::White
            $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(187, 45, 59)
        }
    }
    
    # Add hover effects with proper contrast
    $button.Add_MouseEnter({
        switch ($Style) {
            "Primary" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(0, 86, 179)
                $this.ForeColor = [System.Drawing.Color]::White
            }
            "Secondary" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(90, 98, 104)
                $this.ForeColor = [System.Drawing.Color]::White
            }
            "Success" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(34, 142, 58)
                $this.ForeColor = [System.Drawing.Color]::White
            }
            "Warning" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(217, 164, 6)
                $this.ForeColor = [System.Drawing.Color]::Black
            }
            "Error" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(187, 45, 59)
                $this.ForeColor = [System.Drawing.Color]::White
            }
        }
    })
    
    $button.Add_MouseLeave({
        switch ($Style) {
            "Primary" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(0, 123, 255)
                $this.ForeColor = [System.Drawing.Color]::White
            }
            "Secondary" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(108, 117, 125)
                $this.ForeColor = [System.Drawing.Color]::White
            }
            "Success" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(40, 167, 69)
                $this.ForeColor = [System.Drawing.Color]::White
            }
            "Warning" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(255, 193, 7)
                $this.ForeColor = [System.Drawing.Color]::Black
            }
            "Error" { 
                $this.BackColor = [System.Drawing.Color]::FromArgb(220, 53, 69)
                $this.ForeColor = [System.Drawing.Color]::White
            }
        }
    })
    
    return $button
}

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('Information','Warning','Error')]
        [string]$Severity = 'Information'
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Severity] $Message"
    
    if ($script:DebugMode) {
        $logMessage | Out-File -FilePath $script:LogFile -Append
    }
    
    $color = switch ($Severity) {
        'Warning' { 'Yellow' }
        'Error' { 'Red' }
        default { 'White' }
    }
    
    Write-Host $logMessage -ForegroundColor $color
    
    if ($script:outputBox) {
        $script:outputBox.AppendText("$logMessage`n")
        $script:outputBox.ScrollToCaret()
        $script:outputBox.Refresh()
    }
}

function Show-ErrorDialog {
    param([string]$Message)
    [System.Windows.Forms.MessageBox]::Show($Message, "Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
}

function Show-InfoDialog {
    param(
        [string]$Message,
        [string]$Title = "Information"
    )
    [System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
}

function Test-HyperV {
    try {
        $hyperv = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop
        
        if ($hyperv.State -ne "Enabled") {
            $msg = "Hyper-V is not enabled. Would you like to enable it now? (Requires restart)"
            $result = [System.Windows.Forms.MessageBox]::Show(
                $msg,
                "Hyper-V Not Enabled",
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Question
            )
            
            if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
                Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -NoRestart
                return $false
            } else {
                return $false
            }
        }
        return $true
    }
    catch {
        Write-Log "Failed to check Hyper-V status: $_" -Severity Error
        return $false
    }
}

function Get-DefaultIPForVLAN {
    param(
        [int]$VLANId,
        [int]$LastOctet = 1
    )
    
    # IP ranges based on IPSCHEME.csv - Exact match to Default Subnet column
    switch ($VLANId) {
        # Core Infrastructure VLANs (direct mapping from IPSCHEME.csv)
        1   { return "192.168.1.$LastOctet" }      # Management
        2   { return "Auto IP" }                   # AVB (Dynamic audio VLAN) - Auto IP as per CSV
        3   { return "192.168.3.$LastOctet" }      # Internet from Solotech
        4   { return "192.168.4.$LastOctet" }      # VPN access
        10  { return "192.168.10.$LastOctet" }     # D3 Net
        11  { return "192.168.11.$LastOctet" }     # OmniCal
        12  { return "192.168.12.$LastOctet" }     # Designers
        13  { return "192.168.13.$LastOctet" }     # CUE PILOT
        14  { return "192.168.14.$LastOctet" }     # Reserved
        15  { return "192.168.15.$LastOctet" }     # Reserved
        16  { return "192.168.16.$LastOctet" }     # Reserved
        17  { return "192.168.17.$LastOctet" }     # Reserved
        18  { return "192.168.18.$LastOctet" }     # Reserved
        19  { return "192.168.19.$LastOctet" }     # Reserved
        20  { return "192.168.20.$LastOctet" }     # Media (Content)
        30  { return "192.168.30.$LastOctet" }     # NDI
        40  { return "192.168.40.$LastOctet" }     # KVM
        50  { return "192.168.50.$LastOctet" }     # ST-2110/AES67
        60  { return "192.168.60.$LastOctet" }     # CAMERA SYSTEM (Flypacks)
        70  { return "192.168.70.$LastOctet" }     # Reserved
        80  { return "192.168.80.$LastOctet" }     # Reserved
        90  { return "192.168.90.$LastOctet" }     # Reserved
        100 { return "192.168.100.$LastOctet" }    # Control Video
        
        # High VLANs (200-2000) - Group mapping from IPSCHEME.csv
        200  { return "192.168.102.$LastOctet" }   # MA-Net 2 (sACN, PSN) - Group 2
        300  { return "192.168.103.$LastOctet" }   # ART Net - Group 3
        400  { return "192.168.104.$LastOctet" }   # MA-Net 3 - Group 4
        500  { return "192.168.105.$LastOctet" }   # P3 Net (Sceptron) - Group 5
        600  { return "192.168.106.$LastOctet" }   # Camera (CCTV/RoboCAM) - Group 6
        700  { return "192.168.107.$LastOctet" }   # Dante Timecode - Group 7
        800  { return "192.168.108.$LastOctet" }   # NDI - Group 8
        900  { return "192.168.109.$LastOctet" }   # Reserved - Group 9
        1000 { return "192.168.110.$LastOctet" }   # Control LX - Group 10
        1100 { return "192.168.111.$LastOctet" }   # AVB - Group 11
        1200 { return "192.168.112.$LastOctet" }   # COMM/AES67/Riedel - Group 12
        1300 { return "192.168.113.$LastOctet" }   # Dante Primary - Group 13
        1400 { return "192.168.114.$LastOctet" }   # Dante Secondary - Group 14
        1500 { return "192.168.115.$LastOctet" }   # Reserved - Group 15
        1600 { return "192.168.116.$LastOctet" }   # Reserved - Group 16
        1700 { return "192.168.117.$LastOctet" }   # Reserved - Group 17
        1800 { return "192.168.118.$LastOctet" }   # Reserved - Group 18
        1900 { return "192.168.119.$LastOctet" }   # Reserved - Group 19
        2000 { return "192.168.120.$LastOctet" }   # INTERNET from the venue - Group 20
        
        default {
            # For any other VLAN ID, use the VLAN ID as third octet (fallback)
            return "192.168.$VLANId.$LastOctet"
        }
    }
}

function Get-DefaultVLANName {
    param([int]$VLANId)
    
    # Check if custom name exists in hashtable
    if ($script:CustomVLANNames.ContainsKey($VLANId)) {
        return $script:CustomVLANNames[$VLANId]
    }
    
    # Return generic format if no custom name - just the description part
    return "Generic Network"
}

function Get-VLANAdapterName {
    param(
        [int]$VLANId,
        [int]$AdapterNumber = 1
    )
    
    # Get the descriptive name from IPSCHEME.csv
    $vlanName = Get-DefaultVLANName -VLANId $VLANId
    
    # Create a shorter, cleaner name: "VLAN# - NAME - NET#"
    # This keeps the VLAN number, descriptive name, and adapter number but in a shorter format
    $adapterName = "VLAN$VLANId - $vlanName - NET$AdapterNumber"
    
    # Sanitize the name for Windows adapter naming requirements
    return Get-SanitizedAdapterName -Name $adapterName
}

function Get-SanitizedAdapterName {
    param([string]$Name)
    
    # Remove or replace characters that aren't allowed in Windows adapter names
    $sanitized = $Name -replace '[\\/:*?"<>|#%&{}]', '_'
    $sanitized = $sanitized -replace '[()]', ''
    $sanitized = $sanitized -replace '/', '-'
    $sanitized = $sanitized -replace '\s+', ' '
    $sanitized = $sanitized -replace '_+', '_'
    $sanitized = $sanitized.Trim(' ', '_')
    
    # Increased length limit to 80 characters as per coding instructions
    if ($sanitized.Length -gt 80) {
        $sanitized = $sanitized.Substring(0, 80).TrimEnd(' ', '_')
    }
    
    if ([string]::IsNullOrWhiteSpace($sanitized)) {
        $sanitized = "VLAN_Adapter"
    }
    
    return $sanitized
}

function Save-CustomVLANNames {
    param([string]$FilePath = (Join-Path $PSScriptRoot "VLAN_Names.json"))
    
    try {
        $stringKeyedObject = @{}
        $script:CustomVLANNames.GetEnumerator() | ForEach-Object {
            $stringKeyedObject[$_.Key.ToString()] = $_.Value
        }
        
        $json = $stringKeyedObject | ConvertTo-Json -Depth 10
        $json | Out-File -FilePath $FilePath -Encoding UTF8
        Write-Log "Custom VLAN names saved to: $FilePath" -Severity Information
    }
    catch {
        Write-Log "Failed to save custom VLAN names: $_" -Severity Error
    }
}

function Import-CustomVLANNames {
    param([string]$FilePath = (Join-Path $PSScriptRoot "VLAN_Names.json"))
    
    try {
        if (Test-Path $FilePath) {
            $json = Get-Content $FilePath -Raw
            $loadedData = $json | ConvertFrom-Json
            
            $script:CustomVLANNames.Clear()
            if ($loadedData -is [PSCustomObject]) {
                $loadedData.PSObject.Properties | ForEach-Object {
                    $vlanId = [int]$_.Name
                    $script:CustomVLANNames[$vlanId] = $_.Value
                }
            } else {
                $loadedData.GetEnumerator() | ForEach-Object {
                    $vlanId = if ($_.Key -is [string]) { [int]$_.Key } else { $_.Key }
                    $script:CustomVLANNames[$vlanId] = $_.Value
                }
            }
            
            Write-Log "Custom VLAN names loaded from: $FilePath" -Severity Information
        }
    }
    catch {
        Write-Log "Failed to load custom VLAN names: $_" -Severity Warning
    }
}

function Test-IPAddress {
    param([string]$IP)
    
    if ([string]::IsNullOrWhiteSpace($IP)) {
        return @{ IsValid = $false; Message = "IP address cannot be empty" }
    }
    
    try {
        $null = [IPAddress]$IP
        return @{ IsValid = $true; Message = "Valid IP address" }
    }
    catch {
        return @{ IsValid = $false; Message = "Invalid IP address format" }
    }
}

function Test-VLANId {
    param([string]$VLANId)
    
    if ([string]::IsNullOrWhiteSpace($VLANId)) {
        return @{ IsValid = $false; Message = "VLAN ID cannot be empty" }
    }
    
    if ($VLANId -notmatch '^\d+$') {
        return @{ IsValid = $false; Message = "VLAN ID must be a number" }
    }
    
    $id = [int]$VLANId
    if ($id -lt 1 -or $id -gt 4094) {
        return @{ IsValid = $false; Message = "VLAN ID must be between 1 and 4094" }
    }
    
    return @{ IsValid = $true; Message = "Valid VLAN ID" }
}

function Show-Progress {
    param(
        [switch]$Show,
        [string]$StatusText = "Working..."
    )
    
    if ($Show) {
        $script:statusLabel.Text = $StatusText
        $script:progressBar.Style = 'Marquee'
        $script:progressBar.MarqueeAnimationSpeed = 30
        
        if ($script:outputBox) {
            $script:outputBox.Refresh()
        }
        [System.Windows.Forms.Application]::DoEvents()
    }
    else {
        $script:statusLabel.Text = "Ready"
        $script:progressBar.Style = 'Continuous'
        $script:progressBar.MarqueeAnimationSpeed = 0
        
        if ($script:outputBox) {
            $script:outputBox.Refresh()
        }
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Rename-AdapterSafely {
    param(
        [string]$CurrentName,
        [string]$DesiredName,
        [int]$VLANId
    )
    
    try {
        # Extract just the VLAN name for a cleaner final adapter name
        $vlanName = Get-DefaultVLANName -VLANId $VLANId
        $shortName = "VLAN$VLANId - $vlanName"
        $sanitizedName = Get-SanitizedAdapterName -Name $shortName
        $newAdapterName = "vEthernet ($sanitizedName)"
        
        Write-Log "Attempting to rename adapter from '$CurrentName' to '$newAdapterName'..." -Severity Information
        
        $currentAdapter = Get-NetAdapter -Name $CurrentName -ErrorAction SilentlyContinue
        if (-not $currentAdapter) {
            Write-Log "Source adapter '$CurrentName' not found for renaming" -Severity Warning
            return $CurrentName
        }
        
        $existingTarget = Get-NetAdapter -Name $newAdapterName -ErrorAction SilentlyContinue
        if ($existingTarget) {
            Write-Log "Target name '$newAdapterName' already exists, will not rename" -Severity Warning
            return $CurrentName
        }
        
        Rename-NetAdapter -Name $CurrentName -NewName $newAdapterName -ErrorAction Stop
        Write-Log "Successfully renamed adapter to '$newAdapterName'" -Severity Information
        return $newAdapterName
        
    }
    catch [System.ArgumentException] {
        Write-Log "Parameter error during rename, trying simplified name..." -Severity Warning
        try {
            $simplifiedName = "VLAN $VLANId"
            $fallbackName = "vEthernet ($simplifiedName)"
            
            $existingFallback = Get-NetAdapter -Name $fallbackName -ErrorAction SilentlyContinue
            if (-not $existingFallback) {
                Rename-NetAdapter -Name $CurrentName -NewName $fallbackName -ErrorAction Stop
                Write-Log "Successfully renamed adapter to simplified name '$fallbackName'" -Severity Information
                return $fallbackName
            } else {
                Write-Log "Fallback name also exists, keeping original name '$CurrentName'" -Severity Warning
                return $CurrentName
            }
        }
        catch {
            Write-Log "Fallback rename also failed: $($_.Exception.Message)" -Severity Warning
            return $CurrentName
        }
    }
    catch {
        Write-Log "Failed to rename adapter: $($_.Exception.Message). Keeping original name." -Severity Warning
        return $CurrentName
    }
}

function Set-DebugMode {
    param([bool]$Enable)
    
    $script:DebugMode = $Enable
    $status = if ($Enable) { "Enabled" } else { "Disabled" }
    Write-Log "Debug mode $status"
    
    if ($Enable) {
        Write-Log "Debug log file: $($script:LogFile)"
    }
}

function Set-AdapterStaticIP {
    param(
        [Parameter(Mandatory=$true)]
        [Microsoft.Management.Infrastructure.CimInstance]$NetAdapter,
        [Parameter(Mandatory=$true)]
        [string]$IPAddress,
        [Parameter(Mandatory=$true)]
        [string]$SubnetMask
    )
    
    try {
        Write-Log "Configuring static IP $IPAddress on adapter $($NetAdapter.Name)..." -Severity Information
        
        # Calculate prefix length
        $prefixLength = switch ($SubnetMask) {
            "255.255.255.0" { 24 }
            "255.255.0.0" { 16 }
            "255.0.0.0" { 8 }
            default { 24 }
        }
        
        # Method 1: Try PowerShell approach with proper sequencing
        try {
            # Remove existing IPs first
            $existingIPs = Get-NetIPAddress -InterfaceIndex $NetAdapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
            foreach ($ip in $existingIPs) {
                if ($ip.IPAddress -notmatch '^169\.254\.') {
                    Remove-NetIPAddress -InterfaceIndex $NetAdapter.ifIndex -IPAddress $ip.IPAddress -Confirm:$false -ErrorAction SilentlyContinue
                }
            }
            
            # Disable DHCP
            Set-NetIPInterface -InterfaceIndex $NetAdapter.ifIndex -Dhcp Disabled -ErrorAction Stop
            
            # Wait a moment for the interface to settle
            Start-Sleep -Milliseconds 1000
            
            # Set static IP
            New-NetIPAddress -InterfaceIndex $NetAdapter.ifIndex -IPAddress $IPAddress -PrefixLength $prefixLength -ErrorAction Stop | Out-Null
            
            Write-Log "Successfully configured IP $IPAddress/$prefixLength using PowerShell method" -Severity Information
            return @{ Success = $true; Method = "PowerShell" }
            
        } catch {
            Write-Log "PowerShell method failed: $($_.Exception.Message)" -Severity Warning
            
            # Method 2: Fallback to netsh
            try {
                Write-Log "Trying netsh fallback method..." -Severity Information
                $adapterName = $NetAdapter.Name
                
                # Use netsh to set static IP
                $netshResult = & netsh interface ip set address name="$adapterName" static $IPAddress $SubnetMask 2>&1
                
                if ($LASTEXITCODE -eq 0) {
                    Write-Log "Successfully configured IP $IPAddress using netsh method" -Severity Information
                    return @{ Success = $true; Method = "netsh" }
                } else {
                    throw "netsh failed with exit code $LASTEXITCODE`: $netshResult"
                }
                
            } catch {
                Write-Log "netsh method also failed: $($_.Exception.Message)" -Severity Error
                return @{ Success = $false; Method = "None"; Error = $_.Exception.Message }
            }
        }
        
    } catch {
        Write-Log "Failed to configure static IP: $($_.Exception.Message)" -Severity Error
        return @{ Success = $false; Method = "None"; Error = $_.Exception.Message }
    }
}

function Update-NICList {
    try {
        if (-not $script:nicComboBox) {
            Write-Log "NIC ComboBox not initialized yet, skipping update" -Severity Warning
            return
        }
        
        $script:nicComboBox.Items.Clear()
        $nics = Get-NetAdapter | Sort-Object Name
        
        foreach ($nic in $nics) {
            $nicDisplayName = "{0} ({1})" -f $nic.Name, $nic.Status
            $script:nicComboBox.Items.Add($nicDisplayName)
        }
        
        if ($script:nicComboBox.Items.Count -gt 0) {
            $script:nicComboBox.SelectedIndex = 0
        }
        
        Write-Log "Updated NIC list successfully"
    }
    catch {
        Write-Log "Failed to update NIC list: $_" -Severity Error
    }
}

function Update-SwitchList {
    try {
        if (-not $script:switchComboBox) {
            Write-Log "Switch ComboBox not initialized yet, skipping update" -Severity Warning
            return
        }
        
        $script:switchComboBox.Items.Clear()
        $switches = Get-VMSwitch | Sort-Object Name
        
        foreach ($switch in $switches) {
            $connectedCount = (Get-VMNetworkAdapter -ManagementOS | Where-Object { $_.SwitchName -eq $switch.Name } | Measure-Object).Count
            $switchDisplayName = "{0} ({1} - {2} adapters)" -f $switch.Name, $switch.SwitchType, $connectedCount
            $script:switchComboBox.Items.Add($switchDisplayName)
        }
        
        if ($script:switchComboBox.Items.Count -gt 0) {
            $script:switchComboBox.SelectedIndex = 0
        }
        
        Write-Log "Updated virtual switch list successfully - found $($switches.Count) switches"
    }
    catch {
        Write-Log "Failed to update virtual switch list: $_" -Severity Error
    }
}

# ============================================================================
# Main Form Creation
# ============================================================================

# Create main form
$form = New-Object System.Windows.Forms.Form
$form.Text = "Hyper-V Network Manager v3.0 - Modern Edition (Fixed)"
$form.Size = New-Object System.Drawing.Size(1000, 700)
$form.StartPosition = "CenterScreen"
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.MinimumSize = New-Object System.Drawing.Size(1000, 700)
$form.MaximizeBox = $true
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable

# Apply modern theme
Set-ModernStyling $form

# Create output box with modern styling
$script:outputBox = New-Object System.Windows.Forms.RichTextBox
$script:outputBox.Location = New-Object System.Drawing.Point(10, 350)
$script:outputBox.Size = New-Object System.Drawing.Size(970, 280)
$script:outputBox.ReadOnly = $true
$script:outputBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$script:outputBox.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$script:outputBox.ScrollBars = [System.Windows.Forms.RichTextBoxScrollBars]::Vertical
Set-ModernStyling $script:outputBox
$form.Controls.Add($script:outputBox)

# Create status bar
$statusBar = New-Object System.Windows.Forms.StatusStrip
$script:statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$script:progressBar = New-Object System.Windows.Forms.ToolStripProgressBar
$script:progressBar.Size = New-Object System.Drawing.Size(100, 16)
$statusBar.Items.AddRange(@($script:statusLabel, $script:progressBar))
$form.Controls.Add($statusBar)
$script:statusLabel.Text = "Ready"

# Create menu strip
$menuStrip = New-Object System.Windows.Forms.MenuStrip
$menuStrip.BackColor = Get-ThemeColor "Surface"
$menuStrip.ForeColor = Get-ThemeColor "Text"
$menuStrip.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.MainMenuStrip = $menuStrip

# View menu for theme switching
$viewMenu = New-Object System.Windows.Forms.ToolStripMenuItem
$viewMenu.Text = "View"
$viewMenu.BackColor = Get-ThemeColor "Surface"
$viewMenu.ForeColor = Get-ThemeColor "Text"

$darkThemeItem = New-Object System.Windows.Forms.ToolStripMenuItem
$darkThemeItem.Text = "Dark Theme"
$darkThemeItem.Checked = ($script:CurrentTheme -eq "Dark")
$darkThemeItem.Add_Click({
    Set-ModernTheme "Dark"
    Set-ModernStyling $form
    $darkThemeItem.Checked = $true
    $lightThemeItem.Checked = $false
})

$lightThemeItem = New-Object System.Windows.Forms.ToolStripMenuItem
$lightThemeItem.Text = "Light Theme"
$lightThemeItem.Checked = ($script:CurrentTheme -eq "Light")
$lightThemeItem.Add_Click({
    Set-ModernTheme "Light"
    Set-ModernStyling $form
    $lightThemeItem.Checked = $true
    $darkThemeItem.Checked = $false
})

$viewMenu.DropDownItems.AddRange(@($darkThemeItem, $lightThemeItem))
$menuStrip.Items.Add($viewMenu)

# Debug menu with modern styling
$debugMenu = New-Object System.Windows.Forms.ToolStripMenuItem
$debugMenu.Text = "Debug"
$debugMenu.BackColor = Get-ThemeColor "Surface"
$debugMenu.ForeColor = Get-ThemeColor "Text"

$toggleDebugItem = New-Object System.Windows.Forms.ToolStripMenuItem
$toggleDebugItem.Text = "Enable Debug Mode"
$toggleDebugItem.Add_Click({
    $toggleDebugItem.Checked = !$toggleDebugItem.Checked
    Set-DebugMode -Enable $toggleDebugItem.Checked
})

$showLogItem = New-Object System.Windows.Forms.ToolStripMenuItem
$showLogItem.Text = "Show Log File"
$showLogItem.Add_Click({
    if (Test-Path $script:LogFile) {
        Start-Process notepad.exe $script:LogFile
    }
    else {
        Show-ErrorDialog "Log file not found. Enable debug mode to create it."
    }
})

$debugMenu.DropDownItems.AddRange(@($toggleDebugItem, $showLogItem))
$menuStrip.Items.Add($debugMenu)

# Help menu
$helpMenu = New-Object System.Windows.Forms.ToolStripMenuItem
$helpMenu.Text = "Help"
$helpMenu.BackColor = Get-ThemeColor "Surface"
$helpMenu.ForeColor = Get-ThemeColor "Text"

$aboutItem = New-Object System.Windows.Forms.ToolStripMenuItem
$aboutItem.Text = "About"
$aboutItem.Add_Click({
    $about = @"
Hyper-V Network Manager v3.0 - Modern Edition (Fixed)

A comprehensive tool for managing Hyper-V virtual networks, VLANs, and network adapters with modern UI design.

Features:
• Modern Dark/Light theme support
• Advanced table formatting and search
• Create and manage virtual switches
• Configure VLAN virtual NICs with profiles
• Apply IP configurations with templates
• Test network connectivity
• Comprehensive environment validation
• Enhanced progress animations
• Debug logging and troubleshooting

Developed with PowerShell and Windows Forms
Requires Windows with Hyper-V enabled
"@
    Show-InfoDialog -Message $about -Title "About Hyper-V Network Manager"
})

$helpMenu.DropDownItems.Add($aboutItem)
$menuStrip.Items.Add($helpMenu)
$form.Controls.Add($menuStrip)

# Create GroupBox for VLAN Management
$vlanGroup = New-Object System.Windows.Forms.GroupBox
$vlanGroup.Location = New-Object System.Drawing.Point(10, 30)
$vlanGroup.Size = New-Object System.Drawing.Size(680, 310)
$vlanGroup.Text = "VLAN Management"
Set-ModernStyling $vlanGroup
$form.Controls.Add($vlanGroup)

# NIC selection
$nicLabel = New-Object System.Windows.Forms.Label
$nicLabel.Location = New-Object System.Drawing.Point(10, 30)
$nicLabel.Size = New-Object System.Drawing.Size(100, 20)
$nicLabel.Text = "Select NIC:"
Set-ModernStyling $nicLabel
$vlanGroup.Controls.Add($nicLabel)

$script:nicComboBox = New-Object System.Windows.Forms.ComboBox
$script:nicComboBox.Location = New-Object System.Drawing.Point(120, 30)
$script:nicComboBox.Size = New-Object System.Drawing.Size(180, 20)
$script:nicComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
Set-ModernStyling $script:nicComboBox
$vlanGroup.Controls.Add($script:nicComboBox)

# Refresh button for NICs
$refreshButton = New-ModernButton -Text "Refresh" -Location (New-Object System.Drawing.Point(310, 29)) -Size (New-Object System.Drawing.Size(70, 23)) -Style "Secondary"
$refreshButton.Add_Click({ Update-NICList })
$vlanGroup.Controls.Add($refreshButton)

# Switch name
$labelSwitch = New-Object System.Windows.Forms.Label
$labelSwitch.Text = "Switch Name:"
$labelSwitch.Location = New-Object System.Drawing.Point(10, 65)
$labelSwitch.Size = New-Object System.Drawing.Size(100, 20)
Set-ModernStyling $labelSwitch
$vlanGroup.Controls.Add($labelSwitch)

$textSwitch = New-Object System.Windows.Forms.TextBox
$textSwitch.Text = "VLAN-vSwitch"
$textSwitch.Location = New-Object System.Drawing.Point(120, 65)
$textSwitch.Size = New-Object System.Drawing.Size(180, 20)
Set-ModernStyling $textSwitch
$vlanGroup.Controls.Add($textSwitch)

# VLAN ID
$labelVLAN = New-Object System.Windows.Forms.Label
$labelVLAN.Text = "VLAN ID:"
$labelVLAN.Location = New-Object System.Drawing.Point(10, 100)
$labelVLAN.Size = New-Object System.Drawing.Size(100, 20)
Set-ModernStyling $labelVLAN
$vlanGroup.Controls.Add($labelVLAN)

$textVLAN = New-Object System.Windows.Forms.TextBox
$textVLAN.Text = "1"
$textVLAN.Location = New-Object System.Drawing.Point(120, 100)
$textVLAN.Size = New-Object System.Drawing.Size(180, 20)
Set-ModernStyling $textVLAN

# Add auto-fill functionality when VLAN number changes
$textVLAN.Add_TextChanged({
    $vlanText = $textVLAN.Text.Trim()
    if ($vlanText -match '^\d+$') {
        try {
            $vlanId = [int]$vlanText
            if ($vlanId -ge 1 -and $vlanId -le 4094) {
                # Auto-fill VLAN name and IP
                $vlanName = Get-DefaultVLANName -VLANId $vlanId
                $vlanIP = Get-DefaultIPForVLAN -VLANId $vlanId
                
                # Update status with VLAN info
                $script:statusLabel.Text = "VLAN $vlanId - $vlanName (IP: $vlanIP)"
            } else {
                $script:statusLabel.Text = "Invalid VLAN ID (1-4094)"
            }
        }
        catch {
            $script:statusLabel.Text = "Invalid VLAN ID format"
        }
    } else {
        $script:statusLabel.Text = "Ready"
    }
})

$vlanGroup.Controls.Add($textVLAN)

# VLAN Management Grid Button with modern styling
$btnVlanGrid = New-ModernButton -Text "VLAN Grid..." -Location (New-Object System.Drawing.Point(310, 100)) -Size (New-Object System.Drawing.Size(80, 23)) -Style "Primary"
$vlanGroup.Controls.Add($btnVlanGrid)

# VLAN Names Configuration Button with modern styling
$btnVlanNames = New-ModernButton -Text "Names..." -Location (New-Object System.Drawing.Point(400, 100)) -Size (New-Object System.Drawing.Size(70, 23)) -Style "Secondary"
$vlanGroup.Controls.Add($btnVlanNames)

# Network Adapter Info Button with modern styling
$btnAdapterInfo = New-ModernButton -Text "Adapter Info" -Location (New-Object System.Drawing.Point(480, 100)) -Size (New-Object System.Drawing.Size(90, 23)) -Style "Primary"
$vlanGroup.Controls.Add($btnAdapterInfo)

# Test button
$testButton = New-ModernButton -Text "Test Hyper-V" -Location (New-Object System.Drawing.Point(10, 140)) -Size (New-Object System.Drawing.Size(100, 30)) -Style "Primary"
$testButton.Add_Click({
    Write-Log "Testing Hyper-V functionality..." -Severity Information
    if (Test-HyperV) {
        Write-Log "Hyper-V is enabled and ready!" -Severity Information
        Show-InfoDialog "Hyper-V is enabled and ready to use!"
    } else {
        Write-Log "Hyper-V test failed or requires setup" -Severity Warning
    }
})
$vlanGroup.Controls.Add($testButton)

# Create switch button
$createSwitchButton = New-ModernButton -Text "Create Switch" -Location (New-Object System.Drawing.Point(120, 140)) -Size (New-Object System.Drawing.Size(100, 30)) -Style "Success"
$createSwitchButton.Add_Click({
    $selectedNIC = $script:nicComboBox.SelectedItem
    $switchName = $textSwitch.Text.Trim()
    
    if ([string]::IsNullOrWhiteSpace($switchName)) {
        Show-ErrorDialog "Please enter a switch name."
        return
    }
    
    if (-not $selectedNIC) {
        Show-ErrorDialog "Please select a network adapter."
        return
    }
    
    try {
        $nicName = ($selectedNIC -split ' \(')[0]
        Write-Log "Creating virtual switch '$switchName' on adapter '$nicName'..." -Severity Information
        
        New-VMSwitch -Name $switchName -NetAdapterName $nicName -AllowManagementOS $true
        Write-Log "Virtual switch '$switchName' created successfully!" -Severity Information
        Show-InfoDialog "Virtual switch '$switchName' created successfully!"
        
    } catch {
        Write-Log "Failed to create virtual switch: $($_.Exception.Message)" -Severity Error
        Show-ErrorDialog "Failed to create virtual switch: $($_.Exception.Message)"
    }
})
$vlanGroup.Controls.Add($createSwitchButton)

# Enable Hyper-V button
$enableHyperVButton = New-ModernButton -Text "Enable Hyper-V" -Location (New-Object System.Drawing.Point(230, 140)) -Size (New-Object System.Drawing.Size(100, 30)) -Style "Warning"
$enableHyperVButton.Add_Click({
    try {
        Write-Log "Checking Hyper-V status..." -Severity Information
        $hyperv = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop
        
        if ($hyperv.State -eq "Enabled") {
            Write-Log "Hyper-V is already enabled" -Severity Information
            Show-InfoDialog "Hyper-V is already enabled on this system." -Title "Already Enabled"
            return
        }
        
        $result = [System.Windows.Forms.MessageBox]::Show(
            "This will enable Hyper-V and require a system restart. Continue?",
            "Enable Hyper-V",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        
        if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
            Write-Log "Enabling Hyper-V..." -Severity Information
            Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -NoRestart
            
            $restart = [System.Windows.Forms.MessageBox]::Show(
                "Hyper-V has been enabled. System restart is required. Restart now?",
                "Restart Required",
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Question
            )
            
            if ($restart -eq [System.Windows.Forms.DialogResult]::Yes) {
                Write-Log "Restarting system to complete Hyper-V installation..." -Severity Information
                Restart-Computer -Force
            } else {
                Show-InfoDialog "Hyper-V has been enabled but requires a restart to complete installation." -Title "Restart Required"
            }
        }
    }
    catch {
        Write-Log "Failed to enable Hyper-V: $($_.Exception.Message)" -Severity Error
        Show-ErrorDialog "Failed to enable Hyper-V: $($_.Exception.Message)"
    }
})
$vlanGroup.Controls.Add($enableHyperVButton)

# Disable Hyper-V button
$disableHyperVButton = New-ModernButton -Text "Disable Hyper-V" -Location (New-Object System.Drawing.Point(340, 140)) -Size (New-Object System.Drawing.Size(100, 30)) -Style "Error"
$disableHyperVButton.Add_Click({
    try {
        Write-Log "Checking Hyper-V status..." -Severity Information
        $hyperv = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop
        
        if ($hyperv.State -eq "Disabled") {
            Write-Log "Hyper-V is already disabled" -Severity Information
            Show-InfoDialog "Hyper-V is already disabled on this system." -Title "Already Disabled"
            return
        }
        
        $result = [System.Windows.Forms.MessageBox]::Show(
            "⚠️ WARNING: This will disable Hyper-V and REMOVE ALL virtual machines and switches!`n`nThis action will:`n• Delete all VMs and their data`n• Remove all virtual switches`n• Disable Hyper-V features`n• Require a system restart`n`nAre you absolutely sure you want to continue?",
            "⚠️ DISABLE HYPER-V - DESTRUCTIVE ACTION",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        
        if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
            # Double confirmation for safety
            $secondConfirm = [System.Windows.Forms.MessageBox]::Show(
                "FINAL CONFIRMATION:`n`nThis will permanently delete ALL Hyper-V data including:`n• Virtual machines`n• Virtual switches`n• VLAN configurations`n• Snapshots and checkpoints`n`nType YES in the next dialog to proceed.",
                "⚠️ FINAL CONFIRMATION REQUIRED",
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Stop
            )
            
            if ($secondConfirm -eq [System.Windows.Forms.DialogResult]::Yes) {
                Write-Log "Disabling Hyper-V (user confirmed destructive action)..." -Severity Warning
                Disable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -NoRestart
                
                $restart = [System.Windows.Forms.MessageBox]::Show(
                    "Hyper-V has been disabled. System restart is required. Restart now?",
                    "Restart Required",
                    [System.Windows.Forms.MessageBoxButtons]::YesNo,
                    [System.Windows.Forms.MessageBoxIcon]::Question
                )
                
                if ($restart -eq [System.Windows.Forms.DialogResult]::Yes) {
                    Write-Log "Restarting system to complete Hyper-V removal..." -Severity Information
                    Restart-Computer -Force
                } else {
                    Show-InfoDialog "Hyper-V has been disabled but requires a restart to complete removal." -Title "Restart Required"
                }
            }
        }
    }
    catch {
        Write-Log "Failed to disable Hyper-V: $($_.Exception.Message)" -Severity Error
        Show-ErrorDialog "Failed to disable Hyper-V: $($_.Exception.Message)"
    }
})
$vlanGroup.Controls.Add($disableHyperVButton)

# ============================================================================
# Virtual Switch Management Group
# ============================================================================

# Create GroupBox for Virtual Switch Management
$switchGroup = New-Object System.Windows.Forms.GroupBox
$switchGroup.Location = New-Object System.Drawing.Point(700, 30)
$switchGroup.Size = New-Object System.Drawing.Size(280, 310)
$switchGroup.Text = "Virtual Switch Management"
Set-ModernStyling $switchGroup
$form.Controls.Add($switchGroup)

# Virtual Switch selection dropdown
$switchLabel = New-Object System.Windows.Forms.Label
$switchLabel.Location = New-Object System.Drawing.Point(10, 30)
$switchLabel.Size = New-Object System.Drawing.Size(100, 20)
$switchLabel.Text = "Select Switch:"
Set-ModernStyling $switchLabel
$switchGroup.Controls.Add($switchLabel)

$script:switchComboBox = New-Object System.Windows.Forms.ComboBox
$script:switchComboBox.Location = New-Object System.Drawing.Point(10, 55)
$script:switchComboBox.Size = New-Object System.Drawing.Size(260, 20)
$script:switchComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
Set-ModernStyling $script:switchComboBox
$switchGroup.Controls.Add($script:switchComboBox)

# Refresh switches button
$refreshSwitchesBtn = New-ModernButton -Text "Refresh" -Location (New-Object System.Drawing.Point(10, 85)) -Size (New-Object System.Drawing.Size(80, 25)) -Style "Secondary"
$refreshSwitchesBtn.Add_Click({ Update-SwitchList })
$switchGroup.Controls.Add($refreshSwitchesBtn)
$script:toolTip.SetToolTip($refreshSwitchesBtn, "Refresh the list of virtual switches")

# Virtual Switch Information button
$switchInfoBtn = New-ModernButton -Text "Info" -Location (New-Object System.Drawing.Point(100, 85)) -Size (New-Object System.Drawing.Size(80, 25)) -Style "Primary"
$switchInfoBtn.Add_Click({
    if ($script:switchComboBox.SelectedIndex -eq -1) {
        Show-ErrorDialog "Please select a virtual switch first."
        return
    }
    
    try {
        $selectedText = $script:switchComboBox.SelectedItem.ToString()
        $switchName = ($selectedText -split ' \(')[0]
        $switch = Get-VMSwitch -Name $switchName -ErrorAction Stop
        $connectedAdapters = Get-VMNetworkAdapter -ManagementOS | Where-Object { $_.SwitchName -eq $switchName }
        
        $info = "VIRTUAL SWITCH INFORMATION`n"
        $info += "=" * 50 + "`n`n"
        $info += "Name: $($switch.Name)`n"
        $info += "Type: $($switch.SwitchType)`n"
        $info += "ID: $($switch.Id)`n"
        
        if ($switch.NetAdapterInterfaceDescription) {
            $info += "Physical Adapter: $($switch.NetAdapterInterfaceDescription)`n"
        }
        
        $info += "`nConnected Management OS Adapters: $($connectedAdapters.Count)`n"
        if ($connectedAdapters) {
            foreach ($adapter in $connectedAdapters) {
                $info += "  - $($adapter.Name)`n"
            }
        }
        
        Show-InfoDialog -Message $info -Title "Virtual Switch Information"
    }
    catch {
        Show-ErrorDialog "Failed to get switch information: $($_.Exception.Message)"
    }
})
$switchGroup.Controls.Add($switchInfoBtn)
$script:toolTip.SetToolTip($switchInfoBtn, "Show detailed information about the selected virtual switch")

# Delete Virtual Switch button
$deleteSwitchBtn = New-ModernButton -Text "Delete" -Location (New-Object System.Drawing.Point(190, 85)) -Size (New-Object System.Drawing.Size(80, 25)) -Style "Error"
$deleteSwitchBtn.Add_Click({
    if ($script:switchComboBox.SelectedIndex -eq -1) {
        Show-ErrorDialog "Please select a virtual switch to delete."
        return
    }
    
    try {
        $selectedText = $script:switchComboBox.SelectedItem.ToString()
        $switchName = ($selectedText -split ' \(')[0]
        $switch = Get-VMSwitch -Name $switchName -ErrorAction Stop
        $connectedAdapters = Get-VMNetworkAdapter -ManagementOS | Where-Object { $_.SwitchName -eq $switchName }
        $warningMessage = "WARNING: You are about to DELETE virtual switch '$switchName'!"
        
        if ($connectedAdapters) {
            $warningMessage += "`n`nCONNECTED ADAPTERS (will be DISCONNECTED):"
            foreach ($adapter in $connectedAdapters) {
                $warningMessage += "`n   - $($adapter.Name)"
            }
            $warningMessage += "`n`nAll these adapters will lose their network connectivity!"
        }
        
        $warningMessage += "`n`nAre you absolutely sure you want to delete this virtual switch?"
        
        $result = [System.Windows.Forms.MessageBox]::Show(
            $warningMessage,
            "Delete Virtual Switch - DANGER",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        
        if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
            Write-Log "Deleting virtual switch '$switchName'..." -Severity Information
            Remove-VMSwitch -Name $switchName -Force
            Write-Log "Virtual switch '$switchName' deleted successfully" -Severity Information
            Show-InfoDialog "Virtual switch '$switchName' has been deleted successfully."
            Update-SwitchList
            Update-NICList
        }
    }
    catch {
        Write-Log "Failed to delete virtual switch: $($_.Exception.Message)" -Severity Error
        Show-ErrorDialog "Failed to delete virtual switch: $($_.Exception.Message)"
    }
})
$switchGroup.Controls.Add($deleteSwitchBtn)
$script:toolTip.SetToolTip($deleteSwitchBtn, "DELETE the selected virtual switch (WARNING: This will disconnect all connected adapters)")

# VLAN adapter management section
$vlanAdapterLabel = New-Object System.Windows.Forms.Label
$vlanAdapterLabel.Location = New-Object System.Drawing.Point(10, 130)
$vlanAdapterLabel.Size = New-Object System.Drawing.Size(260, 20)
$vlanAdapterLabel.Text = "VLAN Adapter Management:"
$vlanAdapterLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
Set-ModernStyling $vlanAdapterLabel
$switchGroup.Controls.Add($vlanAdapterLabel)

# List VLAN adapters button
$listVlanBtn = New-ModernButton -Text "List VLANs" -Location (New-Object System.Drawing.Point(10, 155)) -Size (New-Object System.Drawing.Size(80, 25)) -Style "Primary"
$listVlanBtn.Add_Click({
    Show-Progress -Show
    try {
        Write-Log "=== Network Adapters ==="
        
        $physicalNics = Get-NetAdapter | Where-Object { $_.InterfaceDescription -notmatch 'Hyper-V|Virtual|vEthernet' }
        Write-Log "`nPhysical Network Adapters:"
        foreach ($nic in $physicalNics) {
            Write-Log ("- {0} ({1})" -f $nic.Name, $nic.Status)
        }
        
        $virtualSwitches = Get-VMSwitch
        Write-Log "`nVirtual Switches:"
        foreach ($switch in $virtualSwitches) {
            Write-Log ("- {0} ({1})" -f $switch.Name, $switch.SwitchType)
        }
        
        Write-Log "`nVLAN Adapters:"
        # Enhanced VLAN adapter detection for both new and legacy naming formats
        $vlanAdapters = Get-VMNetworkAdapter -ManagementOS | Where-Object { 
            $_.Name -match "VLAN\d+" -or 
            $_.Name -match "VLAN\d+\s*-.*-\s*NETWORK adapter \d+"
        }
        $configuredCount = 0
        
        foreach ($adapter in $vlanAdapters) {
            $vlan = Get-VMNetworkAdapterVlan -ManagementOS -VMNetworkAdapterName $adapter.Name
            $vlanId = $vlan.AccessVlanId
            
            # Get IP configuration for the adapter
            # Hyper-V management OS adapters use "vEthernet (AdapterName)" format
            $netAdapterName = "vEthernet ($($adapter.Name))"
            $netAdapter = Get-NetAdapter | Where-Object Name -eq $netAdapterName -ErrorAction SilentlyContinue
            
            if (-not $netAdapter) {
                # Fallback: try without vEthernet prefix
                $netAdapter = Get-NetAdapter | Where-Object Name -eq $adapter.Name -ErrorAction SilentlyContinue
            }
            
            $ipAddress = "Not Configured"
            $subnet = "Not Configured"
            $status = "Unknown"

            if ($netAdapter) {
                # Get current status first
                $status = $netAdapter.Status
                
                # Check for existing IP configuration
                $ipConfig = Get-NetIPAddress -InterfaceIndex $netAdapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
                
                # Calculate default IP based on VLAN ID (using last octet 1 for listing purposes)
                $defaultIP = Get-DefaultIPForVLAN -VLANId $vlanId -LastOctet 1
                
                if ($ipConfig -and $ipConfig.IPAddress) {
                    # IP exists but might not match our scheme
                    $ipAddress = $ipConfig.IPAddress
                    $subnet = "255.255.255.0"
                    
                    # If IP doesn't match our default scheme, update it
                    if ($ipAddress -ne $defaultIP) {
                        try {
                            Write-Log "Updating IP address for $($adapter.Name) from $ipAddress to $defaultIP..." -Severity Information
                            # Clear all existing configurations
                            Get-NetIPAddress -InterfaceIndex $netAdapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
                            Get-NetRoute -InterfaceIndex $netAdapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
                            Set-NetIPInterface -InterfaceIndex $netAdapter.ifIndex -Dhcp Disabled -ErrorAction Stop
                            Start-Sleep -Seconds 1
                            New-NetIPAddress -InterfaceIndex $netAdapter.ifIndex -IPAddress $defaultIP -PrefixLength 24 -PolicyStore ActiveStore -ErrorAction Stop | Out-Null
                            $ipAddress = $defaultIP
                            $configuredCount++
                        }
                        catch {
                            Write-Log "Failed to update IP address for adapter $($adapter.Name): $_" -Severity Error
                        }
                    }
                } 
                else {
                    # No IP configured, apply the default one
                    try {
                        Write-Log "Configuring IP $defaultIP for adapter $($adapter.Name)..." -Severity Information
                        Set-NetIPInterface -InterfaceIndex $netAdapter.ifIndex -Dhcp Disabled -ErrorAction Stop
                        Start-Sleep -Seconds 1
                        New-NetIPAddress -InterfaceIndex $netAdapter.ifIndex -IPAddress $defaultIP -PrefixLength 24 -PolicyStore ActiveStore -ErrorAction Stop | Out-Null
                        $ipAddress = $defaultIP
                        $subnet = "255.255.255.0"
                        $configuredCount++
                    }
                    catch {
                        Write-Log "Failed to apply IP address to adapter $($adapter.Name): $_" -Severity Error
                        $ipAddress = "Configuration Failed"
                    }
                }
            }
            
            Write-Log ("- {0} (VLAN: {1}, IP: {2}, Subnet: {3}, Status: {4})" -f 
                $adapter.Name, 
                $vlanId, 
                $ipAddress, 
                $subnet,
                $status)
        }
        
        Write-Log "=== End of List ===`n"
        
        if ($configuredCount -gt 0) {
            Write-Log "Successfully configured IP addresses for $configuredCount VLAN adapters" -Severity Information
        }
    }
    catch {
        Write-Log "Failed to list network adapters: $_" -Severity Error
    }
    finally {
        Show-Progress
    }
})
$switchGroup.Controls.Add($listVlanBtn)
$script:toolTip.SetToolTip($listVlanBtn, "List all VLAN adapters and their configurations")

# Delete VLAN adapter button
$deleteVlanBtn = New-ModernButton -Text "Delete VLAN" -Location (New-Object System.Drawing.Point(100, 155)) -Size (New-Object System.Drawing.Size(90, 25)) -Style "Warning"
$deleteVlanBtn.Add_Click({
    # Create form for VLAN adapter selection
    $deleteForm = New-Object System.Windows.Forms.Form
    $deleteForm.Text = "Delete VLAN Adapter"
    $deleteForm.Size = New-Object System.Drawing.Size(400, 200)
    $deleteForm.StartPosition = "CenterParent"
    Set-ModernStyling $deleteForm
    
    $instructionLabel = New-Object System.Windows.Forms.Label
    $instructionLabel.Location = New-Object System.Drawing.Point(10, 10)
    $instructionLabel.Size = New-Object System.Drawing.Size(360, 40)
    $instructionLabel.Text = "Select the VLAN adapter to delete:"
    Set-ModernStyling $instructionLabel
    $deleteForm.Controls.Add($instructionLabel)
    
    $vlanComboBox = New-Object System.Windows.Forms.ComboBox
    $vlanComboBox.Location = New-Object System.Drawing.Point(10, 50)
    $vlanComboBox.Size = New-Object System.Drawing.Size(360, 20)
    $vlanComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
    Set-ModernStyling $vlanComboBox
    
    # Populate with VLAN adapters - support both new and legacy naming formats
    $vlanAdapters = Get-VMNetworkAdapter -ManagementOS | Where-Object { 
        $_.Name -match "VLAN\d+" -or 
        $_.Name -match "VLAN\d+\s*-.*-\s*NETWORK adapter \d+"
    }
    foreach ($adapter in $vlanAdapters) {
        $vlanComboBox.Items.Add($adapter.Name)
    }
    
    $deleteForm.Controls.Add($vlanComboBox)
    
    $deleteConfirmBtn = New-ModernButton -Text "Delete Selected" -Location (New-Object System.Drawing.Point(10, 90)) -Size (New-Object System.Drawing.Size(120, 30)) -Style "Error"
    $cancelBtn = New-ModernButton -Text "Cancel" -Location (New-Object System.Drawing.Point(250, 90)) -Size (New-Object System.Drawing.Size(120, 30)) -Style "Secondary"
    
    $deleteConfirmBtn.Add_Click({
        if ($vlanComboBox.SelectedIndex -eq -1) {
            Show-ErrorDialog "Please select a VLAN adapter to delete."
            return
        }
        
        $vlanAdapterName = $vlanComboBox.SelectedItem.ToString()
        
        $result = [System.Windows.Forms.MessageBox]::Show(
            "Are you sure you want to delete VLAN adapter '$vlanAdapterName'?`n`nThis action cannot be undone.",
            "Confirm Deletion",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
            Write-Log "Removing VLAN adapter '$vlanAdapterName'..."
            Remove-VMNetworkAdapter -ManagementOS -Name $vlanAdapterName
            Write-Log "VLAN adapter removed successfully" -Severity Information
            Show-InfoDialog "VLAN adapter '$vlanAdapterName' has been removed successfully."
            Update-NICList
        }
        $deleteForm.Close()
    })
    
    $cancelBtn.Add_Click({ $deleteForm.Close() })
    
    $deleteForm.Controls.AddRange(@($deleteConfirmBtn, $cancelBtn))
    $deleteForm.ShowDialog()
})
$switchGroup.Controls.Add($deleteVlanBtn)
$script:toolTip.SetToolTip($deleteVlanBtn, "Delete a VLAN adapter from the system")

# Add VLAN Grid Click Handler with all advanced features
$btnVlanGrid.Add_Click({
    # Create VLAN Grid Form with modern design
    $gridForm = New-Object System.Windows.Forms.Form
    $gridForm.Text = "VLAN Management Grid - Modern Edition"
    $gridForm.Size = New-Object System.Drawing.Size(1200, 750)
    $gridForm.StartPosition = "CenterParent"
    $gridForm.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $gridForm.MinimumSize = New-Object System.Drawing.Size(1200, 750)
    Set-ModernStyling $gridForm

    # Enhanced top control panel with search and filter
    $topPanel = New-Object System.Windows.Forms.Panel
    $topPanel.Location = New-Object System.Drawing.Point(10, 10)
    $topPanel.Size = New-Object System.Drawing.Size(1160, 60)
    $topPanel.BackColor = Get-ThemeColor "Surface"
    $topPanel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    
    # Search controls row 1
    $searchLabel = New-Object System.Windows.Forms.Label
    $searchLabel.Location = New-Object System.Drawing.Point(10, 8)
    $searchLabel.Size = New-Object System.Drawing.Size(80, 20)
    $searchLabel.Text = "Search VLANs:"
    $searchLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    Set-ModernStyling $searchLabel
    
    $searchTextBox = New-Object System.Windows.Forms.TextBox
    $searchTextBox.Location = New-Object System.Drawing.Point(100, 6)
    $searchTextBox.Size = New-Object System.Drawing.Size(150, 20)
    Set-ModernStyling $searchTextBox
    
    $filterLabel = New-Object System.Windows.Forms.Label
    $filterLabel.Location = New-Object System.Drawing.Point(270, 8)
    $filterLabel.Size = New-Object System.Drawing.Size(50, 20)
    $filterLabel.Text = "Filter:"
    $filterLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    Set-ModernStyling $filterLabel
    
    $filterCombo = New-Object System.Windows.Forms.ComboBox
    $filterCombo.Location = New-Object System.Drawing.Point(330, 6)
    $filterCombo.Size = New-Object System.Drawing.Size(120, 20)
    $filterCombo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
    $filterCombo.Items.AddRange(@("All VLANs", "Connected", "Disconnected", "With IP", "Without IP", "VIDEO Profile", "LIGHTING Profile"))
    $filterCombo.SelectedIndex = 0
    Set-ModernStyling $filterCombo
    
    $clearSearchBtn = New-ModernButton -Text "Clear" -Location (New-Object System.Drawing.Point(460, 5)) -Size (New-Object System.Drawing.Size(60, 22)) -Style "Secondary"
    
    # Last Octet and status row 2
    $lastOctetLabel = New-Object System.Windows.Forms.Label
    $lastOctetLabel.Location = New-Object System.Drawing.Point(10, 33)
    $lastOctetLabel.Size = New-Object System.Drawing.Size(120, 20)
    $lastOctetLabel.Text = "Default Last Octet:"
    $lastOctetLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    Set-ModernStyling $lastOctetLabel
    
    $lastOctetCombo = New-Object System.Windows.Forms.ComboBox
    $lastOctetCombo.Location = New-Object System.Drawing.Point(140, 31)
    $lastOctetCombo.Size = New-Object System.Drawing.Size(60, 20)
    $lastOctetCombo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
    Set-ModernStyling $lastOctetCombo
    
    # Populate with values in ascending order (1 at top, 254 at bottom)
    for ($i = 1; $i -le 254; $i++) {
        $lastOctetCombo.Items.Add($i)
    }
    $lastOctetCombo.SelectedIndex = 0  # Default to 1 (first item, index 0)
    
    # Status indicator with enhanced readability
    $statusIndicator = New-Object System.Windows.Forms.Label
    $statusIndicator.Location = New-Object System.Drawing.Point(550, 8)
    $statusIndicator.Size = New-Object System.Drawing.Size(600, 40)
    $statusIndicator.Text = "Ready | Use search and filters to find VLANs | Click column headers to sort"
    $statusIndicator.ForeColor = Get-ThemeColor "TextSecondary"
    $statusIndicator.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)  # Bold for better readability
    $statusIndicator.BackColor = [System.Drawing.Color]::Transparent
    Set-ModernStyling $statusIndicator
    
    $topPanel.Controls.AddRange(@($searchLabel, $searchTextBox, $filterLabel, $filterCombo, $clearSearchBtn, $lastOctetLabel, $lastOctetCombo, $statusIndicator))
    $gridForm.Controls.Add($topPanel)

    # Create enhanced DataGridView with advanced features
    $dataGrid = New-Object System.Windows.Forms.DataGridView
    $dataGrid.Location = New-Object System.Drawing.Point(10, 80)
    $dataGrid.Size = New-Object System.Drawing.Size(1160, 420)
    $dataGrid.AllowUserToAddRows = $true
    $dataGrid.AllowUserToDeleteRows = $true
    $dataGrid.AllowUserToResizeColumns = $true
    $dataGrid.AllowUserToOrderColumns = $true
    $dataGrid.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
    $dataGrid.RowHeadersVisible = $false
    $dataGrid.MultiSelect = $true
    $dataGrid.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
    $dataGrid.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $dataGrid.Anchor = "Top,Bottom,Left,Right"
    
    # Apply modern grid styling
    Set-ModernDataGridStyling $dataGrid

    # Add columns
    $columns = @(
        @{Name="Select"; Header="Select"; Width=60; Type="CheckBox"},
        @{Name="VLAN_ID"; Header="VLAN ID ^"; Width=80},
        @{Name="Name"; Header="Name ^"; Width=140},
        @{Name="IP_Address"; Header="IP Address ^"; Width=140},
        @{Name="Subnet_Mask"; Header="Subnet Mask ^"; Width=140},
        @{Name="Switch_Name"; Header="Switch Name ^"; Width=140},
        @{Name="Status"; Header="Status ^"; Width=100}
    )
    
    # Create the columns
    foreach ($col in $columns) {
        if ($col.Type -eq "CheckBox") {
            $column = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn
            $column.Name = $col.Name
            $column.HeaderText = $col.Header
            $column.Width = $col.Width
            $column.ReadOnly = $false
        } else {
            $column = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
            $column.Name = $col.Name
            $column.HeaderText = $col.Header
            $column.Width = $col.Width
        }
        $dataGrid.Columns.Add($column)
    }
    
    $dataGrid.Add_CellValueChanged({
        param($sender, $e)
        
        if ($e.ColumnIndex -eq $dataGrid.Columns["VLAN_ID"].Index -and $e.RowIndex -ge 0) {
            $vlanIdValue = $dataGrid.Rows[$e.RowIndex].Cells["VLAN_ID"].Value
            if (-not [string]::IsNullOrWhiteSpace($vlanIdValue)) {
                # Safely convert to integer with validation
                try {
                    $vlanId = [int]$vlanIdValue
                    if ($vlanId -ge 1 -and $vlanId -le 4094) {
                        $defaultName = Get-DefaultVLANName -VLANId $vlanId
                        $selectedOctet = $lastOctetCombo.SelectedItem
                        if (-not $selectedOctet) { $selectedOctet = 1 }
                        $defaultIP = Get-DefaultIPForVLAN -VLANId $vlanId -LastOctet $selectedOctet
                        
                        $dataGrid.Rows[$e.RowIndex].Cells["Name"].Value = $defaultName
                        $dataGrid.Rows[$e.RowIndex].Cells["IP_Address"].Value = $defaultIP
                        $dataGrid.Rows[$e.RowIndex].Cells["Subnet_Mask"].Value = "255.255.255.0"
                        $dataGrid.Rows[$e.RowIndex].Cells["Switch_Name"].Value = $textSwitch.Text
                    }
                }
                catch {
                    # Invalid VLAN ID format - silently skip auto-fill
                    Write-Log "Invalid VLAN ID format in grid: $vlanIdValue" -Severity Warning
                }
            }
        }
    })
    
    # Advanced search and filter functionality
    $script:originalData = @()
    
    function Set-GridFilter {
        param($searchText, $filterType)
        
        $filteredRows = $script:originalData | Where-Object {
            $matchesSearch = $true
            $matchesFilter = $true
            
            # Search filter
            if (-not [string]::IsNullOrWhiteSpace($searchText)) {
                $matchesSearch = ($_.VLAN_ID -like "*$searchText*") -or 
                               ($_.Name -like "*$searchText*") -or 
                               ($_.IP_Address -like "*$searchText*") -or
                               ($_.Switch_Name -like "*$searchText*")
            }
            
            # Category filter
            switch ($filterType) {
                "Connected" { $matchesFilter = $_.Status -eq "Up" }
                "Disconnected" { $matchesFilter = $_.Status -ne "Up" }
                "With IP" { $matchesFilter = -not [string]::IsNullOrWhiteSpace($_.IP_Address) -and $_.IP_Address -ne "Not Configured" }
                "Without IP" { $matchesFilter = [string]::IsNullOrWhiteSpace($_.IP_Address) -or $_.IP_Address -eq "Not Configured" }
                "VIDEO Profile" { $matchesFilter = $_.VLAN_ID -in @(1,2,3,4,10,11,12,13,14,15,16,20,30,40,50,60,99,100,400,600,2000) }
                "LIGHTING Profile" { $matchesFilter = $_.VLAN_ID -in @(200,300,400,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000) }
                default { $matchesFilter = $true }
            }
            
            return $matchesSearch -and $matchesFilter
        }
        
        # Clear and repopulate grid
        $dataGrid.Rows.Clear()
        foreach ($row in $filteredRows) {
            $gridRow = $dataGrid.Rows.Add()
            $dataGrid.Rows[$gridRow].Cells["Select"].Value = $false
            $dataGrid.Rows[$gridRow].Cells["VLAN_ID"].Value = $row.VLAN_ID
            $dataGrid.Rows[$gridRow].Cells["Name"].Value = $row.Name
            $dataGrid.Rows[$gridRow].Cells["IP_Address"].Value = $row.IP_Address
            $dataGrid.Rows[$gridRow].Cells["Subnet_Mask"].Value = $row.Subnet_Mask
            $dataGrid.Rows[$gridRow].Cells["Switch_Name"].Value = $row.Switch_Name
            $dataGrid.Rows[$gridRow].Cells["Status"].Value = $row.Status
        }
        
        $statusIndicator.Text = "Showing $($filteredRows.Count) of $($script:originalData.Count) VLANs | Filter: $filterType"
        $statusIndicator.ForeColor = if ($filteredRows.Count -eq $script:originalData.Count) { Get-ThemeColor "Success" } else { Get-ThemeColor "Warning" }
    }
    
    # Search event handlers
    $searchTextBox.Add_TextChanged({
        Set-GridFilter -searchText $searchTextBox.Text -filterType $filterCombo.SelectedItem
    })
    
    $filterCombo.Add_SelectedIndexChanged({
        Set-GridFilter -searchText $searchTextBox.Text -filterType $filterCombo.SelectedItem
    })
    
    $clearSearchBtn.Add_Click({
        $searchTextBox.Text = ""
        $filterCombo.SelectedIndex = 0
        Set-GridFilter -searchText "" -filterType "All VLANs"
    })
    
    # Column sorting functionality
    $dataGrid.Add_ColumnHeaderMouseClick({
        param($senderGrid, $clickArgs)
        $columnName = $senderGrid.Columns[$clickArgs.ColumnIndex].Name
        
        if ($columnName -ne "Select") {
            # Toggle sort direction
            $currentHeader = $senderGrid.Columns[$clickArgs.ColumnIndex].HeaderText
            if ($currentHeader.EndsWith(" ^")) {
                $senderGrid.Columns[$clickArgs.ColumnIndex].HeaderText = $currentHeader.Replace(" ^", " v")
                $script:originalData = $script:originalData | Sort-Object $columnName -Descending
            } else {
                $senderGrid.Columns[$clickArgs.ColumnIndex].HeaderText = $currentHeader.Replace(" v", " ^")
                $script:originalData = $script:originalData | Sort-Object $columnName
            }
            
            # Reapply current filter
            Set-GridFilter -searchText $searchTextBox.Text -filterType $filterCombo.SelectedItem
        }
    })

    # Load existing VLANs with enhanced data tracking
    function Update-VLANGrid {
        $script:originalData = @()
        $dataGrid.Rows.Clear()
        
        try {
            # Enhanced adapter detection: support all naming formats - legacy, previous, and new short format
            $vlanAdapters = Get-VMNetworkAdapter -ManagementOS | Where-Object { 
                $_.Name -match "VLAN\d+" -or 
                $_.Name -match "VLAN\d+\s*-.*-\s*NETWORK adapter \d+" -or
                $_.Name -match "VLAN\d+\s*-.*-\s*NET\d+"
            }
            
            foreach ($adapter in $vlanAdapters) {
                $vlan = Get-VMNetworkAdapterVlan -ManagementOS -VMNetworkAdapterName $adapter.Name
                $vlanId = $vlan.AccessVlanId
                
                $displayName = Get-DefaultVLANName -VLANId $vlanId
                
                # Try to find the corresponding network adapter
                $netAdapterName = "vEthernet ($($adapter.Name))"
                $netAdapter = Get-NetAdapter | Where-Object Name -eq $netAdapterName -ErrorAction SilentlyContinue
                
                if (-not $netAdapter) {
                    $netAdapter = Get-NetAdapter | Where-Object Name -eq $adapter.Name -ErrorAction SilentlyContinue
                }
                
                $ipAddress = "Not Configured"
                if ($netAdapter) {
                    $ipConfig = Get-NetIPAddress -InterfaceIndex $netAdapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
                    if ($ipConfig -and $ipConfig.IPAddress -notmatch '^169\.254\.') {
                        $ipAddress = $ipConfig.IPAddress
                    } else {
                        # If no IP configured, use the default IP scheme
                        $selectedOctet = $lastOctetCombo.SelectedItem
                        if (-not $selectedOctet) { $selectedOctet = 1 }
                        $ipAddress = Get-DefaultIPForVLAN -VLANId $vlanId -LastOctet $selectedOctet
                    }
                } else {
                    # If no network adapter found, still provide the default IP scheme
                    $selectedOctet = $lastOctetCombo.SelectedItem
                    if (-not $selectedOctet) { $selectedOctet = 1 }
                    $ipAddress = Get-DefaultIPForVLAN -VLANId $vlanId -LastOctet $selectedOctet
                }
                
                # Create data object for filtering
                $rowData = [PSCustomObject]@{
                    VLAN_ID = $vlanId.ToString()
                    Name = $displayName.ToString()
                    IP_Address = $ipAddress.ToString()
                    Subnet_Mask = "255.255.255.0"
                    Switch_Name = $adapter.SwitchName.ToString()
                    Status = if ($netAdapter) { $netAdapter.Status.ToString() } else { "Unknown" }
                }
                $script:originalData += $rowData
                
                # Add to grid
                $row = $dataGrid.Rows.Add()
                $dataGrid.Rows[$row].Cells["Select"].Value = $false
                $dataGrid.Rows[$row].Cells["VLAN_ID"].Value = $vlanId.ToString()
                $dataGrid.Rows[$row].Cells["Name"].Value = $displayName.ToString()
                $dataGrid.Rows[$row].Cells["IP_Address"].Value = $ipAddress.ToString()
                $dataGrid.Rows[$row].Cells["Subnet_Mask"].Value = "255.255.255.0"
                $dataGrid.Rows[$row].Cells["Switch_Name"].Value = $adapter.SwitchName.ToString()
                $dataGrid.Rows[$row].Cells["Status"].Value = if ($netAdapter) { $netAdapter.Status.ToString() } else { "Unknown" }
            }
        } catch {
            # If no VLANs exist yet, that's fine - just show empty grid
            Write-Log "No existing VLANs found or error loading: $($_.Exception.Message)" -Severity Information
        }
        
        $statusIndicator.Text = "Loaded $($script:originalData.Count) VLANs | Ready for search and filtering"
        $statusIndicator.ForeColor = Get-ThemeColor "Success"
    }

    # Modern progress bar for operations
    $progressBar = New-Object System.Windows.Forms.ProgressBar
    $progressBar.Location = New-Object System.Drawing.Point(10, 510)
    $progressBar.Size = New-Object System.Drawing.Size(1160, 25)
    $progressBar.Visible = $false
    $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    Set-ModernStyling $progressBar

    # Modern progress label
    $progressLabel = New-Object System.Windows.Forms.Label
    $progressLabel.Location = New-Object System.Drawing.Point(10, 485)
    $progressLabel.Size = New-Object System.Drawing.Size(1160, 25)
    $progressLabel.Text = ""
    $progressLabel.Visible = $false
    $progressLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $progressLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    Set-ModernStyling $progressLabel

    # Helper functions for progress display with enhanced animations
    function Show-OperationProgress {
        param([string]$Text, [int]$Maximum, [int]$Value)
        $progressBar.Visible = $true
        $progressLabel.Visible = $true
        $progressBar.Maximum = $Maximum
        $progressBar.Value = $Value
        $progressLabel.Text = $Text
        $progressLabel.ForeColor = Get-ThemeColor "Primary"
        [System.Windows.Forms.Application]::DoEvents()
    }

    function Update-OperationProgress {
        param([string]$Text, [int]$Value, [string]$Status = "Processing")
        
        if ($progressBar.Visible) {
            $progressBar.Value = [Math]::Min($Value, $progressBar.Maximum)
            $progressLabel.Text = $Text
            
            # Color coding based on progress percentage
            $percentage = ($Value / $progressBar.Maximum) * 100
            if ($Status -eq "Success") {
                $progressLabel.ForeColor = Get-ThemeColor "Success"
            } elseif ($Status -eq "Error") {
                $progressLabel.ForeColor = Get-ThemeColor "Error"
            } elseif ($percentage -lt 25) {
                $progressLabel.ForeColor = Get-ThemeColor "Error"
            } elseif ($percentage -lt 50) {
                $progressLabel.ForeColor = Get-ThemeColor "Warning"
            } elseif ($percentage -lt 75) {
                $progressLabel.ForeColor = Get-ThemeColor "Primary"
            } else {
                $progressLabel.ForeColor = Get-ThemeColor "Success"
            }
            
            [System.Windows.Forms.Application]::DoEvents()
        }
    }

    function Hide-OperationProgress {
        $progressBar.Visible = $false
        $progressLabel.Visible = $false
        [System.Windows.Forms.Application]::DoEvents()
    }

    # Modern buttons panel
    $buttonPanel = New-Object System.Windows.Forms.Panel
    $buttonPanel.Location = New-Object System.Drawing.Point(10, 545)
    $buttonPanel.Size = New-Object System.Drawing.Size(1160, 150)
    $buttonPanel.BackColor = Get-ThemeColor "Surface"
    $buttonPanel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle

    # Apply button with comprehensive VLAN creation
    $btnApply = New-ModernButton -Text "Apply All" -Location (New-Object System.Drawing.Point(10, 10)) -Size (New-Object System.Drawing.Size(100, 30)) -Style "Success"
    $btnApply.Add_Click({
        $totalRows = 0
        foreach ($row in $dataGrid.Rows) {
            if ($row.IsNewRow) { continue }
            $vlanIdValue = $row.Cells["VLAN_ID"].Value
            if (-not [string]::IsNullOrWhiteSpace($vlanIdValue)) {
                try {
                    $testVlanId = [int]$vlanIdValue
                    if ($testVlanId -ge 1 -and $testVlanId -le 4094) {
                        $totalRows++
                    }
                }
                catch {
                    # Skip invalid VLAN IDs
                }
            }
        }
        
        if ($totalRows -eq 0) {
            Show-InfoDialog "No VLANs to process. Please add VLAN configurations to the grid first." -Title "No Data"
            return
        }

        # Calculate total progress steps: each VLAN has multiple sub-operations
        # 1. Validation, 2. Creation/Check, 3. Wait for adapter, 4. IP Configuration, 5. Finalization
        $totalSteps = $totalRows * 5 + 2  # +2 for start and final refresh
        $currentStep = 0
        
        Show-OperationProgress -Text "Starting VLAN configuration process..." -Maximum $totalSteps -Value 0
        Start-Sleep -Milliseconds 500  # Brief pause to show start
        
        $changes = $false
        $configuredCount = 0
        $currentRow = 0
        Write-Log "Applying VLAN configurations..." -Severity Information
        
        $currentStep++
        Update-OperationProgress -Text "Initializing VLAN processing..." -Value $currentStep
        
        foreach ($row in $dataGrid.Rows) {
            if ($row.IsNewRow) { continue }
            
            $vlanIdValue = $row.Cells["VLAN_ID"].Value
            $name = $row.Cells["Name"].Value
            $ipAddress = $row.Cells["IP_Address"].Value
            $subnetMask = $row.Cells["Subnet_Mask"].Value
            $switchName = $row.Cells["Switch_Name"].Value
            
            if ([string]::IsNullOrWhiteSpace($vlanIdValue)) { continue }
            
            # Safely convert VLAN ID to integer
            try {
                $vlanId = [int]$vlanIdValue
            }
            catch {
                Write-Log "Invalid VLAN ID format in row: $vlanIdValue" -Severity Error
                continue
            }
            
            $currentRow++
            
            try {
                # Step 1: Validation
                $currentStep++
                Update-OperationProgress -Text "[$currentRow/$totalRows] Validating VLAN $vlanId..." -Value $currentStep
                
                $vlanValidation = Test-VLANId -VLANId $vlanId.ToString()
                if (-not $vlanValidation.IsValid) {
                    Write-Log "Invalid VLAN ID $vlanId`: $($vlanValidation.Message)" -Severity Error
                    $currentStep += 4  # Skip remaining steps for this VLAN
                    continue
                }
                
                $ipValidation = Test-IPAddress -IP $ipAddress
                if (-not $ipValidation.IsValid) {
                    Write-Log "Invalid IP address $ipAddress for VLAN $vlanId`: $($ipValidation.Message)" -Severity Error
                    $currentStep += 4  # Skip remaining steps for this VLAN
                    continue
                }
                
                if ([string]::IsNullOrWhiteSpace($switchName)) {
                    Write-Log "Switch name is required for VLAN $vlanId" -Severity Error
                    $currentStep += 4  # Skip remaining steps for this VLAN
                    continue
                }
                
                # Check if switch exists
                $switch = Get-VMSwitch -Name $switchName -ErrorAction SilentlyContinue
                if (-not $switch) {
                    Write-Log "Virtual switch '$switchName' does not exist for VLAN $vlanId" -Severity Error
                    $currentStep += 4  # Skip remaining steps for this VLAN
                    continue
                }
                
                Write-Log "Validation passed for VLAN $vlanId" -Severity Information
                
                # Step 2: Create/Check VLAN adapter with proper naming
                $currentStep++
                Update-OperationProgress -Text "[$currentRow/$totalRows] Creating/Checking VLAN $vlanId adapter..." -Value $currentStep
                
                $vlanAdapterName = Get-VLANAdapterName -VLANId $vlanId -AdapterNumber 1
                $existingAdapter = Get-VMNetworkAdapter -ManagementOS -Name $vlanAdapterName -ErrorAction SilentlyContinue
                
                if (-not $existingAdapter) {
                    Write-Log "Creating new VLAN adapter $vlanAdapterName..." -Severity Information
                    Add-VMNetworkAdapter -ManagementOS -Name $vlanAdapterName -SwitchName $switchName
                    Set-VMNetworkAdapterVlan -ManagementOS -VMNetworkAdapterName $vlanAdapterName -Access -VlanId $vlanId
                    
                    # Step 3: Wait for adapter to be available
                    $currentStep++
                    $timeout = 30  # 30 second timeout
                    $netAdapter = $null
                    
                    for ($wait = 0; $wait -lt $timeout; $wait++) {
                        Update-OperationProgress -Text "[$currentRow/$totalRows] Waiting for adapter $vlanAdapterName to be available..." -Value $currentStep
                        
                        Write-Log "Waiting for adapter $vlanAdapterName to be available..." -Severity Information
                        Start-Sleep -Seconds 1
                        
                        # Try different name variations
                        $netAdapter = Get-NetAdapter | Where-Object { 
                            $_.Name -eq "vEthernet ($vlanAdapterName)" -or 
                            $_.Name -eq $vlanAdapterName 
                        } -ErrorAction SilentlyContinue
                        
                        if ($netAdapter) { 
                            Write-Log "Network adapter $($netAdapter.Name) is now available" -Severity Information
                            
                            # Rename the network adapter to use the custom VLAN name
                            $finalAdapterName = Rename-AdapterSafely -CurrentName $netAdapter.Name -DesiredName $name -VLANId $vlanId
                            
                            # Update the adapter reference with the final name (renamed or original)
                            $netAdapter = Get-NetAdapter -Name $finalAdapterName -ErrorAction SilentlyContinue
                            
                            break 
                        }
                    }
                    
                    if (-not $netAdapter) {
                        Write-Log "Network adapter $vlanAdapterName not available after $timeout seconds. Skipping IP configuration." -Severity Warning
                        # Skip the remaining steps for this VLAN
                        $currentStep += 2  # Skip remaining 2 steps
                        continue
                    }
                } else {
                    Write-Log "VLAN adapter $vlanAdapterName (Custom Name: '$name') already exists, configuring IP..." -Severity Information
                    # Step 3: Skip wait since adapter already exists, but check if we need to rename
                    $currentStep++
                    Update-OperationProgress -Text "[$currentRow/$totalRows] VLAN $vlanId adapter already exists..." -Value $currentStep
                    
                    # Try to find the corresponding network adapter
                    $netAdapter = Get-NetAdapter | Where-Object { 
                        $_.Name -eq "vEthernet ($vlanAdapterName)" -or 
                        $_.Name -eq $vlanAdapterName 
                    } -ErrorAction SilentlyContinue
                }
                
                # Step 4: Configure IP address
                if ($netAdapter) {
                    $currentStep++
                    Update-OperationProgress -Text "[$currentRow/$totalRows] Configuring IP for VLAN $vlanId..." -Value $currentStep
                    
                    # Use the new helper function for cleaner IP configuration
                    $ipResult = Set-AdapterStaticIP -NetAdapter $netAdapter -IPAddress $ipAddress -SubnetMask $subnetMask
                    
                    if ($ipResult.Success) {
                        Write-Log "IP configuration successful using $($ipResult.Method) method" -Severity Information
                        $changes = $true
                        $configuredCount++
                    } else {
                        Write-Log "Failed to configure IP address for VLAN $vlanId`: $($ipResult.Error)" -Severity Error
                    }
                } else {
                    Write-Log "Could not find network adapter for VLAN $vlanId" -Severity Warning
                    $currentStep++  # Still increment step counter
                }
                
                # Step 5: Finalization
                $currentStep++
                Update-OperationProgress -Text "[$currentRow/$totalRows] Finalizing VLAN $vlanId..." -Value $currentStep
                
                Write-Log "VLAN $vlanId configuration completed" -Severity Information
                
            } catch {
                Write-Log "Error processing VLAN $vlanId`: $($_.Exception.Message)" -Severity Error
                # Skip remaining steps for this VLAN
                $remainingSteps = 5 - (($currentStep - 1) % 5)
                $currentStep += $remainingSteps
            }
        }

        # Final step: Refresh and completion
        $currentStep++
        Update-OperationProgress -Text "Finalizing all changes and refreshing display..." -Value $currentStep

        if ($changes) {
            Write-Log "Refreshing network adapter list..." -Severity Information
            Update-NICList
            Write-Log "Refreshing VLAN grid..." -Severity Information
            Update-VLANGrid
        } else {
            Write-Log "No changes were made" -Severity Information
        }

        # Ensure progress bar reaches 100%
        Update-OperationProgress -Text "All VLAN operations completed successfully!" -Value $totalSteps -Status "Success"
        Start-Sleep -Milliseconds 1500  # Brief pause to show completion

        Hide-OperationProgress
        
        $message = "VLAN configuration completed!`n`n"
        $message += "Successfully configured: $configuredCount VLANs`n"
        $message += "Total processed: $currentRow VLANs"
        
        Show-InfoDialog $message -Title "Configuration Complete"
    })

    # Add other buttons with modern styling
    $refreshBtn = New-ModernButton -Text "Refresh" -Location (New-Object System.Drawing.Point(120, 10)) -Size (New-Object System.Drawing.Size(80, 30)) -Style "Primary"
    $refreshBtn.Add_Click({ Update-VLANGrid })
    
    $deleteBtn = New-ModernButton -Text "Delete Selected" -Location (New-Object System.Drawing.Point(210, 10)) -Size (New-Object System.Drawing.Size(120, 30)) -Style "Error"
    $deleteBtn.Add_Click({
        $selectedRows = @()
        foreach ($row in $dataGrid.Rows) {
            if (-not $row.IsNewRow -and $row.Cells["Select"].Value -eq $true) {
                $selectedRows += $row
            }
        }
        
        if ($selectedRows.Count -eq 0) {
            Show-InfoDialog "Please select VLANs to delete by checking the boxes." -Title "No Selection"
            return
        }
        
        $vlanNames = @()
        foreach ($row in $selectedRows) {
            $vlanIdValue = $row.Cells["VLAN_ID"].Value
            if (-not [string]::IsNullOrWhiteSpace($vlanIdValue)) {
                try {
                    $vlanId = [int]$vlanIdValue
                    $vlanNames += "VLAN$vlanId"
                }
                catch {
                    # Skip invalid VLAN ID format
                    Write-Log "Skipping invalid VLAN ID in selection: $vlanIdValue" -Severity Warning
                }
            }
        }
        
        if ($vlanNames.Count -eq 0) {
            Show-InfoDialog "No valid VLANs selected." -Title "Invalid Selection"
            return
        }
        
        $result = [System.Windows.Forms.MessageBox]::Show(
            "Delete the following VLAN adapters?`n`n$($vlanNames -join "`n")",
            "Confirm Deletion",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
            Show-OperationProgress -Text "Deleting selected VLANs..." -Maximum $vlanNames.Count -Value 0
            
            $deletedCount = 0
            $errorCount = 0
            
            for ($i = 0; $i -lt $vlanNames.Count; $i++) {
                $vlanName = $vlanNames[$i]
                Update-OperationProgress -Text "Deleting $vlanName..." -Value ($i + 1)
                
                try {
                    Remove-VMNetworkAdapter -ManagementOS -Name $vlanName -ErrorAction Stop
                    Write-Log "Successfully deleted $vlanName" -Severity Information
                    $deletedCount++
                } catch {
                    Write-Log "Failed to delete $vlanName`: $($_.Exception.Message)" -Severity Error
                    $errorCount++
                }
                Start-Sleep -Milliseconds 200
            }
            
            Hide-OperationProgress
            Update-VLANGrid
            Update-NICList
            
            $message = "Deletion completed:`n`nDeleted: $deletedCount VLANs"
            if ($errorCount -gt 0) { $message += "`nErrors: $errorCount VLANs" }
            Show-InfoDialog $message -Title "Deletion Results"
        }
    })

    # Profile buttons with enhanced visibility
    $videoBtn = New-ModernButton -Text "VIDEO Profile" -Location (New-Object System.Drawing.Point(340, 10)) -Size (New-Object System.Drawing.Size(120, 30)) -Style "Primary"
    $videoBtn.BackColor = [System.Drawing.Color]::FromArgb(30, 144, 255)  # Bright blue
    $videoBtn.ForeColor = [System.Drawing.Color]::White
    $videoBtn.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $videoBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $videoBtn.FlatAppearance.BorderSize = 1
    $videoBtn.FlatAppearance.BorderColor = [System.Drawing.Color]::White
    $videoBtn.Add_Click({
        $dataGrid.Rows.Clear()
        $videoVLANs = @(1,2,3,4,10,11,12,13,14,15,16,20,30,40,50,60,99,100,400,600,2000)
        
        foreach ($vlanId in $videoVLANs) {
            $defaultName = Get-DefaultVLANName -VLANId $vlanId
            $selectedOctet = $lastOctetCombo.SelectedItem
            if (-not $selectedOctet) { $selectedOctet = 1 }
            $defaultIP = Get-DefaultIPForVLAN -VLANId $vlanId -LastOctet $selectedOctet
            
            $row = $dataGrid.Rows.Add()
            $dataGrid.Rows[$row].Cells["Select"].Value = $false
            $dataGrid.Rows[$row].Cells["VLAN_ID"].Value = $vlanId.ToString()
            $dataGrid.Rows[$row].Cells["Name"].Value = $defaultName
            $dataGrid.Rows[$row].Cells["IP_Address"].Value = $defaultIP
            $dataGrid.Rows[$row].Cells["Subnet_Mask"].Value = "255.255.255.0"
            $dataGrid.Rows[$row].Cells["Switch_Name"].Value = $textSwitch.Text
            $dataGrid.Rows[$row].Cells["Status"].Value = "Ready to Create"
        }
        
        Show-InfoDialog "VIDEO profile loaded successfully!`n`n21 VLANs added for video production, media systems, NDI, control video, live streaming, and broadcast equipment." -Title "VIDEO Profile"
    })
    
    $lightingBtn = New-ModernButton -Text "LIGHTING Profile" -Location (New-Object System.Drawing.Point(470, 10)) -Size (New-Object System.Drawing.Size(130, 30)) -Style "Warning"
    $lightingBtn.BackColor = [System.Drawing.Color]::FromArgb(255, 140, 0)  # Bright orange
    $lightingBtn.ForeColor = [System.Drawing.Color]::White
    $lightingBtn.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $lightingBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $lightingBtn.FlatAppearance.BorderSize = 1
    $lightingBtn.FlatAppearance.BorderColor = [System.Drawing.Color]::White
    $lightingBtn.Add_Click({
        $dataGrid.Rows.Clear()
        $lightingVLANs = @(200,300,400,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000)
        
        Show-OperationProgress -Text "Loading LIGHTING profile..." -Maximum $lightingVLANs.Count -Value 0
        
        for ($i = 0; $i -lt $lightingVLANs.Count; $i++) {
            $vlanId = $lightingVLANs[$i]
            Update-OperationProgress -Text "Adding VLAN $vlanId..." -Value ($i + 1)
            
            $defaultName = Get-DefaultVLANName -VLANId $vlanId
            $selectedOctet = $lastOctetCombo.SelectedItem
            if (-not $selectedOctet) { $selectedOctet = 1 }
            $defaultIP = Get-DefaultIPForVLAN -VLANId $vlanId -LastOctet $selectedOctet
            
            $row = $dataGrid.Rows.Add()
            $dataGrid.Rows[$row].Cells["Select"].Value = $false
            $dataGrid.Rows[$row].Cells["VLAN_ID"].Value = $vlanId.ToString()
            $dataGrid.Rows[$row].Cells["Name"].Value = $defaultName
            $dataGrid.Rows[$row].Cells["IP_Address"].Value = $defaultIP
            $dataGrid.Rows[$row].Cells["Subnet_Mask"].Value = "255.255.255.0"
            $dataGrid.Rows[$row].Cells["Switch_Name"].Value = $textSwitch.Text
            $dataGrid.Rows[$row].Cells["Status"].Value = "Ready to Create"
            
            Start-Sleep -Milliseconds 50
        }
        
        Hide-OperationProgress
        Show-InfoDialog "LIGHTING profile loaded successfully!`n`n$($lightingVLANs.Count) VLANs added for production systems by hundreds." -Title "LIGHTING Profile"
    })

    # Selection control buttons
    $selectAllBtn = New-ModernButton -Text "Select All" -Location (New-Object System.Drawing.Point(610, 10)) -Size (New-Object System.Drawing.Size(90, 30)) -Style "Secondary"
    $selectAllBtn.Add_Click({
        foreach ($row in $dataGrid.Rows) {
            if (-not $row.IsNewRow) {
                $row.Cells["Select"].Value = $true
            }
        }
        Write-Log "Selected all VLANs in grid" -Severity Information
    })
    
    $selectNoneBtn = New-ModernButton -Text "Select None" -Location (New-Object System.Drawing.Point(710, 10)) -Size (New-Object System.Drawing.Size(90, 30)) -Style "Secondary"
    $selectNoneBtn.Add_Click({
        foreach ($row in $dataGrid.Rows) {
            if (-not $row.IsNewRow) {
                $row.Cells["Select"].Value = $false
            }
        }
        Write-Log "Deselected all VLANs in grid" -Severity Information
    })

    $exportBtn = New-ModernButton -Text "Export" -Location (New-Object System.Drawing.Point(810, 10)) -Size (New-Object System.Drawing.Size(80, 30)) -Style "Secondary"
    $exportBtn.Add_Click({
        try {
            $saveDialog = New-Object System.Windows.Forms.SaveFileDialog
            $saveDialog.Filter = "CSV files (*.csv)|*.csv|Text files (*.txt)|*.txt"
            $saveDialog.Title = "Export VLAN Configuration"
            $saveDialog.FileName = "VLAN_Config_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
            
            if ($saveDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                $exportData = @()
                foreach ($row in $dataGrid.Rows) {
                    if (-not $row.IsNewRow) {
                        $exportData += [PSCustomObject]@{
                            'VLAN_ID' = $row.Cells["VLAN_ID"].Value
                            'Name' = $row.Cells["Name"].Value
                            'IP_Address' = $row.Cells["IP_Address"].Value
                            'Subnet_Mask' = $row.Cells["Subnet_Mask"].Value
                            'Switch_Name' = $row.Cells["Switch_Name"].Value
                            'Status' = $row.Cells["Status"].Value
                        }
                    }
                }
                
                if ($saveDialog.FileName.EndsWith('.csv')) {
                    $exportData | Export-Csv -Path $saveDialog.FileName -NoTypeInformation
                } else {
                    $exportData | Format-Table -AutoSize | Out-File -FilePath $saveDialog.FileName
                }
                
                Show-InfoDialog "VLAN configuration exported successfully to:`n$($saveDialog.FileName)" -Title "Export Complete"
                Write-Log "VLAN configuration exported to: $($saveDialog.FileName)" -Severity Information
            }
        } catch {
            Show-ErrorDialog "Failed to export VLAN configuration: $($_.Exception.Message)"
            Write-Log "Export failed: $($_.Exception.Message)" -Severity Error
        }
    })

    $closeBtn = New-ModernButton -Text "Close" -Location (New-Object System.Drawing.Point(1070, 10)) -Size (New-Object System.Drawing.Size(80, 30)) -Style "Secondary"
    $closeBtn.Add_Click({ $gridForm.Close() })

    $buttonPanel.Controls.AddRange(@($btnApply, $refreshBtn, $deleteBtn, $videoBtn, $lightingBtn, $selectAllBtn, $selectNoneBtn, $exportBtn, $closeBtn))

    # Add controls to form
    $gridForm.Controls.AddRange(@($topPanel, $dataGrid, $buttonPanel, $progressBar, $progressLabel))

    # Initial load of VLANs
    Update-VLANGrid

    # Show form
    $gridForm.ShowDialog()
})

# Add Network Adapter Info Click Handler
$btnAdapterInfo.Add_Click({
    # Create Network Adapter Information Form
    $adapterForm = New-Object System.Windows.Forms.Form
    $adapterForm.Text = "Network Adapter Information"
    $adapterForm.Size = New-Object System.Drawing.Size(1000, 700)
    $adapterForm.StartPosition = "CenterParent"
    $adapterForm.MinimumSize = New-Object System.Drawing.Size(800, 600)
    Set-ModernStyling $adapterForm
    
    # Create tab control for different adapter types
    $adapterTabControl = New-Object System.Windows.Forms.TabControl
    $adapterTabControl.Location = New-Object System.Drawing.Point(10, 10)
    $adapterTabControl.Size = New-Object System.Drawing.Size(970, 650)
    $adapterTabControl.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    Set-ModernStyling $adapterTabControl
    
    # Physical Adapters Tab
    $physicalTab = New-Object System.Windows.Forms.TabPage
    $physicalTab.Text = "Physical Adapters"
    $physicalTab.UseVisualStyleBackColor = $true
    Set-ModernStyling $physicalTab
    
    # Physical adapters grid
    $physicalGrid = New-Object System.Windows.Forms.DataGridView
    $physicalGrid.Location = New-Object System.Drawing.Point(5, 5)
    $physicalGrid.Size = New-Object System.Drawing.Size(950, 610)
    $physicalGrid.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
    $physicalGrid.ReadOnly = $true
    $physicalGrid.AllowUserToAddRows = $false
    $physicalGrid.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
    $physicalGrid.Font = New-Object System.Drawing.Font("Segoe UI", 8)  # Smaller font
    Set-ModernDataGridStyling $physicalGrid
    
    # Virtual Adapters Tab
    $virtualTab = New-Object System.Windows.Forms.TabPage
    $virtualTab.Text = "Virtual Adapters"
    $virtualTab.UseVisualStyleBackColor = $true
    Set-ModernStyling $virtualTab
    
    # Virtual adapters grid
    $virtualGrid = New-Object System.Windows.Forms.DataGridView
    $virtualGrid.Location = New-Object System.Drawing.Point(5, 5)
    $virtualGrid.Size = New-Object System.Drawing.Size(950, 610)
    $virtualGrid.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
    $virtualGrid.ReadOnly = $true
    $virtualGrid.AllowUserToAddRows = $false
    $virtualGrid.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
    $virtualGrid.Font = New-Object System.Drawing.Font("Segoe UI", 8)  # Smaller font
    Set-ModernDataGridStyling $virtualGrid
    
    # VLAN Adapters Tab
    $vlanTab = New-Object System.Windows.Forms.TabPage
    $vlanTab.Text = "VLAN Adapters"
    $vlanTab.UseVisualStyleBackColor = $true
    Set-ModernStyling $vlanTab
    
    # VLAN adapters grid
    $vlanAdapterGrid = New-Object System.Windows.Forms.DataGridView
    $vlanAdapterGrid.Location = New-Object System.Drawing.Point(5, 5)
    $vlanAdapterGrid.Size = New-Object System.Drawing.Size(950, 610)
    $vlanAdapterGrid.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
    $vlanAdapterGrid.ReadOnly = $true
    $vlanAdapterGrid.AllowUserToAddRows = $false
    $vlanAdapterGrid.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
    $vlanAdapterGrid.Font = New-Object System.Drawing.Font("Segoe UI", 8)  # Smaller font
    Set-ModernDataGridStyling $vlanAdapterGrid
    
    # Function to populate physical adapters
    function Update-PhysicalAdapters {
        $physicalGrid.Rows.Clear()
        $physicalGrid.Columns.Clear()
        
        # Add columns with smaller width
        $physicalGrid.Columns.Add("Name", "Adapter Name")
        $physicalGrid.Columns.Add("Description", "Description")
        $physicalGrid.Columns.Add("Status", "Status")
        $physicalGrid.Columns.Add("Speed", "Link Speed")
        $physicalGrid.Columns.Add("MAC", "MAC Address")
        $physicalGrid.Columns.Add("Type", "Media Type")
        $physicalGrid.Columns.Add("Driver", "Driver Version")
        
        $physicalAdapters = Get-NetAdapter | Where-Object { $_.InterfaceDescription -notmatch 'Hyper-V|Virtual|vEthernet' }
        foreach ($adapter in $physicalAdapters) {
            $speed = if ($adapter.LinkSpeed) { "$([math]::Round($adapter.LinkSpeed/1GB, 1)) Gbps" } else { "Unknown" }
            $driverInfo = try { (Get-PnpDevice -FriendlyName "*$($adapter.InterfaceDescription)*" -ErrorAction SilentlyContinue | Select-Object -First 1).DriverVersion } catch { "N/A" }
            $physicalGrid.Rows.Add(
                $adapter.Name,
                $adapter.InterfaceDescription,
                $adapter.Status,
                $speed,
                $adapter.MacAddress,
                $adapter.MediaType,
                $driverInfo
            )
        }
    }
    
    # Function to populate virtual adapters
    function Update-VirtualAdapters {
        $virtualGrid.Rows.Clear()
        $virtualGrid.Columns.Clear()
        
        # Add columns
        $virtualGrid.Columns.Add("Name", "Adapter Name")
        $virtualGrid.Columns.Add("Switch", "Virtual Switch")
        $virtualGrid.Columns.Add("Status", "Status")
        $virtualGrid.Columns.Add("MAC", "MAC Address")
        $virtualGrid.Columns.Add("VLAN", "VLAN ID")
        $virtualGrid.Columns.Add("IP", "IP Address")
        $virtualGrid.Columns.Add("Subnet", "Subnet Mask")
        
        $virtualAdapters = Get-VMNetworkAdapter -ManagementOS
        foreach ($adapter in $virtualAdapters) {
            $netAdapter = Get-NetAdapter -Name $adapter.Name -ErrorAction SilentlyContinue
            $ipConfig = Get-NetIPAddress -InterfaceAlias $adapter.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^169\.254\.' } | Select-Object -First 1
            
            $status = if ($netAdapter) { $netAdapter.Status } else { "Unknown" }
            $vlanValue = if ($adapter.VlanSetting.AccessVlanId -gt 0) { $adapter.VlanSetting.AccessVlanId } else { "Untagged" }
            $ipValue = if ($ipConfig) { $ipConfig.IPAddress } else { "Not Configured" }
            $subnetValue = if ($ipConfig) { "/$($ipConfig.PrefixLength)" } else { "N/A" }
            
            $virtualGrid.Rows.Add(
                $adapter.Name,
                $adapter.SwitchName,
                $status,
                $adapter.MacAddress,
                $vlanValue,
                $ipValue,
                $subnetValue
            )
        }
    }
    
    # Function to populate VLAN adapters with enhanced info
    function Update-VLANAdapters {
        $vlanAdapterGrid.Rows.Clear()
        $vlanAdapterGrid.Columns.Clear()
        
        # Add columns with more detailed information
        $vlanAdapterGrid.Columns.Add("VLAN", "VLAN ID")
        $vlanAdapterGrid.Columns.Add("Name", "Adapter Name")
        $vlanAdapterGrid.Columns.Add("Description", "VLAN Description")
        $vlanAdapterGrid.Columns.Add("IP", "IP Address")
        $vlanAdapterGrid.Columns.Add("Subnet", "Subnet")
        $vlanAdapterGrid.Columns.Add("Gateway", "Default Gateway")
        $vlanAdapterGrid.Columns.Add("Status", "Connection Status")
        $vlanAdapterGrid.Columns.Add("MAC", "MAC Address")
        $vlanAdapterGrid.Columns.Add("Switch", "Virtual Switch")
        
        # Enhanced VLAN adapter detection
        $vlanAdapters = Get-VMNetworkAdapter -ManagementOS | Where-Object {
            $_.Name -match 'VLAN\d+' -or
            $_.Name -match 'vEthernet.*VLAN' -or
            ($_.VlanSetting.AccessVlanId -gt 0)
        }
        
        foreach ($adapter in $vlanAdapters) {
            # Extract VLAN ID from name or VLAN setting
            $vlanId = 0
            if ($adapter.Name -match 'VLAN(\d+)') {
                $vlanId = [int]$matches[1]
            } elseif ($adapter.VlanSetting.AccessVlanId -gt 0) {
                $vlanId = $adapter.VlanSetting.AccessVlanId
            }
            
            # Get VLAN description
            $vlanDescription = if ($vlanId -gt 0) { Get-DefaultVLANName -VLANId $vlanId } else { "Unknown" }
            
            # Get network configuration
            $netAdapter = Get-NetAdapter -Name $adapter.Name -ErrorAction SilentlyContinue
            $ipConfig = Get-NetIPAddress -InterfaceAlias $adapter.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^169\.254\.' } | Select-Object -First 1
            $gateway = Get-NetRoute -InterfaceAlias $adapter.Name -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
            
            $vlanIdValue = if ($vlanId -gt 0) { $vlanId } else { "N/A" }
            $ipValue = if ($ipConfig) { $ipConfig.IPAddress } else { "Not Configured" }
            $subnetValue = if ($ipConfig) { "/$($ipConfig.PrefixLength)" } else { "N/A" }
            $gatewayValue = if ($gateway) { $gateway.NextHop } else { "N/A" }
            $statusValue = if ($netAdapter) { $netAdapter.Status } else { "Unknown" }
            
            $vlanAdapterGrid.Rows.Add(
                $vlanIdValue,
                $adapter.Name,
                $vlanDescription,
                $ipValue,
                $subnetValue,
                $gatewayValue,
                $statusValue,
                $adapter.MacAddress,
                $adapter.SwitchName
            )
        }
    }
    
    # Add tabs to tab control
    $physicalTab.Controls.Add($physicalGrid)
    $virtualTab.Controls.Add($virtualGrid)
    $vlanTab.Controls.Add($vlanAdapterGrid)
    
    $adapterTabControl.TabPages.Add($physicalTab)
    $adapterTabControl.TabPages.Add($virtualTab)
    $adapterTabControl.TabPages.Add($vlanTab)
    
    $adapterForm.Controls.Add($adapterTabControl)
    
    # Populate data when form loads
    $adapterForm.Add_Shown({
        Update-PhysicalAdapters
        Update-VirtualAdapters
        Update-VLANAdapters
    })
    
    # Show the form
    $adapterForm.ShowDialog()
})

# VLAN Names Configuration Button Click Handler
$btnVlanNames.Add_Click({
    # Create VLAN Names Configuration Form
    $namesForm = New-Object System.Windows.Forms.Form
    $namesForm.Text = "VLAN Names Configuration"
    $namesForm.Size = New-Object System.Drawing.Size(500, 400)
    $namesForm.StartPosition = "CenterParent"
    $namesForm.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $namesForm.MinimumSize = New-Object System.Drawing.Size(500, 400)
    $namesForm.MaximizeBox = $false
    $namesForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    Set-ModernStyling $namesForm

    # Create DataGridView for editing VLAN names
    $namesGrid = New-Object System.Windows.Forms.DataGridView
    $namesGrid.Location = New-Object System.Drawing.Point(10, 10)
    $namesGrid.Size = New-Object System.Drawing.Size(460, 280)
    $namesGrid.AllowUserToAddRows = $true
    $namesGrid.AllowUserToDeleteRows = $true
    $namesGrid.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
    $namesGrid.RowHeadersVisible = $false
    $namesGrid.MultiSelect = $false
    $namesGrid.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
    Set-ModernDataGridStyling $namesGrid

    # Add columns for VLAN ID and Name
    $vlanIdColumn = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $vlanIdColumn.Name = "VLAN_ID"
    $vlanIdColumn.HeaderText = "VLAN ID"
    $vlanIdColumn.Width = 80
    $namesGrid.Columns.Add($vlanIdColumn)

    $nameColumn = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $nameColumn.Name = "Name"
    $nameColumn.HeaderText = "Custom Name"
    $nameColumn.Width = 350
    $namesGrid.Columns.Add($nameColumn)

    # Load existing custom names
    foreach ($vlanId in ($script:CustomVLANNames.Keys | Sort-Object)) {
        $row = $namesGrid.Rows.Add()
        $namesGrid.Rows[$row].Cells["VLAN_ID"].Value = $vlanId
        $namesGrid.Rows[$row].Cells["Name"].Value = $script:CustomVLANNames[$vlanId]
    }

    # Buttons panel
    $buttonPanel = New-Object System.Windows.Forms.Panel
    $buttonPanel.Location = New-Object System.Drawing.Point(10, 300)
    $buttonPanel.Size = New-Object System.Drawing.Size(460, 50)
    Set-ModernStyling $buttonPanel

    # Save button
    $btnSave = New-ModernButton -Text "Save" -Location (New-Object System.Drawing.Point(10, 10)) -Size (New-Object System.Drawing.Size(80, 30)) -Style "Success"
    $btnSave.Add_Click({
        $script:CustomVLANNames.Clear()
        
        foreach ($row in $namesGrid.Rows) {
            if ($row.IsNewRow) { continue }
            
            $vlanIdStr = $row.Cells["VLAN_ID"].Value
            $nameStr = $row.Cells["Name"].Value
            
            if (-not [string]::IsNullOrWhiteSpace($vlanIdStr) -and -not [string]::IsNullOrWhiteSpace($nameStr)) {
                $vlanValidation = Test-VLANId -VLANId $vlanIdStr
                if ($vlanValidation.IsValid) {
                    try {
                        $vlanId = [int]$vlanIdStr
                        $script:CustomVLANNames[$vlanId] = $nameStr.Trim()
                    }
                    catch {
                        Write-Log "Error converting VLAN ID '$vlanIdStr' to integer in names grid" -Severity Warning
                    }
                }
            }
        }
        
        Save-CustomVLANNames
        Show-InfoDialog "VLAN names saved successfully!" -Title "Success"
        $namesForm.Close()
    })

    $btnCancel = New-ModernButton -Text "Cancel" -Location (New-Object System.Drawing.Point(100, 10)) -Size (New-Object System.Drawing.Size(80, 30)) -Style "Secondary"
    $btnCancel.Add_Click({ $namesForm.Close() })

    $btnReset = New-ModernButton -Text "Reset" -Location (New-Object System.Drawing.Point(190, 10)) -Size (New-Object System.Drawing.Size(80, 30)) -Style "Warning"
    $btnReset.Add_Click({
        $result = [System.Windows.Forms.MessageBox]::Show(
            "Reset all VLAN names to defaults?",
            "Confirm Reset",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )
        
        if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
            # Reset to original defaults from the global hashtable
            Import-CustomVLANNames  # This will load the original template
            
            $namesGrid.Rows.Clear()
            foreach ($vlanId in ($script:CustomVLANNames.Keys | Sort-Object)) {
                $row = $namesGrid.Rows.Add()
                $namesGrid.Rows[$row].Cells["VLAN_ID"].Value = $vlanId
                $namesGrid.Rows[$row].Cells["Name"].Value = $script:CustomVLANNames[$vlanId]
            }
            
            Show-InfoDialog "VLAN names reset to defaults." -Title "Reset Complete"
        }
    })

    $buttonPanel.Controls.AddRange(@($btnSave, $btnCancel, $btnReset))
    $namesForm.Controls.AddRange(@($namesGrid, $buttonPanel))
    $namesForm.ShowDialog()
})

# Initialize the form
# Update-NICList  # Commented out to avoid null reference error

# Show the form
[System.Windows.Forms.Application]::EnableVisualStyles()

# Initialize lists after form is created
try {
    Update-NICList
    Update-SwitchList
}
catch {
    Write-Log "Warning: Could not initialize dropdown lists: $($_.Exception.Message)" -Severity Warning
}

$form.ShowDialog()
