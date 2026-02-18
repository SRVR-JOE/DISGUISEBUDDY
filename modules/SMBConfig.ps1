# SMBConfig.ps1 - DISGUISE BUDDY SMB File Sharing Configuration Module
# Manages d3 Projects SMB shares for disguise (d3) media servers.
# Provides backend functions for share management and a Windows Forms UI view.

# ============================================================================
# Backend Functions
# ============================================================================

function Get-D3ProjectShares {
    <#
    .SYNOPSIS
        Lists all current SMB shares on the system.
    .DESCRIPTION
        Retrieves all SMB shares using Get-SmbShare and returns an array of
        simplified objects. The "d3 Projects" share is flagged if found.
    .OUTPUTS
        Array of PSCustomObjects with Name, Path, Description, ShareState, and IsD3Share properties.
    #>
    try {
        $shares = Get-SmbShare -ErrorAction Stop | ForEach-Object {
            [PSCustomObject]@{
                Name        = $_.Name
                Path        = $_.Path
                Description = $_.Description
                ShareState  = $_.ShareState
                IsD3Share   = ($_.Name -ieq 'd3 Projects')
            }
        }
        Write-AppLog -Message "Retrieved $($shares.Count) SMB shares from system." -Level INFO
        return $shares
    }
    catch {
        Write-AppLog -Message "Failed to retrieve SMB shares: $_" -Level ERROR
        return @()
    }
}

function Get-SharePermissions {
    <#
    .SYNOPSIS
        Gets the access permissions for a specific SMB share.
    .PARAMETER ShareName
        The name of the share to query.
    .OUTPUTS
        Array of PSCustomObjects with AccountName, AccessControlType, and AccessRight properties.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$ShareName
    )

    try {
        $access = Get-SmbShareAccess -Name $ShareName -ErrorAction Stop | ForEach-Object {
            [PSCustomObject]@{
                AccountName       = $_.AccountName
                AccessControlType = $_.AccessControlType
                AccessRight       = $_.AccessRight
            }
        }
        Write-AppLog -Message "Retrieved permissions for share '$ShareName': $($access.Count) entries." -Level INFO
        return $access
    }
    catch {
        Write-AppLog -Message "Failed to retrieve permissions for share '$ShareName': $_" -Level ERROR
        return @()
    }
}

function New-D3ProjectShare {
    <#
    .SYNOPSIS
        Creates a new d3 Projects SMB share.
    .DESCRIPTION
        Creates an SMB share at the specified local path with the given name and
        permissions. The local path is created if it does not exist.
    .PARAMETER LocalPath
        The local filesystem path to share.
    .PARAMETER ShareName
        The name of the share (default: "d3 Projects").
    .PARAMETER Permissions
        Permission string in the format "Account:Level" (default: "Everyone:Full").
        Level can be Full, Change, or Read.
    .OUTPUTS
        PSCustomObject with Success (bool) and Message (string) properties.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$LocalPath,

        [string]$ShareName = 'd3 Projects',

        [string]$Permissions = 'Everyone:Full'
    )

    # Validate share name
    if ([string]::IsNullOrWhiteSpace($ShareName)) {
        return [PSCustomObject]@{ Success = $false; Message = "Share name cannot be empty." }
    }
    if ($ShareName.Length -gt 80) {
        return [PSCustomObject]@{ Success = $false; Message = "Share name is too long (max 80 characters)." }
    }
    if ($ShareName -match '[\\/:*?"<>|]') {
        return [PSCustomObject]@{ Success = $false; Message = "Share name contains invalid characters." }
    }

    try {
        # Validate and create path if needed
        if (-not (Test-Path -Path $LocalPath)) {
            Write-AppLog -Message "Path '$LocalPath' does not exist. Creating directory." -Level INFO
            New-Item -Path $LocalPath -ItemType Directory -Force -ErrorAction Stop | Out-Null
        }

        # Parse permission string
        $parts = $Permissions -split ':'
        $account = if ($parts.Count -ge 1) { $parts[0] } else { 'Everyone' }
        $level   = if ($parts.Count -ge 2) { $parts[1] } else { 'Full' }

        # Check if share already exists
        $existingShare = $null
        try {
            $existingShare = Get-SmbShare -Name $ShareName -ErrorAction Stop
        }
        catch {
            # Share does not exist, which is expected
        }

        if ($existingShare) {
            Write-AppLog -Message "Share '$ShareName' already exists. Remove it first to recreate." -Level WARN
            return [PSCustomObject]@{
                Success = $false
                Message = "Share '$ShareName' already exists. Remove it first or update its settings."
            }
        }

        # Create the share with the appropriate access level
        $shareParams = @{
            Name        = $ShareName
            Path        = $LocalPath
            Description = 'd3 Projects shared folder for disguise media server'
            ErrorAction = 'Stop'
        }

        switch ($level) {
            'Full'   { $shareParams['FullAccess']   = $account }
            'Change' { $shareParams['ChangeAccess'] = $account }
            'Read'   { $shareParams['ReadAccess']   = $account }
            default  { $shareParams['FullAccess']   = $account }
        }

        New-SmbShare @shareParams | Out-Null

        Write-AppLog -Message "Successfully created share '$ShareName' at '$LocalPath' with $level access for $account." -Level INFO
        return [PSCustomObject]@{
            Success = $true
            Message = "Share '$ShareName' created successfully at '$LocalPath'."
        }
    }
    catch {
        Write-AppLog -Message "Failed to create share '$ShareName': $_" -Level ERROR
        return [PSCustomObject]@{
            Success = $false
            Message = "Failed to create share: $_"
        }
    }
}

