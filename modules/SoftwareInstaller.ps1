# SoftwareInstaller.ps1 - DISGUISE BUDDY Software Installer Module
# Provides functions for scanning a local folder for installer files (.exe, .msi, .msix)
# and running silent/unattended installs from the UI.

# ============================================================================
# Configuration
# ============================================================================

# Default software folder path (can be overridden in the UI)
$script:DefaultSoftwarePath = "D:\Software"

# Supported installer file extensions
$script:InstallerExtensions = @('.exe', '.msi', '.msix', '.msp')

# ============================================================================
# Backend Functions
# ============================================================================

function Get-SoftwareFolder {
    <#
    .SYNOPSIS
        Returns the configured software folder path.
    #>
    return $script:DefaultSoftwarePath
}

function Find-Installers {
    <#
    .SYNOPSIS
        Scans a folder for installer files and returns metadata about each.
    .PARAMETER FolderPath
        The folder to scan for installer files.
    .PARAMETER Recurse
        If set, scans subfolders recursively.
    .OUTPUTS
        Array of PSCustomObjects with: Name, FullPath, Extension, SizeMB, Modified, SubFolder
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$FolderPath,

        [switch]$Recurse
    )

    $installers = [System.Collections.ArrayList]::new()

    if (-not (Test-Path -Path $FolderPath -ErrorAction SilentlyContinue)) {
        Write-AppLog -Message "Find-Installers: Folder not found: $FolderPath" -Level 'WARN'
        return @()
    }

    $searchParams = @{
        Path    = $FolderPath
        File    = $true
        ErrorAction = 'SilentlyContinue'
    }
    if ($Recurse) {
        $searchParams.Recurse = $true
    }

    $files = Get-ChildItem @searchParams | Where-Object {
        $script:InstallerExtensions -contains $_.Extension.ToLower()
    }

    foreach ($file in $files) {
        $subFolder = ''
        $relativePath = $file.DirectoryName
        if ($relativePath -ne $FolderPath) {
            $subFolder = $relativePath.Substring($FolderPath.Length).TrimStart('\', '/')
        }

        [void]$installers.Add([PSCustomObject]@{
            Name      = $file.Name
            FullPath  = $file.FullName
            Extension = $file.Extension.ToLower()
            SizeMB    = [math]::Round($file.Length / 1MB, 1)
            Modified  = $file.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
            SubFolder = $subFolder
        })
    }

    Write-AppLog -Message "Find-Installers: Found $($installers.Count) installer(s) in $FolderPath" -Level 'INFO'
    return $installers.ToArray()
}

function Get-InstallerSilentArgs {
    <#
    .SYNOPSIS
        Returns common silent install arguments based on file type and known installer patterns.
    .PARAMETER InstallerPath
        Full path to the installer file.
    .OUTPUTS
        String containing suggested silent install arguments.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallerPath
    )

    $extension = [System.IO.Path]::GetExtension($InstallerPath).ToLower()
    $fileName = [System.IO.Path]::GetFileName($InstallerPath).ToLower()

    switch ($extension) {
        '.msi' {
            return '/quiet /norestart'
        }
        '.msix' {
            return ''   # MSIX installs via Add-AppxPackage
        }
        '.msp' {
            return '/quiet /norestart'
        }
        '.exe' {
            # Try to match known installer frameworks
            if ($fileName -match 'ndi') {
                return '/VERYSILENT /NORESTART'
            }
            if ($fileName -match 'notch') {
                return '/S'
            }
            if ($fileName -match 'setup|install') {
                return '/S /NORESTART'
            }
            # Generic: most NSIS/Inno Setup use /S or /VERYSILENT
            return '/S'
        }
        default {
            return ''
        }
    }
}

