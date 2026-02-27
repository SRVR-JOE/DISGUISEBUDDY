# ServerIdentity.ps1 - DISGUISE BUDDY Server Identity Configuration Module
# Manages server hostname and system identification for disguise (d3) media servers.
# The hostname is critical for d3Net discovery, UNC paths, and API access.

# ============================================================================
# Backend Functions
# ============================================================================

function Get-ServerHostname {
    <#
    .SYNOPSIS
        Returns the current computer hostname.
    .DESCRIPTION
        Retrieves the hostname using environment variables with a DNS fallback.
    .OUTPUTS
        String containing the current computer hostname.
    #>
    try {
        $hostname = $env:COMPUTERNAME
        if (-not $hostname) {
            $hostname = [System.Net.Dns]::GetHostName()
        }
        Write-AppLog -Message "Retrieved server hostname: $hostname" -Level 'DEBUG'
        return $hostname
    }
    catch {
        Write-AppLog -Message "Failed to retrieve hostname: $_" -Level 'ERROR'
        return 'UNKNOWN'
    }
}

function Set-ServerHostname {
    <#
    .SYNOPSIS
        Changes the computer hostname.
    .DESCRIPTION
        Validates the proposed hostname against Windows NetBIOS naming rules
        and applies the change using Rename-Computer. A restart is required
        for the change to take full effect.
    .PARAMETER NewName
        The new hostname to assign to the computer.
    .OUTPUTS
        PSCustomObject with Success (bool), Message (string), and RestartRequired (bool) properties.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$NewName
    )

    # Validate the hostname first
    $validation = Test-ServerHostname -Name $NewName
    if (-not $validation.IsValid) {
        Write-AppLog -Message "Hostname validation failed for '$NewName': $($validation.ErrorMessage)" -Level 'WARN'
        return [PSCustomObject]@{
            Success         = $false
            Message         = "Invalid hostname: $($validation.ErrorMessage)"
            RestartRequired = $false
        }
    }

    try {
        Rename-Computer -NewName $NewName -Force -ErrorAction Stop
        Write-AppLog -Message "Hostname change to '$NewName' applied successfully. Restart required." -Level 'INFO'
        return [PSCustomObject]@{
            Success         = $true
            Message         = "Hostname will change to '$NewName' after the next restart."
            RestartRequired = $true
        }
    }
    catch {
        Write-AppLog -Message "Failed to change hostname to '$NewName': $_" -Level 'ERROR'
        return [PSCustomObject]@{
            Success         = $false
            Message         = "Failed to change hostname: $_"
            RestartRequired = $false
        }
    }
}

function Test-ServerHostname {
    <#
    .SYNOPSIS
        Validates a proposed hostname against Windows NetBIOS naming rules.
    .DESCRIPTION
        Checks: max 15 chars, alphanumeric + hyphens only, no spaces,
        cannot start or end with a hyphen, must not be empty.
    .PARAMETER Name
        The hostname string to validate.
    .OUTPUTS
        PSCustomObject with IsValid (bool) and ErrorMessage (string) properties.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    # Empty check
    if ([string]::IsNullOrWhiteSpace($Name)) {
        return [PSCustomObject]@{
            IsValid      = $false
            ErrorMessage = "Hostname cannot be empty."
        }
    }

    # Length check (NetBIOS limit: 15 characters)
    if ($Name.Length -gt 15) {
        return [PSCustomObject]@{
            IsValid      = $false
            ErrorMessage = "Hostname exceeds 15 characters (NetBIOS limit). Current length: $($Name.Length)."
        }
    }

    # No spaces allowed
    if ($Name -match '\s') {
        return [PSCustomObject]@{
            IsValid      = $false
            ErrorMessage = "Hostname cannot contain spaces."
        }
    }

    # Alphanumeric and hyphens only
    if ($Name -notmatch '^[a-zA-Z0-9-]+$') {
        return [PSCustomObject]@{
            IsValid      = $false
            ErrorMessage = "Hostname can only contain letters (A-Z), numbers (0-9), and hyphens (-)."
        }
    }

    # Cannot start with a hyphen
    if ($Name.StartsWith('-')) {
        return [PSCustomObject]@{
            IsValid      = $false
            ErrorMessage = "Hostname cannot start with a hyphen."
        }
    }

    # Cannot end with a hyphen
    if ($Name.EndsWith('-')) {
        return [PSCustomObject]@{
            IsValid      = $false
            ErrorMessage = "Hostname cannot end with a hyphen."
        }
    }

    # All checks passed
    return [PSCustomObject]@{
        IsValid      = $true
        ErrorMessage = ''
    }
}