function Remove-D3Share {
    <#
    .SYNOPSIS
        Removes an existing SMB share.
    .PARAMETER ShareName
        The name of the share to remove.
    .OUTPUTS
        PSCustomObject with Success (bool) and Message (string) properties.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$ShareName
    )

    try {
        Remove-SmbShare -Name $ShareName -Force -ErrorAction Stop
        Write-AppLog -Message "Successfully removed share '$ShareName'." -Level INFO
        return [PSCustomObject]@{
            Success = $true
            Message = "Share '$ShareName' has been removed."
        }
    }
    catch {
        Write-AppLog -Message "Failed to remove share '$ShareName': $_" -Level ERROR
        return [PSCustomObject]@{
            Success = $false
            Message = "Failed to remove share '$ShareName': $_"
        }
    }
}

function Set-D3SharePermissions {
    <#
    .SYNOPSIS
        Updates the permissions on an existing SMB share.
    .DESCRIPTION
        Grants the specified access right to the given account on the share.
        Revokes existing access for the account first to avoid conflicts.
    .PARAMETER ShareName
        The name of the share to modify.
    .PARAMETER AccountName
        The account to grant access to (e.g., "Everyone", "Administrators").
    .PARAMETER AccessRight
        The access level: Full, Change, or Read.
    .OUTPUTS
        PSCustomObject with Success (bool) and Message (string) properties.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$ShareName,

        [Parameter(Mandatory = $true)]
        [string]$AccountName,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Full', 'Change', 'Read')]
        [string]$AccessRight
    )

    try {
        # Revoke existing access for the account (ignore errors if no existing access)
        try {
            Revoke-SmbShareAccess -Name $ShareName -AccountName $AccountName -Force -ErrorAction Stop
            Write-AppLog -Message "Revoked existing access for '$AccountName' on '$ShareName'." -Level INFO
        }
        catch {
            # No existing access to revoke; this is acceptable
            Write-AppLog -Message "No existing access to revoke for '$AccountName' on '$ShareName'." -Level DEBUG
        }

        # Grant new access
        Grant-SmbShareAccess -Name $ShareName -AccountName $AccountName -AccessRight $AccessRight -Force -ErrorAction Stop | Out-Null

        Write-AppLog -Message "Granted $AccessRight access to '$AccountName' on share '$ShareName'." -Level INFO
        return [PSCustomObject]@{
            Success = $true
            Message = "Granted $AccessRight access to '$AccountName' on '$ShareName'."
        }
    }
    catch {
        Write-AppLog -Message "Failed to set permissions on '$ShareName': $_" -Level ERROR
        return [PSCustomObject]@{
            Success = $false
            Message = "Failed to set permissions: $_"
        }
    }
}