function Install-Software {
    <#
    .SYNOPSIS
        Runs an installer with optional silent arguments.
    .PARAMETER InstallerPath
        Full path to the installer file.
    .PARAMETER Arguments
        Command-line arguments for the installer.
    .PARAMETER WaitForExit
        If set, waits for the installer to finish before returning.
    .OUTPUTS
        PSCustomObject with: Success, ExitCode, Message, Duration
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallerPath,

        [string]$Arguments = '',

        [switch]$WaitForExit
    )

    $result = [PSCustomObject]@{
        Success  = $false
        ExitCode = -1
        Message  = ''
        Duration = ''
    }

    if (-not (Test-Path -Path $InstallerPath -ErrorAction SilentlyContinue)) {
        $result.Message = "Installer not found: $InstallerPath"
        Write-AppLog -Message "Install-Software: $($result.Message)" -Level 'ERROR'
        return $result
    }

    $extension = [System.IO.Path]::GetExtension($InstallerPath).ToLower()
    $allowedExtensions = @('.exe', '.msi', '.msix', '.msp')
    if ($extension -notin $allowedExtensions) {
        $result.Message = "Unsupported installer type: $extension. Allowed: $($allowedExtensions -join ', ')"
        Write-AppLog -Message "Install-Software: $($result.Message)" -Level 'ERROR'
        return $result
    }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        Write-AppLog -Message "Install-Software: Starting $InstallerPath $Arguments" -Level 'INFO'

        if ($extension -eq '.msi' -or $extension -eq '.msp') {
            # Use msiexec for MSI/MSP files - /i for MSI, /p for MSP patches
            $msiFlag = if ($extension -eq '.msp') { '/p' } else { '/i' }
            $msiArgString = "$msiFlag `"$InstallerPath`""
            if ($Arguments) { $msiArgString += " $Arguments" }
            $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgString `
                -PassThru -ErrorAction Stop
        }
        elseif ($extension -eq '.msix') {
            # Use Add-AppxPackage for MSIX
            try {
                Add-AppxPackage -Path $InstallerPath -ErrorAction Stop
                $stopwatch.Stop()
                $result.Success = $true
                $result.ExitCode = 0
                $result.Message = "MSIX package installed successfully"
                $result.Duration = "$([int]$stopwatch.Elapsed.TotalSeconds)s"
                Write-AppLog -Message "Install-Software: MSIX installed OK - $InstallerPath" -Level 'INFO'
                return $result
            } catch {
                $stopwatch.Stop()
                $result.Message = "MSIX install failed: $_"
                $result.Duration = "$([int]$stopwatch.Elapsed.TotalSeconds)s"
                Write-AppLog -Message "Install-Software: $($result.Message)" -Level 'ERROR'
                return $result
            }
        }
        else {
            # EXE installer
            $proc = Start-Process -FilePath $InstallerPath -ArgumentList $Arguments `
                -PassThru -ErrorAction Stop
        }

        if ($WaitForExit -and $proc) {
            $exited = $proc.WaitForExit(600000)  # 10 minute timeout
            if (-not $exited) {
                $stopwatch.Stop()
                $result.Message = "Installer timed out after 10 minutes"
                $result.Duration = "$([int]$stopwatch.Elapsed.TotalSeconds)s"
                Write-AppLog -Message "Install-Software: Timeout - $InstallerPath" -Level 'ERROR'
                return $result
            }
            $result.ExitCode = $proc.ExitCode
            $result.Success = ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010)
            $result.Message = if ($result.Success) {
                if ($proc.ExitCode -eq 3010) { "Installed - reboot required" }
                else { "Installed successfully" }
            } else {
                "Installer exited with code $($proc.ExitCode)"
            }
        } else {
            $result.Success = $true
            $result.ExitCode = 0
            $result.Message = "Installer launched (running in background)"
        }
    } catch {
        $result.Message = "Failed to start installer: $_"
        Write-AppLog -Message "Install-Software: $($result.Message)" -Level 'ERROR'
    }

    $stopwatch.Stop()
    $result.Duration = "$([int]$stopwatch.Elapsed.TotalSeconds)s"

    Write-AppLog -Message "Install-Software: $($result.Message) ($($result.Duration))" -Level 'INFO'
    return $result
}

function Install-MultipleFromQueue {
    <#
    .SYNOPSIS
        Installs multiple software packages sequentially from a queue.
    .PARAMETER Queue
        Array of PSCustomObjects each with: FullPath, Arguments
    .PARAMETER ProgressCallback
        Optional scriptblock invoked with (currentName, index, total, result)
    .OUTPUTS
        Array of install result objects.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [PSCustomObject[]]$Queue,

        [scriptblock]$ProgressCallback = $null
    )

    $allResults = [System.Collections.ArrayList]::new()
    $total = $Queue.Count
    $idx = 0

    foreach ($item in $Queue) {
        $idx++
        $name = [System.IO.Path]::GetFileName($item.FullPath)

        Write-AppLog -Message "Install-MultipleFromQueue: [$idx/$total] $name" -Level 'INFO'

        $installResult = Install-Software -InstallerPath $item.FullPath `
            -Arguments $item.Arguments -WaitForExit

        [void]$allResults.Add([PSCustomObject]@{
            Name     = $name
            Result   = $installResult
        })

        if ($ProgressCallback) {
            try {
                $ProgressCallback.Invoke($name, $idx, $total, $installResult)
            } catch { }
        }
    }

    $successCount = ($allResults | Where-Object { $_.Result.Success }).Count
    Write-AppLog -Message "Install-MultipleFromQueue: $successCount/$total succeeded" -Level 'INFO'

    return $allResults.ToArray()
}


