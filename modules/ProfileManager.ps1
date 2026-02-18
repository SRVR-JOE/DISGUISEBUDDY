# ============================================================================
# ProfileManager.ps1 - DISGUISE BUDDY Profile Management Module
# Purpose: Manage configuration profiles for disguise (d3) media servers.
#          Profiles store hostname, network adapter IPs, SMB sharing settings,
#          and custom settings as JSON files in the profiles/ directory.
# Dependencies: Theme.ps1 (for $script:Theme), UIComponents.ps1 (for New-Styled* functions)
# ============================================================================

# ============================================================================
# BACKEND FUNCTIONS - Profile Data Management
# ============================================================================

function Get-ProfilesDirectory {
    <#
    .SYNOPSIS
        Returns the absolute path to the profiles directory.
    .DESCRIPTION
        Resolves the profiles directory relative to the module location.
        Creates the directory if it does not exist.
    .OUTPUTS
        [string] - Absolute path to profiles/ directory.
    #>
    $profilesDir = Join-Path -Path "$PSScriptRoot\.." -ChildPath 'profiles'

    # Normalize the path to resolve the ".." segment
    $profilesDir = [System.IO.Path]::GetFullPath($profilesDir)

    # Ensure the directory exists
    if (-not (Test-Path -Path $profilesDir)) {
        New-Item -Path $profilesDir -ItemType Directory -Force | Out-Null
        Write-AppLog "Created profiles directory: $profilesDir" -Level 'INFO'
    }

    return $profilesDir
}


function New-DefaultProfile {
    <#
    .SYNOPSIS
        Creates a new profile object populated with default disguise server values.
    .PARAMETER Name
        The name for the new profile.
    .PARAMETER Description
        Optional description for the profile.
    .OUTPUTS
        [PSCustomObject] - A profile object matching the standard JSON schema.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $false)]
        [string]$Description = ""
    )

    $now = (Get-Date).ToString('o')

    $profile = [PSCustomObject]@{
        Name            = $Name
        Description     = $Description
        Created         = $now
        Modified        = $now
        ServerName      = "D3-SERVER-01"
        NetworkAdapters = @(
            [PSCustomObject]@{
                Index       = 0
                Role        = "d3Net"
                DisplayName = "NIC A - d3 Network"
                AdapterName = "NIC A"
                IPAddress   = "192.168.10.10"
                SubnetMask  = "255.255.255.0"
                Gateway     = ""
                DNS1        = ""
                DNS2        = ""
                DHCP        = $false
                VLANID      = $null
                Enabled     = $true
            },
            [PSCustomObject]@{
                Index       = 1
                Role        = "sACN"
                DisplayName = "NIC B - Lighting (sACN/Art-Net)"
                AdapterName = "NIC B"
                IPAddress   = ""
                SubnetMask  = ""
                Gateway     = ""
                DNS1        = ""
                DNS2        = ""
                DHCP        = $true
                VLANID      = $null
                Enabled     = $true
            },
            [PSCustomObject]@{
                Index       = 2
                Role        = "Media"
                DisplayName = "NIC C - Media Network"
                AdapterName = "NIC C"
                IPAddress   = "192.168.20.10"
                SubnetMask  = "255.255.255.0"
                Gateway     = ""
                DNS1        = ""
                DNS2        = ""
                DHCP        = $false
                VLANID      = $null
                Enabled     = $true
            },
            [PSCustomObject]@{
                Index       = 3
                Role        = "NDI"
                DisplayName = "NIC D - NDI Video"
                AdapterName = "NIC D"
                IPAddress   = ""
                SubnetMask  = ""
                Gateway     = ""
                DNS1        = ""
                DNS2        = ""
                DHCP        = $true
                VLANID      = $null
                Enabled     = $true
            },
            [PSCustomObject]@{
                Index       = 4
                Role        = "100G"
                DisplayName = "NIC E - 100G"
                AdapterName = "NIC E"
                IPAddress   = ""
                SubnetMask  = ""
                Gateway     = ""
                DNS1        = ""
                DNS2        = ""
                DHCP        = $true
                VLANID      = $null
                Enabled     = $true
            },
            [PSCustomObject]@{
                Index       = 5
                Role        = "100G"
                DisplayName = "NIC F - 100G"
                AdapterName = "NIC F"
                IPAddress   = ""
                SubnetMask  = ""
                Gateway     = ""
                DNS1        = ""
                DNS2        = ""
                DHCP        = $true
                VLANID      = $null
                Enabled     = $true
            }
        )
        SMBSettings     = [PSCustomObject]@{
            ShareD3Projects  = $true
            ProjectsPath     = "D:\d3 Projects"
            ShareName        = "d3 Projects"
            SharePermissions = "Everyone:Full"
            AdditionalShares = @()
        }
        CustomSettings  = [PSCustomObject]@{}
    }

    Write-AppLog "Created new default profile: '$Name'" -Level 'INFO'
    return $profile
}


function Get-AllProfiles {
    <#
    .SYNOPSIS
        Returns an array of all saved profile objects from the profiles directory.
    .DESCRIPTION
        Reads every .json file in the profiles/ directory and deserializes each
        into a PSCustomObject. Files that fail to parse are logged and skipped.
    .OUTPUTS
        [PSCustomObject[]] - Array of profile objects, sorted by Name.
    #>
    $profilesDir = Get-ProfilesDirectory
    $profiles = @()

    $jsonFiles = Get-ChildItem -Path $profilesDir -Filter '*.json' -File -ErrorAction SilentlyContinue

    foreach ($file in $jsonFiles) {
        try {
            $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
            $profileObj = $content | ConvertFrom-Json
            $profiles += $profileObj
        }
        catch {
            Write-AppLog "Failed to read profile file '$($file.Name)': $_" -Level 'ERROR'
        }
    }

    # Sort profiles alphabetically by name
    $profiles = $profiles | Sort-Object -Property Name
    return $profiles
}


function Get-Profile {
    <#
    .SYNOPSIS
        Reads a specific profile by name from the profiles directory.
    .PARAMETER Name
        The profile name (without .json extension).
    .OUTPUTS
        [PSCustomObject] - The profile object, or $null if not found.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $profilesDir = Get-ProfilesDirectory
    $filePath = Join-Path -Path $profilesDir -ChildPath "$Name.json"

    if (-not (Test-Path -Path $filePath)) {
        Write-AppLog "Profile not found: '$Name'" -Level 'WARN'
        return $null
    }

    try {
        $content = Get-Content -Path $filePath -Raw -Encoding UTF8
        $profileObj = $content | ConvertFrom-Json
        return $profileObj
    }
    catch {
        Write-AppLog "Failed to read profile '$Name': $_" -Level 'ERROR'
        return $null
    }
}


function Save-Profile {
    <#
    .SYNOPSIS
        Saves a profile object to a JSON file in the profiles directory.
    .DESCRIPTION
        Updates the Modified timestamp and writes the profile to
        profiles/{Name}.json with UTF-8 encoding.
    .PARAMETER Profile
        The profile PSCustomObject to save.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [PSCustomObject]$Profile
    )

    # Validate that the profile has a Name
    if ([string]::IsNullOrWhiteSpace($Profile.Name)) {
        Write-AppLog "Cannot save profile: Name is empty." -Level 'ERROR'
        throw "Profile name cannot be empty."
    }

    # Update the Modified timestamp
    $Profile.Modified = (Get-Date).ToString('o')

    $profilesDir = Get-ProfilesDirectory

    # Sanitize filename: remove characters invalid for Windows file paths
    $safeName = $Profile.Name -replace '[\\/:*?"<>|]', '_'
    $filePath = Join-Path -Path $profilesDir -ChildPath "$safeName.json"

    try {
        $json = $Profile | ConvertTo-Json -Depth 10
        Set-Content -Path $filePath -Value $json -Encoding UTF8 -Force
        Write-AppLog "Saved profile '$($Profile.Name)' to '$filePath'" -Level 'INFO'
    }
    catch {
        Write-AppLog "Failed to save profile '$($Profile.Name)': $_" -Level 'ERROR'
        throw "Failed to save profile: $_"
    }
}


