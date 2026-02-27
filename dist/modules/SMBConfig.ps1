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
                IsD3Share   = ($_.Name -eq 'd3 Projects')
            }
        }
        Write-AppLog -Message "Retrieved $($shares.Count) SMB shares from system." -Level 'INFO'
        return $shares
    }
    catch {
        Write-AppLog -Message "Failed to retrieve SMB shares: $_" -Level 'ERROR'
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
        Write-AppLog -Message "Retrieved permissions for share '$ShareName': $($access.Count) entries." -Level 'INFO'
        return $access
    }
    catch {
        Write-AppLog -Message "Failed to retrieve permissions for share '$ShareName': $_" -Level 'ERROR'
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
        Permission string in the format "Account:Level" (default: "Administrators:Full").
        Level can be Full, Change, or Read.
    .OUTPUTS
        PSCustomObject with Success (bool) and Message (string) properties.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$LocalPath,

        [string]$ShareName = 'd3 Projects',

        [string]$Permissions = 'Administrators:Full'
    )

    try {
        # Validate path format before any filesystem operations
        $pathValidation = Test-SharePathFormat -Path $LocalPath
        if (-not $pathValidation.IsValid) {
            Write-AppLog -Message "Share path validation failed for '$LocalPath': $($pathValidation.ErrorMessage)" -Level 'WARN'
            return [PSCustomObject]@{
                Success = $false
                Message = "Invalid share path: $($pathValidation.ErrorMessage)"
            }
        }

        # Validate and create path if needed
        if (-not (Test-Path -Path $LocalPath)) {
            Write-AppLog -Message "Path '$LocalPath' does not exist. Creating directory." -Level 'INFO'
            New-Item -Path $LocalPath -ItemType Directory -Force -ErrorAction Stop | Out-Null
        }

        # Parse permission string
        $parts = $Permissions -split ':'
        $account = if ($parts.Count -ge 1) { $parts[0] } else { 'Administrators' }
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
            Write-AppLog -Message "Share '$ShareName' already exists. Remove it first to recreate." -Level 'WARN'
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

        Write-AppLog -Message "Successfully created share '$ShareName' at '$LocalPath' with $level access for $account." -Level 'INFO'
        return [PSCustomObject]@{
            Success = $true
            Message = "Share '$ShareName' created successfully at '$LocalPath'."
        }
    }
    catch {
        Write-AppLog -Message "Failed to create share '$ShareName': $_" -Level 'ERROR'
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
        Write-AppLog -Message "Successfully removed share '$ShareName'." -Level 'INFO'
        return [PSCustomObject]@{
            Success = $true
            Message = "Share '$ShareName' has been removed."
        }
    }
    catch {
        Write-AppLog -Message "Failed to remove share '$ShareName': $_" -Level 'ERROR'
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
            Write-AppLog -Message "Revoked existing access for '$AccountName' on '$ShareName'." -Level 'INFO'
        }
        catch {
            # No existing access to revoke; this is acceptable
            Write-AppLog -Message "No existing access to revoke for '$AccountName' on '$ShareName'." -Level 'DEBUG'
        }

        # Grant new access
        Grant-SmbShareAccess -Name $ShareName -AccountName $AccountName -AccessRight $AccessRight -Force -ErrorAction Stop | Out-Null

        Write-AppLog -Message "Granted $AccessRight access to '$AccountName' on share '$ShareName'." -Level 'INFO'
        return [PSCustomObject]@{
            Success = $true
            Message = "Granted $AccessRight access to '$AccountName' on '$ShareName'."
        }
    }
    catch {
        Write-AppLog -Message "Failed to set permissions on '$ShareName': $_" -Level 'ERROR'
        return [PSCustomObject]@{
            Success = $false
            Message = "Failed to set permissions: $_"
        }
    }
}

