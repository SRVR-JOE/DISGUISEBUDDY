# Dashboard.ps1 - DISGUISE BUDDY Dashboard Overview Module
# Provides the New-DashboardView function which builds the main Dashboard panel
# displaying quick status cards, network overview, recent profiles, and quick actions.

# ============================================================================
# Application state is initialized in DisguiseBuddy.ps1 before modules load
# ============================================================================

# ============================================================================
# Helper Functions (private to this module)
# ============================================================================

function Get-CurrentHostname {
    <#
    .SYNOPSIS
        Returns the current machine hostname, with cross-platform fallback.
    #>
    try {
        if ($env:COMPUTERNAME) {
            return $env:COMPUTERNAME
        }
        # Fallback for non-Windows (Linux/macOS)
        return (hostname)
    } catch {
        return "N/A"
    }
}

function Get-ActiveAdapterCount {
    <#
    .SYNOPSIS
        Returns a formatted string showing active vs total adapter count.
        Gracefully handles non-Windows systems.
    #>
    try {
        $allAdapters = Get-NetAdapter -ErrorAction Stop
        $activeAdapters = $allAdapters | Where-Object { $_.Status -eq 'Up' }
        $totalCount = $allAdapters.Count
        $activeCount = @($activeAdapters).Count
        return "$activeCount / $totalCount Active"
    } catch {
        return "N/A"
    }
}

function Get-ActiveShareCount {
    <#
    .SYNOPSIS
        Returns the count of non-default SMB shares.
        Gracefully handles non-Windows systems.
    #>
    try {
        $shares = Get-SmbShare -ErrorAction Stop |
            Where-Object { $_.Name -notmatch '^\$|^IPC\$|^ADMIN\$|^C\$|^D\$' }
        return "$(@($shares).Count) Shares"
    } catch {
        return "N/A"
    }
}

function Get-AdapterSummaryData {
    <#
    .SYNOPSIS
        Returns an array of adapter summary objects for the network overview table.
        Each object has: Role, InterfaceAlias, IPAddress, Status.
        Falls back to placeholder data on non-Windows systems.
    #>

    # Define the 6 standard disguise adapter roles
    $roles = @(
        @{ Role = "Management"; Color = "Blue" },
        @{ Role = "d3Net";      Color = "Purple" },
        @{ Role = "Media";      Color = "Green" },
        @{ Role = "NDI";        Color = "Cyan" },
        @{ Role = "KVM";        Color = "Orange" },
        @{ Role = "Backup";     Color = "Gray" }
    )

    $summaryData = [System.Collections.ArrayList]::new()

    try {
        $adapters = Get-NetAdapter -ErrorAction Stop
        $ipConfigs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop

        foreach ($roleEntry in $roles) {
            $roleName = $roleEntry.Role
            # Try to find an adapter whose name or description matches the role
            $matchedAdapter = $adapters | Where-Object {
                $_.Name -match $roleName -or $_.InterfaceDescription -match $roleName
            } | Select-Object -First 1

            if ($matchedAdapter) {
                $ipInfo = $ipConfigs | Where-Object { $_.InterfaceIndex -eq $matchedAdapter.InterfaceIndex } |
                    Select-Object -First 1
                $ipAddr = if ($ipInfo) { $ipInfo.IPAddress } else { "No IP" }
                $status = $matchedAdapter.Status

                [void]$summaryData.Add([PSCustomObject]@{
                    Role    = $roleName
                    Color   = $roleEntry.Color
                    IP      = $ipAddr
                    Status  = $status
                })
            } else {
                [void]$summaryData.Add([PSCustomObject]@{
                    Role    = $roleName
                    Color   = $roleEntry.Color
                    IP      = "Not Configured"
                    Status  = "N/A"
                })
            }
        }
    } catch {
        # Non-Windows or Get-NetAdapter not available: return placeholder data
        foreach ($roleEntry in $roles) {
            [void]$summaryData.Add([PSCustomObject]@{
                Role    = $roleEntry.Role
                Color   = $roleEntry.Color
                IP      = "Not Configured"
                Status  = "N/A"
            })
        }
    }

    return $summaryData.ToArray()
}