function Install-AllFromFolder {
    <#
    .SYNOPSIS
        Scans a folder for installers and runs them all, optionally in parallel.
    .DESCRIPTION
        Used by Apply-FullProfile to auto-install software as part of a profile
        application. Scans the folder for .exe/.msi/.msix/.msp files, determines
        silent arguments, and launches them. In parallel mode, all installers are
        started concurrently and then waited on together. In sequential mode, each
        installer is run and waited on before starting the next.
    .PARAMETER FolderPath
        The folder to scan for installer files.
    .PARAMETER Parallel
        If $true, launches all installers concurrently.
    .PARAMETER Recurse
        If $true, scans subfolders.
    .OUTPUTS
        PSCustomObject with: Success (bool), Message (string), Installed (int), Failed (int), Skipped (int), Details (string[])
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$FolderPath,

        [bool]$Parallel = $false,

        [bool]$Recurse = $true
    )

    $result = [PSCustomObject]@{
        Success   = $false
        Message   = ''
        Installed = 0
        Failed    = 0
        Skipped   = 0
        Details   = @()
    }

    # Validate folder
    if ([string]::IsNullOrWhiteSpace($FolderPath)) {
        $result.Message = "Software folder path is empty."
        Write-AppLog -Message "Install-AllFromFolder: $($result.Message)" -Level 'WARN'
        return $result
    }
    if (-not (Test-Path -Path $FolderPath -ErrorAction SilentlyContinue)) {
        $result.Message = "Software folder not found: $FolderPath"
        Write-AppLog -Message "Install-AllFromFolder: $($result.Message)" -Level 'WARN'
        return $result
    }

    # Find installers
    $installers = Find-Installers -FolderPath $FolderPath -Recurse:$Recurse
    if ($installers.Count -eq 0) {
        $result.Success = $true
        $result.Message = "No installers found in $FolderPath"
        Write-AppLog -Message "Install-AllFromFolder: $($result.Message)" -Level 'INFO'
        return $result
    }

    Write-AppLog -Message "Install-AllFromFolder: Found $($installers.Count) installer(s) in $FolderPath (Parallel=$Parallel)" -Level 'INFO'
    $details = [System.Collections.ArrayList]::new()

    if ($Parallel) {
        # ---- PARALLEL MODE: launch all at once, then wait ----
        $processes = [System.Collections.ArrayList]::new()
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

        foreach ($inst in $installers) {
            $silentArgs = Get-InstallerSilentArgs -InstallerPath $inst.FullPath
            $extension = $inst.Extension.ToLower()

            try {
                Write-AppLog -Message "Install-AllFromFolder: [PARALLEL] Launching $($inst.Name)" -Level 'INFO'

                $proc = $null
                if ($extension -eq '.msi' -or $extension -eq '.msp') {
                    $msiFlag = if ($extension -eq '.msp') { '/p' } else { '/i' }
                    $msiArgString = "$msiFlag `"$($inst.FullPath)`""
                    if ($silentArgs) { $msiArgString += " $silentArgs" }
                    $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgString `
                        -PassThru -ErrorAction Stop
                }
                elseif ($extension -eq '.msix') {
                    # MSIX must be synchronous (Add-AppxPackage has no -PassThru)
                    try {
                        Add-AppxPackage -Path $inst.FullPath -ErrorAction Stop
                        $result.Installed++
                        [void]$details.Add("[OK] $($inst.Name) - MSIX installed")
                        Write-AppLog -Message "Install-AllFromFolder: [OK] $($inst.Name) (MSIX)" -Level 'INFO'
                    } catch {
                        $result.Failed++
                        [void]$details.Add("[FAIL] $($inst.Name) - $_")
                        Write-AppLog -Message "Install-AllFromFolder: [FAIL] $($inst.Name) (MSIX) - $_" -Level 'ERROR'
                    }
                    continue
                }
                else {
                    $proc = Start-Process -FilePath $inst.FullPath -ArgumentList $silentArgs `
                        -PassThru -ErrorAction Stop
                }

                if ($proc) {
                    [void]$processes.Add([PSCustomObject]@{
                        Name    = $inst.Name
                        Process = $proc
                    })
                }
            }
            catch {
                $result.Failed++
                [void]$details.Add("[FAIL] $($inst.Name) - Failed to launch: $_")
                Write-AppLog -Message "Install-AllFromFolder: [FAIL] $($inst.Name) - $_" -Level 'ERROR'
            }
        }

        # Wait for all launched processes (10 minute timeout each)
        foreach ($entry in $processes) {
            try {
                $exited = $entry.Process.WaitForExit(600000)
                if (-not $exited) {
                    $result.Failed++
                    [void]$details.Add("[FAIL] $($entry.Name) - Timed out after 10 minutes")
                    Write-AppLog -Message "Install-AllFromFolder: [TIMEOUT] $($entry.Name)" -Level 'ERROR'
                }
                elseif ($entry.Process.ExitCode -eq 0 -or $entry.Process.ExitCode -eq 3010) {
                    $result.Installed++
                    $extra = if ($entry.Process.ExitCode -eq 3010) { " (reboot required)" } else { "" }
                    [void]$details.Add("[OK] $($entry.Name)$extra")
                    Write-AppLog -Message "Install-AllFromFolder: [OK] $($entry.Name) exit=$($entry.Process.ExitCode)" -Level 'INFO'
                }
                else {
                    $result.Failed++
                    [void]$details.Add("[FAIL] $($entry.Name) - Exit code $($entry.Process.ExitCode)")
                    Write-AppLog -Message "Install-AllFromFolder: [FAIL] $($entry.Name) exit=$($entry.Process.ExitCode)" -Level 'ERROR'
                }
            }
            catch {
                $result.Failed++
                [void]$details.Add("[FAIL] $($entry.Name) - Error waiting: $_")
                Write-AppLog -Message "Install-AllFromFolder: [FAIL] $($entry.Name) - $_" -Level 'ERROR'
            }
        }

        $stopwatch.Stop()
        Write-AppLog -Message "Install-AllFromFolder: Parallel batch complete in $([int]$stopwatch.Elapsed.TotalSeconds)s" -Level 'INFO'
    }
    else {
        # ---- SEQUENTIAL MODE: one at a time ----
        $idx = 0
        foreach ($inst in $installers) {
            $idx++
            $silentArgs = Get-InstallerSilentArgs -InstallerPath $inst.FullPath
            Write-AppLog -Message "Install-AllFromFolder: [$idx/$($installers.Count)] $($inst.Name)" -Level 'INFO'

            $installResult = Install-Software -InstallerPath $inst.FullPath `
                -Arguments $silentArgs -WaitForExit

            if ($installResult.Success) {
                $result.Installed++
                [void]$details.Add("[OK] $($inst.Name) - $($installResult.Message) ($($installResult.Duration))")
            }
            else {
                $result.Failed++
                [void]$details.Add("[FAIL] $($inst.Name) - $($installResult.Message)")
            }
        }
    }

    $result.Details = $details.ToArray()
    $result.Success = ($result.Failed -eq 0)
    $result.Message = "Software install complete: $($result.Installed) installed, $($result.Failed) failed"
    Write-AppLog -Message "Install-AllFromFolder: $($result.Message)" -Level 'INFO'

    return $result
}

# ============================================================================
# UI View Function - Software Installer
# ============================================================================

function New-SoftwareInstallerView {
    <#
    .SYNOPSIS
        Creates the Software Installer view for the DISGUISE BUDDY UI.
    .DESCRIPTION
        Builds a panel with:
          1. Folder selector - pick the software source folder
          2. Installer list - DataGridView with checkbox selection, file info, and silent args
          3. Install controls - Install Selected, Install All, progress and log
    .PARAMETER ContentPanel
        The parent panel to populate with controls.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.Panel]$ContentPanel
    )

    $ContentPanel.Controls.Clear()

    $cardWidth = $ContentPanel.ClientSize.Width - 40

    $scrollContainer = New-ScrollPanel -X 0 -Y 0 -Width $ContentPanel.Width -Height $ContentPanel.Height
    $scrollContainer.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                              [System.Windows.Forms.AnchorStyles]::Left -bor
                              [System.Windows.Forms.AnchorStyles]::Right -bor
                              [System.Windows.Forms.AnchorStyles]::Bottom

    # ===================================================================
    # Header
    # ===================================================================
    $sectionHeader = New-SectionHeader -Text "Software Installer" -X 20 -Y 15 -Width $cardWidth

    $subtitleLabel = New-StyledLabel -Text "Install software from a local folder onto this server" `
        -X 20 -Y 55 -FontSize 9 -IsSecondary

    $scrollContainer.Controls.Add($sectionHeader)
    $scrollContainer.Controls.Add($subtitleLabel)

    # ===================================================================
    # Card 1: Software Folder
    # ===================================================================
    $folderCard = New-StyledCard -Title "Software Source" -X 20 -Y 80 -Width $cardWidth -Height 145

    $lblFolder = New-StyledLabel -Text "Folder:" -X 15 -Y 48 -FontSize 9
    $txtFolder = New-StyledTextBox -X 75 -Y 45 -Width ($cardWidth - 240)
    $txtFolder.Text = $script:DefaultSoftwarePath

    $btnBrowse = New-StyledButton -Text "Browse..." -X ($cardWidth - 155) -Y 43 -Width 100 -Height 30

    $chkRecurse = New-StyledCheckBox -Text "Include subfolders" -X 75 -Y 76
    $chkRecurse.Checked = $true

    $btnScan = New-StyledButton -Text "Scan Folder" -X 15 -Y 105 -Width 130 -Height 30 -IsPrimary

    $lblScanStatus = New-StyledLabel -Text "Enter a folder path and click Scan" -X 160 -Y 112 -FontSize 9 -IsMuted
    $lblScanStatus.AutoSize = $false
    $lblScanStatus.Width = ($cardWidth - 160)

    $folderCard.Controls.AddRange(@($lblFolder, $txtFolder, $btnBrowse, $chkRecurse, $btnScan, $lblScanStatus))
    $scrollContainer.Controls.Add($folderCard)

    # ===================================================================
    # Card 2: Installer List
    # ===================================================================
    $listCard = New-StyledCard -Title "Available Installers" -X 20 -Y 235 -Width $cardWidth -Height 340

    $dgvInstallers = New-StyledDataGridView -X 15 -Y 45 -Width ($cardWidth - 30) -Height 230

    # Columns: Checkbox, Name, Type, Size, SubFolder, Silent Args (editable)
    $colSel = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn
    $colSel.HeaderText = ""
    $colSel.Name = "Select"
    $colSel.Width = 35
    $colSel.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colName = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colName.HeaderText = "Installer"
    $colName.Name = "FileName"
    $colName.Width = 260
    $colName.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colType = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colType.HeaderText = "Type"
    $colType.Name = "Type"
    $colType.Width = 55
    $colType.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colSize = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colSize.HeaderText = "Size"
    $colSize.Name = "Size"
    $colSize.Width = 65
    $colSize.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colSubDir = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colSubDir.HeaderText = "Subfolder"
    $colSubDir.Name = "SubFolder"
    $colSubDir.Width = 130
    $colSubDir.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colArgs = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colArgs.HeaderText = "Silent Arguments"
    $colArgs.Name = "Arguments"
    $colArgs.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::Fill

    $dgvInstallers.Columns.AddRange(@($colSel, $colName, $colType, $colSize, $colSubDir, $colArgs))
    $dgvInstallers.ReadOnly = $false

    # Make all columns read-only except Select and Arguments
    $colName.ReadOnly = $true
    $colType.ReadOnly = $true
    $colSize.ReadOnly = $true
    $colSubDir.ReadOnly = $true

    $listCard.Controls.Add($dgvInstallers)

    # Buttons below the grid
    $btnSelectAll = New-StyledButton -Text "Select All" -X 15 -Y 285 -Width 100 -Height 30
    $btnDeselectAll = New-StyledButton -Text "Deselect All" -X 125 -Y 285 -Width 110 -Height 30
    $btnRefresh = New-StyledButton -Text "Refresh" -X 245 -Y 285 -Width 90 -Height 30

    $lblSelectedCount = New-StyledLabel -Text "0 selected" -X 350 -Y 290 -FontSize 9 -IsSecondary

    $listCard.Controls.AddRange(@($btnSelectAll, $btnDeselectAll, $btnRefresh, $lblSelectedCount))
    $scrollContainer.Controls.Add($listCard)

    # ===================================================================
    # Card 3: Install Controls
    # ===================================================================
    $installCard = New-StyledCard -Title "Install" -X 20 -Y 585 -Width $cardWidth -Height 230

    $chkSilent = New-StyledCheckBox -Text "Silent install (unattended)" -X 15 -Y 45
    $chkSilent.Checked = $true

    $chkWait = New-StyledCheckBox -Text "Wait for each install to finish before next" -X 280 -Y 45
    $chkWait.Checked = $true

    $btnInstallSelected = New-StyledButton -Text "Install Selected" -X 15 -Y 78 `
        -Width 180 -Height 40 -IsPrimary

    $btnInstallAll = New-StyledButton -Text "Install All" -X 210 -Y 78 `
        -Width 130 -Height 40

    $installProgressBar = New-Object System.Windows.Forms.ProgressBar
    $installProgressBar.Location = New-Object System.Drawing.Point(360, 83)
    $installProgressBar.Size = New-Object System.Drawing.Size(($cardWidth - 375), 25)
    $installProgressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $installProgressBar.Minimum = 0
    $installProgressBar.Maximum = 100
    $installProgressBar.Value = 0

    # Install log output
    $txtInstallLog = New-Object System.Windows.Forms.TextBox
    $txtInstallLog.Location = New-Object System.Drawing.Point(15, 125)
    $txtInstallLog.Size = New-Object System.Drawing.Size(($cardWidth - 30), 90)
    $txtInstallLog.Multiline = $true
    $txtInstallLog.ReadOnly = $true
    $txtInstallLog.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
    $txtInstallLog.BackColor = $script:Theme.InputBackground
    $txtInstallLog.ForeColor = $script:Theme.TextSecondary
    $txtInstallLog.Font = New-Object System.Drawing.Font('Consolas', 9)
    $txtInstallLog.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $txtInstallLog.Text = "[$(Get-Date -Format 'HH:mm:ss')] Software installer ready. Scan a folder to find installers.`r`n"

    $installCard.Controls.AddRange(@($chkSilent, $chkWait, $btnInstallSelected, $btnInstallAll,
                                      $installProgressBar, $txtInstallLog))
    $scrollContainer.Controls.Add($installCard)

    # ===================================================================
    # Store installer data for use in event handlers
    # ===================================================================
    $script:InstallerData = @()

    # Helper: populate grid from scan results
    $populateGrid = {
        $dgvInstallers.Rows.Clear()
        foreach ($inst in $script:InstallerData) {
            $suggestedArgs = Get-InstallerSilentArgs -InstallerPath $inst.FullPath
            $typeLabel = $inst.Extension.TrimStart('.').ToUpper()
            $sizeLabel = "$($inst.SizeMB) MB"
            [void]$dgvInstallers.Rows.Add($false, $inst.Name, $typeLabel, $sizeLabel,
                                           $inst.SubFolder, $suggestedArgs)
            # Store full path in row tag
            $dgvInstallers.Rows[$dgvInstallers.Rows.Count - 1].Tag = $inst.FullPath
        }
        $lblSelectedCount.Text = "0 of $($script:InstallerData.Count) selected"
        $lblScanStatus.Text = "Found $($script:InstallerData.Count) installer(s)"
        $lblScanStatus.ForeColor = $script:Theme.Success
    }

    # Helper: update selected count
    $updateSelectedCount = {
        $count = 0
        foreach ($row in $dgvInstallers.Rows) {
            if ($row.Cells["Select"].Value -eq $true) { $count++ }
        }
        $lblSelectedCount.Text = "$count of $($dgvInstallers.Rows.Count) selected"
    }

    # Helper: build install queue from selected rows
    $buildQueue = {
        param([bool]$AllRows = $false)
        $queue = [System.Collections.ArrayList]::new()
        foreach ($row in $dgvInstallers.Rows) {
            if ($AllRows -or $row.Cells["Select"].Value -eq $true) {
                $silentArgs = $row.Cells["Arguments"].Value
                if (-not $chkSilent.Checked) { $silentArgs = '' }
                [void]$queue.Add([PSCustomObject]@{
                    FullPath  = $row.Tag
                    Arguments = $silentArgs
                    Name      = $row.Cells["FileName"].Value
                })
            }
        }
        return $queue.ToArray()
    }

    # Helper: run install queue
    $runInstallQueue = {
        param([PSCustomObject[]]$queue)

        if ($queue.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show(
                "No installers selected. Check the boxes next to the installers you want.",
                "Nothing Selected",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            return
        }

        $confirmResult = [System.Windows.Forms.MessageBox]::Show(
            "Install $($queue.Count) package(s)?`n`n$($queue | ForEach-Object { $_.Name } | Out-String)",
            "Confirm Install",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question)

        if ($confirmResult -ne [System.Windows.Forms.DialogResult]::Yes) { return }

        $btnInstallSelected.Enabled = $false
        $btnInstallAll.Enabled = $false
        $installProgressBar.Value = 0
        $total = $queue.Count
        $successCount = 0

        $txtInstallLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Starting install of $total package(s)...`r`n")
        $txtInstallLog.Refresh()

        $idx = 0
        foreach ($item in $queue) {
            $idx++
            $txtInstallLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] [$idx/$total] Installing $($item.Name)...`r`n")
            $txtInstallLog.Refresh()
            $installProgressBar.Value = [int]((($idx - 1) / $total) * 100)
            $installProgressBar.Refresh()
            [System.Windows.Forms.Application]::DoEvents()

            try {
                $installResult = Install-Software -InstallerPath $item.FullPath `
                    -Arguments $item.Arguments -WaitForExit:$chkWait.Checked

                $statusIcon = if ($installResult.Success) { "OK" } else { "FAIL" }
                $txtInstallLog.AppendText("    $statusIcon - $($installResult.Message) ($($installResult.Duration))`r`n")

                if ($installResult.Success) { $successCount++ }
            } catch {
                $txtInstallLog.AppendText("    ERROR - $_`r`n")
            }

            $txtInstallLog.Refresh()
            [System.Windows.Forms.Application]::DoEvents()
        }

        $installProgressBar.Value = 100
        $txtInstallLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Complete: $successCount/$total succeeded.`r`n")
        $txtInstallLog.AppendText("------------------------------------------------------------`r`n")

        $btnInstallSelected.Enabled = $true
        $btnInstallAll.Enabled = $true
    }

    # ===================================================================
    # Event Handlers
    # ===================================================================

    # Browse button - open folder dialog
    $btnBrowse.Add_Click({
        $folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $folderDialog.Description = "Select the folder containing installer files"
        $folderDialog.SelectedPath = $txtFolder.Text
        $folderDialog.ShowNewFolderButton = $false

        if ($folderDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $txtFolder.Text = $folderDialog.SelectedPath
        }
    })

    # Scan button - find installers in folder
    $btnScan.Add_Click({
        $folderPath = $txtFolder.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($folderPath)) {
            [System.Windows.Forms.MessageBox]::Show(
                "Please enter or browse to a folder path.",
                "No Folder",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            return
        }

        $lblScanStatus.Text = "Scanning $folderPath..."
        $lblScanStatus.ForeColor = $script:Theme.Accent
        $lblScanStatus.Refresh()

        $script:InstallerData = Find-Installers -FolderPath $folderPath -Recurse:$chkRecurse.Checked
        $populateGrid.Invoke()
    })

    # Select All / Deselect All
    $btnSelectAll.Add_Click({
        foreach ($row in $dgvInstallers.Rows) { $row.Cells["Select"].Value = $true }
        $updateSelectedCount.Invoke()
    })

    $btnDeselectAll.Add_Click({
        foreach ($row in $dgvInstallers.Rows) { $row.Cells["Select"].Value = $false }
        $updateSelectedCount.Invoke()
    })

    # Refresh button
    $btnRefresh.Add_Click({
        $folderPath = $txtFolder.Text.Trim()
        if (-not [string]::IsNullOrWhiteSpace($folderPath)) {
            $script:InstallerData = Find-Installers -FolderPath $folderPath -Recurse:$chkRecurse.Checked
            $populateGrid.Invoke()
        }
    })

    # Track checkbox changes for selected count
    $dgvInstallers.Add_CellValueChanged({
        param($sender, $e)
        if ($e.ColumnIndex -eq 0) { $updateSelectedCount.Invoke() }
    })
    $dgvInstallers.Add_CurrentCellDirtyStateChanged({
        if ($dgvInstallers.IsCurrentCellDirty) {
            $dgvInstallers.CommitEdit([System.Windows.Forms.DataGridViewDataErrorContexts]::Commit)
        }
    })

    # Install Selected button
    $btnInstallSelected.Add_Click({
        $queue = $buildQueue.Invoke($false)
        $runInstallQueue.Invoke($queue)
    })

    # Install All button
    $btnInstallAll.Add_Click({
        $queue = $buildQueue.Invoke($true)
        $runInstallQueue.Invoke($queue)
    })

    # ===================================================================
    # Add scroll container
    # ===================================================================
    $ContentPanel.Controls.Add($scrollContainer)
}