function Test-SharePathFormat {
    <#
    .SYNOPSIS
        Validates that a share path is a valid local path suitable for SMB sharing.
    .DESCRIPTION
        Checks that the path is not a UNC path (\\server\share), does not contain
        invalid path characters, and appears to be a valid local filesystem path.
    .PARAMETER Path
        The filesystem path to validate.
    .OUTPUTS
        PSCustomObject with IsValid (bool) and ErrorMessage (string) properties.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return [PSCustomObject]@{ IsValid = $false; ErrorMessage = 'Path cannot be empty.' }
    }

    $trimmed = $Path.Trim()

    # Reject UNC paths - shares must be local paths
    if ($trimmed.StartsWith('\\')) {
        return [PSCustomObject]@{
            IsValid      = $false
            ErrorMessage = 'UNC paths (\\server\share) are not allowed. Share paths must be local (e.g., D:\d3 Projects).'
        }
    }

    # Check for invalid path characters (excluding \ and : which are valid in Windows paths)
    $invalidChars = [System.IO.Path]::GetInvalidPathChars()
    foreach ($ch in $invalidChars) {
        if ($trimmed.Contains($ch)) {
            return [PSCustomObject]@{
                IsValid      = $false
                ErrorMessage = "Path contains an invalid character: '$ch'"
            }
        }
    }

    # Also reject these characters that are invalid in folder names on Windows
    $extraInvalid = @('*', '?', '"', '<', '>', '|')
    foreach ($ch in $extraInvalid) {
        if ($trimmed.Contains($ch)) {
            return [PSCustomObject]@{
                IsValid      = $false
                ErrorMessage = "Path contains an invalid character: '$ch'"
            }
        }
    }

    # Ensure the path looks like a rooted local path (e.g., C:\..., D:\...)
    if (-not [System.IO.Path]::IsPathRooted($trimmed)) {
        return [PSCustomObject]@{
            IsValid      = $false
            ErrorMessage = 'Path must be an absolute local path (e.g., D:\d3 Projects).'
        }
    }

    return [PSCustomObject]@{ IsValid = $true; ErrorMessage = '' }
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
        Write-AppLog -Message "Path test for '$Path': $exists" -Level 'DEBUG'
        return $exists
    }
    catch {
        Write-AppLog -Message "Error testing path '$Path': $_" -Level 'ERROR'
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
        Layout mirrors the React dark glass-morphism design: 3 auto-sized cards
        in a scrollable container with 24px padding and 24px gaps between cards.
    .PARAMETER ContentPanel
        The parent panel in which to render the view.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.Panel]$ContentPanel
    )

    # ------------------------------------------------------------------
    # Layout constants (mirror React design spec)
    # ------------------------------------------------------------------
    $PAGE_PAD   = 24   # outer padding on all sides
    $CARD_GAP   = 24   # vertical gap between cards
    $INNER_PAD  = 20   # horizontal padding inside cards (left gutter)
    $CTRL_GAP   = 12   # vertical gap between controls within a card
    $BTN_H      = 35   # consistent button height
    $BTN_GAP    = 12   # horizontal gap between buttons in a row
    $INPUT_H    = 28   # textbox / combobox height
    $LABEL_H    = 18   # single-line label height
    $CARD_W     = 900  # card width (fixed, page scrolls vertically)

    # ------------------------------------------------------------------
    # Resolve current d3 Projects share state (used across all cards)
    # ------------------------------------------------------------------
    $d3ShareActive = $false
    $d3SharePath   = ''
    try {
        $existingShare = Get-SmbShare -Name 'd3 Projects' -ErrorAction Stop
        $d3ShareActive = $true
        $d3SharePath   = $existingShare.Path
    }
    catch {
        # Share does not exist - that is fine
    }

    $hostname = $env:COMPUTERNAME
    if (-not $hostname) {
        try { $hostname = [System.Net.Dns]::GetHostName() } catch { $hostname = 'UNKNOWN' }
    }
    $uncPath = "\\$hostname\d3 Projects"

    # ------------------------------------------------------------------
    # Permissions text (computed once, reused in Card 1)
    # ------------------------------------------------------------------
    $permText = 'No permissions configured'
    if ($d3ShareActive) {
        try {
            $perms = Get-SharePermissions -ShareName 'd3 Projects'
            if ($perms -and $perms.Count -gt 0) {
                $permEntries = foreach ($perm in $perms) {
                    $aLabel = switch ($perm.AccessRight) {
                        'Full'   { 'Full Control' }
                        'Change' { 'Change (Read/Write)' }
                        'Read'   { 'Read Only' }
                        default  { $perm.AccessRight }
                    }
                    $dLabel = if ($perm.AccessControlType -eq 'Deny') { ' [DENY]' } else { '' }
                    "$($perm.AccountName) - $aLabel$dLabel"
                }
                $permText = $permEntries -join '  |  '
            }
        }
        catch {
            $permText = 'Unable to retrieve permissions'
        }
    }

    # ------------------------------------------------------------------
    # Scaffold: clear + scroll container
    # ------------------------------------------------------------------
    $ContentPanel.Controls.Clear()
    $ContentPanel.SuspendLayout()

    $scrollPanel = New-ScrollPanel -X 0 -Y 0 -Width $ContentPanel.Width -Height $ContentPanel.Height

    # ---- Page header ----
    $header = New-SectionHeader -Text "SMB File Sharing" -X $PAGE_PAD -Y $PAGE_PAD -Width $CARD_W
    $scrollPanel.Controls.Add($header)

    $subtitle = New-StyledLabel -Text "Manage d3 Projects and media share access" `
        -X $PAGE_PAD -Y ($PAGE_PAD + 44) -IsSecondary -FontSize 9.5
    $scrollPanel.Controls.Add($subtitle)

    # ======================================================================
    # CARD 1 -- d3 Projects Share   (purple left-accent border)
    # ======================================================================
    #
    # Layout (Y coords relative to card interior, title sits at Y=15 in card):
    #   Y=45   section header + status badge
    #   Y=65   col headers: "Share Name" | "Local Path"
    #   Y=83   input row: txtShareName (420w) | txtLocalPath (340w) + Browse (88w)
    #   Y=107  toggle checkbox
    #   Y=131  "Permissions" label
    #   Y=153  current perms (muted, wrapping)
    #   Y=173  col headers: "Account" | "Access Level"
    #   Y=191  cmbAccount (270w) | cmbAccess (160w) | btnUpdatePerms (178w)
    #   Y=215  separator
    #   Y=227  action buttons: Apply (180w) | Remove (140w)
    #   card height = 227 + 35 + 20 = 282
    # ----------------------------------------------------------------------

    # Y positions relative to card content area
    $c1_y_inputHeaders = 45
    $c1_y_inputs       = 63
    $c1_y_toggle       = $c1_y_inputs + $INPUT_H + $CTRL_GAP        # 103
    $c1_y_permHeader   = $c1_y_toggle + 26 + $CTRL_GAP              # 141
    $c1_y_permCurrent  = $c1_y_permHeader + $LABEL_H + 4            # 163
    $c1_y_permColHdrs  = $c1_y_permCurrent + ($LABEL_H * 2) + 2     # 201  (current perms wraps ~2 lines)
    $c1_y_permInputs   = $c1_y_permColHdrs + $LABEL_H + 2           # 221
    $c1_y_separator    = $c1_y_permInputs + $INPUT_H + $CTRL_GAP    # 261
    $c1_y_actionBtns   = $c1_y_separator + 10                       # 271
    $c1_height         = $c1_y_actionBtns + $BTN_H + $PAGE_PAD      # 330

    $card1Y = $PAGE_PAD + 44 + 20 + $PAGE_PAD                       # header + subtitle + gap = 112
    $card1 = New-StyledCard -Title "d3 Projects Share" `
        -X $PAGE_PAD -Y $card1Y -Width $CARD_W -Height $c1_height `
        -AccentColor $script:Theme.Primary

    # -- Status badge (top-right of card header row) --
    $statusType = if ($d3ShareActive) { 'Success' } else { 'Error' }
    $statusText = if ($d3ShareActive) { 'ACTIVE'  } else { 'INACTIVE' }
    $statusBadge = New-StatusBadge -Text $statusText -X ($CARD_W - 110) -Y 14 -Type $statusType
    $statusBadge.Name = 'statusBadge'
    $card1.Controls.Add($statusBadge)

    # ---- 2-column input row: field labels above, inputs side-by-side ----
    # Column 1: Share Name (left half)
    $lblShareName = New-StyledLabel -Text "Share Name" -X $INNER_PAD -Y $c1_y_inputHeaders -IsBold -FontSize 9
    $card1.Controls.Add($lblShareName)

    # Column 2: Local Path (right half, starts at x=452 = 20 + 420 + 12)
    $col2X = $INNER_PAD + 420 + $CTRL_GAP
    $lblLocalPath = New-StyledLabel -Text "Local Path" -X $col2X -Y $c1_y_inputHeaders -IsBold -FontSize 9
    $card1.Controls.Add($lblLocalPath)

    # Share Name textbox
    $txtShareName = New-StyledTextBox -X $INNER_PAD -Y $c1_y_inputs -Width 408 -Height $INPUT_H `
        -PlaceholderText "d3 Projects"
    $txtShareName.Name = 'txtShareName'
    if ($d3ShareActive) {
        $txtShareName.Text     = 'd3 Projects'
        $txtShareName.ForeColor = $script:Theme.Text
    }
    $card1.Controls.Add($txtShareName)

    # Local Path textbox (narrower to leave room for Browse)
    $txtLocalPath = New-StyledTextBox -X $col2X -Y $c1_y_inputs -Width 248 -Height $INPUT_H `
        -PlaceholderText "D:\d3 Projects"
    $txtLocalPath.Name = 'txtLocalPath'
    if ($d3ShareActive -and $d3SharePath) {
        $txtLocalPath.Text      = $d3SharePath
        $txtLocalPath.ForeColor = $script:Theme.Text
    }
    $card1.Controls.Add($txtLocalPath)

    # Browse button inline with Local Path
    $browseBtnX = $col2X + 248 + $BTN_GAP
    $btnBrowse = New-StyledButton -Text "Browse..." `
        -X $browseBtnX -Y $c1_y_inputs -Width 88 -Height $INPUT_H -OnClick {
        $folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $folderDialog.Description    = "Select the d3 Projects folder"
        $folderDialog.ShowNewFolderButton = $true
        if ($folderDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $pathBox = $this.Parent.Controls['txtLocalPath']
            if ($pathBox) {
                $pathBox.Text      = $folderDialog.SelectedPath
                $pathBox.ForeColor = $script:Theme.Text
            }
        }
    }
    $card1.Controls.Add($btnBrowse)

    # ---- Toggle: Share d3 Projects folder ----
    $chkShareEnabled = New-StyledCheckBox -Text "Share d3 Projects folder" -X $INNER_PAD -Y $c1_y_toggle
    $chkShareEnabled.Name    = 'chkShareEnabled'
    $chkShareEnabled.Checked = $d3ShareActive
    $card1.Controls.Add($chkShareEnabled)

    # ---- Permissions section ----
    $lblPermSection = New-StyledLabel -Text "PERMISSIONS" `
        -X $INNER_PAD -Y $c1_y_permHeader -IsBold -FontSize 8.5
    $lblPermSection.ForeColor = $script:Theme.TextMuted
    $card1.Controls.Add($lblPermSection)

    # Current permissions summary (read-only, wraps)
    $lblCurrentPerms = New-StyledLabel -Text "Current: $permText" `
        -X $INNER_PAD -Y $c1_y_permCurrent -IsSecondary -FontSize 9 -MaxWidth ($CARD_W - ($INNER_PAD * 2) - 8)
    $lblCurrentPerms.Name = 'lblCurrentPerms'
    $card1.Controls.Add($lblCurrentPerms)

    # Permissions dropdown column labels
    $lblAcctHdr = New-StyledLabel -Text "Account" -X $INNER_PAD -Y $c1_y_permColHdrs -IsBold -FontSize 9
    $card1.Controls.Add($lblAcctHdr)

    $acl2X = $INNER_PAD + 270 + $CTRL_GAP
    $lblAclHdr = New-StyledLabel -Text "Access Level" -X $acl2X -Y $c1_y_permColHdrs -IsBold -FontSize 9
    $card1.Controls.Add($lblAclHdr)

    # Account dropdown
    $cmbAccount = New-StyledComboBox -X $INNER_PAD -Y $c1_y_permInputs -Width 270 `
        -Items @('Administrators', 'Everyone', 'SYSTEM', 'Authenticated Users')
    $cmbAccount.Name           = 'cmbAccount'
    $cmbAccount.SelectedIndex  = 0
    $card1.Controls.Add($cmbAccount)

    # Access Level dropdown
    $cmbAccess = New-StyledComboBox -X $acl2X -Y $c1_y_permInputs -Width 160 `
        -Items @('Full', 'Change', 'Read')
    $cmbAccess.Name          = 'cmbAccess'
    $cmbAccess.SelectedIndex = 0
    $card1.Controls.Add($cmbAccess)

    # Update Permissions button (inline, right of dropdowns)
    $updBtnX = $acl2X + 160 + $BTN_GAP
    $btnUpdatePerms = New-StyledButton -Text "Update Permissions" `
        -X $updBtnX -Y $c1_y_permInputs -Width 178 -Height $INPUT_H -IsPrimary -OnClick {
        $card     = $this.Parent
        $shareName = Get-TextBoxValue $card.Controls['txtShareName']
        if (-not $shareName) { $shareName = 'd3 Projects' }
        $account = $card.Controls['cmbAccount'].SelectedItem
        $access  = $card.Controls['cmbAccess'].SelectedItem

        if (-not $account -or -not $access) {
            [System.Windows.Forms.MessageBox]::Show(
                "Please select an account and access level.",
                "Missing Selection",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            )
            return
        }

        $accessLabel = switch ($access) {
            'Full'   { 'Full Control' }
            'Change' { 'Change (Read/Write)' }
            'Read'   { 'Read Only' }
            default  { $access }
        }
        $confirmPerm = [System.Windows.Forms.MessageBox]::Show(
            "Change permissions on '$shareName'?`n`nAccount: $account`nAccess:  $accessLabel`n`nExisting access for '$account' will be revoked first.",
            "Confirm Permission Change",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )
        if ($confirmPerm -ne [System.Windows.Forms.DialogResult]::Yes) { return }

        $result = Set-D3SharePermissions -ShareName $shareName -AccountName $account -AccessRight $access

        if ($result.Success) {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message, "Permissions Updated",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            )
            # Refresh live permissions label
            $refreshed = Get-SharePermissions -ShareName $shareName
            if ($refreshed -and $refreshed.Count -gt 0) {
                $entries = foreach ($p in $refreshed) {
                    $al = switch ($p.AccessRight) {
                        'Full'   { 'Full Control' }
                        'Change' { 'Change (Read/Write)' }
                        'Read'   { 'Read Only' }
                        default  { $p.AccessRight }
                    }
                    $dl = if ($p.AccessControlType -eq 'Deny') { ' [DENY]' } else { '' }
                    "$($p.AccountName) - $al$dl"
                }
                $card.Controls['lblCurrentPerms'].Text = "Current: $($entries -join '  |  ')"
            }
        }
        else {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message, "Permission Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card1.Controls.Add($btnUpdatePerms)

    # ---- Thin separator line before action buttons ----
    $separator1 = New-Object System.Windows.Forms.Panel
    $separator1.Location  = New-Object System.Drawing.Point($INNER_PAD, $c1_y_separator)
    $separator1.Size      = New-Object System.Drawing.Size(($CARD_W - ($INNER_PAD * 2) - 8), 1)
    $separator1.BackColor = $script:Theme.Border
    $card1.Controls.Add($separator1)

    # ---- Primary action buttons row ----
    $btnApplyShare = New-StyledButton -Text "Apply Share Settings" `
        -X $INNER_PAD -Y $c1_y_actionBtns -Width 180 -Height $BTN_H -IsPrimary -OnClick {
        $card        = $this.Parent
        $shareName   = Get-TextBoxValue $card.Controls['txtShareName']
        $localPath   = Get-TextBoxValue $card.Controls['txtLocalPath']
        $shareEnabled = $card.Controls['chkShareEnabled'].Checked
        $account     = $card.Controls['cmbAccount'].SelectedItem
        $access      = $card.Controls['cmbAccess'].SelectedItem

        if (-not $shareName)  { $shareName  = 'd3 Projects'   }
        if (-not $localPath)  { $localPath  = 'D:\d3 Projects' }
        if (-not $account)    { $account    = 'Administrators' }
        if (-not $access)     { $access     = 'Full'           }

        if (-not $shareEnabled) {
            [System.Windows.Forms.MessageBox]::Show(
                "Enable the 'Share d3 Projects folder' toggle to create the share.",
                "Share Disabled",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            )
            return
        }

        $pathCheck = Test-SharePathFormat -Path $localPath
        if (-not $pathCheck.IsValid) {
            [System.Windows.Forms.MessageBox]::Show(
                "Invalid share path: $($pathCheck.ErrorMessage)",
                "Path Validation Failed",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
            return
        }

        if (-not (Test-D3ProjectsPath -Path $localPath)) {
            $createDir = [System.Windows.Forms.MessageBox]::Show(
                "The path '$localPath' does not exist. Create it now?",
                "Path Not Found",
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Question
            )
            if ($createDir -ne [System.Windows.Forms.DialogResult]::Yes) { return }
        }

        $result = New-D3ProjectShare -LocalPath $localPath -ShareName $shareName `
            -Permissions "${account}:${access}"

        if ($result.Success) {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message, "Share Created",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            )
            New-SMBView -ContentPanel $card.Parent.Parent
        }
        else {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message, "Share Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card1.Controls.Add($btnApplyShare)

    $btnRemoveShare = New-StyledButton -Text "Remove Share" `
        -X ($INNER_PAD + 180 + $BTN_GAP) -Y $c1_y_actionBtns -Width 140 -Height $BTN_H -IsDestructive -OnClick {
        $card      = $this.Parent
        $shareName = Get-TextBoxValue $card.Controls['txtShareName']
        if (-not $shareName) { $shareName = 'd3 Projects' }

        $confirm = [System.Windows.Forms.MessageBox]::Show(
            "Remove the share '$shareName'?`n`nNetwork access to this folder will stop. Local files are not deleted.",
            "Confirm Share Removal",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }

        $result = Remove-D3Share -ShareName $shareName
        if ($result.Success) {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message, "Share Removed",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            )
            New-SMBView -ContentPanel $card.Parent.Parent
        }
        else {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message, "Removal Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card1.Controls.Add($btnRemoveShare)

    $scrollPanel.Controls.Add($card1)

    # ======================================================================
    # CARD 2 -- Additional Shares
    # ======================================================================
    #
    # Layout:
    #   Y=45   DataGridView (220px tall)
    #   Y=277  button row: Refresh | Create New | Remove Selected
    #   card height = 277 + 35 + 20 = 332
    # ----------------------------------------------------------------------

    $dgvH          = 220
    $c2_y_dgv      = 45
    $c2_y_btnRow   = $c2_y_dgv + $dgvH + $CTRL_GAP   # 277
    $c2_height     = $c2_y_btnRow + $BTN_H + $PAGE_PAD # 332

    $card2Y = $card1Y + $c1_height + $CARD_GAP
    $card2  = New-StyledCard -Title "Additional Shares" `
        -X $PAGE_PAD -Y $card2Y -Width $CARD_W -Height $c2_height

    # DataGridView
    $dgv = New-StyledDataGridView -X $INNER_PAD -Y $c2_y_dgv `
        -Width ($CARD_W - ($INNER_PAD * 2) - 8) -Height $dgvH
    $dgv.Name     = 'dgvShares'
    $dgv.ReadOnly = $true

    $colName = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colName.Name       = 'ShareName'
    $colName.HeaderText = 'Name'
    $colName.FillWeight = 30

    $colPath = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colPath.Name       = 'SharePath'
    $colPath.HeaderText = 'Path'
    $colPath.FillWeight = 45

    $colState = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colState.Name       = 'ShareState'
    $colState.HeaderText = 'State'
    $colState.FillWeight = 25

    $dgv.Columns.Add($colName)  | Out-Null
    $dgv.Columns.Add($colPath)  | Out-Null
    $dgv.Columns.Add($colState) | Out-Null

    try {
        $allShares = Get-D3ProjectShares
        foreach ($share in $allShares) {
            $dgv.Rows.Add($share.Name, $share.Path, $share.ShareState) | Out-Null
        }
    }
    catch {
        Write-AppLog -Message "Could not populate share grid: $_" -Level 'WARN'
    }
    $card2.Controls.Add($dgv)

    # Helper: refresh grid rows (closure captures $dgv by reference)
    $refreshGrid = {
        $dgv.Rows.Clear()
        try {
            $shares = Get-D3ProjectShares
            foreach ($s in $shares) {
                $dgv.Rows.Add($s.Name, $s.Path, $s.ShareState) | Out-Null
            }
        }
        catch {
            Write-AppLog -Message "Failed to refresh SMB shares: $_" -Level 'WARN'
        }
    }

    # Refresh (ghost style -- same as default surface button)
    $btnRefresh = New-StyledButton -Text "Refresh" `
        -X $INNER_PAD -Y $c2_y_btnRow -Width 100 -Height $BTN_H -OnClick {
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
                "Failed to refresh shares: $_", "Refresh Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card2.Controls.Add($btnRefresh)

    # Create New (outline -- same surface style, border communicates outline intent)
    $btnCreateNew = New-StyledButton -Text "Create New" `
        -X ($INNER_PAD + 100 + $BTN_GAP) -Y $c2_y_btnRow -Width 120 -Height $BTN_H -OnClick {
        $dlg = New-Object System.Windows.Forms.Form
        $dlg.Text             = "Create New SMB Share"
        $dlg.Size             = New-Object System.Drawing.Size(460, 300)
        $dlg.StartPosition    = [System.Windows.Forms.FormStartPosition]::CenterParent
        $dlg.FormBorderStyle  = [System.Windows.Forms.FormBorderStyle]::FixedDialog
        $dlg.MaximizeBox      = $false
        $dlg.MinimizeBox      = $false
        $dlg.BackColor        = $script:Theme.Background

        $dlg.Controls.Add((New-StyledLabel -Text "Share Name:"  -X 15 -Y 20  -IsBold))
        $txtDlgName = New-StyledTextBox -X 140 -Y 20 -Width 280 -PlaceholderText "Enter share name"
        $txtDlgName.Name = 'txtDlgName'
        $dlg.Controls.Add($txtDlgName)

        $dlg.Controls.Add((New-StyledLabel -Text "Local Path:"  -X 15 -Y 60  -IsBold))
        $txtDlgPath = New-StyledTextBox -X 140 -Y 60 -Width 200 -PlaceholderText "C:\SharedFolder"
        $txtDlgPath.Name = 'txtDlgPath'
        $dlg.Controls.Add($txtDlgPath)

        $btnDlgBrowse = New-StyledButton -Text "Browse..." -X 350 -Y 60 -Width 75 -Height 28 -OnClick {
            $fb = New-Object System.Windows.Forms.FolderBrowserDialog
            $fb.Description        = "Select folder to share"
            $fb.ShowNewFolderButton = $true
            if ($fb.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                $this.Parent.Controls['txtDlgPath'].Text      = $fb.SelectedPath
                $this.Parent.Controls['txtDlgPath'].ForeColor = $script:Theme.Text
            }
        }
        $dlg.Controls.Add($btnDlgBrowse)

        $dlg.Controls.Add((New-StyledLabel -Text "Account:"     -X 15 -Y 100 -IsBold))
        $cmbDlgAccount = New-StyledComboBox -X 140 -Y 100 -Width 200 `
            -Items @('Administrators', 'Everyone', 'SYSTEM', 'Authenticated Users')
        $cmbDlgAccount.Name          = 'cmbDlgAccount'
        $cmbDlgAccount.SelectedIndex = 0
        $dlg.Controls.Add($cmbDlgAccount)

        $dlg.Controls.Add((New-StyledLabel -Text "Access Level:" -X 15 -Y 140 -IsBold))
        $cmbDlgAccess = New-StyledComboBox -X 140 -Y 140 -Width 200 -Items @('Full', 'Change', 'Read')
        $cmbDlgAccess.Name          = 'cmbDlgAccess'
        $cmbDlgAccess.SelectedIndex = 0
        $dlg.Controls.Add($cmbDlgAccess)

        $btnDlgCreate = New-StyledButton -Text "Create Share" -X 140 -Y 195 -Width 140 -Height $BTN_H -IsPrimary -OnClick {
            $form     = $this.Parent
            $sName    = Get-TextBoxValue $form.Controls['txtDlgName']
            $sPath    = Get-TextBoxValue $form.Controls['txtDlgPath']
            $sAccount = $form.Controls['cmbDlgAccount'].SelectedItem
            $sAccess  = $form.Controls['cmbDlgAccess'].SelectedItem

            if (-not $sName -or -not $sPath) {
                [System.Windows.Forms.MessageBox]::Show(
                    "Please enter both a share name and a local path.",
                    "Missing Input",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Warning
                )
                return
            }

            $pathCheck = Test-SharePathFormat -Path $sPath
            if (-not $pathCheck.IsValid) {
                [System.Windows.Forms.MessageBox]::Show(
                    "Invalid share path: $($pathCheck.ErrorMessage)",
                    "Path Validation Failed",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error
                )
                return
            }

            $result = New-D3ProjectShare -LocalPath $sPath -ShareName $sName `
                -Permissions "${sAccount}:${sAccess}"

            if ($result.Success) {
                [System.Windows.Forms.MessageBox]::Show(
                    $result.Message, "Share Created",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Information
                )
                $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
                $form.Close()
            }
            else {
                [System.Windows.Forms.MessageBox]::Show(
                    $result.Message, "Error",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error
                )
            }
        }
        $dlg.Controls.Add($btnDlgCreate)

        $btnDlgCancel = New-StyledButton -Text "Cancel" -X 290 -Y 195 -Width 100 -Height $BTN_H -OnClick {
            $this.Parent.Close()
        }
        $dlg.Controls.Add($btnDlgCancel)

        # Refresh grid after successful creation
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $parentCard = $this.Parent
            $grid       = $parentCard.Controls['dgvShares']
            $grid.Rows.Clear()
            try {
                $shares = Get-D3ProjectShares
                foreach ($s in $shares) {
                    $grid.Rows.Add($s.Name, $s.Path, $s.ShareState) | Out-Null
                }
            }
            catch {
                Write-AppLog -Message "Failed to refresh SMB shares list: $_" -Level 'WARN'
            }
        }
    }
    $card2.Controls.Add($btnCreateNew)

    # Remove Selected (destructive)
    $btnRemoveSelected = New-StyledButton -Text "Remove Selected" `
        -X ($INNER_PAD + 100 + $BTN_GAP + 120 + $BTN_GAP) -Y $c2_y_btnRow `
        -Width 150 -Height $BTN_H -IsDestructive -OnClick {
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
            "Remove the share '$selectedName'?",
            "Confirm Removal",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }

        $result = Remove-D3Share -ShareName $selectedName
        if ($result.Success) {
            $grid.Rows.Clear()
            try {
                $shares = Get-D3ProjectShares
                foreach ($s in $shares) {
                    $grid.Rows.Add($s.Name, $s.Path, $s.ShareState) | Out-Null
                }
            }
            catch {
                Write-AppLog -Message "Failed to refresh SMB shares after removal: $_" -Level 'WARN'
            }
        }
        else {
            [System.Windows.Forms.MessageBox]::Show(
                $result.Message, "Removal Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card2.Controls.Add($btnRemoveSelected)

    $scrollPanel.Controls.Add($card2)

    # ======================================================================
    # CARD 3 -- Quick Actions
    # ======================================================================
    #
    # Layout:
    #   Y=45   "UNC Path" field label
    #   Y=63   read-only monospace UNC path textbox (full width)
    #   Y=103  button row: Test Share Access | Copy UNC Path
    #   Y=150  status feedback label (dynamically coloured)
    #   card height = 150 + 20 + 20 = 190
    # ----------------------------------------------------------------------

    $c3_y_uncLabel   = 45
    $c3_y_uncBox     = $c3_y_uncLabel + $LABEL_H + 2   # 65
    $c3_y_btnRow     = $c3_y_uncBox + $INPUT_H + $CTRL_GAP  # 105
    $c3_y_status     = $c3_y_btnRow + $BTN_H + $CTRL_GAP    # 152
    $c3_height       = $c3_y_status + ($LABEL_H * 2) + $PAGE_PAD  # 212

    $card3Y = $card2Y + $c2_height + $CARD_GAP
    $card3  = New-StyledCard -Title "Quick Actions" `
        -X $PAGE_PAD -Y $card3Y -Width $CARD_W -Height $c3_height

    # UNC Path label
    $lblUncHdr = New-StyledLabel -Text "UNC Path" -X $INNER_PAD -Y $c3_y_uncLabel -IsBold -FontSize 9
    $card3.Controls.Add($lblUncHdr)

    # Read-only monospace UNC path display box
    $txtUNC = New-StyledTextBox -X $INNER_PAD -Y $c3_y_uncBox `
        -Width ($CARD_W - ($INNER_PAD * 2) - 8) -Height $INPUT_H
    $txtUNC.Text      = $uncPath
    $txtUNC.ForeColor = $script:Theme.Text
    $txtUNC.BackColor = $script:Theme.Surface
    $txtUNC.ReadOnly  = $true
    $txtUNC.Font      = New-Object System.Drawing.Font('Consolas', 10)
    $txtUNC.Name      = 'txtUNCPath'
    $card3.Controls.Add($txtUNC)

    # Test Share Access
    $btnTestAccess = New-StyledButton -Text "Test Share Access" `
        -X $INNER_PAD -Y $c3_y_btnRow -Width 170 -Height $BTN_H -OnClick {
        $card        = $this.Parent
        $statusLabel = $card.Controls['lblQuickStatus']
        $unc         = $card.Controls['txtUNCPath'].Text

        $statusLabel.Text      = "Testing share access..."
        $statusLabel.ForeColor = $script:Theme.TextSecondary
        $statusLabel.Refresh()

        try {
            if (Test-Path -Path $unc -ErrorAction Stop) {
                $statusLabel.Text      = "Share is accessible: $unc"
                $statusLabel.ForeColor = $script:Theme.Success
            }
            else {
                $statusLabel.Text      = "Share is NOT accessible: $unc"
                $statusLabel.ForeColor = $script:Theme.Error
            }
        }
        catch {
            $statusLabel.Text      = "Error testing share: $_"
            $statusLabel.ForeColor = $script:Theme.Error
        }
    }
    $card3.Controls.Add($btnTestAccess)

    # Copy UNC Path
    $btnCopyUNC = New-StyledButton -Text "Copy UNC Path" `
        -X ($INNER_PAD + 170 + $BTN_GAP) -Y $c3_y_btnRow -Width 150 -Height $BTN_H -OnClick {
        $card        = $this.Parent
        $statusLabel = $card.Controls['lblQuickStatus']
        $unc         = $card.Controls['txtUNCPath'].Text
        try {
            [System.Windows.Forms.Clipboard]::SetText($unc)
            $statusLabel.Text      = "Copied to clipboard: $unc"
            $statusLabel.ForeColor = $script:Theme.Success
        }
        catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Failed to copy to clipboard: $_", "Clipboard Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }
    $card3.Controls.Add($btnCopyUNC)

    # Status feedback area
    $lblQuickStatus = New-StyledLabel -Text "" `
        -X $INNER_PAD -Y $c3_y_status -IsSecondary -FontSize 9 `
        -MaxWidth ($CARD_W - ($INNER_PAD * 2) - 8)
    $lblQuickStatus.Name = 'lblQuickStatus'
    $card3.Controls.Add($lblQuickStatus)

    $scrollPanel.Controls.Add($card3)

    # ------------------------------------------------------------------
    # Mount scroll panel into the content panel
    # ------------------------------------------------------------------
    $ContentPanel.Controls.Add($scrollPanel)
    $ContentPanel.ResumeLayout()
}