function Get-RecentProfilesList {
    <#
    .SYNOPSIS
        Returns the 5 most recently modified profiles, sorted by date descending.
    #>
    try {
        $allProfiles = Get-AllProfiles
        if ($allProfiles -and $allProfiles.Count -gt 0) {
            # Sort by Modified date if the property exists, otherwise by Name
            $sorted = $allProfiles | Sort-Object -Property {
                if ($_.Modified) { [datetime]$_.Modified } else { [datetime]::MinValue }
            } -Descending | Select-Object -First 5
            return $sorted
        }
    } catch {
        Write-AppLog -Message "Dashboard: Could not load profiles - $_" -Level 'WARN'
    }
    return @()
}

# ============================================================================
# UI View Function - Dashboard
# ============================================================================

function New-DashboardView {
    <#
    .SYNOPSIS
        Creates the Dashboard overview panel for DISGUISE BUDDY.
    .DESCRIPTION
        Builds the main Dashboard view with:
          - Row 1: Four quick-status cards (hostname, active profile, adapters, SMB shares)
          - Row 2: Network Overview (left) and Recent Profiles (right)
          - Row 3: Quick Actions bar
        Reads live system data where available, gracefully falling back to "N/A" on
        non-Windows platforms.
    .PARAMETER ContentPanel
        The parent panel to populate with dashboard controls.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.Panel]$ContentPanel
    )

    # Clear any existing controls from the content panel
    $ContentPanel.Controls.Clear()

    # Create a scrollable container for the entire dashboard
    $scrollContainer = New-ScrollPanel -X 0 -Y 0 -Width $ContentPanel.Width -Height $ContentPanel.Height
    $scrollContainer.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                              [System.Windows.Forms.AnchorStyles]::Left -bor
                              [System.Windows.Forms.AnchorStyles]::Right -bor
                              [System.Windows.Forms.AnchorStyles]::Bottom

    # ===================================================================
    # Section Header with Refresh Button
    # ===================================================================
    $sectionHeader = New-SectionHeader -Text "Dashboard" -X 20 -Y 10 -Width 900

    $subtitleLabel = New-StyledLabel -Text "DISGUISE BUDDY - Server Configuration Manager" `
        -X 20 -Y 48 -FontSize 9 -IsSecondary

    # Refresh button in the header area
    $btnRefreshDashboard = New-StyledButton -Text ([char]0x21BB + " Refresh") -X 820 -Y 10 `
        -Width 100 -Height 30
    $btnRefreshDashboard.Add_Click({
        try {
            Write-AppLog -Message "Dashboard: Refreshing all data" -Level 'INFO'
            Set-ActiveView -ViewName 'Dashboard'
        } catch {
            Write-AppLog -Message "Dashboard: Refresh failed - $_" -Level 'WARN'
        }
    })

    $scrollContainer.Controls.Add($sectionHeader)
    $scrollContainer.Controls.Add($subtitleLabel)
    $scrollContainer.Controls.Add($btnRefreshDashboard)

    # ===================================================================
    # Row 1: Quick Status Cards (4 cards in a row)
    # ===================================================================
    $cardY = 80
    $cardWidth = 215
    $cardHeight = 100
    $cardSpacing = 10
    $cardStartX = 20

    # --- Gather live data ---
    $currentHostname = Get-CurrentHostname
    $activeProfile = if ($script:AppState.LastAppliedProfile) { $script:AppState.LastAppliedProfile } else { "None" }
    $adapterCount = Get-ActiveAdapterCount
    $shareCount = Get-ActiveShareCount

    # --- Card 1: Server Name ---
    $card1 = New-StyledCard -Title "Server Name" -X $cardStartX -Y $cardY `
        -Width $cardWidth -Height $cardHeight

    # Left accent border - Accent (cyan) for hostname
    $card1Accent = New-Object System.Windows.Forms.Panel
    $card1Accent.Location = New-Object System.Drawing.Point(0, 0)
    $card1Accent.Size = New-Object System.Drawing.Size(4, $cardHeight)
    $card1Accent.BackColor = $script:Theme.Accent
    $card1.Controls.Add($card1Accent)

    $hostnameStatusBadge = New-StatusBadge -Text "LIVE" -X 150 -Y 15 -Type 'Success'
    $card1.Controls.Add($hostnameStatusBadge)

    $lblHostnameValue = New-StyledLabel -Text $currentHostname -X 15 -Y 50 -FontSize 14 -IsBold -MaxWidth ($cardWidth - 30)
    $card1.Controls.Add($lblHostnameValue)

    $scrollContainer.Controls.Add($card1)

    # --- Card 2: Active Profile ---
    $card2X = $cardStartX + $cardWidth + $cardSpacing
    $card2 = New-StyledCard -Title "Active Profile" -X $card2X -Y $cardY `
        -Width $cardWidth -Height $cardHeight

    # Left accent border - Primary (purple) for profile
    $card2Accent = New-Object System.Windows.Forms.Panel
    $card2Accent.Location = New-Object System.Drawing.Point(0, 0)
    $card2Accent.Size = New-Object System.Drawing.Size(4, $cardHeight)
    $card2Accent.BackColor = $script:Theme.Primary
    $card2.Controls.Add($card2Accent)

    $profileBadgeType = if ($activeProfile -eq "None") { 'Warning' } else { 'Info' }
    $profileStatusBadge = New-StatusBadge -Text $profileBadgeType.ToUpper() `
        -X 150 -Y 15 -Type $profileBadgeType
    $card2.Controls.Add($profileStatusBadge)

    $lblProfileValue = New-StyledLabel -Text $activeProfile -X 15 -Y 50 -FontSize 12 -IsBold -MaxWidth ($cardWidth - 30)
    $card2.Controls.Add($lblProfileValue)

    $scrollContainer.Controls.Add($card2)

    # --- Card 3: Network Adapters ---
    $card3X = $card2X + $cardWidth + $cardSpacing
    $card3 = New-StyledCard -Title "Network Adapters" -X $card3X -Y $cardY `
        -Width $cardWidth -Height $cardHeight

    # Left accent border - Success (green) for adapters
    $card3Accent = New-Object System.Windows.Forms.Panel
    $card3Accent.Location = New-Object System.Drawing.Point(0, 0)
    $card3Accent.Size = New-Object System.Drawing.Size(4, $cardHeight)
    $card3Accent.BackColor = $script:Theme.Success
    $card3.Controls.Add($card3Accent)

    $adapterBadgeType = if ($adapterCount -eq "N/A") { 'Warning' } else { 'Success' }
    $adapterStatusBadge = New-StatusBadge -Text $adapterBadgeType.ToUpper() `
        -X 150 -Y 15 -Type $adapterBadgeType
    $card3.Controls.Add($adapterStatusBadge)

    $lblAdapterValue = New-StyledLabel -Text $adapterCount -X 15 -Y 50 -FontSize 12 -IsBold -MaxWidth ($cardWidth - 30)
    $card3.Controls.Add($lblAdapterValue)

    $scrollContainer.Controls.Add($card3)

    # --- Card 4: SMB Shares ---
    $card4X = $card3X + $cardWidth + $cardSpacing
    $card4 = New-StyledCard -Title "SMB Shares" -X $card4X -Y $cardY `
        -Width $cardWidth -Height $cardHeight

    # Left accent border - Warning (orange) for SMB
    $card4Accent = New-Object System.Windows.Forms.Panel
    $card4Accent.Location = New-Object System.Drawing.Point(0, 0)
    $card4Accent.Size = New-Object System.Drawing.Size(4, $cardHeight)
    $card4Accent.BackColor = $script:Theme.Warning
    $card4.Controls.Add($card4Accent)

    $shareBadgeType = if ($shareCount -eq "N/A") { 'Warning' } else { 'Info' }
    $shareStatusBadge = New-StatusBadge -Text $shareBadgeType.ToUpper() `
        -X 150 -Y 15 -Type $shareBadgeType
    $card4.Controls.Add($shareStatusBadge)

    $lblShareValue = New-StyledLabel -Text $shareCount -X 15 -Y 50 -FontSize 12 -IsBold -MaxWidth ($cardWidth - 30)
    $card4.Controls.Add($lblShareValue)

    $scrollContainer.Controls.Add($card4)

    # ===================================================================
    # Row 2: Two-column layout
    # ===================================================================
    $row2Y = $cardY + $cardHeight + 20  # 200
    $colWidth = 440
    $colHeight = 300
    $colSpacing = 20

    # --- Left Column: Network Overview ---
    $networkCard = New-StyledCard -Title "Network Overview" -X 20 -Y $row2Y `
        -Width $colWidth -Height $colHeight

    # Build the adapter summary table using a DataGridView
    $adapterData = Get-AdapterSummaryData

    $dgvAdapters = New-StyledDataGridView -X 15 -Y 45 -Width ($colWidth - 30) -Height 200

    # Columns: Status dot (color), Role, IP Address, Status badge
    $colDot = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colDot.HeaderText = ""
    $colDot.Name = "StatusDot"
    $colDot.Width = 30
    $colDot.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colRole = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colRole.HeaderText = "Role"
    $colRole.Name = "Role"
    $colRole.Width = 100
    $colRole.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colAdapterIP = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colAdapterIP.HeaderText = "IP Address"
    $colAdapterIP.Name = "IPAddress"
    $colAdapterIP.Width = 140
    $colAdapterIP.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colAdapterStatus = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colAdapterStatus.HeaderText = "Status"
    $colAdapterStatus.Name = "Status"
    $colAdapterStatus.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::Fill

    $dgvAdapters.Columns.AddRange(@($colDot, $colRole, $colAdapterIP, $colAdapterStatus))
    $dgvAdapters.ReadOnly = $true

    # Populate adapter rows
    foreach ($adapter in $adapterData) {
        $dotChar = [char]0x25CF  # Unicode filled circle
        $rowIndex = $dgvAdapters.Rows.Add($dotChar, $adapter.Role, $adapter.IP, $adapter.Status)

        # Color the status dot based on adapter role color
        $dotColor = switch ($adapter.Color) {
            "Blue"   { $script:Theme.Accent }
            "Purple" { $script:Theme.Primary }
            "Green"  { $script:Theme.Success }
            "Cyan"   { [System.Drawing.ColorTranslator]::FromHtml('#06B6D4') }
            "Orange" { $script:Theme.Warning }
            "Gray"   { $script:Theme.TextMuted }
            default  { $script:Theme.TextSecondary }
        }
        $dgvAdapters.Rows[$rowIndex].Cells["StatusDot"].Style.ForeColor = $dotColor
        $dgvAdapters.Rows[$rowIndex].Cells["StatusDot"].Style.Font = New-Object System.Drawing.Font('Segoe UI', 12)

        # Color the status cell
        if ($adapter.Status -eq 'Up') {
            $dgvAdapters.Rows[$rowIndex].Cells["Status"].Style.ForeColor = $script:Theme.Success
        } elseif ($adapter.Status -eq 'N/A') {
            $dgvAdapters.Rows[$rowIndex].Cells["Status"].Style.ForeColor = $script:Theme.TextMuted
        } else {
            $dgvAdapters.Rows[$rowIndex].Cells["Status"].Style.ForeColor = $script:Theme.Error
        }
    }

    $networkCard.Controls.Add($dgvAdapters)

    # "Configure" button at the bottom of the network card
    $btnConfigureNetwork = New-StyledButton -Text "Configure" -X 15 -Y 258 `
        -Width 120 -Height 30 -IsPrimary
    $btnConfigureNetwork.Add_Click({
        try {
            Set-ActiveView -ViewName 'Network'
        } catch {
            Write-AppLog -Message "Dashboard: Navigate to Network failed - $_" -Level 'WARN'
        }
    })
    $networkCard.Controls.Add($btnConfigureNetwork)

    $scrollContainer.Controls.Add($networkCard)

    # --- Right Column: Recent Profiles ---
    $profilesCardX = 20 + $colWidth + $colSpacing  # 480
    $profilesCard = New-StyledCard -Title "Recent Profiles" -X $profilesCardX -Y $row2Y `
        -Width $colWidth -Height $colHeight

    # Fetch recent profiles
    $recentProfiles = Get-RecentProfilesList

    # Build profile list entries - each entry gets name, description, date, and a Quick Apply button
    $entryY = 48
    $entryHeight = 46
    $maxEntries = 5

    if ($recentProfiles.Count -eq 0) {
        $lblNoProfiles = New-StyledLabel -Text "No profiles found. Create one in the Profiles view." `
            -X 15 -Y $entryY -FontSize 9 -IsMuted -MaxWidth ($colWidth - 40)
        $profilesCard.Controls.Add($lblNoProfiles)
    } else {
        $entryIndex = 0
        foreach ($profile in $recentProfiles) {
            if ($entryIndex -ge $maxEntries) { break }

            $currentEntryY = $entryY + ($entryIndex * $entryHeight)

            # Profile name (bold)
            $profileName = if ($profile.Name) { $profile.Name } else { "Unnamed" }
            $lblName = New-StyledLabel -Text $profileName -X 15 -Y $currentEntryY -FontSize 10 -IsBold
            $profilesCard.Controls.Add($lblName)

            # Profile description and modified date (secondary text on the same line)
            $description = if ($profile.Description) { $profile.Description } else { "" }
            $modified = if ($profile.Modified) {
                try { (Get-Date $profile.Modified).ToString('MM/dd/yyyy') } catch { "" }
            } else { "" }
            $secondaryText = if ($description -and $modified) {
                "$description - $modified"
            } elseif ($description) {
                $description
            } elseif ($modified) {
                "Modified: $modified"
            } else {
                ""
            }

            if ($secondaryText) {
                $lblDesc = New-StyledLabel -Text $secondaryText -X 15 -Y ($currentEntryY + 20) `
                    -FontSize 8.5 -IsMuted -MaxWidth ($colWidth - 140)
                $profilesCard.Controls.Add($lblDesc)
            }

            # Quick Apply button for each profile entry
            $btnQuickApply = New-StyledButton -Text "Quick Apply" `
                -X ($colWidth - 115) -Y $currentEntryY -Width 95 -Height 28
            # Store the profile name in the button's Tag so the click handler can reference it
            $btnQuickApply.Tag = $profileName
            $btnQuickApply.Add_Click({
                $targetProfileName = $this.Tag
                try {
                    $profileToApply = Get-Profile -Name $targetProfileName
                    if ($profileToApply) {
                        # Apply-FullProfile shows its own confirmation dialog and results summary
                        $applyResult = Apply-FullProfile -Profile $profileToApply
                        if ($applyResult) {
                            $script:AppState.LastAppliedProfile = $targetProfileName
                            Write-AppLog -Message "Dashboard: Quick Apply - profile '$targetProfileName' applied successfully" -Level 'INFO'
                            # Refresh the dashboard to show updated status
                            Set-ActiveView -ViewName 'Dashboard'
                        } else {
                            Write-AppLog -Message "Dashboard: Quick Apply - profile '$targetProfileName' had errors" -Level 'WARN'
                        }
                    } else {
                        [System.Windows.Forms.MessageBox]::Show(
                            "Profile '$targetProfileName' could not be loaded.",
                            "Error",
                            [System.Windows.Forms.MessageBoxButtons]::OK,
                            [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
                    }
                } catch {
                    [System.Windows.Forms.MessageBox]::Show(
                        "Error applying profile: $_",
                        "Error",
                        [System.Windows.Forms.MessageBoxButtons]::OK,
                        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
                    Write-AppLog -Message "Dashboard: Quick Apply failed - $_" -Level 'ERROR'
                }
            })
            $profilesCard.Controls.Add($btnQuickApply)

            # Separator line between entries (except after the last one)
            if ($entryIndex -lt [Math]::Min($recentProfiles.Count, $maxEntries) - 1) {
                $separator = New-Object System.Windows.Forms.Panel
                $separator.Location = New-Object System.Drawing.Point(15, ($currentEntryY + $entryHeight - 4))
                $separator.Size = New-Object System.Drawing.Size(($colWidth - 30), 1)
                $separator.BackColor = $script:Theme.Border
                $profilesCard.Controls.Add($separator)
            }

            $entryIndex++
        }
    }

    # "Manage Profiles" button at the bottom of the profiles card
    $btnManageProfiles = New-StyledButton -Text "Manage Profiles" -X 15 -Y 258 `
        -Width 140 -Height 30 -IsPrimary
    $btnManageProfiles.Add_Click({
        try {
            Set-ActiveView -ViewName 'Profiles'
        } catch {
            Write-AppLog -Message "Dashboard: Navigate to Profiles failed - $_" -Level 'WARN'
        }
    })
    $profilesCard.Controls.Add($btnManageProfiles)

    $scrollContainer.Controls.Add($profilesCard)

    # ===================================================================
    # Row 3: Quick Actions
    # ===================================================================
    $row3Y = $row2Y + $colHeight + 20  # 520
    $actionsCard = New-StyledCard -Title "Quick Actions" -X 20 -Y $row3Y `
        -Width 920 -Height 80

    # Action buttons positioned in a horizontal row
    $actionBtnY = 40
    $actionBtnHeight = 30
    $actionBtnSpacing = 15

    # --- Button: Scan Network ---
    $btnActionScan = New-StyledButton -Text "Scan Network" -X 15 -Y $actionBtnY `
        -Width 140 -Height $actionBtnHeight -IsPrimary
    $btnActionScan.Add_Click({
        try {
            Set-ActiveView -ViewName 'Deploy'
        } catch {
            Write-AppLog -Message "Dashboard: Navigate to Deploy failed - $_" -Level 'WARN'
        }
    })
    $actionsCard.Controls.Add($btnActionScan)

    # --- Button: Capture Current Config ---
    $btnActionCapture = New-StyledButton -Text "Capture Current Config" `
        -X (15 + 140 + $actionBtnSpacing) -Y $actionBtnY `
        -Width 185 -Height $actionBtnHeight
    $btnActionCapture.Add_Click({
        try {
            $captureName = "Capture_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
            $newProfile = New-DefaultProfile -Name $captureName -Description "Auto-captured from $(Get-CurrentHostname)"

            # Attempt to populate adapter data from the live system
            try {
                $liveAdapters = Get-NetAdapter -ErrorAction Stop
                $liveIPs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop
                $adapterIndex = 0
                foreach ($adapter in $liveAdapters | Select-Object -First 6) {
                    $ipInfo = $liveIPs | Where-Object { $_.InterfaceIndex -eq $adapter.InterfaceIndex } |
                        Select-Object -First 1
                    if ($newProfile.NetworkAdapters -and $adapterIndex -lt $newProfile.NetworkAdapters.Count) {
                        $newProfile.NetworkAdapters[$adapterIndex].InterfaceAlias = $adapter.Name
                        $newProfile.NetworkAdapters[$adapterIndex].IPAddress = if ($ipInfo) { $ipInfo.IPAddress } else { '' }
                        $newProfile.NetworkAdapters[$adapterIndex].SubnetPrefix = if ($ipInfo) { $ipInfo.PrefixLength } else { 24 }
                    }
                    $adapterIndex++
                }
            } catch {
                # Non-Windows or adapter query failed - profile keeps defaults
                Write-AppLog -Message "Dashboard: Adapter capture failed (expected on non-Windows) - $_" -Level 'DEBUG'
            }

            $newProfile.ServerName = Get-CurrentHostname
            Save-Profile -Profile $newProfile

            [System.Windows.Forms.MessageBox]::Show(
                "Current configuration captured as '$captureName'.",
                "Capture Complete",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null

            Write-AppLog -Message "Dashboard: Configuration captured as '$captureName'" -Level 'INFO'
        } catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Failed to capture configuration: $_",
                "Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
            Write-AppLog -Message "Dashboard: Capture failed - $_" -Level 'ERROR'
        }
    })
    $actionsCard.Controls.Add($btnActionCapture)

    # --- Button: Apply Last Profile ---
    $btnActionApplyLast = New-StyledButton -Text "Apply Last Profile" `
        -X (15 + 140 + $actionBtnSpacing + 185 + $actionBtnSpacing) -Y $actionBtnY `
        -Width 155 -Height $actionBtnHeight
    $btnActionApplyLast.Add_Click({
        $lastProfile = $script:AppState.LastAppliedProfile
        if ([string]::IsNullOrWhiteSpace($lastProfile)) {
            [System.Windows.Forms.MessageBox]::Show(
                "No profile has been applied yet. Use the Profiles view to select one.",
                "No Profile",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
            return
        }

        try {
            $profileObj = Get-Profile -Name $lastProfile
            if ($profileObj) {
                # Apply-FullProfile shows its own confirmation dialog and results summary
                $applyResult = Apply-FullProfile -Profile $profileObj
                if ($applyResult) {
                    Write-AppLog -Message "Dashboard: Re-applied last profile '$lastProfile' successfully" -Level 'INFO'
                    # Refresh the dashboard to show updated status
                    Set-ActiveView -ViewName 'Dashboard'
                } else {
                    Write-AppLog -Message "Dashboard: Re-apply of '$lastProfile' had errors" -Level 'WARN'
                }
            } else {
                [System.Windows.Forms.MessageBox]::Show(
                    "Profile '$lastProfile' was not found. It may have been deleted.",
                    "Profile Not Found",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            }
        } catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Error loading profile: $_",
                "Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
        }
    })
    $actionsCard.Controls.Add($btnActionApplyLast)

    # --- Button: Manage Shares ---
    $btnActionShares = New-StyledButton -Text "Manage Shares" `
        -X (15 + 140 + $actionBtnSpacing + 185 + $actionBtnSpacing + 155 + $actionBtnSpacing) -Y $actionBtnY `
        -Width 140 -Height $actionBtnHeight
    $btnActionShares.Add_Click({
        try {
            Set-ActiveView -ViewName 'SMB'
        } catch {
            Write-AppLog -Message "Dashboard: Navigate to SMB failed - $_" -Level 'WARN'
        }
    })
    $actionsCard.Controls.Add($btnActionShares)

    # --- Button: Open d3 Projects ---
    $btnActionOpenD3 = New-StyledButton -Text "Open d3 Projects" `
        -X (15 + 140 + $actionBtnSpacing + 185 + $actionBtnSpacing + 155 + $actionBtnSpacing + 140 + $actionBtnSpacing) -Y $actionBtnY `
        -Width 150 -Height $actionBtnHeight
    $btnActionOpenD3.Add_Click({
        # Common d3 project folder locations
        $d3Paths = @(
            "C:\Program Files\d3 Technologies",
            "C:\d3 Projects",
            "D:\d3 Projects",
            "$env:USERPROFILE\Documents\d3 Projects"
        )

        $foundPath = $null
        foreach ($path in $d3Paths) {
            if (Test-Path -Path $path -ErrorAction SilentlyContinue) {
                $foundPath = $path
                break
            }
        }

        if ($foundPath) {
            try {
                Start-Process "explorer.exe" -ArgumentList $foundPath -ErrorAction Stop
                Write-AppLog -Message "Dashboard: Opened d3 Projects folder at $foundPath" -Level 'INFO'
            } catch {
                [System.Windows.Forms.MessageBox]::Show(
                    "Failed to open folder: $_",
                    "Error",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
            }
        } else {
            [System.Windows.Forms.MessageBox]::Show(
                "Could not find a d3 Projects folder.`nSearched:`n$($d3Paths -join "`n")",
                "Folder Not Found",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
        }
    })
    $actionsCard.Controls.Add($btnActionOpenD3)

    $scrollContainer.Controls.Add($actionsCard)

    # ===================================================================
    # Add the scroll container to the content panel
    # ===================================================================
    $ContentPanel.Controls.Add($scrollContainer)
}
