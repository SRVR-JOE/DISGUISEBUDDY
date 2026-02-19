# Dashboard.ps1 - DISGUISE BUDDY Dashboard Overview Module
# Provides the New-DashboardView function which builds the main Dashboard panel
# displaying quick status cards, network overview, recent profiles, and quick actions.

# ============================================================================
# Initialize shared application state if not already present
# ============================================================================
if (-not $script:AppState) {
    $script:AppState = @{
        LastAppliedProfile = ''
        LastScanResults    = @()
    }
}

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

    # Define the 6 standard disguise adapter roles (NIC A-F)
    $roles = @(
        @{ Role = "NIC A - d3Net"; Color = "Purple" },
        @{ Role = "NIC B - sACN";  Color = "Orange" },
        @{ Role = "NIC C - Media"; Color = "Cyan" },
        @{ Role = "NIC D - NDI";   Color = "Green" },
        @{ Role = "NIC E - 100G";  Color = "Blue" },
        @{ Role = "NIC F - 100G";  Color = "Gray" }
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
    # Section Header
    # ===================================================================
    $sectionHeader = New-SectionHeader -Text "Dashboard" -X 20 -Y 15 -Width ($ContentPanel.ClientSize.Width - 40)

    $subtitleLabel = New-StyledLabel -Text "DISGUISE BUDDY - Server Configuration Manager" `
        -X 20 -Y 55 -FontSize 9 -IsSecondary

    $scrollContainer.Controls.Add($sectionHeader)
    $scrollContainer.Controls.Add($subtitleLabel)

    # ===================================================================
    # Row 1: Quick Status Cards (4 cards in a row)
    # ===================================================================
    $cardY = 80
    $cardHeight = 100
    $cardSpacing = 10
    $cardStartX = 20
    $availableWidth = $ContentPanel.ClientSize.Width - (2 * $cardStartX)
    $cardWidth = [Math]::Floor(($availableWidth - (3 * $cardSpacing)) / 4)

    # --- Gather live data ---
    $currentHostname = Get-CurrentHostname
    $activeProfile = if ($script:AppState.LastAppliedProfile) { $script:AppState.LastAppliedProfile } else { "None" }
    $adapterCount = Get-ActiveAdapterCount
    $shareCount = Get-ActiveShareCount

    # --- Card 1: Server Name ---
    $card1 = New-StyledCard -Title "Server Name" -X $cardStartX -Y $cardY `
        -Width $cardWidth -Height $cardHeight

    $hostnameStatusBadge = New-StatusBadge -Text "LIVE" -X ($cardWidth - 50) -Y 15 -Type 'Success'
    $card1.Controls.Add($hostnameStatusBadge)

    $lblHostnameValue = New-StyledLabel -Text $currentHostname -X 15 -Y 50 -FontSize 14 -IsBold
    $card1.Controls.Add($lblHostnameValue)

    $scrollContainer.Controls.Add($card1)

    # --- Card 2: Active Profile ---
    $card2X = $cardStartX + $cardWidth + $cardSpacing
    $card2 = New-StyledCard -Title "Active Profile" -X $card2X -Y $cardY `
        -Width $cardWidth -Height $cardHeight

    $profileBadgeType = if ($activeProfile -eq "None") { 'Warning' } else { 'Info' }
    $profileBadgeText = if ($activeProfile -eq "None") { 'NONE' } else { 'ACTIVE' }
    $script:DashProfileStatusBadge = New-StatusBadge -Text $profileBadgeText `
        -X ($cardWidth - 50) -Y 15 -Type $profileBadgeType
    $card2.Controls.Add($script:DashProfileStatusBadge)

    $script:DashLblProfileValue = New-StyledLabel -Text $activeProfile -X 15 -Y 50 -FontSize 12 -IsBold
    $card2.Controls.Add($script:DashLblProfileValue)

    $scrollContainer.Controls.Add($card2)

    # --- Card 3: Network Adapters ---
    $card3X = $card2X + $cardWidth + $cardSpacing
    $card3 = New-StyledCard -Title "Network Adapters" -X $card3X -Y $cardY `
        -Width $cardWidth -Height $cardHeight

    $adapterBadgeType = if ($adapterCount -eq "N/A") { 'Warning' } else { 'Success' }
    $adapterBadgeText = if ($adapterCount -eq "N/A") { 'N/A' } else { 'OK' }
    $adapterStatusBadge = New-StatusBadge -Text $adapterBadgeText `
        -X ($cardWidth - 50) -Y 15 -Type $adapterBadgeType
    $card3.Controls.Add($adapterStatusBadge)

    $lblAdapterValue = New-StyledLabel -Text $adapterCount -X 15 -Y 50 -FontSize 12 -IsBold
    $card3.Controls.Add($lblAdapterValue)

    $scrollContainer.Controls.Add($card3)

    # --- Card 4: SMB Shares ---
    $card4X = $card3X + $cardWidth + $cardSpacing
    $card4 = New-StyledCard -Title "SMB Shares" -X $card4X -Y $cardY `
        -Width $cardWidth -Height $cardHeight

    $shareBadgeType = if ($shareCount -eq "N/A") { 'Warning' } else { 'Info' }
    $shareBadgeText = if ($shareCount -eq "N/A") { 'N/A' } else { 'ACTIVE' }
    $shareStatusBadge = New-StatusBadge -Text $shareBadgeText `
        -X ($cardWidth - 50) -Y 15 -Type $shareBadgeType
    $card4.Controls.Add($shareStatusBadge)

    $lblShareValue = New-StyledLabel -Text $shareCount -X 15 -Y 50 -FontSize 12 -IsBold
    $card4.Controls.Add($lblShareValue)

    $scrollContainer.Controls.Add($card4)

    # ===================================================================
    # Row 2: Two-column layout
    # ===================================================================
    $row2Y = $cardY + $cardHeight + 20  # 200
    $colSpacing = 15
    $colHeight = 300
    $colWidth = [Math]::Floor(($ContentPanel.ClientSize.Width - (2 * 20) - $colSpacing) / 2)

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
            "Cyan"   { $script:Theme.Accent }
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
        # Navigate to the Network view (if a navigation callback is available in AppState)
        if ($script:AppState.NavigateTo) {
            try {
                $script:AppState.NavigateTo.Invoke('Network')
            } catch {
                Write-AppLog -Message "Dashboard: Navigate to Network failed - $_" -Level 'WARN'
            }
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

            # Set Active button for each profile entry
            $btnQuickApply = New-StyledButton -Text "Set Active" `
                -X ($colWidth - 115) -Y $currentEntryY -Width 95 -Height 28
            # Store the profile name in the button's Tag so the click handler can reference it
            $btnQuickApply.Tag = $profileName
            $btnQuickApply.Add_Click({
                $targetProfileName = $this.Tag
                $confirmResult = [System.Windows.Forms.MessageBox]::Show(
                    "Set '$targetProfileName' as the active profile?",
                    "Set Active Profile",
                    [System.Windows.Forms.MessageBoxButtons]::YesNo,
                    [System.Windows.Forms.MessageBoxIcon]::Question)

                if ($confirmResult -eq [System.Windows.Forms.DialogResult]::Yes) {
                    try {
                        $profileToApply = Get-Profile -Name $targetProfileName
                        if ($profileToApply) {
                            $script:AppState.LastAppliedProfile = $targetProfileName
                            # Refresh the active profile display on the dashboard
                            $script:DashLblProfileValue.Text = $targetProfileName
                            $script:DashProfileStatusBadge.Text = "ACTIVE"
                            $script:DashProfileStatusBadge.BackColor = $script:Theme.Accent
                            [System.Windows.Forms.MessageBox]::Show(
                                "Profile '$targetProfileName' marked as active.`nUse Network Deploy to push to remote servers.",
                                "Profile Applied",
                                [System.Windows.Forms.MessageBoxButtons]::OK,
                                [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
                            Write-AppLog -Message "Dashboard: Quick Apply - profile '$targetProfileName' set as active" -Level 'INFO'
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
                    }
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
        if ($script:AppState.NavigateTo) {
            try {
                $script:AppState.NavigateTo.Invoke('Profiles')
            } catch {
                Write-AppLog -Message "Dashboard: Navigate to Profiles failed - $_" -Level 'WARN'
            }
        }
    })
    $profilesCard.Controls.Add($btnManageProfiles)

    $scrollContainer.Controls.Add($profilesCard)

    # ===================================================================
    # Row 3: Discovered Servers
    # ===================================================================
    $row3Y = $row2Y + $colHeight + 20
    $fullWidth = $ContentPanel.ClientSize.Width - 40
    $serversCardHeight = 260

    $serversCard = New-StyledCard -Title "Discovered Servers" -X 20 -Y $row3Y `
        -Width $fullWidth -Height $serversCardHeight

    # DataGridView showing last scan results
    $script:DashDgvServers = New-StyledDataGridView -X 15 -Y 45 -Width ($fullWidth - 30) -Height 140

    $dColIP = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $dColIP.HeaderText = "IP Address"
    $dColIP.Name = "IPAddress"
    $dColIP.Width = 130
    $dColIP.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $dColHostname = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $dColHostname.HeaderText = "Hostname"
    $dColHostname.Name = "Hostname"
    $dColHostname.Width = 160
    $dColHostname.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $dColStatus = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $dColStatus.HeaderText = "Status"
    $dColStatus.Name = "Status"
    $dColStatus.Width = 100
    $dColStatus.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $dColAPI = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $dColAPI.HeaderText = "d3 API"
    $dColAPI.Name = "D3API"
    $dColAPI.Width = 100
    $dColAPI.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $dColPorts = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $dColPorts.HeaderText = "Ports"
    $dColPorts.Name = "Ports"
    $dColPorts.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::Fill

    $script:DashDgvServers.Columns.AddRange(@($dColIP, $dColHostname, $dColStatus, $dColAPI, $dColPorts))
    $script:DashDgvServers.ReadOnly = $true

    # Populate from last scan results (if any)
    $lastScan = $script:AppState.LastScanResults
    if ($lastScan -and $lastScan.Count -gt 0) {
        foreach ($server in $lastScan) {
            $statusText = if ($server.IsDisguise) { "Disguise" }
                          elseif ($server.Ports.Count -gt 0) { "Online" }
                          else { "Unreachable" }
            $apiText = if ($server.APIVersion) { $server.APIVersion } else { "N/A" }
            $portsText = if ($server.Ports.Count -gt 0) { $server.Ports -join ", " } else { "None" }

            $rowIdx = $script:DashDgvServers.Rows.Add($server.IPAddress, $server.Hostname,
                                                       $statusText, $apiText, $portsText)

            if ($statusText -eq "Disguise") {
                $script:DashDgvServers.Rows[$rowIdx].Cells["Status"].Style.ForeColor = $script:Theme.Success
                $script:DashDgvServers.Rows[$rowIdx].Cells["Status"].Style.Font =
                    New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
            } elseif ($statusText -eq "Online") {
                $script:DashDgvServers.Rows[$rowIdx].Cells["Status"].Style.ForeColor = $script:Theme.Warning
            }
        }
    }

    $serversCard.Controls.Add($script:DashDgvServers)

    # Status label
    $dashServerCount = if ($lastScan) { $lastScan.Count } else { 0 }
    $script:DashServersStatusLabel = New-StyledLabel `
        -Text "$(if ($dashServerCount -gt 0) { "$dashServerCount server(s) from last scan" } else { "No scan results yet - use Quick Scan or go to Network Deploy" })" `
        -X 15 -Y 195 -FontSize 9 -IsMuted
    $script:DashServersStatusLabel.AutoSize = $false
    $script:DashServersStatusLabel.Width = ($fullWidth - 250)
    $serversCard.Controls.Add($script:DashServersStatusLabel)

    # Quick Scan button
    $btnDashQuickScan = New-StyledButton -Text "Quick Scan" -X 15 -Y 218 -Width 130 -Height 30 -IsPrimary
    $btnDashQuickScan.Add_Click({
        $this.Enabled = $false
        $script:DashServersStatusLabel.Text = "Scanning 192.168.10.x ..."
        $script:DashServersStatusLabel.ForeColor = $script:Theme.Accent
        $script:DashServersStatusLabel.Refresh()
        [System.Windows.Forms.Application]::DoEvents()

        try {
            $quickTargets = @(1,2,3,4,5,10,11,12,13,14,15,20,21,22,23,24,30,50,100,101,102,103,104,105,110,150,200,201,210,250,251,252,253,254)
            $scanResults = [System.Collections.ArrayList]::new()

            foreach ($octet in $quickTargets) {
                $ip = "192.168.10.$octet"
                try {
                    $testResult = Test-DisguiseServer -IPAddress $ip -TimeoutMs 500
                    if ($testResult.Ports.Count -gt 0) {
                        [void]$scanResults.Add([PSCustomObject]@{
                            IPAddress      = $testResult.IPAddress
                            Hostname       = $testResult.Hostname
                            IsDisguise     = $testResult.IsDisguise
                            ResponseTimeMs = 0
                            Ports          = $testResult.Ports
                            APIVersion     = $testResult.DesignerVersion
                        })
                    }
                } catch { }
                [System.Windows.Forms.Application]::DoEvents()
            }

            $script:AppState.LastScanResults = $scanResults.ToArray()

            # Refresh grid
            $script:DashDgvServers.Rows.Clear()
            foreach ($server in $scanResults) {
                $statusText = if ($server.IsDisguise) { "Disguise" }
                              elseif ($server.Ports.Count -gt 0) { "Online" }
                              else { "Unreachable" }
                $apiText = if ($server.APIVersion) { $server.APIVersion } else { "N/A" }
                $portsText = if ($server.Ports.Count -gt 0) { $server.Ports -join ", " } else { "None" }
                $rowIdx = $script:DashDgvServers.Rows.Add($server.IPAddress, $server.Hostname,
                                                           $statusText, $apiText, $portsText)
                if ($statusText -eq "Disguise") {
                    $script:DashDgvServers.Rows[$rowIdx].Cells["Status"].Style.ForeColor = $script:Theme.Success
                    $script:DashDgvServers.Rows[$rowIdx].Cells["Status"].Style.Font =
                        New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
                }
            }

            $disguiseCount = ($scanResults | Where-Object { $_.IsDisguise }).Count
            $script:DashServersStatusLabel.Text = "Found $($scanResults.Count) host(s), $disguiseCount disguise server(s)"
            $script:DashServersStatusLabel.ForeColor = $script:Theme.Success
        } catch {
            $script:DashServersStatusLabel.Text = "Scan failed: $_"
            $script:DashServersStatusLabel.ForeColor = $script:Theme.Error
        }

        $this.Enabled = $true
    })
    $serversCard.Controls.Add($btnDashQuickScan)

    # Assign Profile button (click a server row, then click this)
    $btnDashAssign = New-StyledButton -Text "Assign Profile" -X 160 -Y 218 -Width 140 -Height 30
    $btnDashAssign.Add_Click({
        $selectedRow = $script:DashDgvServers.CurrentRow
        if (-not $selectedRow) {
            [System.Windows.Forms.MessageBox]::Show(
                "Click on a server row first, then click Assign Profile.",
                "No Server Selected",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
            return
        }
        $ip = $selectedRow.Cells["IPAddress"].Value
        $hostname = $selectedRow.Cells["Hostname"].Value
        if (-not $ip) { return }

        # Build profile picker dialog
        $pickerForm = New-Object System.Windows.Forms.Form
        $pickerForm.Text = "Assign Profile to $ip"
        $pickerForm.Size = New-Object System.Drawing.Size(400, 340)
        $pickerForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent
        $pickerForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
        $pickerForm.MaximizeBox = $false
        $pickerForm.MinimizeBox = $false
        $pickerForm.BackColor = $script:Theme.Background
        $pickerForm.ForeColor = $script:Theme.Text
        $pickerForm.Font = New-Object System.Drawing.Font('Segoe UI', 10)

        $pickerHeaderLabel = New-Object System.Windows.Forms.Label
        $pickerHeaderLabel.Text = "Select a profile to assign:"
        $pickerHeaderLabel.Location = New-Object System.Drawing.Point(15, 15)
        $pickerHeaderLabel.AutoSize = $true
        $pickerHeaderLabel.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)

        $pickerTargetLabel = New-Object System.Windows.Forms.Label
        $pickerTargetLabel.Text = "Target: $ip $(if ($hostname) { "($hostname)" })"
        $pickerTargetLabel.Location = New-Object System.Drawing.Point(15, 42)
        $pickerTargetLabel.AutoSize = $true
        $pickerTargetLabel.ForeColor = $script:Theme.TextSecondary

        $profileListBox = New-Object System.Windows.Forms.ListBox
        $profileListBox.Location = New-Object System.Drawing.Point(15, 70)
        $profileListBox.Size = New-Object System.Drawing.Size(355, 170)
        $profileListBox.BackColor = $script:Theme.InputBackground
        $profileListBox.ForeColor = $script:Theme.Text
        $profileListBox.Font = New-Object System.Drawing.Font('Segoe UI', 10)
        $profileListBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle

        $pickerProfiles = @()
        try {
            $pickerProfiles = @(Get-AllProfiles)
            foreach ($p in $pickerProfiles) {
                $desc = if ($p.Description) { " - $($p.Description)" } else { "" }
                $profileListBox.Items.Add("$($p.Name)$desc") | Out-Null
            }
        } catch {
            Write-AppLog "Dashboard: Failed to load profiles for picker: $_" -Level 'WARN'
        }
        if ($profileListBox.Items.Count -gt 0) { $profileListBox.SelectedIndex = 0 }

        $btnAssign = New-Object System.Windows.Forms.Button
        $btnAssign.Text = "Assign"
        $btnAssign.Location = New-Object System.Drawing.Point(175, 252)
        $btnAssign.Size = New-Object System.Drawing.Size(100, 35)
        $btnAssign.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
        $btnAssign.BackColor = $script:Theme.Primary
        $btnAssign.ForeColor = [System.Drawing.Color]::White
        $btnAssign.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
        $btnAssign.DialogResult = [System.Windows.Forms.DialogResult]::OK

        $btnCancel = New-Object System.Windows.Forms.Button
        $btnCancel.Text = "Cancel"
        $btnCancel.Location = New-Object System.Drawing.Point(285, 252)
        $btnCancel.Size = New-Object System.Drawing.Size(85, 35)
        $btnCancel.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
        $btnCancel.BackColor = $script:Theme.CardBackground
        $btnCancel.ForeColor = $script:Theme.TextSecondary
        $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

        $profileListBox.Add_DoubleClick({ $pickerForm.DialogResult = [System.Windows.Forms.DialogResult]::OK; $pickerForm.Close() })

        $pickerForm.AcceptButton = $btnAssign
        $pickerForm.CancelButton = $btnCancel
        $pickerForm.Controls.AddRange(@($pickerHeaderLabel, $pickerTargetLabel, $profileListBox, $btnAssign, $btnCancel))

        $dialogResult = $pickerForm.ShowDialog()
        if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK) { return }
        if ($profileListBox.SelectedIndex -lt 0) { return }

        $profileObj = $pickerProfiles[$profileListBox.SelectedIndex]
        $profileName = $profileObj.Name

        $script:DashServersStatusLabel.Text = "Pushing '$profileName' to $ip..."
        $script:DashServersStatusLabel.ForeColor = $script:Theme.Accent
        $script:DashServersStatusLabel.Refresh()
        [System.Windows.Forms.Application]::DoEvents()

        try {
            $pushResult = Push-ProfileToServer -ServerIP $ip -Profile $profileObj
            if ($pushResult.Success) {
                $selectedRow.Cells["Status"].Value = "Configured"
                $selectedRow.Cells["Status"].Style.ForeColor = $script:Theme.Primary
                $script:DashServersStatusLabel.Text = "Profile '$profileName' pushed to $ip successfully"
                $script:DashServersStatusLabel.ForeColor = $script:Theme.Success
                $script:AppState.LastAppliedProfile = $profileName
                $script:DashLblProfileValue.Text = $profileName
                $script:DashProfileStatusBadge.Text = "ACTIVE"
                Write-AppLog "Dashboard: Assigned '$profileName' to $ip" -Level 'INFO'
            } else {
                $script:DashServersStatusLabel.Text = "Push failed: $($pushResult.ErrorMessage)"
                $script:DashServersStatusLabel.ForeColor = $script:Theme.Error
            }
        } catch {
            $script:DashServersStatusLabel.Text = "Push error: $_"
            $script:DashServersStatusLabel.ForeColor = $script:Theme.Error
            Write-AppLog "Dashboard: Push to $ip failed: $_" -Level 'ERROR'
        }
    })
    $serversCard.Controls.Add($btnDashAssign)

    # Go to full Network Deploy view
    $btnGoToDeploy = New-StyledButton -Text "Full Network Deploy" -X ($fullWidth - 175) -Y 218 -Width 160 -Height 30
    $btnGoToDeploy.Add_Click({
        if ($script:AppState.NavigateTo) {
            try { $script:AppState.NavigateTo.Invoke('Deploy') } catch { }
        }
    })
    $serversCard.Controls.Add($btnGoToDeploy)

    $scrollContainer.Controls.Add($serversCard)

    # ===================================================================
    # Row 4: Quick Actions
    # ===================================================================
    $row4Y = $row3Y + $serversCardHeight + 20
    $actionsCard = New-StyledCard -Title "Quick Actions" -X 20 -Y $row4Y `
        -Width ($ContentPanel.ClientSize.Width - 40) -Height 80

    # Action buttons positioned in a horizontal row
    $actionBtnY = 40
    $actionBtnHeight = 30
    $actionBtnSpacing = 15

    # --- Button: Scan Network ---
    $btnActionScan = New-StyledButton -Text "Scan Network" -X 15 -Y $actionBtnY `
        -Width 140 -Height $actionBtnHeight -IsPrimary
    $btnActionScan.Add_Click({
        if ($script:AppState.NavigateTo) {
            try {
                $script:AppState.NavigateTo.Invoke('Deploy')
            } catch {
                Write-AppLog -Message "Dashboard: Navigate to Deploy failed - $_" -Level 'WARN'
            }
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
                        $newProfile.NetworkAdapters[$adapterIndex].AdapterName = $adapter.Name
                        $newProfile.NetworkAdapters[$adapterIndex].IPAddress = if ($ipInfo) { $ipInfo.IPAddress } else { '' }
                        $newProfile.NetworkAdapters[$adapterIndex].SubnetMask = if ($ipInfo) {
                            Convert-PrefixToSubnetMask -PrefixLength $ipInfo.PrefixLength
                        } else { '255.255.255.0' }
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

        $confirmResult = [System.Windows.Forms.MessageBox]::Show(
            "Re-apply the last used profile '$lastProfile'?",
            "Apply Last Profile",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question)

        if ($confirmResult -eq [System.Windows.Forms.DialogResult]::Yes) {
            try {
                $profileObj = Get-Profile -Name $lastProfile
                if ($profileObj) {
                    # Mark as active (actual deployment goes through the Deploy view)
                    $script:DashLblProfileValue.Text = $lastProfile
                    [System.Windows.Forms.MessageBox]::Show(
                        "Profile '$lastProfile' marked as active.`nUse Network Deploy to push to remote servers.",
                        "Profile Active",
                        [System.Windows.Forms.MessageBoxButtons]::OK,
                        [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
                    Write-AppLog -Message "Dashboard: Re-applied last profile '$lastProfile'" -Level 'INFO'
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
        }
    })
    $actionsCard.Controls.Add($btnActionApplyLast)

    # --- Button: Open d3 Projects ---
    $btnActionOpenD3 = New-StyledButton -Text "Open d3 Projects" `
        -X (15 + 140 + $actionBtnSpacing + 185 + $actionBtnSpacing + 155 + $actionBtnSpacing) -Y $actionBtnY `
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