function Get-ServerSystemInfo {
    <#
    .SYNOPSIS
        Gets system information for display in the Server Identity view.
    .DESCRIPTION
        Queries WMI/CIM for computer system details including hostname,
        domain/workgroup, OS version, uptime, serial number, and model.
    .OUTPUTS
        PSCustomObject with Hostname, Domain, DomainType, OSVersion, Uptime,
        SerialNumber, and Model properties.
    #>
    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop

        # Determine domain vs workgroup
        $domainType = if ($cs.PartOfDomain) { 'Domain' } else { 'Workgroup' }
        $domainName = if ($cs.PartOfDomain) { $cs.Domain } else { $cs.Workgroup }

        # Calculate uptime
        $uptime = (Get-Date) - $os.LastBootUpTime
        $uptimeStr = "{0}d {1}h {2}m" -f $uptime.Days, $uptime.Hours, $uptime.Minutes

        $info = [PSCustomObject]@{
            Hostname     = $cs.Name
            Domain       = $domainName
            DomainType   = $domainType
            OSVersion    = "$($os.Caption) ($($os.Version))"
            Uptime       = $uptimeStr
            SerialNumber = $bios.SerialNumber
            Model        = "$($cs.Manufacturer) $($cs.Model)"
        }

        Write-AppLog -Message "Retrieved system info for '$($cs.Name)'." -Level 'DEBUG'
        return $info
    }
    catch {
        Write-AppLog -Message "Failed to retrieve system info: $_" -Level 'ERROR'

        # Return partial info using fallback methods
        $hostname = $env:COMPUTERNAME
        if (-not $hostname) {
            try { $hostname = [System.Net.Dns]::GetHostName() } catch { $hostname = 'UNKNOWN' }
        }

        return [PSCustomObject]@{
            Hostname     = $hostname
            Domain       = 'Unknown'
            DomainType   = 'Unknown'
            OSVersion    = [System.Environment]::OSVersion.VersionString
            Uptime       = 'Unknown'
            SerialNumber = 'Unknown'
            Model        = 'Unknown'
        }
    }
}

# ============================================================================
# UI View Function
# ============================================================================

