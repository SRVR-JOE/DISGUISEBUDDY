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
        Write-AppLog -Message "Retrieved server hostname: $hostname" -Level DEBUG
        return $hostname
    }
    catch {
        Write-AppLog -Message "Failed to retrieve hostname: $_" -Level ERROR
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
        Write-AppLog -Message "Hostname validation failed for '$NewName': $($validation.ErrorMessage)" -Level WARN
        return [PSCustomObject]@{
            Success         = $false
            Message         = "Invalid hostname: $($validation.ErrorMessage)"
            RestartRequired = $false
        }
    }

    try {
        Rename-Computer -NewName $NewName -Force -ErrorAction Stop
        Write-AppLog -Message "Hostname change to '$NewName' applied successfully. Restart required." -Level INFO
        return [PSCustomObject]@{
            Success         = $true
            Message         = "Hostname will change to '$NewName' after the next restart."
            RestartRequired = $true
        }
    }
    catch {
        Write-AppLog -Message "Failed to change hostname to '$NewName': $_" -Level ERROR
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

        Write-AppLog -Message "Retrieved system info for '$($cs.Name)'." -Level DEBUG
        return $info
    }
    catch {
        Write-AppLog -Message "Failed to retrieve system info: $_" -Level ERROR

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
    .PARAMETER ContentPanel
        The parent panel in which to render the view.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.Panel]$ContentPanel
    )

    # Clear existing content
    $ContentPanel.Controls.Clear()

    # Compute card width dynamically based on content panel width minus padding
    $cardWidth = $ContentPanel.ClientSize.Width - 40

    # Create a scrollable container for all content
    $scrollPanel = New-ScrollPanel -X 0 -Y 0 -Width $ContentPanel.Width -Height $ContentPanel.Height
    $scrollPanel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                          [System.Windows.Forms.AnchorStyles]::Left -bor
                          [System.Windows.Forms.AnchorStyles]::Right -bor
                          [System.Windows.Forms.AnchorStyles]::Bottom

    # ---- Section Header ----
    $header = New-SectionHeader -Text "Server Identity" -X 20 -Y 15 -Width $cardWidth
    $scrollPanel.Controls.Add($header)

    $subtitle = New-StyledLabel -Text "Manage server hostname and system identification" -X 20 -Y 55 -IsSecondary
    $scrollPanel.Controls.Add($subtitle)

    # Retrieve system information once for use across all cards
    $sysInfo = Get-ServerSystemInfo

    # ========================================================================
    # Card 1: Current Identity
    # ========================================================================
    $card1 = New-StyledCard -Title "Current Identity" -X 20 -Y 90 -Width $cardWidth -Height 300

    # Status badge: Domain-joined vs Workgroup
    $domainStatusType = if ($sysInfo.DomainType -eq 'Domain') { 'Info' } else { 'Warning' }
    $domainStatusText = if ($sysInfo.DomainType -eq 'Domain') { "DOMAIN: $($sysInfo.Domain)" } else { "WORKGROUP: $($sysInfo.Domain)" }
    $domainBadge = New-StatusBadge -Text $domainStatusText -X ($cardWidth - 200) -Y 15 -Type $domainStatusType
    $card1.Controls.Add($domainBadge)

    # Large hostname display
    $lblHostnameValue = New-StyledLabel -Text $sysInfo.Hostname -X 15 -Y 50 -FontSize 18 -IsBold
    $lblHostnameValue.ForeColor = $script:Theme.Primary
    $card1.Controls.Add($lblHostnameValue)

    $lblHostnameHint = New-StyledLabel -Text "Server Hostname" -X 15 -Y 85 -IsMuted -FontSize 9
    $card1.Controls.Add($lblHostnameHint)

    # System info grid
    $infoStartY = 115
    $infoRowHeight = 28
    $labelX = 15
    $valueX = 160

    # OS
    $lblOS = New-StyledLabel -Text "OS:" -X $labelX -Y $infoStartY -IsBold -FontSize 9.5
    $card1.Controls.Add($lblOS)
    $lblOSValue = New-StyledLabel -Text $sysInfo.OSVersion -X $valueX -Y $infoStartY -FontSize 9.5 -MaxWidth 700
    $card1.Controls.Add($lblOSValue)
    $infoStartY += $infoRowHeight

    # Domain / Workgroup
    $lblDomain = New-StyledLabel -Text "$($sysInfo.DomainType):" -X $labelX -Y $infoStartY -IsBold -FontSize 9.5
    $card1.Controls.Add($lblDomain)
    $lblDomainValue = New-StyledLabel -Text $sysInfo.Domain -X $valueX -Y $infoStartY -FontSize 9.5
    $card1.Controls.Add($lblDomainValue)
    $infoStartY += $infoRowHeight

    # Uptime
    $lblUptime = New-StyledLabel -Text "Uptime:" -X $labelX -Y $infoStartY -IsBold -FontSize 9.5
    $card1.Controls.Add($lblUptime)
    $lblUptimeValue = New-StyledLabel -Text $sysInfo.Uptime -X $valueX -Y $infoStartY -FontSize 9.5
    $card1.Controls.Add($lblUptimeValue)
    $infoStartY += $infoRowHeight

    # Model
    $lblModel = New-StyledLabel -Text "Model:" -X $labelX -Y $infoStartY -IsBold -FontSize 9.5
    $card1.Controls.Add($lblModel)
    $lblModelValue = New-StyledLabel -Text $sysInfo.Model -X $valueX -Y $infoStartY -FontSize 9.5 -MaxWidth 700
    $card1.Controls.Add($lblModelValue)
    $infoStartY += $infoRowHeight

    # Serial Number
    $lblSerial = New-StyledLabel -Text "Serial Number:" -X $labelX -Y $infoStartY -IsBold -FontSize 9.5
    $card1.Controls.Add($lblSerial)
    $lblSerialValue = New-StyledLabel -Text $sysInfo.SerialNumber -X $valueX -Y $infoStartY -FontSize 9.5
    $card1.Controls.Add($lblSerialValue)

    $scrollPanel.Controls.Add($card1)

    # ========================================================================
    # Card 2: Change Hostname
    # ========================================================================
    $card2 = New-StyledCard -Title "Change Hostname" -X 20 -Y 410 -Width $cardWidth -Height 400

    $yPos = 45

    # Warning label
    $lblWarning = New-StyledLabel -Text "WARNING: Changing the hostname requires a restart. All d3Net sessions will be disrupted." -X 15 -Y $yPos -FontSize 9.5 -MaxWidth ($cardWidth - 30)
    $lblWarning.ForeColor = $script:Theme.Warning
    $lblWarning.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
    $card2.Controls.Add($lblWarning)

    $yPos += 35

    # Current hostname
    $lblCurrentHost = New-StyledLabel -Text "Current Hostname:" -X 15 -Y $yPos -IsBold
    $card2.Controls.Add($lblCurrentHost)
    $lblCurrentHostValue = New-StyledLabel -Text $sysInfo.Hostname -X 200 -Y $yPos
    $card2.Controls.Add($lblCurrentHostValue)

    $yPos += 38

    # New hostname input
    $lblNewHost = New-StyledLabel -Text "New Hostname:" -X 15 -Y $yPos -IsBold
    $card2.Controls.Add($lblNewHost)

    $txtNewHostname = New-StyledTextBox -X 200 -Y $yPos -Width 300 -PlaceholderText "e.g., MYSHOW-D3-01"
    $txtNewHostname.Name = 'txtNewHostname'
    $card2.Controls.Add($txtNewHostname)

    # Character count label
    $lblCharCount = New-StyledLabel -Text "0/15 characters" -X 510 -Y ($yPos + 4) -IsMuted -FontSize 8.5
    $lblCharCount.Name = 'lblCharCount'
    $card2.Controls.Add($lblCharCount)

    $yPos += 35

    # Validation feedback label
    $lblValidation = New-StyledLabel -Text "" -X 200 -Y $yPos -FontSize 9 -MaxWidth ($cardWidth - 120)
    $lblValidation.Name = 'lblValidation'
    $card2.Controls.Add($lblValidation)

    # Real-time validation on text change
    $txtNewHostname.Add_TextChanged({
        $card = $this.Parent
        $validationLabel = $card.Controls['lblValidation']
        $charCountLabel = $card.Controls['lblCharCount']
        $previewPanel = $card.Controls['pnlPreview']
        $inputText = $this.Text

        # Handle placeholder text (do not validate the placeholder)
        if ($inputText -eq $this.Tag) {
            $validationLabel.Text = ''
            $charCountLabel.Text = '0/15 characters'
            $charCountLabel.ForeColor = $script:Theme.TextMuted
            if ($previewPanel) { $previewPanel.Visible = $false }
            return
        }

        # Update character count
        $len = $inputText.Length
        $charCountLabel.Text = "$len/15 characters"
        if ($len -gt 15) {
            $charCountLabel.ForeColor = $script:Theme.Error
        }
        elseif ($len -gt 12) {
            $charCountLabel.ForeColor = $script:Theme.Warning
        }
        else {
            $charCountLabel.ForeColor = $script:Theme.TextMuted
        }

        if ([string]::IsNullOrWhiteSpace($inputText)) {
            $validationLabel.Text = ''
            if ($previewPanel) { $previewPanel.Visible = $false }
            return
        }

        # Run validation
        $result = Test-ServerHostname -Name $inputText
        if ($result.IsValid) {
            $validationLabel.Text = "[OK] Valid hostname"
            $validationLabel.ForeColor = $script:Theme.Success
            if ($previewPanel) { $previewPanel.Visible = $true }
        }
        else {
            $validationLabel.Text = "[X] $($result.ErrorMessage)"
            $validationLabel.ForeColor = $script:Theme.Error
            if ($previewPanel) { $previewPanel.Visible = $false }
        }

        # Update preview content if valid
        if ($result.IsValid -and $previewPanel) {
            $lblPreviewUNC = $previewPanel.Controls['lblPreviewUNC']
            $lblPreviewD3Net = $previewPanel.Controls['lblPreviewD3Net']
            $lblPreviewAPI = $previewPanel.Controls['lblPreviewAPI']
            if ($lblPreviewUNC)   { $lblPreviewUNC.Text   = "UNC Path:    \\$inputText\d3 Projects" }
            if ($lblPreviewD3Net) { $lblPreviewD3Net.Text = "d3Net Name:  $inputText" }
            if ($lblPreviewAPI)   { $lblPreviewAPI.Text   = "API Access:  http://${inputText}:80/api/..." }
        }
    })

    $yPos += 30

    # Preview Changes section
    $lblPreviewTitle = New-StyledLabel -Text "Preview Changes:" -X 15 -Y $yPos -IsBold -FontSize 10.5
    $card2.Controls.Add($lblPreviewTitle)

    $yPos += 28

    $pnlPreview = New-StyledPanel -X 15 -Y $yPos -Width ($cardWidth - 30) -Height 100 -IsCard
    $pnlPreview.Name = 'pnlPreview'
    $pnlPreview.Visible = $false

    $lblPreviewUNC = New-StyledLabel -Text "UNC Path:    \\NEWNAME\d3 Projects" -X 10 -Y 10 -FontSize 9.5 -MaxWidth ($cardWidth - 60)
    $lblPreviewUNC.Name = 'lblPreviewUNC'
    $lblPreviewUNC.Font = New-Object System.Drawing.Font('Consolas', 9.5)
    $pnlPreview.Controls.Add($lblPreviewUNC)

    $lblPreviewD3Net = New-StyledLabel -Text "d3Net Name:  NEWNAME" -X 10 -Y 35 -FontSize 9.5 -MaxWidth ($cardWidth - 60)
    $lblPreviewD3Net.Name = 'lblPreviewD3Net'
    $lblPreviewD3Net.Font = New-Object System.Drawing.Font('Consolas', 9.5)
    $pnlPreview.Controls.Add($lblPreviewD3Net)

    $lblPreviewAPI = New-StyledLabel -Text "API Access:  http://NEWNAME:80/api/..." -X 10 -Y 60 -FontSize 9.5 -MaxWidth ($cardWidth - 60)
    $lblPreviewAPI.Name = 'lblPreviewAPI'
    $lblPreviewAPI.Font = New-Object System.Drawing.Font('Consolas', 9.5)
    $pnlPreview.Controls.Add($lblPreviewAPI)

    $card2.Controls.Add($pnlPreview)

    $yPos += 115

    # Apply Hostname Change button
    $btnApplyHostname = New-StyledButton -Text "Apply Hostname Change" -X 15 -Y $yPos -Width 200 -Height 40 -IsPrimary -OnClick {
        $card = $this.Parent
        $newName = $card.Controls['txtNewHostname'].Text

        # Handle placeholder text
        if (-not $newName -or $newName -eq $card.Controls['txtNewHostname'].Tag) {
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

    $scrollPanel.Controls.Add($card2)

    # ========================================================================
    # Card 3: Naming Conventions
    # ========================================================================
    $card3 = New-StyledCard -Title "Naming Conventions" -X 20 -Y 830 -Width $cardWidth -Height 310

    $yPos = 50

    # Info icon-style indicator
    $infoBadge = New-StatusBadge -Text "INFO" -X ($cardWidth - 100) -Y 15 -Type Info
    $card3.Controls.Add($infoBadge)

    # Recommended format
    $lblRecFormat = New-StyledLabel -Text "Recommended Format" -X 15 -Y $yPos -IsBold -FontSize 10.5
    $card3.Controls.Add($lblRecFormat)
    $yPos += 25

    $lblFormatExample = New-StyledLabel -Text "{SHOW}-{ROLE}-{NUMBER}" -X 15 -Y $yPos -FontSize 11
    $lblFormatExample.Font = New-Object System.Drawing.Font('Consolas', 11, [System.Drawing.FontStyle]::Bold)
    $lblFormatExample.ForeColor = $script:Theme.Accent
    $card3.Controls.Add($lblFormatExample)

    $lblFormatDesc = New-StyledLabel -Text "Example: MYSHOW-D3-01, CONCERT-GX3-02, TOUR24-UDX-01" -X 350 -Y ($yPos + 2) -IsSecondary -FontSize 9.5
    $card3.Controls.Add($lblFormatDesc)
    $yPos += 38

    # Separator line
    $separator = New-Object System.Windows.Forms.Panel
    $separator.Location = New-Object System.Drawing.Point(15, $yPos)
    $separator.Size = New-Object System.Drawing.Size(($cardWidth - 30), 1)
    $separator.BackColor = $script:Theme.Border
    $card3.Controls.Add($separator)
    $yPos += 15

    # Guidelines list
    $guidelines = @(
        "NetBIOS limit: 15 characters maximum",
        "Use only letters (A-Z), numbers (0-9), and hyphens (-)",
        "Avoid spaces, underscores, and special characters",
        "The hostname is used for d3Net discovery, UNC share paths (\\hostname\d3 Projects\), and API access"
    )

    foreach ($guideline in $guidelines) {
        $bulletLabel = New-StyledLabel -Text $guideline -X 30 -Y $yPos -FontSize 9.5 -MaxWidth ($cardWidth - 60)
        $card3.Controls.Add($bulletLabel)

        # Bullet point marker
        $bulletMarker = New-StyledLabel -Text "`u{2022}" -X 15 -Y $yPos -FontSize 9.5
        $bulletMarker.ForeColor = $script:Theme.Primary
        $card3.Controls.Add($bulletMarker)

        $yPos += 25
    }

    $scrollPanel.Controls.Add($card3)

    # Add scroll panel to content panel
    $ContentPanel.Controls.Add($scrollPanel)
}