function Remove-Profile {
    <#
    .SYNOPSIS
        Deletes a profile JSON file from the profiles directory.
    .PARAMETER Name
        The profile name to delete.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $profilesDir = Get-ProfilesDirectory
    $safeName = $Name -replace '[\\/:*?"<>|]', '_'
    $filePath = Join-Path -Path $profilesDir -ChildPath "$safeName.json"

    if (Test-Path -Path $filePath) {
        try {
            Remove-Item -Path $filePath -Force
            Write-AppLog "Deleted profile '$Name'" -Level 'INFO'
        }
        catch {
            Write-AppLog "Failed to delete profile '$Name': $_" -Level 'ERROR'
            throw "Failed to delete profile: $_"
        }
    }
    else {
        Write-AppLog "Cannot delete profile '$Name': file not found." -Level 'WARN'
    }
}


function Export-ProfileToFile {
    <#
    .SYNOPSIS
        Exports a profile to a user-chosen location using a SaveFileDialog.
    .PARAMETER Profile
        The profile object to export.
    .OUTPUTS
        [bool] - $true if the export succeeded, $false otherwise.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [PSCustomObject]$Profile
    )

    $saveDialog = New-Object System.Windows.Forms.SaveFileDialog
    $saveDialog.Title = "Export Profile - $($Profile.Name)"
    $saveDialog.Filter = "JSON Files (*.json)|*.json|All Files (*.*)|*.*"
    $saveDialog.DefaultExt = "json"
    $saveDialog.FileName = "$($Profile.Name).json"
    $saveDialog.OverwritePrompt = $true

    if ($saveDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        try {
            $json = $Profile | ConvertTo-Json -Depth 10
            Set-Content -Path $saveDialog.FileName -Value $json -Encoding UTF8 -Force
            Write-AppLog "Exported profile '$($Profile.Name)' to '$($saveDialog.FileName)'" -Level 'INFO'
            [System.Windows.Forms.MessageBox]::Show(
                "Profile '$($Profile.Name)' exported successfully.`n`nLocation: $($saveDialog.FileName)",
                "Export Successful",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            ) | Out-Null
            return $true
        }
        catch {
            Write-AppLog "Failed to export profile: $_" -Level 'ERROR'
            [System.Windows.Forms.MessageBox]::Show(
                "Failed to export profile:`n$_",
                "Export Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            ) | Out-Null
            return $false
        }
    }

    return $false
}