function New-ServerIdentityView {
    <#
    .SYNOPSIS
        Creates the Server Identity configuration view.
    .DESCRIPTION
        Builds the complete UI for viewing and changing the server hostname,
        displaying system information, and providing naming convention guidance.
        Layout mirrors the React dark glass-morphism design: 3 cards in a scrollable
        container with 24px padding and 24px gap between cards.
    .PARAMETER ContentPanel
        The parent panel in which to render the view.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.Panel]$ContentPanel
    )

    # Clear existing content
    $ContentPanel.Controls.Clear()
    $ContentPanel.SuspendLayout()

    # Scrollable container -- full content panel size, background matches app background
    $scrollPanel = New-ScrollPanel -X 0 -Y 0 -Width $ContentPanel.Width -Height $ContentPanel.Height

    # ---- Page header (24px padding) ----
    $header = New-SectionHeader -Text "Server Identity" -X 24 -Y 16 -Width 900
    $scrollPanel.Controls.Add($header)

    $subtitle = New-StyledLabel -Text "Manage server hostname and system identification" -X 24 -Y 58 -IsSecondary -FontSize 9.5
    $scrollPanel.Controls.Add($subtitle)

    # Fetch system information once -- shared across all cards
    $sysInfo = Get-ServerSystemInfo

    # ========================================================================
    # Card 1: Current Identity  (purple left-accent border, matching React)
    # ========================================================================
    # Header area height ~90px, divider, info grid ~120px, total ~230px
    $card1 = New-StyledCard -Title "Current Identity" -X 24 -Y 90 -Width 900 -Height 310 `
                            -AccentColor $script:Theme.Primary

    # Domain / Workgroup status badge -- top-right of card
    $domainStatusType = if ($sysInfo.DomainType -eq 'Domain') { 'Info' } else { 'Warning' }
    $domainStatusText = if ($sysInfo.DomainType -eq 'Domain') {
        "Domain: $($sysInfo.Domain)"
    } else {
        "Workgroup: $($sysInfo.Domain)"
    }
    $domainBadge = New-StatusBadge -Text $domainStatusText -X 660 -Y 15 -Type $domainStatusType
    $card1.Controls.Add($domainBadge)

    # --- Hero hostname display ---
    # Purple icon block (monitor icon stand-in: a solid-colored square label)
    $hostnameIconBlock = New-Object System.Windows.Forms.Panel
    $hostnameIconBlock.Location = New-Object System.Drawing.Point(19, 44)
    $hostnameIconBlock.Size = New-Object System.Drawing.Size(42, 42)
    $hostnameIconBlock.BackColor = $script:Theme.Primary
    $card1.Controls.Add($hostnameIconBlock)

    $hostnameIconLabel = New-Object System.Windows.Forms.Label
    $hostnameIconLabel.Text = [char]0xF878   # Segoe Fluent / fallback -- shows as block on Segoe UI
    $hostnameIconLabel.Location = New-Object System.Drawing.Point(0, 0)
    $hostnameIconLabel.Size = New-Object System.Drawing.Size(42, 42)
    $hostnameIconLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $hostnameIconLabel.Font = New-Object System.Drawing.Font('Segoe UI', 14)
    $hostnameIconLabel.ForeColor = [System.Drawing.Color]::White
    $hostnameIconLabel.BackColor = [System.Drawing.Color]::Transparent
    $hostnameIconBlock.Controls.Add($hostnameIconLabel)

    # Large hostname -- the hero element (30pt bold, Primary color)
    $lblHostnameValue = New-Object System.Windows.Forms.Label
    $lblHostnameValue.Text = $sysInfo.Hostname
    $lblHostnameValue.Location = New-Object System.Drawing.Point(71, 38)
    $lblHostnameValue.AutoSize = $true
    $lblHostnameValue.Font = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
    $lblHostnameValue.ForeColor = $script:Theme.Primary
    $card1.Controls.Add($lblHostnameValue)

    # "Server Hostname" subtitle beneath the large name
    $lblHostnameHint = New-StyledLabel -Text "Server Hostname" -X 71 -Y 82 -IsMuted -FontSize 9
    $card1.Controls.Add($lblHostnameHint)

    # Divider line between header area and info grid
    $divider = New-Object System.Windows.Forms.Panel
    $divider.Location = New-Object System.Drawing.Point(15, 105)
    $divider.Size = New-Object System.Drawing.Size(860, 1)
    $divider.BackColor = $script:Theme.Border
    $card1.Controls.Add($divider)

    # --- Info grid (2 columns, uppercase labels, monospace values) ---
    # Column layout: left label X=19, left value X=155, right label X=455, right value X=595
    $gridY      = 118
    $rowGap     = 30
    $lblX       = 19
    $valX       = 155
    $rLblX      = 455
    $rValX      = 595
    $labelFont  = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $monoFont   = New-Object System.Drawing.Font('Consolas', 9)

    # Helper to create an uppercase tracking label (muted, small-caps style)
    # and a monospace value label side-by-side in the grid
    $addGridRow = {
        param($leftLabel, $leftValue, $rightLabel, $rightValue, $rowY)

        $lLbl = New-Object System.Windows.Forms.Label
        $lLbl.Text = $leftLabel.ToUpper()
        $lLbl.Location = New-Object System.Drawing.Point($lblX, $rowY)
        $lLbl.AutoSize = $true
        $lLbl.Font = $labelFont
        $lLbl.ForeColor = $script:Theme.TextMuted
        $card1.Controls.Add($lLbl)

        $lVal = New-Object System.Windows.Forms.Label
        $lVal.Text = $leftValue
        $lVal.Location = New-Object System.Drawing.Point($valX, ($rowY - 1))
        $lVal.AutoSize = $false
        $lVal.Width = 270
        $lVal.MaximumSize = New-Object System.Drawing.Size(270, 0)
        $lVal.AutoSize = $true
        $lVal.Font = $monoFont
        $lVal.ForeColor = $script:Theme.TextSecondary
        $card1.Controls.Add($lVal)

        if ($rightLabel) {
            $rLbl = New-Object System.Windows.Forms.Label
            $rLbl.Text = $rightLabel.ToUpper()
            $rLbl.Location = New-Object System.Drawing.Point($rLblX, $rowY)
            $rLbl.AutoSize = $true
            $rLbl.Font = $labelFont
            $rLbl.ForeColor = $script:Theme.TextMuted
            $card1.Controls.Add($rLbl)

            $rVal = New-Object System.Windows.Forms.Label
            $rVal.Text = $rightValue
            $rVal.Location = New-Object System.Drawing.Point($rValX, ($rowY - 1))
            $rVal.AutoSize = $false
            $rVal.Width = 250
            $rVal.MaximumSize = New-Object System.Drawing.Size(250, 0)
            $rVal.AutoSize = $true
            $rVal.Font = $monoFont
            $rVal.ForeColor = $script:Theme.TextSecondary
            $card1.Controls.Add($rVal)
        }
    }

    # Row 1: OS | Domain/Workgroup
    & $addGridRow 'Operating System' $sysInfo.OSVersion $sysInfo.DomainType $sysInfo.Domain $gridY
    $gridY += $rowGap

    # Row 2: Uptime | Model
    & $addGridRow 'Uptime' $sysInfo.Uptime 'Model' $sysInfo.Model $gridY
    $gridY += $rowGap

    # Row 3: Serial Number (spans full width)
    & $addGridRow 'Serial Number' $sysInfo.SerialNumber $null $null $gridY

    $scrollPanel.Controls.Add($card1)

    # ========================================================================
    # Card 2: Change Hostname  (no accent)
    # ========================================================================
    # Dynamic height: warning(60) + current host row(50) + input row(55)
    #   + validation(28) + preview(118 when visible) + button(60) + padding = ~460
    $card2 = New-StyledCard -Title "Change Hostname" -X 24 -Y 426 -Width 900 -Height 470

    $yPos = 48

    # --- Warning banner: semi-transparent WarningBackground + 4px left amber accent ---
    $warningPanel = New-Object System.Windows.Forms.Panel
    $warningPanel.Location = New-Object System.Drawing.Point(15, $yPos)
    $warningPanel.Size = New-Object System.Drawing.Size(860, 56)
    $warningPanel.BackColor = $script:Theme.WarningBackground
    $card2.Controls.Add($warningPanel)

    # 4px left accent stripe in Warning color
    $warningAccent = New-Object System.Windows.Forms.Panel
    $warningAccent.Location = New-Object System.Drawing.Point(0, 0)
    $warningAccent.Size = New-Object System.Drawing.Size(4, 56)
    $warningAccent.BackColor = $script:Theme.Warning
    $warningPanel.Controls.Add($warningAccent)

    # Warning icon (triangle)
    $lblWarningIcon = New-Object System.Windows.Forms.Label
    $lblWarningIcon.Text = [char]0x26A0
    $lblWarningIcon.Location = New-Object System.Drawing.Point(14, 8)
    $lblWarningIcon.AutoSize = $true
    $lblWarningIcon.Font = New-Object System.Drawing.Font('Segoe UI', 14)
    $lblWarningIcon.ForeColor = $script:Theme.Warning
    $warningPanel.Controls.Add($lblWarningIcon)

    # "RESTART REQUIRED" bold title
    $lblWarningTitle = New-Object System.Windows.Forms.Label
    $lblWarningTitle.Text = "RESTART REQUIRED"
    $lblWarningTitle.Location = New-Object System.Drawing.Point(44, 7)
    $lblWarningTitle.AutoSize = $true
    $lblWarningTitle.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
    $lblWarningTitle.ForeColor = $script:Theme.Warning
    $warningPanel.Controls.Add($lblWarningTitle)

    # Detail text below the title
    $lblWarningDetail = New-Object System.Windows.Forms.Label
    $lblWarningDetail.Text = "Changing the hostname requires a system restart. All active d3Net sessions and UNC share connections will be disrupted."
    $lblWarningDetail.Location = New-Object System.Drawing.Point(44, 28)
    $lblWarningDetail.AutoSize = $false
    $lblWarningDetail.Size = New-Object System.Drawing.Size(786, 20)
    $lblWarningDetail.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
    $lblWarningDetail.ForeColor = $script:Theme.Text
    $warningPanel.Controls.Add($lblWarningDetail)

    $yPos += 68

    # --- Current hostname: read-only display box ---
    $lblCurrentHostTitle = New-StyledLabel -Text "CURRENT HOSTNAME" -X 15 -Y $yPos -IsMuted -FontSize 8 -IsBold
    $card2.Controls.Add($lblCurrentHostTitle)

    $yPos += 18

    # Surface-bg read-only box styled to look like a disabled input
    $pnlCurrentHost = New-Object System.Windows.Forms.Panel
    $pnlCurrentHost.Location = New-Object System.Drawing.Point(15, $yPos)
    $pnlCurrentHost.Size = New-Object System.Drawing.Size(460, 30)
    $pnlCurrentHost.BackColor = $script:Theme.Surface
    $card2.Controls.Add($pnlCurrentHost)

    # 1px border painted on the panel
    $pnlCurrentHost.Add_Paint({
        param($sender, $e)
        $pen = New-Object System.Drawing.Pen($script:Theme.BorderLight, 1)
        $e.Graphics.DrawRectangle($pen, 0, 0, ($sender.Width - 1), ($sender.Height - 1))
        $pen.Dispose()
    })

    $lblCurrentHostValue = New-Object System.Windows.Forms.Label
    $lblCurrentHostValue.Text = $sysInfo.Hostname
    $lblCurrentHostValue.Location = New-Object System.Drawing.Point(10, 6)
    $lblCurrentHostValue.AutoSize = $true
    $lblCurrentHostValue.Font = New-Object System.Drawing.Font('Consolas', 10)
    $lblCurrentHostValue.ForeColor = $script:Theme.TextSecondary
    $pnlCurrentHost.Controls.Add($lblCurrentHostValue)

    $yPos += 40

    # --- New hostname label + character counter on the same row ---
    $lblNewHost = New-StyledLabel -Text "NEW HOSTNAME" -X 15 -Y $yPos -IsMuted -FontSize 8 -IsBold
    $card2.Controls.Add($lblNewHost)

    # Character counter right-aligned relative to the input width (15 + 460 = 475, counter at 480)
    $lblCharCount = New-Object System.Windows.Forms.Label
    $lblCharCount.Text = "0 / 15"
    $lblCharCount.Name = 'lblCharCount'
    $lblCharCount.Location = New-Object System.Drawing.Point(418, $yPos)
    $lblCharCount.AutoSize = $true
    $lblCharCount.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $lblCharCount.ForeColor = $script:Theme.TextMuted
    $card2.Controls.Add($lblCharCount)

    $yPos += 18

    # Monospace text box, auto-uppercases input, placeholder matches the React spec
    $txtNewHostname = New-StyledTextBox -X 15 -Y $yPos -Width 460 -Height 30 -PlaceholderText "MYSHOW-D3-01"
    $txtNewHostname.Name = 'txtNewHostname'
    $txtNewHostname.Font = New-Object System.Drawing.Font('Consolas', 10.5)
    $txtNewHostname.MaxLength = 15
    $card2.Controls.Add($txtNewHostname)

    $yPos += 38

    # --- Validation feedback (icon + text) ---
    $lblValidation = New-Object System.Windows.Forms.Label
    $lblValidation.Text = ""
    $lblValidation.Name = 'lblValidation'
    $lblValidation.Location = New-Object System.Drawing.Point(15, $yPos)
    $lblValidation.AutoSize = $false
    $lblValidation.Width = 700
    $lblValidation.MaximumSize = New-Object System.Drawing.Size(700, 0)
    $lblValidation.AutoSize = $true
    $lblValidation.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $lblValidation.ForeColor = $script:Theme.TextMuted
    $card2.Controls.Add($lblValidation)

    $yPos += 30

    # --- Preview panel (hidden until hostname is valid) ---
    $pnlPreview = New-Object System.Windows.Forms.Panel
    $pnlPreview.Name = 'pnlPreview'
    $pnlPreview.Location = New-Object System.Drawing.Point(15, $yPos)
    $pnlPreview.Size = New-Object System.Drawing.Size(860, 110)
    $pnlPreview.BackColor = $script:Theme.Surface
    $pnlPreview.Visible = $false

    # 1px border painted on the preview panel
    $pnlPreview.Add_Paint({
        param($sender, $e)
        $pen = New-Object System.Drawing.Pen($script:Theme.Border, 1)
        $e.Graphics.DrawRectangle($pen, 0, 0, ($sender.Width - 1), ($sender.Height - 1))
        $pen.Dispose()
    })

    # "Preview" heading inside the panel
    $lblPreviewHeading = New-Object System.Windows.Forms.Label
    $lblPreviewHeading.Text = "PREVIEW"
    $lblPreviewHeading.Location = New-Object System.Drawing.Point(12, 10)
    $lblPreviewHeading.AutoSize = $true
    $lblPreviewHeading.Font = New-Object System.Drawing.Font('Segoe UI', 7.5, [System.Drawing.FontStyle]::Bold)
    $lblPreviewHeading.ForeColor = $script:Theme.TextMuted
    $pnlPreview.Controls.Add($lblPreviewHeading)

    $previewMonoFont = New-Object System.Drawing.Font('Consolas', 9.5)

    # UNC path row
    $lblUNCTitle = New-Object System.Windows.Forms.Label
    $lblUNCTitle.Text = "UNC Path"
    $lblUNCTitle.Location = New-Object System.Drawing.Point(12, 30)
    $lblUNCTitle.AutoSize = $true
    $lblUNCTitle.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
    $lblUNCTitle.ForeColor = $script:Theme.TextMuted
    $pnlPreview.Controls.Add($lblUNCTitle)

    $lblPreviewUNC = New-Object System.Windows.Forms.Label
    $lblPreviewUNC.Name = 'lblPreviewUNC'
    $lblPreviewUNC.Text = "\\HOSTNAME\d3 Projects"
    $lblPreviewUNC.Location = New-Object System.Drawing.Point(110, 29)
    $lblPreviewUNC.AutoSize = $true
    $lblPreviewUNC.Font = $previewMonoFont
    $lblPreviewUNC.ForeColor = $script:Theme.Accent
    $pnlPreview.Controls.Add($lblPreviewUNC)

    # d3Net name row
    $lblD3NetTitle = New-Object System.Windows.Forms.Label
    $lblD3NetTitle.Text = "d3Net Name"
    $lblD3NetTitle.Location = New-Object System.Drawing.Point(12, 55)
    $lblD3NetTitle.AutoSize = $true
    $lblD3NetTitle.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
    $lblD3NetTitle.ForeColor = $script:Theme.TextMuted
    $pnlPreview.Controls.Add($lblD3NetTitle)

    $lblPreviewD3Net = New-Object System.Windows.Forms.Label
    $lblPreviewD3Net.Name = 'lblPreviewD3Net'
    $lblPreviewD3Net.Text = "HOSTNAME"
    $lblPreviewD3Net.Location = New-Object System.Drawing.Point(110, 54)
    $lblPreviewD3Net.AutoSize = $true
    $lblPreviewD3Net.Font = $previewMonoFont
    $lblPreviewD3Net.ForeColor = $script:Theme.Accent
    $pnlPreview.Controls.Add($lblPreviewD3Net)

    # API access row
    $lblAPITitle = New-Object System.Windows.Forms.Label
    $lblAPITitle.Text = "API Access"
    $lblAPITitle.Location = New-Object System.Drawing.Point(12, 80)
    $lblAPITitle.AutoSize = $true
    $lblAPITitle.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
    $lblAPITitle.ForeColor = $script:Theme.TextMuted
    $pnlPreview.Controls.Add($lblAPITitle)

    $lblPreviewAPI = New-Object System.Windows.Forms.Label
    $lblPreviewAPI.Name = 'lblPreviewAPI'
    $lblPreviewAPI.Text = "http://HOSTNAME:80/api/..."
    $lblPreviewAPI.Location = New-Object System.Drawing.Point(110, 79)
    $lblPreviewAPI.AutoSize = $true
    $lblPreviewAPI.Font = $previewMonoFont
    $lblPreviewAPI.ForeColor = $script:Theme.Accent
    $pnlPreview.Controls.Add($lblPreviewAPI)

    $card2.Controls.Add($pnlPreview)

    $yPos += 120

    # --- Apply button ---
    $btnApplyHostname = New-StyledButton -Text "Apply Hostname Change" -X 15 -Y $yPos `
                                         -Width 220 -Height 38 -IsPrimary -OnClick {
        $card = $this.Parent
        $txtBox = $card.Controls['txtNewHostname']
        $newName = Get-TextBoxValue $txtBox

        if ([string]::IsNullOrWhiteSpace($newName)) {
            [System.Windows.Forms.MessageBox]::Show(
                "Please enter a new hostname.",
                "No Hostname Entered",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            )
            return
        }

        # Validate before proceeding
        $validation = Test-ServerHostname -Name $newName
        if (-not $validation.IsValid) {
            [System.Windows.Forms.MessageBox]::Show(
                "Invalid hostname: $($validation.ErrorMessage)",
                "Validation Failed",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
            return
        }

        $currentHostname = Get-ServerHostname

        # Confirmation dialog with detailed warning
        $confirmMsg = @"
Are you sure you want to change the hostname?

Current:  $currentHostname
New:      $newName

This change will affect:
  - d3Net discovery name
  - UNC share paths (\\$currentHostname\... will become \\$newName\...)
  - API endpoint addresses
  - Any scripts or configurations referencing this hostname

A RESTART IS REQUIRED for the change to take effect.
All active d3 sessions will be disconnected.
"@

        $confirm = [System.Windows.Forms.MessageBox]::Show(
            $confirmMsg,
            "Confirm Hostname Change",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($confirm -eq [System.Windows.Forms.DialogResult]::Yes) {
            $result = Set-ServerHostname -NewName $newName

            if ($result.Success) {
                $restartMsg = "$($result.Message)`n`nWould you like to restart now?"
                $restartChoice = [System.Windows.Forms.MessageBox]::Show(
                    $restartMsg,
                    "Hostname Changed - Restart Required",
                    [System.Windows.Forms.MessageBoxButtons]::YesNo,
                    [System.Windows.Forms.MessageBoxIcon]::Information
                )

                if ($restartChoice -eq [System.Windows.Forms.DialogResult]::Yes) {
                    try {
                        Restart-Computer -Force
                    }
                    catch {
                        [System.Windows.Forms.MessageBox]::Show(
                            "Failed to initiate restart: $_`n`nPlease restart manually.",
                            "Restart Failed",
                            [System.Windows.Forms.MessageBoxButtons]::OK,
                            [System.Windows.Forms.MessageBoxIcon]::Error
                        )
                    }
                }
            }
            else {
                [System.Windows.Forms.MessageBox]::Show(
                    $result.Message,
                    "Hostname Change Failed",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error
                )
            }
        }
    }
    $card2.Controls.Add($btnApplyHostname)

    # Real-time validation handler -- wired after all named controls exist on card2
    $txtNewHostname.Add_TextChanged({
        $card             = $this.Parent
        $validationLabel  = $card.Controls['lblValidation']
        $charCountLabel   = $card.Controls['lblCharCount']
        $previewPanel     = $card.Controls['pnlPreview']
        $inputText        = $this.Text

        # Suppress validation while showing placeholder text
        if ($inputText -eq $this.Tag) {
            $validationLabel.Text      = ''
            $charCountLabel.Text       = "0 / 15"
            $charCountLabel.ForeColor  = $script:Theme.TextMuted
            $this.BackColor            = $script:Theme.InputBackground
            if ($previewPanel) { $previewPanel.Visible = $false }
            return
        }

        # Auto-uppercase: store caret, update, restore
        $caretPos = $this.SelectionStart
        $upper = $inputText.ToUpper()
        if ($inputText -cne $upper) {
            $this.Text = $upper
            $this.SelectionStart = [Math]::Min($caretPos, $this.Text.Length)
            return  # TextChanged will re-fire with the uppercased value
        }

        # Character counter -- color shifts at thresholds
        $len = $inputText.Length
        $charCountLabel.Text = "$len / 15"
        if ($len -gt 15) {
            $charCountLabel.ForeColor = $script:Theme.Error
        } elseif ($len -gt 12) {
            $charCountLabel.ForeColor = $script:Theme.Warning
        } else {
            $charCountLabel.ForeColor = $script:Theme.TextMuted
        }

        # Empty input -- clear state
        if ([string]::IsNullOrWhiteSpace($inputText)) {
            $validationLabel.Text  = ''
            $this.BackColor        = $script:Theme.InputBackground
            if ($previewPanel) { $previewPanel.Visible = $false }
            return
        }

        # Identify any invalid characters for detailed error messaging
        $invalidFound = @()
        foreach ($ch in $inputText.ToCharArray()) {
            if ($ch -notmatch '[A-Z0-9\-]' -and ($invalidFound -notcontains $ch)) {
                $invalidFound += $ch
            }
        }

        # Run full validation
        $result = Test-ServerHostname -Name $inputText
        if ($result.IsValid) {
            $validationLabel.Text     = [char]0x2713 + "  Valid hostname"   # check mark
            $validationLabel.ForeColor = $script:Theme.Success
            $this.BackColor           = $script:Theme.InputBackground
            if ($previewPanel) { $previewPanel.Visible = $true }
        } else {
            $errText = if ($invalidFound.Count -gt 0) {
                $badChars = ($invalidFound | ForEach-Object { "'$_'" }) -join ', '
                [char]0x2715 + "  Invalid character(s): $badChars"   # cross mark
            } else {
                [char]0x2715 + "  $($result.ErrorMessage)"
            }
            $validationLabel.Text      = $errText
            $validationLabel.ForeColor = $script:Theme.Error
            $this.BackColor            = [System.Drawing.Color]::FromArgb(40, 239, 68, 68)
            if ($previewPanel) { $previewPanel.Visible = $false }
        }

        # Keep preview labels current while valid
        if ($result.IsValid -and $previewPanel) {
            $lblPreviewUNC  = $previewPanel.Controls['lblPreviewUNC']
            $lblPreviewD3Net = $previewPanel.Controls['lblPreviewD3Net']
            $lblPreviewAPI   = $previewPanel.Controls['lblPreviewAPI']
            if ($lblPreviewUNC)   { $lblPreviewUNC.Text   = "\\$inputText\d3 Projects" }
            if ($lblPreviewD3Net) { $lblPreviewD3Net.Text = $inputText }
            if ($lblPreviewAPI)   { $lblPreviewAPI.Text   = "http://${inputText}:80/api/..." }
        }
    })

    $scrollPanel.Controls.Add($card2)

    # ========================================================================
    # Card 3: Naming Conventions  (no accent)
    # ========================================================================
    # 7 guidelines at ~26px each + header area ~120px = ~302px
    $card3 = New-StyledCard -Title "Naming Conventions" -X 24 -Y 920 -Width 900 -Height 350

    $yPos = 48

    # --- "Recommended Format" label + accent-colored monospace format string ---
    $lblRecFormat = New-Object System.Windows.Forms.Label
    $lblRecFormat.Text = "RECOMMENDED FORMAT"
    $lblRecFormat.Location = New-Object System.Drawing.Point(19, $yPos)
    $lblRecFormat.AutoSize = $true
    $lblRecFormat.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $lblRecFormat.ForeColor = $script:Theme.TextMuted
    $card3.Controls.Add($lblRecFormat)

    $yPos += 20

    $lblFormatValue = New-Object System.Windows.Forms.Label
    $lblFormatValue.Text = "{SHOW}-{ROLE}-{NUMBER}"
    $lblFormatValue.Location = New-Object System.Drawing.Point(19, $yPos)
    $lblFormatValue.AutoSize = $true
    $lblFormatValue.Font = New-Object System.Drawing.Font('Consolas', 14, [System.Drawing.FontStyle]::Bold)
    $lblFormatValue.ForeColor = $script:Theme.Primary
    $card3.Controls.Add($lblFormatValue)

    $yPos += 36

    # --- "Examples" label + 3 pill-shaped monospace tags ---
    $lblExamples = New-Object System.Windows.Forms.Label
    $lblExamples.Text = "EXAMPLES"
    $lblExamples.Location = New-Object System.Drawing.Point(19, $yPos)
    $lblExamples.AutoSize = $true
    $lblExamples.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $lblExamples.ForeColor = $script:Theme.TextMuted
    $card3.Controls.Add($lblExamples)

    $yPos += 20

    # Render pill-shaped example tags at fixed horizontal positions
    $exampleTags = @("MYSHOW-D3-01", "CONCERT-GX3-02", "TOUR-D3-03")
    $tagX = 19
    $tagFont = New-Object System.Drawing.Font('Consolas', 9.5)

    foreach ($tagText in $exampleTags) {
        # Measure text width to size the pill correctly
        $tempGfx = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
        $measured = $tempGfx.MeasureString($tagText, $tagFont)
        $tempGfx.Dispose()
        $tagWidth  = [int]$measured.Width + 24
        $tagHeight = 26

        $tagPanel = New-Object System.Windows.Forms.Panel
        $tagPanel.Location = New-Object System.Drawing.Point($tagX, $yPos)
        $tagPanel.Size = New-Object System.Drawing.Size($tagWidth, $tagHeight)
        $tagPanel.BackColor = $script:Theme.Surface

        # Capture values for paint closure
        $capturedText  = $tagText
        $capturedFont  = $tagFont
        $capturedW     = $tagWidth
        $capturedH     = $tagHeight

        $tagPanel.Add_Paint({
            param($sender, $e)
            $g = $e.Graphics
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

            # Border
            $pen = New-Object System.Drawing.Pen($script:Theme.BorderLight, 1)
            $rect = New-Object System.Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))
            $radius = 5
            $path = New-Object System.Drawing.Drawing2D.GraphicsPath
            $path.AddArc($rect.X, $rect.Y, $radius * 2, $radius * 2, 180, 90)
            $path.AddArc($rect.Right - $radius * 2, $rect.Y, $radius * 2, $radius * 2, 270, 90)
            $path.AddArc($rect.Right - $radius * 2, $rect.Bottom - $radius * 2, $radius * 2, $radius * 2, 0, 90)
            $path.AddArc($rect.X, $rect.Bottom - $radius * 2, $radius * 2, $radius * 2, 90, 90)
            $path.CloseFigure()
            $g.DrawPath($pen, $path)
            $pen.Dispose()
            $path.Dispose()

            # Text
            $textBrush = New-Object System.Drawing.SolidBrush($script:Theme.TextSecondary)
            $sf = New-Object System.Drawing.StringFormat
            $sf.Alignment     = [System.Drawing.StringAlignment]::Center
            $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
            $textRect = New-Object System.Drawing.RectangleF(0, 0, $sender.Width, $sender.Height)
            $g.DrawString($sender.Tag, $capturedFont, $textBrush, $textRect, $sf)
            $textBrush.Dispose()
            $sf.Dispose()
        }.GetNewClosure())

        $tagPanel.Tag = $capturedText
        $card3.Controls.Add($tagPanel)
        $tagX += $tagWidth + 10
    }

    $yPos += 38

    # Separator between examples and guidelines
    $sep2 = New-Object System.Windows.Forms.Panel
    $sep2.Location = New-Object System.Drawing.Point(19, $yPos)
    $sep2.Size = New-Object System.Drawing.Size(856, 1)
    $sep2.BackColor = $script:Theme.Border
    $card3.Controls.Add($sep2)

    $yPos += 14

    # --- "Guidelines" label + 7 bullet points ---
    $lblGuidelinesHdr = New-Object System.Windows.Forms.Label
    $lblGuidelinesHdr.Text = "GUIDELINES"
    $lblGuidelinesHdr.Location = New-Object System.Drawing.Point(19, $yPos)
    $lblGuidelinesHdr.AutoSize = $true
    $lblGuidelinesHdr.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $lblGuidelinesHdr.ForeColor = $script:Theme.TextMuted
    $card3.Controls.Add($lblGuidelinesHdr)

    $yPos += 20

    $guidelines = @(
        "Maximum 15 characters (Windows NetBIOS limit)",
        "Use only letters (A-Z), numbers (0-9), and hyphens (-)",
        "Cannot start or end with a hyphen",
        "No spaces, underscores, or special characters",
        "Used for d3Net discovery -- must be unique on the subnet",
        "UNC share paths reference the hostname (\\hostname\d3 Projects)",
        "API endpoint addresses use the hostname as the host (http://hostname:80/api/...)"
    )

    foreach ($guideline in $guidelines) {
        # Purple dot bullet indicator
        $bullet = New-Object System.Windows.Forms.Panel
        $bullet.Location = New-Object System.Drawing.Point(19, ($yPos + 5))
        $bullet.Size = New-Object System.Drawing.Size(7, 7)
        $bullet.BackColor = $script:Theme.Primary

        $bullet.Add_Paint({
            param($sender, $e)
            $g = $e.Graphics
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $brush = New-Object System.Drawing.SolidBrush($script:Theme.Primary)
            $g.FillEllipse($brush, 0, 0, ($sender.Width - 1), ($sender.Height - 1))
            $brush.Dispose()
        })

        $card3.Controls.Add($bullet)

        $guideLabel = New-Object System.Windows.Forms.Label
        $guideLabel.Text = $guideline
        $guideLabel.Location = New-Object System.Drawing.Point(34, $yPos)
        $guideLabel.AutoSize = $false
        $guideLabel.Width = 840
        $guideLabel.MaximumSize = New-Object System.Drawing.Size(840, 0)
        $guideLabel.AutoSize = $true
        $guideLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
        $guideLabel.ForeColor = $script:Theme.TextSecondary
        $card3.Controls.Add($guideLabel)

        $yPos += 26
    }

    $scrollPanel.Controls.Add($card3)

    # Commit to the content panel
    $ContentPanel.Controls.Add($scrollPanel)
    $ContentPanel.ResumeLayout()
}
