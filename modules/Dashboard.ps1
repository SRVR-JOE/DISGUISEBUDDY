# Dashboard.ps1 - DISGUISE BUDDY Dashboard Overview Module
# Provides the New-DashboardView function which builds the main Dashboard panel
# displaying quick status cards, network overview, recent profiles, and quick actions.

# ============================================================================
# Application state is initialized in DisguiseBuddy.ps1 before modules load
# ============================================================================

# ============================================================================
# Helper Functions (private to this module)
# ============================================================================

# Get-ServerHostname removed — use Get-ServerHostname from ServerIdentity.ps1 instead

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
        @{ Role = "d3Net";    Color = "Purple" },
        @{ Role = "sACN";     Color = "Orange" },
        @{ Role = "Media";    Color = "Green" },
        @{ Role = "NDI";      Color = "Cyan" },
        @{ Role = "Control";  Color = "Blue" },
        @{ Role = "100G";     Color = "Gray" }
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

function Get-DisguiseServerDetails {
    <#
    .SYNOPSIS
        Queries a discovered disguise server's REST API and returns a structured
        summary of version, NIC status, GPU outputs, and project list.
    .DESCRIPTION
        Makes up to four sequential HTTP GET calls against the disguise REST API:
          GET /api/service/system              -> version
          GET /api/service/system/networkadapters -> NIC status
          GET /api/service/system/gpuoutputs   -> GPU output count
          GET /api/service/system/projects     -> project names/count

        All calls use a 3-second timeout. On any failure the relevant field is
        returned as "Unavailable" so callers never have to null-guard.
    .PARAMETER IPAddress
        The IPv4 address of the target disguise server.
    .PARAMETER Port
        The HTTP port on which the disguise REST API is listening. Defaults to 80.
    .OUTPUTS
        PSCustomObject with properties:
          IPAddress, Version, NICEnabled, NICDisconnected, GPUOutputs,
          ProjectCount, ProjectNames, APIReachable
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$IPAddress,

        [int]$Port = 80
    )

    # Validate IPv4 format and octet bounds to prevent SSRF via crafted hostnames/URLs
    $parsedIP = $null
    if (-not ([System.Net.IPAddress]::TryParse($IPAddress, [ref]$parsedIP)) -or
        $parsedIP.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
        Write-AppLog -Message "Get-DisguiseServerDetails: Rejected non-IPv4 input '$IPAddress'" -Level 'WARN'
        return [PSCustomObject]@{
            IPAddress       = $IPAddress
            Version         = 'Invalid IP'
            NICEnabled      = 'N/A'
            NICDisconnected = 'N/A'
            GPUOutputs      = 'N/A'
            ProjectCount    = 'N/A'
            ProjectNames    = @()
            APIReachable    = $false
        }
    }

    # Build the base URL once — use the discovered port, not a hardcoded 80
    $baseUrl = if ($Port -eq 80) { "http://$IPAddress" } else { "http://$IPAddress`:$Port" }

    $result = [PSCustomObject]@{
        IPAddress      = $IPAddress
        Version        = 'Unavailable'
        NICEnabled     = 'Unavailable'
        NICDisconnected = 'Unavailable'
        GPUOutputs     = 'Unavailable'
        ProjectCount   = 'Unavailable'
        ProjectNames   = @()
        APIReachable   = $false
    }

    $httpClient = $null
    try {
        $httpClient = New-Object System.Net.Http.HttpClient
        $httpClient.Timeout = [TimeSpan]::FromSeconds(3)

        # ----------------------------------------------------------------
        # 1. System info — version
        # ----------------------------------------------------------------
        try {
            $sysJson = $httpClient.GetStringAsync("$baseUrl/api/service/system").Result
            $sysData = $sysJson | ConvertFrom-Json
            # disguise API returns d3VersionString or version depending on release
            $ver = if ($sysData.d3VersionString) {
                $sysData.d3VersionString
            } elseif ($sysData.version) {
                $sysData.version
            } else {
                'Unknown'
            }
            $result.Version = $ver
            $result.APIReachable = $true
        } catch {
            Write-AppLog -Message "Get-DisguiseServerDetails: /api/service/system failed for $IPAddress - $_" -Level 'DEBUG'
        }

        # ----------------------------------------------------------------
        # 2. Network adapters — enabled count and disconnected list
        # ----------------------------------------------------------------
        try {
            $nicJson = $httpClient.GetStringAsync("$baseUrl/api/service/system/networkadapters").Result
            $nicData = $nicJson | ConvertFrom-Json

            # The API may return a top-level array or an object with an adapters key
            $adapters = if ($nicData -is [System.Array]) {
                $nicData
            } elseif ($nicData.adapters) {
                $nicData.adapters
            } elseif ($nicData.networkAdapters) {
                $nicData.networkAdapters
            } else {
                @()
            }

            $enabledAdapters  = @($adapters | Where-Object { $_.enabled -eq $true -or $_.Enabled -eq $true })
            # Disconnected = enabled but no link / status indicates no cable
            $disconnected = @($adapters | Where-Object {
                ($_.enabled -eq $true -or $_.Enabled -eq $true) -and
                ($_.connected -eq $false -or $_.Connected -eq $false -or
                 $_.linkStatus -eq 'Down' -or $_.LinkStatus -eq 'Down' -or
                 $_.status -ieq 'Disconnected')
            })

            $result.NICEnabled     = $enabledAdapters.Count
            $result.NICDisconnected = $disconnected.Count
        } catch {
            Write-AppLog -Message "Get-DisguiseServerDetails: /api/service/system/networkadapters failed for $IPAddress - $_" -Level 'DEBUG'
        }

        # ----------------------------------------------------------------
        # 3. GPU outputs — count of active outputs
        # ----------------------------------------------------------------
        try {
            $gpuJson = $httpClient.GetStringAsync("$baseUrl/api/service/system/gpuoutputs").Result
            $gpuData = $gpuJson | ConvertFrom-Json

            $outputs = if ($gpuData -is [System.Array]) {
                $gpuData
            } elseif ($gpuData.outputs) {
                $gpuData.outputs
            } elseif ($gpuData.gpuOutputs) {
                $gpuData.gpuOutputs
            } else {
                @()
            }

            $activeOutputs = @($outputs | Where-Object {
                $_.active -eq $true -or $_.Active -eq $true -or
                $_.enabled -eq $true -or $_.Enabled -eq $true
            })
            $result.GPUOutputs = if ($activeOutputs.Count -gt 0) {
                $activeOutputs.Count
            } else {
                # If no "active" property, treat total count as active
                @($outputs).Count
            }
        } catch {
            Write-AppLog -Message "Get-DisguiseServerDetails: /api/service/system/gpuoutputs failed for $IPAddress - $_" -Level 'DEBUG'
        }

        # ----------------------------------------------------------------
        # 4. Projects — count and names
        # ----------------------------------------------------------------
        try {
            $projJson = $httpClient.GetStringAsync("$baseUrl/api/service/system/projects").Result
            $projData = $projJson | ConvertFrom-Json

            $projects = if ($projData -is [System.Array]) {
                $projData
            } elseif ($projData.projects) {
                $projData.projects
            } else {
                @()
            }

            $result.ProjectCount = @($projects).Count
            $result.ProjectNames = @($projects | ForEach-Object {
                if ($_.name) { $_.name }
                elseif ($_.projectName) { $_.projectName }
                elseif ($_ -is [string]) { $_ }
                else { $_.ToString() }
            })
        } catch {
            Write-AppLog -Message "Get-DisguiseServerDetails: /api/service/system/projects failed for $IPAddress - $_" -Level 'DEBUG'
        }

    } catch {
        Write-AppLog -Message "Get-DisguiseServerDetails: HttpClient init failed for $IPAddress - $_" -Level 'WARN'
    } finally {
        if ($httpClient) { $httpClient.Dispose() }
    }

    return $result
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
    $currentHostname = Get-ServerHostname
    $activeProfile = if ($script:AppState.LastAppliedProfile) { $script:AppState.LastAppliedProfile } else { "None" }
    $adapterCount = Get-ActiveAdapterCount
    $shareCount = Get-ActiveShareCount

    # --- Card 1: Server Name ---
    $card1 = New-StyledCard -Title "Server Name" -X $cardStartX -Y $cardY `
        -Width $cardWidth -Height $cardHeight -AccentColor $script:Theme.Accent

    $hostnameStatusBadge = New-StatusBadge -Text "LIVE" -X 150 -Y 15 -Type 'Success'
    $card1.Controls.Add($hostnameStatusBadge)

    $lblHostnameValue = New-StyledLabel -Text $currentHostname -X 15 -Y 50 -FontSize 14 -IsBold -MaxWidth ($cardWidth - 30)
    $card1.Controls.Add($lblHostnameValue)

    $scrollContainer.Controls.Add($card1)

    # --- Card 2: Active Profile ---
    $card2X = $cardStartX + $cardWidth + $cardSpacing
    $card2 = New-StyledCard -Title "Active Profile" -X $card2X -Y $cardY `
        -Width $cardWidth -Height $cardHeight -AccentColor $script:Theme.Primary

    $profileBadgeType = if ($activeProfile -eq "None") { 'Info' } else { 'Success' }
    $profileBadgeText  = if ($activeProfile -eq "None") { 'NONE' } else { 'ACTIVE' }
    $profileStatusBadge = New-StatusBadge -Text $profileBadgeText `
        -X 150 -Y 15 -Type $profileBadgeType
    $card2.Controls.Add($profileStatusBadge)

    $lblProfileValue = New-StyledLabel -Text $activeProfile -X 15 -Y 50 -FontSize 12 -IsBold -MaxWidth ($cardWidth - 30)
    $card2.Controls.Add($lblProfileValue)

    $scrollContainer.Controls.Add($card2)

    # --- Card 3: Network Adapters ---
    $card3X = $card2X + $cardWidth + $cardSpacing
    $card3 = New-StyledCard -Title "Network Adapters" -X $card3X -Y $cardY `
        -Width $cardWidth -Height $cardHeight -AccentColor $script:Theme.Success

    $adapterBadgeType = if ($adapterCount -eq "N/A") { 'Warning' } else { 'Success' }
    $adapterBadgeText  = if ($adapterCount -eq "N/A") { 'N/A' }    else { 'ACTIVE' }
    $adapterStatusBadge = New-StatusBadge -Text $adapterBadgeText `
        -X 150 -Y 15 -Type $adapterBadgeType
    $card3.Controls.Add($adapterStatusBadge)

    $lblAdapterValue = New-StyledLabel -Text $adapterCount -X 15 -Y 50 -FontSize 12 -IsBold -MaxWidth ($cardWidth - 30)
    $card3.Controls.Add($lblAdapterValue)

    $scrollContainer.Controls.Add($card3)

    # --- Card 4: SMB Shares ---
    $card4X = $card3X + $cardWidth + $cardSpacing
    $card4 = New-StyledCard -Title "SMB Shares" -X $card4X -Y $cardY `
        -Width $cardWidth -Height $cardHeight -AccentColor $script:Theme.Warning

    $shareBadgeType = if ($shareCount -eq "N/A") { 'Warning' } else { 'Info' }
    $shareBadgeText  = if ($shareCount -eq "N/A") { 'N/A' }    else { 'ACTIVE' }
    $shareStatusBadge = New-StatusBadge -Text $shareBadgeText `
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

    $dgvAdapters.Columns.Add($colDot) | Out-Null
    $dgvAdapters.Columns.Add($colRole) | Out-Null
    $dgvAdapters.Columns.Add($colAdapterIP) | Out-Null
    $dgvAdapters.Columns.Add($colAdapterStatus) | Out-Null
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
                            Write-AppLog -Message "Dashboard: Quick Apply - profile '$targetProfileName' applied successfully" -Level 'INFO'
                        } else {
                            Write-AppLog -Message "Dashboard: Quick Apply - profile '$targetProfileName' had errors" -Level 'WARN'
                        }
                        # Always refresh to show updated status
                        Set-ActiveView -ViewName 'Dashboard'
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
            $newProfile = New-DefaultProfile -Name $captureName -Description "Auto-captured from $(Get-ServerHostname)"

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
                        $prefixLen = if ($ipInfo) { $ipInfo.PrefixLength } else { 24 }
                        $newProfile.NetworkAdapters[$adapterIndex].SubnetMask = Convert-PrefixToSubnetMask -PrefixLength $prefixLen
                    }
                    $adapterIndex++
                }
            } catch {
                # Non-Windows or adapter query failed - profile keeps defaults
                Write-AppLog -Message "Dashboard: Adapter capture failed (expected on non-Windows) - $_" -Level 'DEBUG'
            }

            $newProfile.ServerName = Get-ServerHostname
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
                } else {
                    Write-AppLog -Message "Dashboard: Re-apply of '$lastProfile' had errors" -Level 'WARN'
                }
                # Always refresh to show updated status
                Set-ActiveView -ViewName 'Dashboard'
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
    # Row 4: Fleet Status
    # Shows live data from discovered disguise servers' REST APIs.
    # Only rendered when $script:AppState.LastScanResults contains servers
    # with IsDisguise = $true.
    # ===================================================================
    $fleetHeaderY = $row3Y + 80 + 20   # below Quick Actions card (height 80)

    $fleetSectionHeader = New-SectionHeader -Text "Fleet Status" -X 20 -Y $fleetHeaderY -Width 900
    $scrollContainer.Controls.Add($fleetSectionHeader)

    # Identify disguise servers from the last scan
    $disguiseServers = @()
    if ($script:AppState.LastScanResults) {
        $disguiseServers = @($script:AppState.LastScanResults | Where-Object { $_.IsDisguise -eq $true })
    }

    $fleetContentY = $fleetHeaderY + 50  # below the section header

    if ($disguiseServers.Count -eq 0) {
        # No servers known — show a helpful prompt
        $lblNoFleet = New-StyledLabel `
            -Text "No disguise servers discovered yet. Run a Scan Network or Auto-Discover (DNS-SD) from the Network Deploy view." `
            -X 20 -Y $fleetContentY -FontSize 9 -IsMuted -MaxWidth 880
        $scrollContainer.Controls.Add($lblNoFleet)

        # Scan Network shortcut button
        $btnGoScan = New-StyledButton -Text "Go to Network Deploy" `
            -X 20 -Y ($fleetContentY + 30) -Width 180 -Height 30
        $btnGoScan.Add_Click({
            try { Set-ActiveView -ViewName 'Deploy' } catch {
                Write-AppLog -Message "Dashboard: Navigate to Deploy failed - $_" -Level 'WARN'
            }
        })
        $scrollContainer.Controls.Add($btnGoScan)
    } else {
        # Status label shown while querying servers (updated by the Refresh logic)
        $lblFleetStatus = New-StyledLabel -Text "Loading fleet data..." `
            -X 20 -Y $fleetContentY -FontSize 9 -IsMuted
        $scrollContainer.Controls.Add($lblFleetStatus)

        # "Refresh Fleet" button — re-queries all known servers
        $btnRefreshFleet = New-StyledButton -Text ([char]0x21BB + " Refresh Fleet") `
            -X 820 -Y ($fleetHeaderY + 5) -Width 120 -Height 28
        $scrollContainer.Controls.Add($btnRefreshFleet)

        # Container panel for the server cards, laid out in a wrapping row
        $fleetCardsY = $fleetContentY + 22
        $fleetCardWidth  = 285
        $fleetCardHeight = 165
        $fleetCardSpacingX = 15
        $fleetCardSpacingY = 15
        $fleetCardsPerRow = 3
        $fleetStartX = 20

        # We keep a reference to each server card panel so we can rebuild them on refresh
        $fleetCardPanels = [System.Collections.ArrayList]::new()

        # Helper scriptblock: given a server descriptor, query its API and build/update the card
        $buildFleetCard = {
            param(
                [PSCustomObject]$ServerScanResult,
                [System.Windows.Forms.Panel]$CardPanel
            )

            # Determine which port to use — prefer discovered port 80, else fallback
            $apiPort = 80
            if ($ServerScanResult.Ports -and ($ServerScanResult.Ports -contains 80)) {
                $apiPort = 80
            } elseif ($ServerScanResult.Ports -and $ServerScanResult.Ports.Count -gt 0) {
                $apiPort = $ServerScanResult.Ports[0]
            }

            $details = Get-DisguiseServerDetails -IPAddress $ServerScanResult.IPAddress -Port $apiPort

            # Left accent border: green = API responsive, red = unreachable
            $accentColor = if ($details.APIReachable) { $script:Theme.Success } else { $script:Theme.Error }
            $existingAccent = $CardPanel.Controls | Where-Object { $_.Name -eq 'FleetAccent' }
            if ($existingAccent) {
                $existingAccent.BackColor = $accentColor
            }

            # Update all the stat labels — they are stored by Name on the card panel
            $hostname = if ($ServerScanResult.Hostname -and $ServerScanResult.Hostname -ne '') {
                $ServerScanResult.Hostname
            } else {
                $ServerScanResult.IPAddress
            }

            $CardPanel.Controls | Where-Object { $_.Name -eq 'FleetHostname' } |
                ForEach-Object { $_.Text = $hostname }
            $CardPanel.Controls | Where-Object { $_.Name -eq 'FleetIP' } |
                ForEach-Object { $_.Text = $ServerScanResult.IPAddress }
            $CardPanel.Controls | Where-Object { $_.Name -eq 'FleetVersion' } |
                ForEach-Object { $_.Text = "Version: $($details.Version)" }

            $nicText = if ($details.NICEnabled -eq 'Unavailable') {
                "NICs: Unavailable"
            } elseif ($details.NICDisconnected -gt 0) {
                "NICs: $($details.NICEnabled) enabled ($($details.NICDisconnected) disconnected)"
            } else {
                "NICs: $($details.NICEnabled) enabled"
            }
            $CardPanel.Controls | Where-Object { $_.Name -eq 'FleetNIC' } |
                ForEach-Object {
                    $_.Text = $nicText
                    $_.ForeColor = if ($details.NICDisconnected -gt 0 -and $details.NICDisconnected -ne 'Unavailable') {
                        $script:Theme.Warning
                    } else {
                        $script:Theme.TextSecondary
                    }
                }

            $gpuText = if ($details.GPUOutputs -eq 'Unavailable') {
                "GPU Outputs: Unavailable"
            } else {
                "GPU Outputs: $($details.GPUOutputs) active"
            }
            $CardPanel.Controls | Where-Object { $_.Name -eq 'FleetGPU' } |
                ForEach-Object { $_.Text = $gpuText }

            $projText = if ($details.ProjectCount -eq 'Unavailable') {
                "Projects: Unavailable"
            } elseif ($details.ProjectCount -eq 0) {
                "Projects: None"
            } elseif ($details.ProjectNames.Count -gt 0) {
                $namePreview = ($details.ProjectNames | Select-Object -First 2) -join ', '
                if ($details.ProjectCount -gt 2) { $namePreview += "..." }
                "Projects: $($details.ProjectCount) ($namePreview)"
            } else {
                "Projects: $($details.ProjectCount)"
            }
            $CardPanel.Controls | Where-Object { $_.Name -eq 'FleetProj' } |
                ForEach-Object { $_.Text = $projText }

            $CardPanel.Refresh()
        }

        # Build an empty card shell for each disguise server (populated below / on refresh)
        $serverIndex = 0
        foreach ($srv in $disguiseServers) {
            $col = $serverIndex % $fleetCardsPerRow
            $row = [Math]::Floor($serverIndex / $fleetCardsPerRow)

            $cx = $fleetStartX + $col * ($fleetCardWidth + $fleetCardSpacingX)
            $cy = $fleetCardsY + $row * ($fleetCardHeight + $fleetCardSpacingY)

            # Use the raw Panel (not New-StyledCard) so we can paint our own accent border
            $srvCard = New-Object System.Windows.Forms.Panel
            $srvCard.Location = New-Object System.Drawing.Point($cx, $cy)
            $srvCard.Size = New-Object System.Drawing.Size($fleetCardWidth, $fleetCardHeight)
            $srvCard.BackColor = $script:Theme.CardBackground

            # Rounded border paint handler (matches New-StyledCard style)
            $srvCard.Add_Paint({
                param($sender, $e)
                $borderPen = New-Object System.Drawing.Pen($script:Theme.Border, 1)
                $rect = New-Object System.Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))
                $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
                $radius = 6
                $path = New-Object System.Drawing.Drawing2D.GraphicsPath
                $path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
                $path.AddArc(($rect.Right - $radius), $rect.Y, $radius, $radius, 270, 90)
                $path.AddArc(($rect.Right - $radius), ($rect.Bottom - $radius), $radius, $radius, 0, 90)
                $path.AddArc($rect.X, ($rect.Bottom - $radius), $radius, $radius, 90, 90)
                $path.CloseFigure()
                $e.Graphics.DrawPath($borderPen, $path)
                $borderPen.Dispose()
                $path.Dispose()
            })

            # Left accent stripe (4px, colored by API reachability after query)
            $srvAccent = New-Object System.Windows.Forms.Panel
            $srvAccent.Name = 'FleetAccent'
            $srvAccent.Location = New-Object System.Drawing.Point(0, 0)
            $srvAccent.Size = New-Object System.Drawing.Size(4, $fleetCardHeight)
            $srvAccent.BackColor = $script:Theme.TextMuted  # neutral until queried
            $srvCard.Controls.Add($srvAccent)

            # Hostname label (bold, truncated)
            $lblSrvHostname = New-StyledLabel -Text "..." -X 12 -Y 12 -FontSize 10 -IsBold -MaxWidth ($fleetCardWidth - 20)
            $lblSrvHostname.Name = 'FleetHostname'
            $srvCard.Controls.Add($lblSrvHostname)

            # IP address subtitle
            $lblSrvIP = New-StyledLabel -Text $srv.IPAddress -X 12 -Y 32 -FontSize 8.5 -IsMuted
            $lblSrvIP.Name = 'FleetIP'
            $srvCard.Controls.Add($lblSrvIP)

            # Separator line
            $srvSep = New-Object System.Windows.Forms.Panel
            $srvSep.Location = New-Object System.Drawing.Point(12, 53)
            $srvSep.Size = New-Object System.Drawing.Size(($fleetCardWidth - 24), 1)
            $srvSep.BackColor = $script:Theme.Border
            $srvCard.Controls.Add($srvSep)

            # Version row
            $lblSrvVer = New-StyledLabel -Text "Version: ..." -X 12 -Y 62 -FontSize 8.5 -IsSecondary -MaxWidth ($fleetCardWidth - 20)
            $lblSrvVer.Name = 'FleetVersion'
            $srvCard.Controls.Add($lblSrvVer)

            # NIC row
            $lblSrvNIC = New-StyledLabel -Text "NICs: ..." -X 12 -Y 82 -FontSize 8.5 -IsSecondary -MaxWidth ($fleetCardWidth - 20)
            $lblSrvNIC.Name = 'FleetNIC'
            $srvCard.Controls.Add($lblSrvNIC)

            # GPU row
            $lblSrvGPU = New-StyledLabel -Text "GPU Outputs: ..." -X 12 -Y 102 -FontSize 8.5 -IsSecondary -MaxWidth ($fleetCardWidth - 20)
            $lblSrvGPU.Name = 'FleetGPU'
            $srvCard.Controls.Add($lblSrvGPU)

            # Projects row
            $lblSrvProj = New-StyledLabel -Text "Projects: ..." -X 12 -Y 122 -FontSize 8.5 -IsSecondary -MaxWidth ($fleetCardWidth - 20)
            $lblSrvProj.Name = 'FleetProj'
            $srvCard.Controls.Add($lblSrvProj)

            [void]$fleetCardPanels.Add([PSCustomObject]@{
                Panel  = $srvCard
                Server = $srv
            })

            $scrollContainer.Controls.Add($srvCard)
            $serverIndex++
        }

        # ---------------------------------------------------------------
        # Populate the cards — query servers sequentially with DoEvents()
        # so the UI remains responsive.
        # ---------------------------------------------------------------
        $totalFleet = $fleetCardPanels.Count
        $queryIndex = 0
        foreach ($cardEntry in $fleetCardPanels) {
            $queryIndex++
            $lblFleetStatus.Text = "Querying server $queryIndex of $totalFleet ($($cardEntry.Server.IPAddress))..."
            $lblFleetStatus.Refresh()
            [System.Windows.Forms.Application]::DoEvents()

            try {
                & $buildFleetCard -ServerScanResult $cardEntry.Server -CardPanel $cardEntry.Panel
            } catch {
                Write-AppLog -Message "Dashboard Fleet: Query failed for $($cardEntry.Server.IPAddress) - $_" -Level 'WARN'
            }

            [System.Windows.Forms.Application]::DoEvents()
        }

        $lblFleetStatus.Text = "Fleet status updated - $totalFleet server(s) queried"
        $lblFleetStatus.ForeColor = $script:Theme.Success

        # ---------------------------------------------------------------
        # Refresh Fleet click handler — re-runs the query loop
        # ---------------------------------------------------------------
        $btnRefreshFleet.Add_Click({
            $totalRefresh = $fleetCardPanels.Count
            $refreshIndex = 0
            foreach ($cardEntry in $fleetCardPanels) {
                $refreshIndex++
                $lblFleetStatus.Text = "Refreshing server $refreshIndex of $totalRefresh ($($cardEntry.Server.IPAddress))..."
                $lblFleetStatus.ForeColor = $script:Theme.Accent
                $lblFleetStatus.Refresh()
                [System.Windows.Forms.Application]::DoEvents()

                try {
                    & $buildFleetCard -ServerScanResult $cardEntry.Server -CardPanel $cardEntry.Panel
                } catch {
                    Write-AppLog -Message "Dashboard Fleet Refresh: failed for $($cardEntry.Server.IPAddress) - $_" -Level 'WARN'
                }

                [System.Windows.Forms.Application]::DoEvents()
            }

            $lblFleetStatus.Text = "Fleet status refreshed - $totalRefresh server(s)"
            $lblFleetStatus.ForeColor = $script:Theme.Success
        })
    }

    # ===================================================================
    # Add the scroll container to the content panel
    # ===================================================================
    $ContentPanel.Controls.Add($scrollContainer)
}