function Import-ProfileFromFile {
    <#
    .SYNOPSIS
        Imports a profile from a user-chosen JSON file using an OpenFileDialog.
    .DESCRIPTION
        Presents a file picker, reads the selected JSON file, validates the
        structure, and returns the profile object. If a profile with the same
        name already exists, the user is prompted to rename or overwrite.
    .OUTPUTS
        [PSCustomObject] - The imported profile, or $null if cancelled/failed.
    #>
    $openDialog = New-Object System.Windows.Forms.OpenFileDialog
    $openDialog.Title = "Import Profile"
    $openDialog.Filter = "JSON Files (*.json)|*.json|All Files (*.*)|*.*"
    $openDialog.Multiselect = $false

    if ($openDialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        return $null
    }

    try {
        $content = Get-Content -Path $openDialog.FileName -Raw -Encoding UTF8
        $importedProfile = $content | ConvertFrom-Json
    }
    catch {
        Write-AppLog "Failed to read imported file '$($openDialog.FileName)': $_" -Level 'ERROR'
        [System.Windows.Forms.MessageBox]::Show(
            "Failed to read the selected file. Ensure it is a valid JSON profile.`n`nError: $_",
            "Import Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
        return $null
    }

    # Validate that required fields exist
    if (-not $importedProfile.Name) {
        [System.Windows.Forms.MessageBox]::Show(
            "The selected file does not contain a valid profile (missing 'Name' field).",
            "Invalid Profile",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return $null
    }

    if (-not $importedProfile.NetworkAdapters) {
        [System.Windows.Forms.MessageBox]::Show(
            "The selected file does not contain a valid profile (missing 'NetworkAdapters' field).",
            "Invalid Profile",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return $null
    }

    # Check if a profile with this name already exists
    $existingProfile = Get-Profile -Name $importedProfile.Name
    if ($null -ne $existingProfile) {
        $overwriteResult = [System.Windows.Forms.MessageBox]::Show(
            "A profile named '$($importedProfile.Name)' already exists.`n`nDo you want to overwrite it?",
            "Profile Exists",
            [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )

        if ($overwriteResult -eq [System.Windows.Forms.DialogResult]::Cancel) {
            return $null
        }
        elseif ($overwriteResult -eq [System.Windows.Forms.DialogResult]::No) {
            # Prompt for a new name
            $newName = Show-InputDialog -Title "Rename Imported Profile" `
                -Message "Enter a new name for the imported profile:" `
                -DefaultValue "$($importedProfile.Name) (Imported)"
            if ([string]::IsNullOrWhiteSpace($newName)) {
                return $null
            }
            $importedProfile.Name = $newName
        }
        # If Yes, we fall through and overwrite
    }

    # Update timestamps for the import
    $importedProfile.Modified = (Get-Date).ToString('o')

    # Save the imported profile
    try {
        Save-Profile -Profile $importedProfile
        Write-AppLog "Imported profile '$($importedProfile.Name)' from '$($openDialog.FileName)'" -Level 'INFO'
        [System.Windows.Forms.MessageBox]::Show(
            "Profile '$($importedProfile.Name)' imported successfully.",
            "Import Successful",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
        return $importedProfile
    }
    catch {
        Write-AppLog "Failed to save imported profile: $_" -Level 'ERROR'
        [System.Windows.Forms.MessageBox]::Show(
            "Failed to save imported profile:`n$_",
            "Import Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
        return $null
    }
}


function Apply-FullProfile {
    <#
    .SYNOPSIS
        Applies all settings from a profile to the local machine.
    .DESCRIPTION
        Shows a confirmation dialog listing all changes, then applies:
        1. Hostname change via Set-ServerHostname (if different from current)
        2. Network adapter configuration via Set-AdapterStaticIP / Set-AdapterDHCP
        3. SMB share creation via New-D3ProjectShare (if enabled)
        Each step is wrapped in error handling so one failure does not block
        the remaining steps. A results summary dialog is shown after all
        steps complete. If the hostname was changed, the user is prompted
        to restart.
    .PARAMETER Profile
        The profile object to apply.
    .OUTPUTS
        [bool] - $true if all steps succeeded (or were skipped), $false if any failed.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [PSCustomObject]$Profile
    )

    # Build a summary of all changes that would be applied
    $changesList = [System.Text.StringBuilder]::new()
    [void]$changesList.AppendLine("The following settings will be applied from profile '$($Profile.Name)':")
    [void]$changesList.AppendLine("")

    # Server name
    [void]$changesList.AppendLine("SERVER NAME:")
    [void]$changesList.AppendLine("  Hostname: $($Profile.ServerName)")
    [void]$changesList.AppendLine("")

    # Network adapters
    [void]$changesList.AppendLine("NETWORK ADAPTERS:")
    foreach ($adapter in $Profile.NetworkAdapters) {
        if ($adapter.Enabled) {
            $ipInfo = if ($adapter.DHCP) { "DHCP" } else { "$($adapter.IPAddress) / $($adapter.SubnetMask)" }
            [void]$changesList.AppendLine("  [$($adapter.Index)] $($adapter.DisplayName) ($($adapter.Role)): $ipInfo")
            if ($adapter.Gateway) {
                [void]$changesList.AppendLine("       Gateway: $($adapter.Gateway)")
            }
            if ($adapter.DNS1) {
                $dnsStr = $adapter.DNS1
                if ($adapter.DNS2) { $dnsStr += ", $($adapter.DNS2)" }
                [void]$changesList.AppendLine("       DNS: $dnsStr")
            }
        }
        else {
            [void]$changesList.AppendLine("  [$($adapter.Index)] $($adapter.DisplayName) ($($adapter.Role)): DISABLED")
        }
    }
    [void]$changesList.AppendLine("")

    # SMB settings
    [void]$changesList.AppendLine("SMB SHARING:")
    if ($Profile.SMBSettings.ShareD3Projects) {
        [void]$changesList.AppendLine("  Share Name: $($Profile.SMBSettings.ShareName)")
        [void]$changesList.AppendLine("  Path: $($Profile.SMBSettings.ProjectsPath)")
        [void]$changesList.AppendLine("  Permissions: $($Profile.SMBSettings.SharePermissions)")
    }
    else {
        [void]$changesList.AppendLine("  d3 Projects sharing: Disabled")
    }

    [void]$changesList.AppendLine("")
    [void]$changesList.AppendLine("WARNING: This will modify system network and sharing settings.")
    [void]$changesList.AppendLine("Ensure you have reviewed all values before proceeding.")

    # Show confirmation dialog
    $confirmResult = [System.Windows.Forms.MessageBox]::Show(
        $changesList.ToString(),
        "Confirm Profile Application - $($Profile.Name)",
        [System.Windows.Forms.MessageBoxButtons]::OKCancel,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )

    if ($confirmResult -ne [System.Windows.Forms.DialogResult]::OK) {
        Write-AppLog "User cancelled profile application for '$($Profile.Name)'" -Level 'INFO'
        return $false
    }

    # ---- Execute profile application ----
    Write-AppLog "=== PROFILE APPLICATION START: '$($Profile.Name)' ===" -Level 'INFO'

    $results = [System.Text.StringBuilder]::new()
    $successCount = 0
    $failCount = 0
    $skipCount = 0
    $restartNeeded = $false

    # ================================================================
    # Step 1: Change hostname (if different from current)
    # ================================================================
    try {
        if ($Profile.ServerName -and $Profile.ServerName -ne $env:COMPUTERNAME) {
            Write-AppLog "Applying hostname change: '$env:COMPUTERNAME' -> '$($Profile.ServerName)'" -Level 'INFO'
            $hostnameResult = Set-ServerHostname -NewName $Profile.ServerName

            if ($hostnameResult.Success) {
                $successCount++
                $restartNeeded = $hostnameResult.RestartRequired
                [void]$results.AppendLine("[OK] Hostname: $($hostnameResult.Message)")
                Write-AppLog "Hostname change succeeded: $($hostnameResult.Message)" -Level 'INFO'
            }
            else {
                $failCount++
                [void]$results.AppendLine("[FAIL] Hostname: $($hostnameResult.Message)")
                Write-AppLog "Hostname change failed: $($hostnameResult.Message)" -Level 'ERROR'
            }
        }
        else {
            $skipCount++
            [void]$results.AppendLine("[SKIP] Hostname: Already set to '$($Profile.ServerName)'")
            Write-AppLog "Hostname unchanged (already '$($Profile.ServerName)')" -Level 'INFO'
        }
    }
    catch {
        $failCount++
        [void]$results.AppendLine("[FAIL] Hostname: Unexpected error - $_")
        Write-AppLog "Hostname change error: $_" -Level 'ERROR'
    }

    # ================================================================
    # Step 2: Configure network adapters
    # ================================================================
    foreach ($adapter in $Profile.NetworkAdapters) {
        $adapterLabel = "[$($adapter.Index)] $($adapter.DisplayName) ($($adapter.Role))"

        try {
            if (-not $adapter.Enabled) {
                $skipCount++
                [void]$results.AppendLine("[SKIP] $adapterLabel : Disabled in profile")
                Write-AppLog "Skipping adapter $adapterLabel - disabled in profile" -Level 'INFO'
                continue
            }

            $adapterName = $adapter.AdapterName
            if ([string]::IsNullOrWhiteSpace($adapterName)) {
                $skipCount++
                [void]$results.AppendLine("[SKIP] $adapterLabel : No physical adapter assigned")
                Write-AppLog "Skipping adapter $adapterLabel - no AdapterName set" -Level 'WARN'
                continue
            }

            if ($adapter.DHCP) {
                Write-AppLog "Setting adapter '$adapterName' ($adapterLabel) to DHCP" -Level 'INFO'
                $adapterResult = Set-AdapterDHCP -AdapterName $adapterName
            }
            else {
                Write-AppLog "Setting adapter '$adapterName' ($adapterLabel) to static IP=$($adapter.IPAddress)" -Level 'INFO'
                $adapterResult = Set-AdapterStaticIP -AdapterName $adapterName `
                    -IPAddress $adapter.IPAddress `
                    -SubnetMask $adapter.SubnetMask `
                    -Gateway $adapter.Gateway `
                    -DNS1 $adapter.DNS1 `
                    -DNS2 $adapter.DNS2
            }

            if ($adapterResult.Success) {
                $successCount++
                [void]$results.AppendLine("[OK] $adapterLabel : $($adapterResult.Message)")
                Write-AppLog "Adapter $adapterLabel succeeded: $($adapterResult.Message)" -Level 'INFO'
            }
            else {
                $failCount++
                [void]$results.AppendLine("[FAIL] $adapterLabel : $($adapterResult.Message)")
                Write-AppLog "Adapter $adapterLabel failed: $($adapterResult.Message)" -Level 'ERROR'
            }
        }
        catch {
            $failCount++
            [void]$results.AppendLine("[FAIL] $adapterLabel : Unexpected error - $_")
            Write-AppLog "Adapter $adapterLabel error: $_" -Level 'ERROR'
        }
    }

    # ================================================================
    # Step 3: Configure SMB sharing
    # ================================================================
    try {
        if ($Profile.SMBSettings.ShareD3Projects) {
            Write-AppLog "Creating SMB share '$($Profile.SMBSettings.ShareName)' at '$($Profile.SMBSettings.ProjectsPath)'" -Level 'INFO'
            $smbResult = New-D3ProjectShare `
                -LocalPath $Profile.SMBSettings.ProjectsPath `
                -ShareName $Profile.SMBSettings.ShareName `
                -Permissions $Profile.SMBSettings.SharePermissions

            if ($smbResult.Success) {
                $successCount++
                [void]$results.AppendLine("[OK] SMB Share: $($smbResult.Message)")
                Write-AppLog "SMB share creation succeeded: $($smbResult.Message)" -Level 'INFO'
            }
            else {
                $failCount++
                [void]$results.AppendLine("[FAIL] SMB Share: $($smbResult.Message)")
                Write-AppLog "SMB share creation failed: $($smbResult.Message)" -Level 'ERROR'
            }
        }
        else {
            $skipCount++
            [void]$results.AppendLine("[SKIP] SMB Share: Disabled in profile")
            Write-AppLog "SMB sharing disabled in profile - skipping" -Level 'INFO'
        }
    }
    catch {
        $failCount++
        [void]$results.AppendLine("[FAIL] SMB Share: Unexpected error - $_")
        Write-AppLog "SMB share error: $_" -Level 'ERROR'
    }

    # ================================================================
    # Step 4: Update AppState
    # ================================================================
    $script:AppState.LastAppliedProfile = $Profile.Name
    Write-AppLog "Updated LastAppliedProfile to '$($Profile.Name)'" -Level 'INFO'

    Write-AppLog "=== PROFILE APPLICATION END: '$($Profile.Name)' ===" -Level 'INFO'

    # ================================================================
    # Show results summary dialog
    # ================================================================
    $summaryText = [System.Text.StringBuilder]::new()
    [void]$summaryText.AppendLine("Profile '$($Profile.Name)' application results:")
    [void]$summaryText.AppendLine("")
    [void]$summaryText.AppendLine("  Succeeded: $successCount")
    [void]$summaryText.AppendLine("  Failed:    $failCount")
    [void]$summaryText.AppendLine("  Skipped:   $skipCount")
    [void]$summaryText.AppendLine("")
    [void]$summaryText.AppendLine("Details:")
    [void]$summaryText.AppendLine($results.ToString())

    $summaryIcon = if ($failCount -gt 0) {
        [System.Windows.Forms.MessageBoxIcon]::Warning
    }
    else {
        [System.Windows.Forms.MessageBoxIcon]::Information
    }

    [System.Windows.Forms.MessageBox]::Show(
        $summaryText.ToString(),
        "Profile Application Results - $($Profile.Name)",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        $summaryIcon
    ) | Out-Null

    # ================================================================
    # If hostname was changed, prompt for restart
    # ================================================================
    if ($restartNeeded) {
        $restartChoice = [System.Windows.Forms.MessageBox]::Show(
            "Hostname was changed. A restart is required for the new hostname to take effect.`n`nRestart now?",
            "Restart Required",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )

        if ($restartChoice -eq [System.Windows.Forms.DialogResult]::Yes) {
            Write-AppLog "User chose to restart after hostname change" -Level 'INFO'
            try {
                Restart-Computer -Force
            }
            catch {
                Write-AppLog "Failed to initiate restart: $_" -Level 'ERROR'
                [System.Windows.Forms.MessageBox]::Show(
                    "Failed to initiate restart: $_`n`nPlease restart manually.",
                    "Restart Failed",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error
                ) | Out-Null
            }
        }
        else {
            Write-AppLog "User deferred restart after hostname change" -Level 'INFO'
        }
    }

    return ($failCount -eq 0)
}


function Get-CurrentSystemProfile {
    <#
    .SYNOPSIS
        Captures the current system settings into a profile object.
    .DESCRIPTION
        Reads the current hostname, network adapter configurations, and SMB
        shares from the local machine and assembles them into a profile object
        matching the standard schema.
    .OUTPUTS
        [PSCustomObject] - A profile object populated with current system values.
    #>
    $now = (Get-Date).ToString('o')
    $currentHostname = $env:COMPUTERNAME

    # Build network adapters array from the system
    $adapters = @()

    # Define the expected adapter roles and their indices
    $roleDefinitions = @(
        @{ Index = 0; Role = "d3Net"; DisplayName = "NIC A - d3 Network" },
        @{ Index = 1; Role = "sACN";  DisplayName = "NIC B - Lighting (sACN/Art-Net)" },
        @{ Index = 2; Role = "Media"; DisplayName = "NIC C - Media Network" },
        @{ Index = 3; Role = "NDI";   DisplayName = "NIC D - NDI Video" },
        @{ Index = 4; Role = "100G";  DisplayName = "NIC E - 100G" },
        @{ Index = 5; Role = "100G";  DisplayName = "NIC F - 100G" }
    )

    # Try to read physical network adapters from the system
    $systemAdapters = @()
    try {
        # Get-NetAdapter is available on Windows; gracefully handle if unavailable
        $systemAdapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
            Where-Object { $_.Status -ne 'Not Present' } |
            Sort-Object -Property InterfaceIndex)
    }
    catch {
        Write-AppLog "Unable to enumerate network adapters: $_" -Level 'WARN'
    }

    for ($i = 0; $i -lt 6; $i++) {
        $roleDef = $roleDefinitions[$i]
        $adapterObj = [PSCustomObject]@{
            Index       = $roleDef.Index
            Role        = $roleDef.Role
            DisplayName = $roleDef.DisplayName
            AdapterName = ""
            IPAddress   = ""
            SubnetMask  = ""
            Gateway     = ""
            DNS1        = ""
            DNS2        = ""
            DHCP        = $false
            VLANID      = $null
            Enabled     = $true
        }

        # Map system adapters to profile slots (if enough adapters exist)
        if ($i -lt $systemAdapters.Count) {
            $sysAdapter = $systemAdapters[$i]
            $adapterObj.AdapterName = $sysAdapter.Name
            $adapterObj.Enabled = ($sysAdapter.Status -eq 'Up')

            try {
                $ipConfig = Get-NetIPConfiguration -InterfaceIndex $sysAdapter.InterfaceIndex -ErrorAction SilentlyContinue
                if ($ipConfig) {
                    # Get IPv4 address
                    $ipv4 = $ipConfig.IPv4Address | Select-Object -First 1
                    if ($ipv4) {
                        $adapterObj.IPAddress = $ipv4.IPAddress
                        # Convert prefix length to subnet mask
                        $prefixLength = $ipv4.PrefixLength
                        $adapterObj.SubnetMask = Convert-PrefixToSubnetMask -PrefixLength $prefixLength
                    }

                    # Gateway
                    $gw = $ipConfig.IPv4DefaultGateway | Select-Object -First 1
                    if ($gw) {
                        $adapterObj.Gateway = $gw.NextHop
                    }

                    # DNS servers
                    $dnsServers = $ipConfig.DNSServer | Where-Object { $_.AddressFamily -eq 2 } |
                        Select-Object -ExpandProperty ServerAddresses -ErrorAction SilentlyContinue
                    if ($dnsServers) {
                        if ($dnsServers.Count -ge 1) { $adapterObj.DNS1 = $dnsServers[0] }
                        if ($dnsServers.Count -ge 2) { $adapterObj.DNS2 = $dnsServers[1] }
                    }

                    # DHCP status
                    try {
                        $dhcpStatus = Get-NetIPInterface -InterfaceIndex $sysAdapter.InterfaceIndex `
                            -AddressFamily IPv4 -ErrorAction SilentlyContinue
                        if ($dhcpStatus -and $dhcpStatus.Dhcp -eq 'Enabled') {
                            $adapterObj.DHCP = $true
                        }
                    }
                    catch {
                        # DHCP detection failed; default to false
                    }
                }
            }
            catch {
                Write-AppLog "Failed to read IP config for adapter '$($sysAdapter.Name)': $_" -Level 'WARN'
            }
        }

        $adapters += $adapterObj
    }

    # Capture SMB share settings
    $smbSettings = [PSCustomObject]@{
        ShareD3Projects  = $false
        ProjectsPath     = "D:\d3 Projects"
        ShareName        = "d3 Projects"
        SharePermissions = "Everyone:Full"
        AdditionalShares = @()
    }

    try {
        $d3Share = Get-SmbShare -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*d3*' -or $_.Name -like '*Projects*' } |
            Select-Object -First 1

        if ($d3Share) {
            $smbSettings.ShareD3Projects = $true
            $smbSettings.ShareName = $d3Share.Name
            $smbSettings.ProjectsPath = $d3Share.Path

            # Try to read share permissions
            try {
                $shareAccess = Get-SmbShareAccess -Name $d3Share.Name -ErrorAction SilentlyContinue
                if ($shareAccess) {
                    $permStrings = $shareAccess | ForEach-Object {
                        "$($_.AccountName):$($_.AccessRight)"
                    }
                    $smbSettings.SharePermissions = ($permStrings -join '; ')
                }
            }
            catch {
                # Permissions read failed; keep default
            }
        }
    }
    catch {
        Write-AppLog "Unable to read SMB shares: $_" -Level 'WARN'
    }

    # Assemble the full profile object
    $capturedProfile = [PSCustomObject]@{
        Name            = "Captured - $currentHostname - $(Get-Date -Format 'yyyy-MM-dd')"
        Description     = "System capture from $currentHostname on $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
        Created         = $now
        Modified        = $now
        ServerName      = $currentHostname
        NetworkAdapters = $adapters
        SMBSettings     = $smbSettings
        CustomSettings  = [PSCustomObject]@{}
    }

    Write-AppLog "Captured current system profile from '$currentHostname'" -Level 'INFO'
    return $capturedProfile
}


function Convert-PrefixToSubnetMask {
    <#
    .SYNOPSIS
        Converts a CIDR prefix length to a dotted-decimal subnet mask string.
    .PARAMETER PrefixLength
        The prefix length (0-32).
    .OUTPUTS
        [string] - Dotted-decimal subnet mask (e.g. "255.255.255.0").
    #>
    param(
        [Parameter(Mandatory = $true)]
        [int]$PrefixLength
    )

    if ($PrefixLength -lt 0 -or $PrefixLength -gt 32) {
        return "255.255.255.0"
    }

    $mask = ([Math]::Pow(2, 32) - [Math]::Pow(2, 32 - $PrefixLength))
    $maskUInt = [UInt32]$mask

    $b1 = ($maskUInt -shr 24) -band 0xFF
    $b2 = ($maskUInt -shr 16) -band 0xFF
    $b3 = ($maskUInt -shr 8) -band 0xFF
    $b4 = $maskUInt -band 0xFF

    return "$b1.$b2.$b3.$b4"
}


# ============================================================================
# UI HELPER FUNCTIONS - Dialogs and small components
# ============================================================================

function Show-InputDialog {
    <#
    .SYNOPSIS
        Displays a simple input dialog with a text field.
    .PARAMETER Title
        The dialog window title.
    .PARAMETER Message
        The prompt message.
    .PARAMETER DefaultValue
        The initial value in the text field.
    .OUTPUTS
        [string] - The entered value, or empty string if cancelled.
    #>
    param(
        [string]$Title = "Input",
        [string]$Message = "Enter a value:",
        [string]$DefaultValue = ""
    )

    $form = New-Object System.Windows.Forms.Form
    $form.Text = $Title
    $form.Size = New-Object System.Drawing.Size(420, 200)
    $form.StartPosition = 'CenterParent'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.BackColor = $script:Theme.Background
    $form.ForeColor = $script:Theme.Text

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Message
    $label.Location = New-Object System.Drawing.Point(15, 20)
    $label.Size = New-Object System.Drawing.Size(370, 25)
    $label.Font = New-Object System.Drawing.Font("Segoe UI", 10)
    $label.ForeColor = $script:Theme.Text
    $form.Controls.Add($label)

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Location = New-Object System.Drawing.Point(15, 55)
    $textBox.Size = New-Object System.Drawing.Size(370, 28)
    $textBox.Font = New-Object System.Drawing.Font("Segoe UI", 10)
    $textBox.Text = $DefaultValue
    $textBox.BackColor = $script:Theme.InputBackground
    $textBox.ForeColor = $script:Theme.Text
    $form.Controls.Add($textBox)

    $okButton = New-Object System.Windows.Forms.Button
    $okButton.Text = "OK"
    $okButton.Location = New-Object System.Drawing.Point(200, 105)
    $okButton.Size = New-Object System.Drawing.Size(85, 35)
    $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $okButton.FlatStyle = 'Flat'
    $okButton.BackColor = $script:Theme.Primary
    $okButton.ForeColor = [System.Drawing.Color]::White
    $okButton.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $form.Controls.Add($okButton)

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = "Cancel"
    $cancelButton.Location = New-Object System.Drawing.Point(300, 105)
    $cancelButton.Size = New-Object System.Drawing.Size(85, 35)
    $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $cancelButton.FlatStyle = 'Flat'
    $cancelButton.BackColor = $script:Theme.Surface
    $cancelButton.ForeColor = $script:Theme.Text
    $cancelButton.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $form.Controls.Add($cancelButton)

    $form.AcceptButton = $okButton
    $form.CancelButton = $cancelButton

    $result = $form.ShowDialog()
    $value = $textBox.Text

    $form.Dispose()

    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        return $value
    }
    return ""
}


function Show-NewProfileDialog {
    <#
    .SYNOPSIS
        Displays a dialog for creating a new profile with name and description fields.
    .OUTPUTS
        [PSCustomObject] - Object with Name and Description, or $null if cancelled.
    #>
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "New Profile"
    $form.Size = New-Object System.Drawing.Size(460, 280)
    $form.StartPosition = 'CenterParent'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.BackColor = $script:Theme.Background
    $form.ForeColor = $script:Theme.Text

    # Profile Name
    $nameLabel = New-Object System.Windows.Forms.Label
    $nameLabel.Text = "Profile Name:"
    $nameLabel.Location = New-Object System.Drawing.Point(15, 20)
    $nameLabel.Size = New-Object System.Drawing.Size(410, 22)
    $nameLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
    $nameLabel.ForeColor = $script:Theme.Text
    $form.Controls.Add($nameLabel)

    $nameBox = New-Object System.Windows.Forms.TextBox
    $nameBox.Location = New-Object System.Drawing.Point(15, 45)
    $nameBox.Size = New-Object System.Drawing.Size(410, 28)
    $nameBox.Font = New-Object System.Drawing.Font("Segoe UI", 10)
    $nameBox.BackColor = $script:Theme.InputBackground
    $nameBox.ForeColor = $script:Theme.Text
    $form.Controls.Add($nameBox)

    # Description
    $descLabel = New-Object System.Windows.Forms.Label
    $descLabel.Text = "Description (optional):"
    $descLabel.Location = New-Object System.Drawing.Point(15, 85)
    $descLabel.Size = New-Object System.Drawing.Size(410, 22)
    $descLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
    $descLabel.ForeColor = $script:Theme.Text
    $form.Controls.Add($descLabel)

    $descBox = New-Object System.Windows.Forms.TextBox
    $descBox.Location = New-Object System.Drawing.Point(15, 110)
    $descBox.Size = New-Object System.Drawing.Size(410, 60)
    $descBox.Font = New-Object System.Drawing.Font("Segoe UI", 10)
    $descBox.Multiline = $true
    $descBox.BackColor = $script:Theme.InputBackground
    $descBox.ForeColor = $script:Theme.Text
    $form.Controls.Add($descBox)

    # Buttons
    $okButton = New-Object System.Windows.Forms.Button
    $okButton.Text = "Create"
    $okButton.Location = New-Object System.Drawing.Point(240, 190)
    $okButton.Size = New-Object System.Drawing.Size(85, 35)
    $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $okButton.FlatStyle = 'Flat'
    $okButton.BackColor = $script:Theme.Primary
    $okButton.ForeColor = [System.Drawing.Color]::White
    $okButton.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $form.Controls.Add($okButton)

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = "Cancel"
    $cancelButton.Location = New-Object System.Drawing.Point(340, 190)
    $cancelButton.Size = New-Object System.Drawing.Size(85, 35)
    $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $cancelButton.FlatStyle = 'Flat'
    $cancelButton.BackColor = $script:Theme.Surface
    $cancelButton.ForeColor = $script:Theme.Text
    $cancelButton.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $form.Controls.Add($cancelButton)

    $form.AcceptButton = $okButton
    $form.CancelButton = $cancelButton

    $result = $form.ShowDialog()
    $name = $nameBox.Text.Trim()
    $desc = $descBox.Text.Trim()

    $form.Dispose()

    if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($name)) {
        return [PSCustomObject]@{
            Name        = $name
            Description = $desc
        }
    }
    return $null
}


# ============================================================================
# UI VIEW FUNCTION - Main Profiles Management View
# ============================================================================

function New-ProfilesView {
    <#
    .SYNOPSIS
        Creates the Profiles management view inside the given content panel.
    .DESCRIPTION
        Builds a two-column layout:
          - Left column: profile list with action buttons
          - Right column: profile detail view with summary cards and actions
    .PARAMETER ContentPanel
        The parent panel to populate with the profiles view controls.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.Panel]$ContentPanel
    )

    $ContentPanel.Controls.Clear()
    $ContentPanel.SuspendLayout()

    # ---- Module-scoped variables for cross-control communication ----
    $script:SelectedProfile = $null
    $script:ProfileListBox = $null
    $script:DetailPanel = $null

    # ---- Create a scroll panel to hold everything ----
    $scrollPanel = New-ScrollPanel -X 0 -Y 0 -Width $ContentPanel.Width -Height $ContentPanel.Height
    $scrollPanel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
        [System.Windows.Forms.AnchorStyles]::Left -bor
        [System.Windows.Forms.AnchorStyles]::Right -bor
        [System.Windows.Forms.AnchorStyles]::Bottom

    # ---- Section Header ----
    $header = New-SectionHeader -Text "Configuration Profiles" -X 20 -Y 15 -Width ($ContentPanel.Width - 40)

    $scrollPanel.Controls.Add($header)

    # Subtitle label
    $subtitleLabel = New-StyledLabel -Text "Manage, apply, and share d3 server configuration profiles." `
        -X 20 -Y 55 -IsSecondary
    $scrollPanel.Controls.Add($subtitleLabel)

    # ========================================================================
    # LEFT COLUMN - Profile List (~350px)
    # ========================================================================
    $leftColumnX = 20
    $leftColumnY = 90
    $leftColumnWidth = 350

    $leftPanel = New-StyledPanel -X $leftColumnX -Y $leftColumnY `
        -Width $leftColumnWidth -Height 500 -IsCard
    $leftPanel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
        [System.Windows.Forms.AnchorStyles]::Left -bor
        [System.Windows.Forms.AnchorStyles]::Bottom

    # Profile list header
    $listHeader = New-StyledLabel -Text "Saved Profiles" -X 12 -Y 10 -FontSize 12 -IsBold
    $leftPanel.Controls.Add($listHeader)

    # Profile count badge (updated dynamically)
    $script:ProfileCountLabel = New-StyledLabel -Text "" -X 12 -Y 35 -IsSecondary
    $leftPanel.Controls.Add($script:ProfileCountLabel)

    # Profile ListBox
    $profileListBox = New-Object System.Windows.Forms.ListBox
    $profileListBox.Location = New-Object System.Drawing.Point(12, 58)
    $profileListBox.Size = New-Object System.Drawing.Size(($leftColumnWidth - 24), 330)
    $profileListBox.Font = New-Object System.Drawing.Font("Segoe UI", 10)
    $profileListBox.BackColor = $script:Theme.InputBackground
    $profileListBox.ForeColor = $script:Theme.Text
    $profileListBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $profileListBox.DrawMode = [System.Windows.Forms.DrawMode]::OwnerDrawVariable
    $profileListBox.ItemHeight = 52
    $profileListBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
        [System.Windows.Forms.AnchorStyles]::Left -bor
        [System.Windows.Forms.AnchorStyles]::Bottom

    $script:ProfileListBox = $profileListBox

    # Custom drawing for richer list items
    $profileListBox.Add_MeasureItem({
        param($sender, $e)
        $e.ItemHeight = 52
    })

    $profileListBox.Add_DrawItem({
        param($sender, $e)
        if ($e.Index -lt 0) { return }

        # Determine selection state
        $isSelected = ($e.State -band [System.Windows.Forms.DrawItemState]::Selected) -eq [System.Windows.Forms.DrawItemState]::Selected

        # Background
        if ($isSelected) {
            $bgBrush = New-Object System.Drawing.SolidBrush($script:Theme.Primary)
        }
        else {
            $bgBrush = New-Object System.Drawing.SolidBrush($script:Theme.InputBackground)
        }
        $e.Graphics.FillRectangle($bgBrush, $e.Bounds)
        $bgBrush.Dispose()

        # Get the profile data stored in the Tag
        $itemText = $sender.Items[$e.Index].ToString()
        $parts = $itemText -split '\|', 3

        $profileName = if ($parts.Count -ge 1) { $parts[0] } else { $itemText }
        $profileDesc = if ($parts.Count -ge 2) { $parts[1] } else { "" }
        $profileDate = if ($parts.Count -ge 3) { $parts[2] } else { "" }

        # Draw profile name (bold)
        $nameFont = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
        $nameBrush = New-Object System.Drawing.SolidBrush(
            $(if ($isSelected) { [System.Drawing.Color]::White } else { $script:Theme.Text })
        )
        $nameRect = New-Object System.Drawing.RectangleF($e.Bounds.X + 10, $e.Bounds.Y + 5, $e.Bounds.Width - 20, 22)
        $e.Graphics.DrawString($profileName, $nameFont, $nameBrush, $nameRect)
        $nameFont.Dispose()
        $nameBrush.Dispose()

        # Draw description / date (secondary, smaller)
        $subText = if ($profileDesc) { $profileDesc } else { $profileDate }
        if ($subText) {
            $subFont = New-Object System.Drawing.Font("Segoe UI", 8)
            $subBrush = New-Object System.Drawing.SolidBrush(
                $(if ($isSelected) { [System.Drawing.Color]::FromArgb(200, 200, 200) } else { $script:Theme.TextSecondary })
            )
            $subRect = New-Object System.Drawing.RectangleF($e.Bounds.X + 10, $e.Bounds.Y + 28, $e.Bounds.Width - 20, 18)
            $e.Graphics.DrawString($subText, $subFont, $subBrush, $subRect)
            $subFont.Dispose()
            $subBrush.Dispose()
        }

        # Draw bottom separator
        $sepPen = New-Object System.Drawing.Pen($script:Theme.Border, 1)
        $e.Graphics.DrawLine($sepPen, $e.Bounds.X + 10, $e.Bounds.Bottom - 1,
            $e.Bounds.Right - 10, $e.Bounds.Bottom - 1)
        $sepPen.Dispose()
    })

    # Selection changed handler
    $profileListBox.Add_SelectedIndexChanged({
        if ($script:ProfileListBox.SelectedIndex -ge 0) {
            $selectedText = $script:ProfileListBox.SelectedItem.ToString()
            $profileName = ($selectedText -split '\|', 3)[0]
            $script:SelectedProfile = Get-Profile -Name $profileName
            Update-ProfileDetailPanel
        }
        else {
            $script:SelectedProfile = $null
            Update-ProfileDetailPanel
        }
    })

    $leftPanel.Controls.Add($profileListBox)

    # ---- Buttons below the list ----
    $buttonY = 395
    $buttonWidth = 100
    $buttonSpacing = 8

    $newProfileBtn = New-StyledButton -Text "New Profile" -X 12 -Y $buttonY `
        -Width $buttonWidth -Height 34 -IsPrimary -OnClick {
        $dialogResult = Show-NewProfileDialog
        if ($null -ne $dialogResult) {
            # Check if profile name already exists
            $existingProfile = Get-Profile -Name $dialogResult.Name
            if ($null -ne $existingProfile) {
                [System.Windows.Forms.MessageBox]::Show(
                    "A profile named '$($dialogResult.Name)' already exists. Please choose a different name.",
                    "Name Conflict",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Warning
                ) | Out-Null
                return
            }

            $newProfile = New-DefaultProfile -Name $dialogResult.Name -Description $dialogResult.Description
            Save-Profile -Profile $newProfile
            Refresh-ProfileList
            Select-ProfileInList -Name $dialogResult.Name
        }
    }
    $newProfileBtn.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor
        [System.Windows.Forms.AnchorStyles]::Left
    $leftPanel.Controls.Add($newProfileBtn)

    $importBtn = New-StyledButton -Text "Import" -X (12 + $buttonWidth + $buttonSpacing) `
        -Y $buttonY -Width 80 -Height 34 -OnClick {
        $importedProfile = Import-ProfileFromFile
        if ($null -ne $importedProfile) {
            Refresh-ProfileList
            Select-ProfileInList -Name $importedProfile.Name
        }
    }
    $importBtn.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor
        [System.Windows.Forms.AnchorStyles]::Left
    $leftPanel.Controls.Add($importBtn)

    $captureBtn = New-StyledButton -Text "Capture Current" `
        -X (12 + $buttonWidth + $buttonSpacing + 80 + $buttonSpacing) `
        -Y $buttonY -Width 120 -Height 34 -OnClick {
        try {
            $capturedProfile = Get-CurrentSystemProfile
            Save-Profile -Profile $capturedProfile
            Refresh-ProfileList
            Select-ProfileInList -Name $capturedProfile.Name

            [System.Windows.Forms.MessageBox]::Show(
                "Current system configuration captured as profile:`n'$($capturedProfile.Name)'",
                "Capture Complete",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            ) | Out-Null
        }
        catch {
            Write-AppLog "Failed to capture system profile: $_" -Level 'ERROR'
            [System.Windows.Forms.MessageBox]::Show(
                "Failed to capture current system configuration:`n$_",
                "Capture Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            ) | Out-Null
        }
    }
    $captureBtn.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor
        [System.Windows.Forms.AnchorStyles]::Left
    $leftPanel.Controls.Add($captureBtn)

    $scrollPanel.Controls.Add($leftPanel)

    # ========================================================================
    # RIGHT COLUMN - Profile Detail View (~550px)
    # ========================================================================
    $rightColumnX = $leftColumnX + $leftColumnWidth + 20
    $rightColumnY = $leftColumnY
    $rightColumnWidth = 550

    $detailPanel = New-StyledPanel -X $rightColumnX -Y $rightColumnY `
        -Width $rightColumnWidth -Height 500 -IsCard
    $detailPanel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
        [System.Windows.Forms.AnchorStyles]::Left -bor
        [System.Windows.Forms.AnchorStyles]::Right -bor
        [System.Windows.Forms.AnchorStyles]::Bottom
    $detailPanel.AutoScroll = $true

    $script:DetailPanel = $detailPanel
    $scrollPanel.Controls.Add($detailPanel)

    # ---- Add the scroll panel to the content panel ----
    $ContentPanel.Controls.Add($scrollPanel)

    # ---- Initial load ----
    Refresh-ProfileList
    Show-EmptyDetailState

    $ContentPanel.ResumeLayout()
}


# ============================================================================
# UI HELPER FUNCTIONS - Profile List & Detail Panel Management
# ============================================================================

function Refresh-ProfileList {
    <#
    .SYNOPSIS
        Reloads the profile list from disk and updates the ListBox.
    #>
    if ($null -eq $script:ProfileListBox) { return }

    $script:ProfileListBox.Items.Clear()
    $profiles = Get-AllProfiles

    foreach ($p in $profiles) {
        # Format: Name|Description|ModifiedDate (pipe-delimited for custom drawing)
        $modifiedStr = ""
        if ($p.Modified) {
            try {
                $modifiedDate = [DateTime]::Parse($p.Modified)
                $modifiedStr = "Modified: $($modifiedDate.ToString('yyyy-MM-dd HH:mm'))"
            }
            catch {
                $modifiedStr = "Modified: $($p.Modified)"
            }
        }

        $displayText = "$($p.Name)|$($p.Description)|$modifiedStr"
        $script:ProfileListBox.Items.Add($displayText) | Out-Null
    }

    # Update the count label
    $count = $profiles.Count
    $script:ProfileCountLabel.Text = "$count profile$(if ($count -ne 1) { 's' }) saved"
}


function Select-ProfileInList {
    <#
    .SYNOPSIS
        Selects a profile in the ListBox by name.
    .PARAMETER Name
        The profile name to select.
    #>
    param([string]$Name)

    if ($null -eq $script:ProfileListBox) { return }

    for ($i = 0; $i -lt $script:ProfileListBox.Items.Count; $i++) {
        $itemText = $script:ProfileListBox.Items[$i].ToString()
        $itemName = ($itemText -split '\|', 3)[0]
        if ($itemName -eq $Name) {
            $script:ProfileListBox.SelectedIndex = $i
            return
        }
    }
}


function Show-EmptyDetailState {
    <#
    .SYNOPSIS
        Shows a placeholder message when no profile is selected.
    #>
    if ($null -eq $script:DetailPanel) { return }

    $script:DetailPanel.Controls.Clear()
    $script:DetailPanel.SuspendLayout()

    $emptyLabel = New-StyledLabel -Text "Select a profile from the list to view details," `
        -X 30 -Y 180 -IsMuted -FontSize 11
    $script:DetailPanel.Controls.Add($emptyLabel)

    $emptyLabel2 = New-StyledLabel -Text "or create a new profile to get started." `
        -X 30 -Y 210 -IsMuted -FontSize 11
    $script:DetailPanel.Controls.Add($emptyLabel2)

    $script:DetailPanel.ResumeLayout()
}


function Update-ProfileDetailPanel {
    <#
    .SYNOPSIS
        Updates the right-column detail panel with the currently selected profile's data.
    .DESCRIPTION
        Populates editable fields (name, description), summary cards (server name,
        network adapters, SMB settings), and action buttons.
    #>
    if ($null -eq $script:DetailPanel) { return }

    $script:DetailPanel.Controls.Clear()
    $script:DetailPanel.SuspendLayout()

    if ($null -eq $script:SelectedProfile) {
        Show-EmptyDetailState
        return
    }

    $p = $script:SelectedProfile
    $panelWidth = $script:DetailPanel.Width
    $currentY = 12
    $innerWidth = $panelWidth - 40

    # ---- Profile Name (editable) ----
    $nameLabel = New-StyledLabel -Text "Profile Name" -X 15 -Y $currentY -FontSize 9 -IsSecondary
    $script:DetailPanel.Controls.Add($nameLabel)
    $currentY += 22

    $script:ProfileNameBox = New-StyledTextBox -X 15 -Y $currentY -Width $innerWidth -Height 30
    $script:ProfileNameBox.Text = $p.Name
    $script:ProfileNameBox.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
    $script:DetailPanel.Controls.Add($script:ProfileNameBox)
    $currentY += 40

    # ---- Description (editable) ----
    $descLabel = New-StyledLabel -Text "Description" -X 15 -Y $currentY -FontSize 9 -IsSecondary
    $script:DetailPanel.Controls.Add($descLabel)
    $currentY += 22

    $script:ProfileDescBox = New-StyledTextBox -X 15 -Y $currentY -Width $innerWidth -Height 28
    $script:ProfileDescBox.Text = $p.Description
    $script:DetailPanel.Controls.Add($script:ProfileDescBox)
    $currentY += 38

    # ---- Timestamps (read-only) ----
    $createdStr = ""
    $modifiedStr = ""
    try {
        $createdStr = ([DateTime]::Parse($p.Created)).ToString('yyyy-MM-dd HH:mm')
    }
    catch { $createdStr = "$($p.Created)" }
    try {
        $modifiedStr = ([DateTime]::Parse($p.Modified)).ToString('yyyy-MM-dd HH:mm')
    }
    catch { $modifiedStr = "$($p.Modified)" }

    $timestampLabel = New-StyledLabel -Text "Created: $createdStr  |  Modified: $modifiedStr" `
        -X 15 -Y $currentY -IsMuted -FontSize 8
    $script:DetailPanel.Controls.Add($timestampLabel)
    $currentY += 25

    # ---- Server Name Card ----
    $serverCard = New-StyledCard -Title "Server Name" -X 15 -Y $currentY `
        -Width $innerWidth -Height 55
    $serverValueLabel = New-StyledLabel -Text $p.ServerName -X 12 -Y 25 -FontSize 11 -IsBold
    $serverCard.Controls.Add($serverValueLabel)
    $script:DetailPanel.Controls.Add($serverCard)
    $currentY += 65

    # ---- Network Adapters Summary Card ----
    $adapterCount = 0
    if ($p.NetworkAdapters) { $adapterCount = $p.NetworkAdapters.Count }
    $adapterCardHeight = 30 + ($adapterCount * 24)

    $adapterCard = New-StyledCard -Title "Network Adapters ($adapterCount)" -X 15 -Y $currentY `
        -Width $innerWidth -Height $adapterCardHeight

    $adapterY = 26
    foreach ($adapter in $p.NetworkAdapters) {
        $roleText = "[$($adapter.Index)] $($adapter.Role)"
        $ipText = if ($adapter.DHCP) { "DHCP" }
                  elseif ($adapter.IPAddress) { $adapter.IPAddress }
                  else { "Not configured" }

        $statusColor = if (-not $adapter.Enabled) { $script:Theme.TextMuted }
                       elseif ($adapter.DHCP) { $script:Theme.Accent }
                       elseif ($adapter.IPAddress) { $script:Theme.Success }
                       else { $script:Theme.Warning }

        # Role label (left-aligned)
        $roleLabel = New-Object System.Windows.Forms.Label
        $roleLabel.Text = $roleText
        $roleLabel.Location = New-Object System.Drawing.Point(12, $adapterY)
        $roleLabel.Size = New-Object System.Drawing.Size(160, 20)
        $roleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9)
        $roleLabel.ForeColor = $script:Theme.Text
        $roleLabel.BackColor = [System.Drawing.Color]::Transparent
        $adapterCard.Controls.Add($roleLabel)

        # Display name label (center)
        $displayLabel = New-Object System.Windows.Forms.Label
        $displayLabel.Text = $adapter.DisplayName
        $displayLabel.Location = New-Object System.Drawing.Point(175, $adapterY)
        $displayLabel.Size = New-Object System.Drawing.Size(180, 20)
        $displayLabel.Font = New-Object System.Drawing.Font("Segoe UI", 8)
        $displayLabel.ForeColor = $script:Theme.TextSecondary
        $displayLabel.BackColor = [System.Drawing.Color]::Transparent
        $adapterCard.Controls.Add($displayLabel)

        # IP / status label (right-aligned)
        $ipLabel = New-Object System.Windows.Forms.Label
        $ipLabel.Text = if (-not $adapter.Enabled) { "Disabled" } else { $ipText }
        $ipLabel.Location = New-Object System.Drawing.Point(360, $adapterY)
        $ipLabel.Size = New-Object System.Drawing.Size(150, 20)
        $ipLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
        $ipLabel.ForeColor = $statusColor
        $ipLabel.BackColor = [System.Drawing.Color]::Transparent
        $ipLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
        $adapterCard.Controls.Add($ipLabel)

        $adapterY += 24
    }

    $script:DetailPanel.Controls.Add($adapterCard)
    $currentY += ($adapterCardHeight + 10)

    # ---- SMB Settings Summary Card ----
    $smbCard = New-StyledCard -Title "SMB Sharing" -X 15 -Y $currentY `
        -Width $innerWidth -Height 80

    $smbStatus = if ($p.SMBSettings.ShareD3Projects) {
        "Enabled"
    }
    else {
        "Disabled"
    }
    $smbStatusType = if ($p.SMBSettings.ShareD3Projects) { "Success" } else { "Warning" }
    $smbBadge = New-StatusBadge -Text $smbStatus -X 12 -Y 26 -Type $smbStatusType
    $smbCard.Controls.Add($smbBadge)

    if ($p.SMBSettings.ShareD3Projects) {
        $shareInfoLabel = New-StyledLabel -Text "Share: $($p.SMBSettings.ShareName)  |  Path: $($p.SMBSettings.ProjectsPath)" `
            -X 100 -Y 28 -IsSecondary -FontSize 9
        $smbCard.Controls.Add($shareInfoLabel)

        $permLabel = New-StyledLabel -Text "Permissions: $($p.SMBSettings.SharePermissions)" `
            -X 12 -Y 52 -IsMuted -FontSize 8
        $smbCard.Controls.Add($permLabel)
    }

    $script:DetailPanel.Controls.Add($smbCard)
    $currentY += 95

    # ---- Save Changes Button ----
    $saveBtn = New-StyledButton -Text "Save Changes" -X 15 -Y $currentY `
        -Width 120 -Height 36 -IsPrimary -OnClick {
        if ($null -eq $script:SelectedProfile) { return }

        $oldName = $script:SelectedProfile.Name
        $newName = $script:ProfileNameBox.Text.Trim()
        $newDesc = $script:ProfileDescBox.Text.Trim()

        if ([string]::IsNullOrWhiteSpace($newName)) {
            [System.Windows.Forms.MessageBox]::Show(
                "Profile name cannot be empty.",
                "Validation Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            ) | Out-Null
            return
        }

        # If the name changed, check for conflicts and remove the old file
        if ($newName -ne $oldName) {
            $existingProfile = Get-Profile -Name $newName
            if ($null -ne $existingProfile) {
                [System.Windows.Forms.MessageBox]::Show(
                    "A profile named '$newName' already exists.",
                    "Name Conflict",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Warning
                ) | Out-Null
                return
            }
            # Remove the old profile file
            Remove-Profile -Name $oldName
        }

        $script:SelectedProfile.Name = $newName
        $script:SelectedProfile.Description = $newDesc

        try {
            Save-Profile -Profile $script:SelectedProfile
            Refresh-ProfileList
            Select-ProfileInList -Name $newName
        }
        catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Failed to save profile:`n$_",
                "Save Error",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            ) | Out-Null
        }
    }
    $script:DetailPanel.Controls.Add($saveBtn)

    # ---- Action Buttons Row ----
    $actionY = $currentY + 46
    $actionX = 15

    $applyBtn = New-StyledButton -Text "Apply Profile" -X $actionX -Y $actionY `
        -Width 120 -Height 36 -IsPrimary -OnClick {
        if ($null -eq $script:SelectedProfile) { return }
        Apply-FullProfile -Profile $script:SelectedProfile
    }
    $script:DetailPanel.Controls.Add($applyBtn)
    $actionX += 130

    $editBtn = New-StyledButton -Text "Edit Full Profile" -X $actionX -Y $actionY `
        -Width 130 -Height 36 -OnClick {
        if ($null -eq $script:SelectedProfile) { return }
        # Placeholder: Full profile editor will be in a separate module/view
        [System.Windows.Forms.MessageBox]::Show(
            "The full profile editor will open here.`nThis feature is coming in a future update.",
            "Edit Profile",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
    $script:DetailPanel.Controls.Add($editBtn)
    $actionX += 140

    $exportBtn = New-StyledButton -Text "Export" -X $actionX -Y $actionY `
        -Width 80 -Height 36 -OnClick {
        if ($null -eq $script:SelectedProfile) { return }
        Export-ProfileToFile -Profile $script:SelectedProfile
    }
    $script:DetailPanel.Controls.Add($exportBtn)
    $actionX += 90

    $deleteBtn = New-StyledButton -Text "Delete" -X $actionX -Y $actionY `
        -Width 80 -Height 36 -IsDestructive -OnClick {
        if ($null -eq $script:SelectedProfile) { return }

        $confirmResult = [System.Windows.Forms.MessageBox]::Show(
            "Are you sure you want to permanently delete the profile '$($script:SelectedProfile.Name)'?`n`nThis action cannot be undone.",
            "Confirm Delete",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($confirmResult -eq [System.Windows.Forms.DialogResult]::Yes) {
            try {
                Remove-Profile -Name $script:SelectedProfile.Name
                $script:SelectedProfile = $null
                Refresh-ProfileList
                Show-EmptyDetailState
            }
            catch {
                [System.Windows.Forms.MessageBox]::Show(
                    "Failed to delete profile:`n$_",
                    "Delete Error",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error
                ) | Out-Null
            }
        }
    }
    $script:DetailPanel.Controls.Add($deleteBtn)

    $script:DetailPanel.ResumeLayout()
}