function Test-D3ProjectsPath {
    <#
    .SYNOPSIS
        Validates that a d3 projects path exists and is accessible.
    .PARAMETER Path
        The filesystem path to test.
    .OUTPUTS
        Boolean indicating whether the path exists and is accessible.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    try {
        $exists = Test-Path -Path $Path -ErrorAction Stop
        Write-AppLog -Message "Path test for '$Path': $exists" -Level DEBUG
        return $exists
    }
    catch {
        Write-AppLog -Message "Error testing path '$Path': $_" -Level ERROR
        return $false
    }
}

# ============================================================================
# UI View Function
# ============================================================================

function New-SMBView {
    <#
    .SYNOPSIS
        Creates the SMB File Sharing configuration view.
    .DESCRIPTION
        Builds the complete UI for managing d3 Projects SMB shares, including
        share creation, permissions, and additional share management.
    .PARAMETER ContentPanel
        The parent panel in which to render the view.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.Panel]$ContentPanel
    )

    # Store content panel reference for view refresh callbacks
    $script:SMBContentPanel = $ContentPanel

    # Clear existing content
    $ContentPanel.Controls.Clear()

    # Compute dynamic card width based on available content area (minus 20px padding each side)
    $cardWidth = $ContentPanel.ClientSize.Width - 40

    # Create a scrollable container for all content
    $scrollPanel = New-ScrollPanel -X 0 -Y 0 -Width $ContentPanel.Width -Height $ContentPanel.Height
    $scrollPanel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                          [System.Windows.Forms.AnchorStyles]::Left -bor
                          [System.Windows.Forms.AnchorStyles]::Right -bor
                          [System.Windows.Forms.AnchorStyles]::Bottom

    # ---- Section Header ----
    $header = New-SectionHeader -Text "SMB File Sharing" -X 20 -Y 15 -Width $cardWidth
    $scrollPanel.Controls.Add($header)

    $subtitle = New-StyledLabel -Text "Manage d3 Projects and media share access" -X 20 -Y 55 -IsSecondary
    $scrollPanel.Controls.Add($subtitle)

    # ========================================================================
    # Card 1: d3 Projects Share
    # ========================================================================
    $card1 = New-StyledCard -Title "d3 Projects Share" -X 20 -Y 90 -Width $cardWidth -Height 460

    $yPos = 45

    # -- Status badge --
    # Determine whether the d3 Projects share currently exists
    $d3ShareActive = $false
    $d3SharePath = ''
    try {
        $existingShare = Get-SmbShare -Name 'd3 Projects' -ErrorAction Stop
        $d3ShareActive = $true
        $d3SharePath = $existingShare.Path
    }
    catch {
        # Share does not exist
    }

    $statusType = if ($d3ShareActive) { 'Success' } else { 'Error' }
    $statusText = if ($d3ShareActive) { 'ACTIVE' } else { 'INACTIVE' }
    $statusBadge = New-StatusBadge -Text $statusText -X ($cardWidth - 100) -Y 15 -Type $statusType
    $statusBadge.Name = 'statusBadge'
    $card1.Controls.Add($statusBadge)

    # -- Share name --
    $lblShareName = New-StyledLabel -Text "Share Name:" -X 15 -Y $yPos -IsBold
    $card1.Controls.Add($lblShareName)

    $txtShareName = New-StyledTextBox -X 160 -Y $yPos -Width 350 -PlaceholderText "d3 Projects"
    $txtShareName.Name = 'txtShareName'
    if ($d3ShareActive) {
        $txtShareName.Text = 'd3 Projects'
        $txtShareName.ForeColor = $script:Theme.Text
    }
    $card1.Controls.Add($txtShareName)

    $yPos += 40

    # -- Local path --
    $lblLocalPath = New-StyledLabel -Text "Local Path:" -X 15 -Y $yPos -IsBold
    $card1.Controls.Add($lblLocalPath)

    $txtLocalPath = New-StyledTextBox -X 160 -Y $yPos -Width 350 -PlaceholderText "D:\d3 Projects"
    $txtLocalPath.Name = 'txtLocalPath'
    if ($d3ShareActive -and $d3SharePath) {
        $txtLocalPath.Text = $d3SharePath
        $txtLocalPath.ForeColor = $script:Theme.Text
    }
    $card1.Controls.Add($txtLocalPath)

    # Browse button
    $btnBrowse = New-StyledButton -Text "Browse..." -X 520 -Y $yPos -Width 90 -Height 28 -OnClick {
        $folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $folderDialog.Description = "Select the d3 Projects folder"
        $folderDialog.ShowNewFolderButton = $true

        if ($folderDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $pathBox = $this.Parent.Controls['txtLocalPath']
            if ($pathBox) {
                $pathBox.Text = $folderDialog.SelectedPath
                $pathBox.ForeColor = $script:Theme.Text
            }
        }
    }
    $card1.Controls.Add($btnBrowse)

    $yPos += 30

    # -- Current path info --
    if ($d3ShareActive -and $d3SharePath) {
        $lblCurrentPath = New-StyledLabel -Text "Current shared path: $d3SharePath" -X 160 -Y $yPos -IsMuted -FontSize 8.5
        $card1.Controls.Add($lblCurrentPath)
    }

    $yPos += 30

    # -- Share checkbox --
    $chkShareEnabled = New-StyledCheckBox -Text "Share d3 Projects folder" -X 15 -Y $yPos
    $chkShareEnabled.Name = 'chkShareEnabled'
    $chkShareEnabled.Checked = $d3ShareActive
    $card1.Controls.Add($chkShareEnabled)

    $yPos += 40

    # -- Permissions section --
    $lblPermSection = New-StyledLabel -Text "Permissions" -X 15 -Y $yPos -IsBold -FontSize 10.5
    $card1.Controls.Add($lblPermSection)
    $yPos += 28

    # Current permissions display
    $permText = "No permissions loaded"
    if ($d3ShareActive) {
        try {
            $perms = Get-SharePermissions -ShareName 'd3 Projects'
            if ($perms -and $perms.Count -gt 0) {
                $permText = ($perms | ForEach-Object { "$($_.AccountName): $($_.AccessRight)" }) -join ', '
            }
        }
        catch {
            $permText = "Unable to retrieve permissions"
        }
    }

    $lblCurrentPerms = New-StyledLabel -Text "Current: $permText" -X 15 -Y $yPos -IsSecondary -FontSize 9 -MaxWidth ($cardWidth - 30)
    $lblCurrentPerms.Name = 'lblCurrentPerms'
    $card1.Controls.Add($lblCurrentPerms)
    $yPos += 30

    # Account dropdown
    $lblAccount = New-StyledLabel -Text "Account:" -X 15 -Y $yPos
    $card1.Controls.Add($lblAccount)

    $cmbAccount = New-StyledComboBox -X 160 -Y $yPos -Width 200 -Items @('Everyone', 'Administrators', 'SYSTEM', 'Authenticated Users')
    $cmbAccount.Name = 'cmbAccount'
    $cmbAccount.SelectedIndex = 0
    $card1.Controls.Add($cmbAccount)

    # Access level dropdown
    $lblAccess = New-StyledLabel -Text "Access:" -X 380 -Y $yPos
    $card1.Controls.Add($lblAccess)

    $cmbAccess = New-StyledComboBox -X 450 -Y $yPos -Width 140 -Items @('Full', 'Change', 'Read')
    $cmbAccess.Name = 'cmbAccess'
    $cmbAccess.SelectedIndex = 0
    $card1.Controls.Add($cmbAccess)

    # Update Permissions button
    $btnUpdatePerms = New-StyledButton -Text "Update Permissions" -X ($cardWidth - 175) -Y $yPos -Width 150 -Height 28 -OnClick {
        $card = $this.Parent
        $shareName = $card.Controls['txtShareName'].Text
        $account = $card.Controls['cmbAccount'].SelectedItem
        $access = $card.Controls['cmbAccess'].SelectedItem

        if (-not $shareName -or $shareName -eq '') {
            $shareName = 'd3 Projects'
        }
        # Use placeholder fallback
        if ($shareName -eq $card.Controls['txtShareName'].Tag) {
            $shareName = 'd3 Projects'
        }

        if (-not $account -or -not $access) {
            [System.Windows.Forms.MessageBox]::Show(
                "Please select an account and access level.",
                "Missing Selection",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            )
            return
        }

        $result = Set-D3SharePermissions -ShareName $shareName -AccountName $account -AccessRight $access

        if ($result.Success) {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message,
                "Permissions Updated",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            )
            # Refresh permissions label
            $perms = Get-SharePermissions -ShareName $shareName
            if ($perms -and $perms.Count -gt 0) {
                $permDisplay = ($perms | ForEach-Object { "$($_.AccountName): $($_.AccessRight)" }) -join ', '
                $card.Controls['lblCurrentPerms'].Text = "Current: $permDisplay"
            }
        }
        else {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message,
                "Permission Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card1.Controls.Add($btnUpdatePerms)

    $yPos += 45

    # -- Action buttons row --
    $btnApplyShare = New-StyledButton -Text "Apply Share Settings" -X 15 -Y $yPos -Width 180 -Height 35 -IsPrimary -OnClick {
        $card = $this.Parent
        $shareName = $card.Controls['txtShareName'].Text
        $localPath = $card.Controls['txtLocalPath'].Text
        $shareEnabled = $card.Controls['chkShareEnabled'].Checked
        $account = $card.Controls['cmbAccount'].SelectedItem
        $access = $card.Controls['cmbAccess'].SelectedItem

        # Handle placeholder text fallback
        if (-not $shareName -or $shareName -eq $card.Controls['txtShareName'].Tag) {
            $shareName = 'd3 Projects'
        }
        if (-not $localPath -or $localPath -eq $card.Controls['txtLocalPath'].Tag) {
            $localPath = 'D:\d3 Projects'
        }

        if (-not $shareEnabled) {
            [System.Windows.Forms.MessageBox]::Show(
                "The 'Share d3 Projects folder' checkbox is not checked. Enable it to create the share.",
                "Share Disabled",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            )
            return
        }

        # Validate path
        if (-not (Test-D3ProjectsPath -Path $localPath)) {
            $createDir = [System.Windows.Forms.MessageBox]::Show(
                "The path '$localPath' does not exist. Create it now?",
                "Path Not Found",
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Question
            )
            if ($createDir -ne [System.Windows.Forms.DialogResult]::Yes) {
                return
            }
        }

        # Build permissions string
        if (-not $account) { $account = 'Everyone' }
        if (-not $access) { $access = 'Full' }
        $permString = "${account}:${access}"

        $result = New-D3ProjectShare -LocalPath $localPath -ShareName $shareName -Permissions $permString

        if ($result.Success) {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message,
                "Share Created",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            )
            # Refresh the view
            New-SMBView -ContentPanel $script:SMBContentPanel
        }
        else {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message,
                "Share Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card1.Controls.Add($btnApplyShare)

    $btnRemoveShare = New-StyledButton -Text "Remove Share" -X 210 -Y $yPos -Width 140 -Height 35 -IsDestructive -OnClick {
        $card = $this.Parent
        $shareName = $card.Controls['txtShareName'].Text
        if (-not $shareName -or $shareName -eq $card.Controls['txtShareName'].Tag) {
            $shareName = 'd3 Projects'
        }

        $confirm = [System.Windows.Forms.MessageBox]::Show(
            "Are you sure you want to remove the share '$shareName'?`n`nThis will stop all network access to this folder. The local files will not be deleted.",
            "Confirm Share Removal",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($confirm -eq [System.Windows.Forms.DialogResult]::Yes) {
            $result = Remove-D3Share -ShareName $shareName
            if ($result.Success) {
                [System.Windows.Forms.MessageBox]::Show(
                    $result.Message,
                    "Share Removed",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Information
                )
                # Refresh the view
                New-SMBView -ContentPanel $script:SMBContentPanel
            }
            else {
                [System.Windows.Forms.MessageBox]::Show(
                    $result.Message,
                    "Removal Error",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error
                )
            }
        }
    }
    $card1.Controls.Add($btnRemoveShare)

    $scrollPanel.Controls.Add($card1)

    # ========================================================================
    # Card 2: Additional Shares
    # ========================================================================
    $card2 = New-StyledCard -Title "Additional Shares" -X 20 -Y 570 -Width $cardWidth -Height 360

    # DataGridView showing all system shares
    $dgv = New-StyledDataGridView -X 15 -Y 45 -Width ($cardWidth - 30) -Height 220
    $dgv.Name = 'dgvShares'
    $dgv.ReadOnly = $true

    # Define columns
    $colName = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colName.Name = 'ShareName'
    $colName.HeaderText = 'Name'
    $colName.FillWeight = 30

    $colPath = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colPath.Name = 'SharePath'
    $colPath.HeaderText = 'Path'
    $colPath.FillWeight = 50

    $colState = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colState.Name = 'ShareState'
    $colState.HeaderText = 'State'
    $colState.FillWeight = 20

    $dgv.Columns.AddRange(@($colName, $colPath, $colState))

    # Populate the grid with current shares
    try {
        $allShares = Get-D3ProjectShares
        foreach ($share in $allShares) {
            $dgv.Rows.Add($share.Name, $share.Path, $share.ShareState) | Out-Null
        }
    }
    catch {
        Write-AppLog -Message "Could not populate share grid: $_" -Level WARN
    }

    $card2.Controls.Add($dgv)

    # Button row for Additional Shares card
    $btnRefresh = New-StyledButton -Text "Refresh" -X 15 -Y 275 -Width 100 -Height 32 -OnClick {
        $card = $this.Parent
        $grid = $card.Controls['dgvShares']
        $grid.Rows.Clear()
        try {
            $shares = Get-D3ProjectShares
            foreach ($s in $shares) {
                $grid.Rows.Add($s.Name, $s.Path, $s.ShareState) | Out-Null
            }
        }
        catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Failed to refresh shares: $_",
                "Refresh Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card2.Controls.Add($btnRefresh)

    $btnCreateNew = New-StyledButton -Text "Create New Share" -X 125 -Y 275 -Width 150 -Height 32 -OnClick {
        # Open a dialog form for creating a new share
        $dlg = New-Object System.Windows.Forms.Form
        $dlg.Text = "Create New SMB Share"
        $dlg.Size = New-Object System.Drawing.Size(450, 320)
        $dlg.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent
        $dlg.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
        $dlg.MaximizeBox = $false
        $dlg.MinimizeBox = $false
        $dlg.BackColor = $script:Theme.Background

        # Share name
        $lblDlgName = New-StyledLabel -Text "Share Name:" -X 15 -Y 20 -IsBold
        $dlg.Controls.Add($lblDlgName)
        $txtDlgName = New-StyledTextBox -X 140 -Y 20 -Width 270 -PlaceholderText "Enter share name"
        $txtDlgName.Name = 'txtDlgName'
        $dlg.Controls.Add($txtDlgName)

        # Local path
        $lblDlgPath = New-StyledLabel -Text "Local Path:" -X 15 -Y 65 -IsBold
        $dlg.Controls.Add($lblDlgPath)
        $txtDlgPath = New-StyledTextBox -X 140 -Y 65 -Width 200 -PlaceholderText "C:\SharedFolder"
        $txtDlgPath.Name = 'txtDlgPath'
        $dlg.Controls.Add($txtDlgPath)

        $btnDlgBrowse = New-StyledButton -Text "Browse..." -X 350 -Y 65 -Width 70 -Height 28 -OnClick {
            $fb = New-Object System.Windows.Forms.FolderBrowserDialog
            $fb.Description = "Select folder to share"
            $fb.ShowNewFolderButton = $true
            if ($fb.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                $this.Parent.Controls['txtDlgPath'].Text = $fb.SelectedPath
                $this.Parent.Controls['txtDlgPath'].ForeColor = $script:Theme.Text
            }
        }
        $dlg.Controls.Add($btnDlgBrowse)

        # Account
        $lblDlgAccount = New-StyledLabel -Text "Account:" -X 15 -Y 110 -IsBold
        $dlg.Controls.Add($lblDlgAccount)
        $cmbDlgAccount = New-StyledComboBox -X 140 -Y 110 -Width 200 -Items @('Everyone', 'Administrators', 'SYSTEM', 'Authenticated Users')
        $cmbDlgAccount.Name = 'cmbDlgAccount'
        $cmbDlgAccount.SelectedIndex = 0
        $dlg.Controls.Add($cmbDlgAccount)

        # Access level
        $lblDlgAccess = New-StyledLabel -Text "Access Level:" -X 15 -Y 155 -IsBold
        $dlg.Controls.Add($lblDlgAccess)
        $cmbDlgAccess = New-StyledComboBox -X 140 -Y 155 -Width 200 -Items @('Full', 'Change', 'Read')
        $cmbDlgAccess.Name = 'cmbDlgAccess'
        $cmbDlgAccess.SelectedIndex = 0
        $dlg.Controls.Add($cmbDlgAccess)

        # Create button
        $btnDlgCreate = New-StyledButton -Text "Create Share" -X 140 -Y 210 -Width 140 -Height 35 -IsPrimary -OnClick {
            $form = $this.Parent
            $sName = $form.Controls['txtDlgName'].Text
            $sPath = $form.Controls['txtDlgPath'].Text
            $sAccount = $form.Controls['cmbDlgAccount'].SelectedItem
            $sAccess = $form.Controls['cmbDlgAccess'].SelectedItem

            # Handle placeholder text
            if ($sName -eq $form.Controls['txtDlgName'].Tag) { $sName = '' }
            if ($sPath -eq $form.Controls['txtDlgPath'].Tag) { $sPath = '' }

            if (-not $sName -or -not $sPath) {
                [System.Windows.Forms.MessageBox]::Show(
                    "Please enter both a share name and a local path.",
                    "Missing Input",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Warning
                )
                return
            }

            $permString = "${sAccount}:${sAccess}"
            $result = New-D3ProjectShare -LocalPath $sPath -ShareName $sName -Permissions $permString

            if ($result.Success) {
                [System.Windows.Forms.MessageBox]::Show(
                    $result.Message,
                    "Share Created",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Information
                )
                $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
                $form.Close()
            }
            else {
                [System.Windows.Forms.MessageBox]::Show(
                    $result.Message,
                    "Error",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error
                )
            }
        }
        $dlg.Controls.Add($btnDlgCreate)

        # Cancel button
        $btnDlgCancel = New-StyledButton -Text "Cancel" -X 290 -Y 210 -Width 100 -Height 35 -OnClick {
            $this.Parent.Close()
        }
        $dlg.Controls.Add($btnDlgCancel)

        # Show the dialog; refresh grid if a share was created
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $parentCard = $this.Parent
            $grid = $parentCard.Controls['dgvShares']
            $grid.Rows.Clear()
            try {
                $shares = Get-D3ProjectShares
                foreach ($s in $shares) {
                    $grid.Rows.Add($s.Name, $s.Path, $s.ShareState) | Out-Null
                }
            }
            catch { }
        }
    }
    $card2.Controls.Add($btnCreateNew)

    $btnRemoveSelected = New-StyledButton -Text "Remove Selected" -X 285 -Y 275 -Width 150 -Height 32 -IsDestructive -OnClick {
        $card = $this.Parent
        $grid = $card.Controls['dgvShares']

        if ($grid.SelectedRows.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show(
                "Please select a share to remove.",
                "No Selection",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            )
            return
        }

        $selectedName = $grid.SelectedRows[0].Cells['ShareName'].Value

        $confirm = [System.Windows.Forms.MessageBox]::Show(
            "Are you sure you want to remove the share '$selectedName'?",
            "Confirm Removal",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($confirm -eq [System.Windows.Forms.DialogResult]::Yes) {
            $result = Remove-D3Share -ShareName $selectedName
            if ($result.Success) {
                # Refresh grid
                $grid.Rows.Clear()
                try {
                    $shares = Get-D3ProjectShares
                    foreach ($s in $shares) {
                        $grid.Rows.Add($s.Name, $s.Path, $s.ShareState) | Out-Null
                    }
                }
                catch { }
            }
            else {
                [System.Windows.Forms.MessageBox]::Show(
                    $result.Message,
                    "Removal Error",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error
                )
            }
        }
    }
    $card2.Controls.Add($btnRemoveSelected)

    $scrollPanel.Controls.Add($card2)

    # ========================================================================
    # Card 3: Quick Actions
    # ========================================================================
    $card3 = New-StyledCard -Title "Quick Actions" -X 20 -Y 950 -Width $cardWidth -Height 200

    $hostname = $env:COMPUTERNAME
    if (-not $hostname) {
        try { $hostname = [System.Net.Dns]::GetHostName() } catch { $hostname = 'UNKNOWN' }
    }

    # Test Share Access button
    $btnTestAccess = New-StyledButton -Text "Test Share Access" -X 15 -Y 50 -Width 160 -Height 35 -OnClick {
        $card = $this.Parent
        $statusLabel = $card.Controls['lblQuickStatus']
        $statusLabel.Text = "Testing share access..."
        $statusLabel.ForeColor = $script:Theme.TextSecondary
        $statusLabel.Refresh()

        $hn = $env:COMPUTERNAME
        if (-not $hn) {
            try { $hn = [System.Net.Dns]::GetHostName() } catch { $hn = 'UNKNOWN' }
        }
        $uncPath = "\\$hn\d3 Projects"

        try {
            if (Test-Path -Path $uncPath -ErrorAction Stop) {
                $statusLabel.Text = "Share '$uncPath' is accessible."
                $statusLabel.ForeColor = $script:Theme.Success
            }
            else {
                $statusLabel.Text = "Share '$uncPath' is NOT accessible."
                $statusLabel.ForeColor = $script:Theme.Error
            }
        }
        catch {
            $statusLabel.Text = "Error testing share: $_"
            $statusLabel.ForeColor = $script:Theme.Error
        }
    }
    $card3.Controls.Add($btnTestAccess)

    # Open in Explorer button
    $btnOpenExplorer = New-StyledButton -Text "Open Share in Explorer" -X 190 -Y 50 -Width 180 -Height 35 -OnClick {
        try {
            # Try to find the d3 Projects share path
            $sharePath = $null
            try {
                $shareInfo = Get-SmbShare -Name 'd3 Projects' -ErrorAction Stop
                $sharePath = $shareInfo.Path
            }
            catch {
                $sharePath = 'D:\d3 Projects'
            }

            if (Test-Path -Path $sharePath -ErrorAction SilentlyContinue) {
                Start-Process explorer.exe -ArgumentList $sharePath
            }
            else {
                [System.Windows.Forms.MessageBox]::Show(
                    "The path '$sharePath' does not exist.",
                    "Path Not Found",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Warning
                )
            }
        }
        catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Failed to open Explorer: $_",
                "Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card3.Controls.Add($btnOpenExplorer)

    # Copy UNC Path button
    $btnCopyUNC = New-StyledButton -Text "Copy UNC Path" -X 385 -Y 50 -Width 150 -Height 35 -OnClick {
        $hn = $env:COMPUTERNAME
        if (-not $hn) {
            try { $hn = [System.Net.Dns]::GetHostName() } catch { $hn = 'UNKNOWN' }
        }
        $uncPath = "\\$hn\d3 Projects"
        try {
            [System.Windows.Forms.Clipboard]::SetText($uncPath)
            $card = $this.Parent
            $statusLabel = $card.Controls['lblQuickStatus']
            $statusLabel.Text = "Copied to clipboard: $uncPath"
            $statusLabel.ForeColor = $script:Theme.Success
        }
        catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Failed to copy to clipboard: $_",
                "Clipboard Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card3.Controls.Add($btnCopyUNC)

    # Status area
    $lblQuickStatus = New-StyledLabel -Text "UNC Path: \\$hostname\d3 Projects" -X 15 -Y 100 -IsSecondary -FontSize 9 -MaxWidth ($cardWidth - 30)
    $lblQuickStatus.Name = 'lblQuickStatus'
    $card3.Controls.Add($lblQuickStatus)

    $scrollPanel.Controls.Add($card3)

    # Add scroll panel to content panel
    $ContentPanel.Controls.Add($scrollPanel)
}
