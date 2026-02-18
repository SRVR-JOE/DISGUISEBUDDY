# Discovery.ps1 - DISGUISE BUDDY Network Discovery and Deployment Module
# Provides functions for scanning networks, discovering disguise (d3) media servers,
# testing connections, retrieving remote server info, and pushing configuration profiles.
# Also provides the New-DeployView UI function for the Network Deploy panel.

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
# Backend Functions
# ============================================================================

function Find-DisguiseServers {
    <#
    .SYNOPSIS
        Scans a subnet for disguise (d3) media servers using multiple discovery strategies.
    .DESCRIPTION
        Performs a parallel network scan across a given IP range using:
          1. Async TCP port probes on ports 80 (API) and 873 (rsync)
          2. Ping sweep via Test-Connection
          3. HTTP probe against the disguise REST API at /api/service/system
        Results are aggregated and returned as an array of server descriptor objects.
    .PARAMETER SubnetBase
        The first three octets of the target subnet (e.g. "10.0.0").
    .PARAMETER StartIP
        The starting value for the fourth octet. Default 1.
    .PARAMETER EndIP
        The ending value for the fourth octet. Default 254.
    .PARAMETER TimeoutMs
        Timeout in milliseconds for each TCP connection attempt. Default 200.
    .PARAMETER ProgressCallback
        Optional scriptblock invoked with (currentIP, percentComplete, statusMessage) for progress reporting.
    .OUTPUTS
        Array of PSCustomObjects with properties:
          IPAddress, Hostname, IsDisguise, ResponseTimeMs, Ports, APIVersion
    #>
    [CmdletBinding()]
    param(
        [string]$SubnetBase = "10.0.0",
        [int]$StartIP = 1,
        [int]$EndIP = 254,
        [int]$TimeoutMs = 200,
        [scriptblock]$ProgressCallback = $null
    )

    $discoveredServers = [System.Collections.ArrayList]::new()
    $totalIPs = $EndIP - $StartIP + 1
    $processedCount = 0

    # Known disguise ports to probe
    $targetPorts = @(80, 873, 9864)

    # -----------------------------------------------------------------------
    # Strategy 1 & 2: Parallel TCP port scan + ping sweep using runspaces
    # -----------------------------------------------------------------------
    $runspacePool = [System.Management.Automation.Runspaces.RunspacePool]::CreateRunspacePool(1, 50)
    $runspacePool.Open()

    $runspaceJobs = [System.Collections.ArrayList]::new()

    # Scriptblock executed inside each runspace: probes TCP ports and pings the host
    $scanScriptBlock = {
        param(
            [string]$IPAddress,
            [int[]]$Ports,
            [int]$Timeout
        )

        $result = [PSCustomObject]@{
            IPAddress      = $IPAddress
            Hostname       = ''
            IsDisguise     = $false
            ResponseTimeMs = -1
            Ports          = @()
            APIVersion     = $null
            PingSuccess    = $false
        }

        $openPorts = [System.Collections.ArrayList]::new()
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

        # --- TCP Port Scan (async connections) ---
        foreach ($port in $Ports) {
            try {
                $tcpClient = New-Object System.Net.Sockets.TcpClient
                $connectTask = $tcpClient.ConnectAsync($IPAddress, $port)
                $completed = $connectTask.Wait($Timeout)
                if ($completed -and $tcpClient.Connected) {
                    [void]$openPorts.Add($port)
                }
                $tcpClient.Close()
                $tcpClient.Dispose()
            } catch {
                # Connection failed or timed out - port is closed/filtered
            }
        }

        $stopwatch.Stop()
        $result.ResponseTimeMs = [int]$stopwatch.Elapsed.TotalMilliseconds

        # --- Ping Sweep ---
        try {
            $ping = New-Object System.Net.NetworkInformation.Ping
            $pingReply = $ping.Send($IPAddress, $Timeout)
            if ($pingReply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                $result.PingSuccess = $true
                # Use ping round-trip time if it is better than TCP timing
                if ($pingReply.RoundtripTime -gt 0) {
                    $result.ResponseTimeMs = [Math]::Min($result.ResponseTimeMs, [int]$pingReply.RoundtripTime)
                }
            }
            $ping.Dispose()
        } catch {
            # Ping failed - host may still be reachable via TCP
        }

        # --- Hostname Resolution ---
        try {
            $dnsEntry = [System.Net.Dns]::GetHostEntry($IPAddress)
            $result.Hostname = $dnsEntry.HostName
        } catch {
            $result.Hostname = ''
        }

        $result.Ports = $openPorts.ToArray()

        # If port 80 is open, attempt a quick disguise API probe
        if ($openPorts -contains 80) {
            try {
                $httpClient = New-Object System.Net.Http.HttpClient
                $httpClient.Timeout = [TimeSpan]::FromMilliseconds($Timeout * 3)
                $apiResponse = $httpClient.GetStringAsync("http://$IPAddress/api/service/system").Result
                if ($apiResponse -match 'hostname|version|d3|disguise') {
                    $result.IsDisguise = $true
                    # Try to extract version info from the JSON response
                    try {
                        $parsed = $apiResponse | ConvertFrom-Json
                        if ($parsed.version) {
                            $result.APIVersion = $parsed.version
                        } elseif ($parsed.d3VersionString) {
                            $result.APIVersion = $parsed.d3VersionString
                        }
                    } catch {
                        $result.APIVersion = 'Unknown'
                    }
                }
                $httpClient.Dispose()
            } catch {
                # API not responding or not a disguise server
                if ($httpClient) { $httpClient.Dispose() }
            }
        }

        return $result
    }

    # Launch a runspace for each IP in the scan range
    for ($i = $StartIP; $i -le $EndIP; $i++) {
        $ip = "$SubnetBase.$i"

        $powershell = [System.Management.Automation.PowerShell]::Create()
        $powershell.RunspacePool = $runspacePool
        [void]$powershell.AddScript($scanScriptBlock)
        [void]$powershell.AddArgument($ip)
        [void]$powershell.AddArgument($targetPorts)
        [void]$powershell.AddArgument($TimeoutMs)

        $handle = $powershell.BeginInvoke()

        [void]$runspaceJobs.Add([PSCustomObject]@{
            PowerShell = $powershell
            Handle     = $handle
            IP         = $ip
        })
    }

    # Collect results from all runspaces
    foreach ($job in $runspaceJobs) {
        try {
            $scanResult = $job.PowerShell.EndInvoke($job.Handle)
            if ($scanResult -and $scanResult.Count -gt 0) {
                $serverInfo = $scanResult[0]
                # Include the server if it has open ports or responded to ping
                if ($serverInfo.Ports.Count -gt 0 -or $serverInfo.PingSuccess) {
                    [void]$discoveredServers.Add($serverInfo)
                }
            }
        } catch {
            Write-AppLog -Message "Error collecting scan result for $($job.IP): $_" -Level 'WARN'
        } finally {
            $job.PowerShell.Dispose()
        }

        $processedCount++
        if ($ProgressCallback) {
            $percentComplete = [int](($processedCount / $totalIPs) * 100)
            try {
                $ProgressCallback.Invoke($job.IP, $percentComplete, "Scanning $($job.IP)...")
            } catch {
                # Progress callback error - continue silently
            }
        }
    }

    # Clean up the runspace pool
    $runspacePool.Close()
    $runspacePool.Dispose()

    # -----------------------------------------------------------------------
    # Strategy 3: For hosts with port 80 open that were not yet identified
    # as disguise servers, do a deeper API check
    # -----------------------------------------------------------------------
    foreach ($server in $discoveredServers) {
        if (-not $server.IsDisguise -and $server.Ports -contains 80) {
            $apiInfo = Get-RemoteServerInfo -IPAddress $server.IPAddress
            if ($null -ne $apiInfo) {
                $server.IsDisguise = $true
                if ($apiInfo.version) {
                    $server.APIVersion = $apiInfo.version
                }
            }
        }
    }

    # Store results in shared app state for cross-view access
    $script:AppState.LastScanResults = $discoveredServers.ToArray()

    Write-AppLog -Message "Network scan complete. Found $($discoveredServers.Count) server(s) on $SubnetBase.x ($StartIP-$EndIP)." -Level 'INFO'

    return $discoveredServers.ToArray()
}

function Test-DisguiseServer {
    <#
    .SYNOPSIS
        Tests whether a specific IP address hosts a disguise (d3) media server.
    .DESCRIPTION
        Performs targeted connectivity checks against a single host:
          - TCP port probes on 80, 873, 9864
          - HTTP GET to the disguise REST API (/api/service/system)
          - Attempt to reach the SMC API
          - Hostname resolution via reverse DNS
    .PARAMETER IPAddress
        The IPv4 address to test.
    .PARAMETER TimeoutMs
        Timeout in milliseconds for each connection attempt. Default 2000.
    .OUTPUTS
        PSCustomObject with properties:
          IPAddress, Hostname, IsDisguise, APIAvailable, SMCAvailable, Ports, DesignerVersion
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$IPAddress,

        [int]$TimeoutMs = 2000
    )

    $result = [PSCustomObject]@{
        IPAddress       = $IPAddress
        Hostname        = ''
        IsDisguise      = $false
        APIAvailable    = $false
        SMCAvailable    = $false
        Ports           = @()
        DesignerVersion = $null
    }

    $openPorts = [System.Collections.ArrayList]::new()

    # --- TCP Port Probes ---
    $knownPorts = @(80, 873, 9864)
    foreach ($port in $knownPorts) {
        try {
            $tcpClient = New-Object System.Net.Sockets.TcpClient
            $connectTask = $tcpClient.ConnectAsync($IPAddress, $port)
            $completed = $connectTask.Wait($TimeoutMs)
            if ($completed -and $tcpClient.Connected) {
                [void]$openPorts.Add($port)
            }
            $tcpClient.Close()
            $tcpClient.Dispose()
        } catch {
            # Port is closed or unreachable
        }
    }

    $result.Ports = $openPorts.ToArray()

    # --- Hostname Resolution ---
    try {
        $dnsEntry = [System.Net.Dns]::GetHostEntry($IPAddress)
        $result.Hostname = $dnsEntry.HostName
    } catch {
        $result.Hostname = ''
    }

    # --- Disguise REST API Check (port 80) ---
    if ($openPorts -contains 80) {
        try {
            $httpClient = New-Object System.Net.Http.HttpClient
            $httpClient.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMs)
            $apiResponse = $httpClient.GetStringAsync("http://$IPAddress/api/service/system").Result

            if ($apiResponse) {
                $result.APIAvailable = $true
                try {
                    $parsed = $apiResponse | ConvertFrom-Json
                    # Identify as disguise server if the response contains expected fields
                    if ($parsed.hostname -or $parsed.version -or $parsed.d3VersionString) {
                        $result.IsDisguise = $true
                        $result.DesignerVersion = if ($parsed.d3VersionString) {
                            $parsed.d3VersionString
                        } elseif ($parsed.version) {
                            $parsed.version
                        } else {
                            'Unknown'
                        }
                    }
                } catch {
                    # Response was not valid JSON - still mark API as available
                    if ($apiResponse -match 'disguise|d3') {
                        $result.IsDisguise = $true
                    }
                }
            }
            $httpClient.Dispose()
        } catch {
            # API not reachable or timed out
            if ($httpClient) { $httpClient.Dispose() }
        }
    }

    # --- SMC API Check ---
    # Only attempt if port 80 is open (avoid unnecessary HTTP timeouts)
    if ($result.Ports -contains 80) {
        $httpClient = $null
        try {
            $httpClient = New-Object System.Net.Http.HttpClient
            $httpClient.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMs)
            $smcResponse = $httpClient.GetStringAsync("http://$IPAddress/api/networkadapters").Result
            if ($smcResponse) {
                $result.SMCAvailable = $true
                if (-not $result.IsDisguise -and ($smcResponse -match 'adapter|network|interface')) {
                    $result.IsDisguise = $true
                }
            }
        } catch {
            # SMC API not available on this host
        } finally {
            if ($httpClient) { $httpClient.Dispose() }
        }
    }

    Write-AppLog -Message "Test-DisguiseServer: $IPAddress - IsDisguise=$($result.IsDisguise), API=$($result.APIAvailable), Ports=$($result.Ports -join ',')" -Level 'INFO'

    return $result
}

function Get-RemoteServerInfo {
    <#
    .SYNOPSIS
        Retrieves detailed system information from a remote disguise server via REST API.
    .DESCRIPTION
        Sends an HTTP GET to http://<IPAddress>/api/service/system and parses the JSON response.
    .PARAMETER IPAddress
        The IPv4 address of the disguise server.
    .OUTPUTS
        Parsed PSCustomObject from the API response, or $null if the request fails.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$IPAddress
    )

    try {
        $httpClient = New-Object System.Net.Http.HttpClient
        $httpClient.Timeout = [TimeSpan]::FromSeconds(5)
        $response = $httpClient.GetStringAsync("http://$IPAddress/api/service/system").Result

        if ($response) {
            $parsed = $response | ConvertFrom-Json
            Write-AppLog -Message "Get-RemoteServerInfo: Successfully retrieved info from $IPAddress" -Level 'INFO'
            $httpClient.Dispose()
            return $parsed
        }

        $httpClient.Dispose()
    } catch {
        Write-AppLog -Message "Get-RemoteServerInfo: Failed to reach $IPAddress - $_" -Level 'WARN'
        if ($httpClient) { $httpClient.Dispose() }
    }

    return $null
}

function Push-ProfileToServer {
    <#
    .SYNOPSIS
        Pushes a configuration profile to a remote disguise server.
    .DESCRIPTION
        Uses PowerShell remoting (Invoke-Command) to apply the profile settings
        on the target machine. The operation consists of three phases:
          1. Set the server hostname
          2. Configure network adapters (IP, subnet, gateway, DNS)
          3. Configure SMB shares
        Each phase is wrapped in error handling and returns a detailed result.

        NOTE: The actual remote execution commands are structured and ready for
        deployment on a Windows environment. On non-Windows systems, the function
        returns a simulated/framework result.
    .PARAMETER ServerIP
        The IPv4 address of the target disguise server.
    .PARAMETER Profile
        The profile PSCustomObject containing configuration data.
    .PARAMETER Credential
        PSCredential for authenticating against the remote server.
    .OUTPUTS
        PSCustomObject with properties: ServerIP, Success, Steps (array of step results),
        ErrorMessage, Timestamp
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ServerIP,

        [Parameter(Mandatory = $true)]
        [PSCustomObject]$Profile,

        [Parameter(Mandatory = $false)]
        [PSCredential]$Credential
    )

    $result = [PSCustomObject]@{
        ServerIP     = $ServerIP
        Success      = $false
        Steps        = [System.Collections.ArrayList]::new()
        ErrorMessage = ''
        Timestamp    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    }

    Write-AppLog -Message "Push-ProfileToServer: Starting deployment of profile '$($Profile.Name)' to $ServerIP" -Level 'INFO'

    # -----------------------------------------------------------------------
    # Step 1: Set Hostname
    # -----------------------------------------------------------------------
    $hostnameStep = [PSCustomObject]@{
        StepName = 'Set Hostname'
        Success  = $false
        Message  = ''
    }

    try {
        $targetHostname = $Profile.ServerName
        if ([string]::IsNullOrWhiteSpace($targetHostname)) {
            $hostnameStep.Message = 'Skipped - no hostname specified in profile'
            $hostnameStep.Success = $true
        } else {
            # Build the remote command for setting the hostname
            $hostnameScriptBlock = {
                param($NewHostname)
                try {
                    Rename-Computer -NewName $NewHostname -Force -ErrorAction Stop
                    return @{ Success = $true; Message = "Hostname set to '$NewHostname'. Reboot required." }
                } catch {
                    return @{ Success = $false; Message = "Failed to set hostname: $_" }
                }
            }

            # Execute remotely via Invoke-Command
            $invokeParams = @{
                ComputerName = $ServerIP
                ScriptBlock  = $hostnameScriptBlock
                ArgumentList = @($targetHostname)
                ErrorAction  = 'Stop'
            }
            if ($Credential) {
                $invokeParams.Credential = $Credential
            }

            $remoteResult = Invoke-Command @invokeParams
            $hostnameStep.Success = $remoteResult.Success
            $hostnameStep.Message = $remoteResult.Message
        }
    } catch {
        $hostnameStep.Success = $false
        $hostnameStep.Message = "Remote execution failed: $_"
        Write-AppLog -Message "Push-ProfileToServer: Hostname step failed for $ServerIP - $_" -Level 'ERROR'
    }

    [void]$result.Steps.Add($hostnameStep)

    # -----------------------------------------------------------------------
    # Step 2: Configure Network Adapters
    # -----------------------------------------------------------------------
    $networkStep = [PSCustomObject]@{
        StepName = 'Configure Network Adapters'
        Success  = $false
        Message  = ''
    }

    try {
        $adapters = $Profile.NetworkAdapters
        if (-not $adapters -or $adapters.Count -eq 0) {
            $networkStep.Message = 'Skipped - no network adapter configuration in profile'
            $networkStep.Success = $true
        } else {
            # Build the remote command for configuring each adapter
            $networkScriptBlock = {
                param($AdapterConfigs)
                $results = @()
                foreach ($adapter in $AdapterConfigs) {
                    try {
                        # Skip unconfigured adapters
                        if ([string]::IsNullOrWhiteSpace($adapter.IPAddress)) { continue }

                        # Find the adapter by name or role
                        $netAdapter = Get-NetAdapter | Where-Object {
                            $_.Name -eq $adapter.AdapterName -or
                            $_.InterfaceDescription -match $adapter.Role
                        } | Select-Object -First 1

                        if (-not $netAdapter) {
                            $results += "WARN: Adapter for role '$($adapter.Role)' not found"
                            continue
                        }

                        # Remove existing IP configuration
                        $netAdapter | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
                        $netAdapter | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue

                        # Apply new IP configuration (convert SubnetMask to prefix length)
                        $prefixLen = 24
                        if ($adapter.SubnetMask) {
                            $maskOctets = $adapter.SubnetMask.Split('.')
                            $binary = ''
                            foreach ($o in $maskOctets) { $binary += [Convert]::ToString([int]$o, 2).PadLeft(8, '0') }
                            $prefixLen = ($binary.ToCharArray() | Where-Object { $_ -eq '1' }).Count
                        }
                        $ipParams = @{
                            InterfaceIndex = $netAdapter.InterfaceIndex
                            IPAddress      = $adapter.IPAddress
                            PrefixLength   = $prefixLen
                            ErrorAction    = 'Stop'
                        }
                        if ($adapter.Gateway) {
                            $ipParams.DefaultGateway = $adapter.Gateway
                        }
                        New-NetIPAddress @ipParams

                        # Set DNS servers if specified
                        $dnsAddrs = @()
                        if ($adapter.DNS1) { $dnsAddrs += $adapter.DNS1 }
                        if ($adapter.DNS2) { $dnsAddrs += $adapter.DNS2 }
                        if ($dnsAddrs.Count -gt 0) {
                            Set-DnsClientServerAddress -InterfaceIndex $netAdapter.InterfaceIndex `
                                -ServerAddresses $dnsAddrs -ErrorAction Stop
                        }

                        $results += "OK: $($adapter.Role) -> $($adapter.IPAddress)/$prefixLen"
                    } catch {
                        $results += "ERROR: $($adapter.Role) - $_"
                    }
                }
                return @{ Success = ($results -notmatch '^ERROR:').Count -eq $results.Count; Message = ($results -join '; ') }
            }

            $invokeParams = @{
                ComputerName = $ServerIP
                ScriptBlock  = $networkScriptBlock
                ArgumentList = @(, $adapters)
                ErrorAction  = 'Stop'
            }
            if ($Credential) {
                $invokeParams.Credential = $Credential
            }

            $remoteResult = Invoke-Command @invokeParams
            $networkStep.Success = $remoteResult.Success
            $networkStep.Message = $remoteResult.Message
        }
    } catch {
        $networkStep.Success = $false
        $networkStep.Message = "Remote execution failed: $_"
        Write-AppLog -Message "Push-ProfileToServer: Network config step failed for $ServerIP - $_" -Level 'ERROR'
    }

    [void]$result.Steps.Add($networkStep)

    # -----------------------------------------------------------------------
    # Step 3: Configure SMB Shares
    # -----------------------------------------------------------------------
    $smbStep = [PSCustomObject]@{
        StepName = 'Configure SMB Shares'
        Success  = $false
        Message  = ''
    }

    try {
        $smbSettings = $Profile.SMBSettings
        if (-not $smbSettings) {
            $smbStep.Message = 'Skipped - no SMB configuration in profile'
            $smbStep.Success = $true
        } else {
            $smbScriptBlock = {
                param($SMBConfig)
                $results = @()
                try {
                    # Configure SMB server settings
                    if ($SMBConfig.EnableSMB1) {
                        Set-SmbServerConfiguration -EnableSMB1Protocol $true -Force -ErrorAction Stop
                        $results += "OK: SMB1 enabled"
                    }
                    if ($SMBConfig.EnableSMB2) {
                        Set-SmbServerConfiguration -EnableSMB2Protocol $true -Force -ErrorAction Stop
                        $results += "OK: SMB2 enabled"
                    }

                    # Create or update shares
                    if ($SMBConfig.Shares) {
                        foreach ($share in $SMBConfig.Shares) {
                            try {
                                $existingShare = Get-SmbShare -Name $share.Name -ErrorAction SilentlyContinue
                                if ($existingShare) {
                                    Set-SmbShare -Name $share.Name -Path $share.Path -Force -ErrorAction Stop
                                    $results += "OK: Updated share '$($share.Name)'"
                                } else {
                                    New-SmbShare -Name $share.Name -Path $share.Path `
                                        -FullAccess $share.FullAccess -ErrorAction Stop
                                    $results += "OK: Created share '$($share.Name)'"
                                }
                            } catch {
                                $results += "ERROR: Share '$($share.Name)' - $_"
                            }
                        }
                    }
                } catch {
                    $results += "ERROR: SMB configuration - $_"
                }
                return @{
                    Success = ($results | Where-Object { $_ -match '^ERROR:' }).Count -eq 0
                    Message = ($results -join '; ')
                }
            }

            $invokeParams = @{
                ComputerName = $ServerIP
                ScriptBlock  = $smbScriptBlock
                ArgumentList = @($smbSettings)
                ErrorAction  = 'Stop'
            }
            if ($Credential) {
                $invokeParams.Credential = $Credential
            }

            $remoteResult = Invoke-Command @invokeParams
            $smbStep.Success = $remoteResult.Success
            $smbStep.Message = $remoteResult.Message
        }
    } catch {
        $smbStep.Success = $false
        $smbStep.Message = "Remote execution failed: $_"
        Write-AppLog -Message "Push-ProfileToServer: SMB config step failed for $ServerIP - $_" -Level 'ERROR'
    }

    [void]$result.Steps.Add($smbStep)

    # -----------------------------------------------------------------------
    # Aggregate overall success
    # -----------------------------------------------------------------------
    $result.Success = ($result.Steps | Where-Object { -not $_.Success }).Count -eq 0
    if (-not $result.Success) {
        $failedSteps = ($result.Steps | Where-Object { -not $_.Success } | ForEach-Object { $_.StepName }) -join ', '
        $result.ErrorMessage = "Failed steps: $failedSteps"
    }

    Write-AppLog -Message "Push-ProfileToServer: Deployment to $ServerIP completed. Success=$($result.Success)" -Level 'INFO'

    return $result
}

function Push-ProfileToMultipleServers {
    <#
    .SYNOPSIS
        Pushes a configuration profile to multiple disguise servers in batch.
    .DESCRIPTION
        Iterates over the given list of server IPs, calling Push-ProfileToServer
        for each one. Supports a progress callback for UI updates.
    .PARAMETER ServerIPs
        Array of IPv4 addresses to deploy to.
    .PARAMETER Profile
        The configuration profile to push.
    .PARAMETER Credential
        PSCredential for remote authentication.
    .PARAMETER ProgressCallback
        Optional scriptblock invoked with (serverIP, index, total, result) after each server.
    .OUTPUTS
        Array of PSCustomObjects (one per server), each containing deployment results.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$ServerIPs,

        [Parameter(Mandatory = $true)]
        [PSCustomObject]$Profile,

        [Parameter(Mandatory = $false)]
        [PSCredential]$Credential,

        [scriptblock]$ProgressCallback = $null
    )

    $allResults = [System.Collections.ArrayList]::new()
    $totalServers = $ServerIPs.Count
    $currentIndex = 0

    foreach ($ip in $ServerIPs) {
        $currentIndex++

        Write-AppLog -Message "Push-ProfileToMultipleServers: Deploying to $ip ($currentIndex of $totalServers)" -Level 'INFO'

        $pushResult = Push-ProfileToServer -ServerIP $ip -Profile $Profile -Credential $Credential
        [void]$allResults.Add($pushResult)

        if ($ProgressCallback) {
            try {
                $ProgressCallback.Invoke($ip, $currentIndex, $totalServers, $pushResult)
            } catch {
                # Progress callback error - continue with next server
            }
        }
    }

    $successCount = ($allResults | Where-Object { $_.Success }).Count
    Write-AppLog -Message "Push-ProfileToMultipleServers: Batch complete. $successCount/$totalServers succeeded." -Level 'INFO'

    return $allResults.ToArray()
}

# ============================================================================
# UI View Function - Network Deploy
# ============================================================================

function New-DeployView {
    <#
    .SYNOPSIS
        Creates the Network Discovery and Deployment view for the DISGUISE BUDDY UI.
    .DESCRIPTION
        Builds a full panel with three cards:
          1. Network Scan - subnet/range inputs, scan and quick-scan buttons, progress
          2. Discovered Servers - DataGridView with server list and actions
          3. Deploy Configuration - profile selection, credentials, deployment controls
    .PARAMETER ContentPanel
        The parent panel to which all controls will be added.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.Panel]$ContentPanel
    )

    # Clear any existing controls from the content panel
    $ContentPanel.Controls.Clear()

    # Create a scrollable container for the entire view
    $scrollContainer = New-ScrollPanel -X 0 -Y 0 -Width $ContentPanel.Width -Height $ContentPanel.Height
    $scrollContainer.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                              [System.Windows.Forms.AnchorStyles]::Left -bor
                              [System.Windows.Forms.AnchorStyles]::Right -bor
                              [System.Windows.Forms.AnchorStyles]::Bottom

    # ===================================================================
    # Section Header
    # ===================================================================
    $sectionHeader = New-SectionHeader -Text "Network Deploy" -X 20 -Y 10 -Width 900

    $subtitleLabel = New-StyledLabel -Text "Discover disguise servers and push configurations" `
        -X 20 -Y 48 -FontSize 9 -IsSecondary

    $scrollContainer.Controls.Add($sectionHeader)
    $scrollContainer.Controls.Add($subtitleLabel)

    # ===================================================================
    # Card 1: Network Scan
    # ===================================================================
    $scanCard = New-StyledCard -Title "Network Scan" -X 20 -Y 80 -Width 900 -Height 180

    # --- Row 1: Subnet, IP range, and timeout inputs ---
    $lblSubnet = New-StyledLabel -Text "Subnet:" -X 15 -Y 48 -FontSize 9
    $txtSubnet = New-StyledTextBox -X 75 -Y 45 -Width 120 -PlaceholderText "10.0.0"
    $txtSubnet.Text = "10.0.0"
    $txtSubnet.ForeColor = $script:Theme.Text

    $lblStartIP = New-StyledLabel -Text "Start:" -X 210 -Y 48 -FontSize 9
    $txtStartIP = New-StyledTextBox -X 255 -Y 45 -Width 60
    $txtStartIP.Text = "1"

    $lblEndIP = New-StyledLabel -Text "End:" -X 330 -Y 48 -FontSize 9
    $txtEndIP = New-StyledTextBox -X 370 -Y 45 -Width 60
    $txtEndIP.Text = "254"

    $lblTimeout = New-StyledLabel -Text "Timeout (ms):" -X 450 -Y 48 -FontSize 9
    $txtTimeout = New-StyledTextBox -X 555 -Y 45 -Width 70
    $txtTimeout.Text = "200"

    $scanCard.Controls.AddRange(@($lblSubnet, $txtSubnet, $lblStartIP, $txtStartIP,
                                   $lblEndIP, $txtEndIP, $lblTimeout, $txtTimeout))

    # --- Row 2: Scan buttons, progress bar, and status label ---
    $btnScanNetwork = New-StyledButton -Text "Scan Network" -X 15 -Y 90 `
        -Width 140 -Height 35 -IsPrimary

    $btnQuickScan = New-StyledButton -Text "Quick Scan" -X 170 -Y 90 `
        -Width 120 -Height 35

    # Progress bar for scan progress
    $scanProgressBar = New-Object System.Windows.Forms.ProgressBar
    $scanProgressBar.Location = New-Object System.Drawing.Point(310, 95)
    $scanProgressBar.Size = New-Object System.Drawing.Size(350, 22)
    $scanProgressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $scanProgressBar.Minimum = 0
    $scanProgressBar.Maximum = 100
    $scanProgressBar.Value = 0

    $lblScanStatus = New-StyledLabel -Text "Ready to scan" -X 15 -Y 140 -FontSize 9 -IsMuted
    $lblScanStatus.AutoSize = $false
    $lblScanStatus.Width = 870

    $scanCard.Controls.AddRange(@($btnScanNetwork, $btnQuickScan, $scanProgressBar, $lblScanStatus))

    $scrollContainer.Controls.Add($scanCard)

    # ===================================================================
    # Card 2: Discovered Servers
    # ===================================================================
    $serversCard = New-StyledCard -Title "Discovered Servers" -X 20 -Y 270 -Width 900 -Height 280

    # DataGridView for the server list
    $dgvServers = New-StyledDataGridView -X 15 -Y 45 -Width 870 -Height 180

    # Configure columns: Checkbox, IP Address, Hostname, Status, d3 API, Ports, Response Time
    $colSelect = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn
    $colSelect.HeaderText = ""
    $colSelect.Name = "Select"
    $colSelect.Width = 40
    $colSelect.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colIP = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colIP.HeaderText = "IP Address"
    $colIP.Name = "IPAddress"
    $colIP.Width = 120
    $colIP.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colHostname = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colHostname.HeaderText = "Hostname"
    $colHostname.Name = "Hostname"
    $colHostname.Width = 150
    $colHostname.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colStatus = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colStatus.HeaderText = "Status"
    $colStatus.Name = "Status"
    $colStatus.Width = 90
    $colStatus.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colAPI = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colAPI.HeaderText = "d3 API"
    $colAPI.Name = "D3API"
    $colAPI.Width = 100
    $colAPI.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colPorts = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colPorts.HeaderText = "Ports"
    $colPorts.Name = "Ports"
    $colPorts.Width = 130
    $colPorts.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colResponseTime = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colResponseTime.HeaderText = "Response Time"
    $colResponseTime.Name = "ResponseTime"
    $colResponseTime.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::Fill

    $dgvServers.Columns.AddRange(@($colSelect, $colIP, $colHostname, $colStatus,
                                    $colAPI, $colPorts, $colResponseTime))
    $dgvServers.ReadOnly = $false

    # Make only the checkbox column editable
    foreach ($col in $dgvServers.Columns) {
        if ($col.Name -ne "Select") {
            $col.ReadOnly = $true
        }
    }

    # --- Right-click context menu for the grid ---
    $contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

    $menuViewDetails = New-Object System.Windows.Forms.ToolStripMenuItem
    $menuViewDetails.Text = "View Details"
    $menuViewDetails.Add_Click({
        $selectedRow = $dgvServers.CurrentRow
        if ($selectedRow) {
            $ip = $selectedRow.Cells["IPAddress"].Value
            if ($ip) {
                $lblScanStatus.Text = "Testing $ip..."
                $lblScanStatus.ForeColor = $script:Theme.TextSecondary
                $lblScanStatus.Refresh()

                try {
                    $details = Test-DisguiseServer -IPAddress $ip -TimeoutMs 3000
                    $detailMsg = "Server: $ip`n" +
                                 "Hostname: $($details.Hostname)`n" +
                                 "Is Disguise: $($details.IsDisguise)`n" +
                                 "API Available: $($details.APIAvailable)`n" +
                                 "SMC Available: $($details.SMCAvailable)`n" +
                                 "Open Ports: $($details.Ports -join ', ')`n" +
                                 "Designer Version: $($details.DesignerVersion)"
                    [System.Windows.Forms.MessageBox]::Show($detailMsg, "Server Details - $ip",
                        [System.Windows.Forms.MessageBoxButtons]::OK,
                        [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
                } catch {
                    [System.Windows.Forms.MessageBox]::Show("Failed to get details: $_",
                        "Error", [System.Windows.Forms.MessageBoxButtons]::OK,
                        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
                }

                $lblScanStatus.Text = "Ready"
                $lblScanStatus.ForeColor = $script:Theme.TextMuted
            }
        }
    })

    $menuTestConnection = New-Object System.Windows.Forms.ToolStripMenuItem
    $menuTestConnection.Text = "Test Connection"
    $menuTestConnection.Add_Click({
        $selectedRow = $dgvServers.CurrentRow
        if ($selectedRow) {
            $ip = $selectedRow.Cells["IPAddress"].Value
            if ($ip) {
                $lblScanStatus.Text = "Testing connection to $ip..."
                $lblScanStatus.Refresh()

                try {
                    $testResult = Test-DisguiseServer -IPAddress $ip -TimeoutMs 3000
                    $statusText = if ($testResult.IsDisguise) { "Disguise" } elseif ($testResult.Ports.Count -gt 0) { "Online" } else { "Offline" }
                    $selectedRow.Cells["Status"].Value = $statusText
                    $lblScanStatus.Text = "Connection test to $ip complete: $statusText"
                    $lblScanStatus.ForeColor = $script:Theme.Success
                } catch {
                    $lblScanStatus.Text = "Connection test to $ip failed: $_"
                    $lblScanStatus.ForeColor = $script:Theme.Error
                }
            }
        }
    })

    $menuPushProfile = New-Object System.Windows.Forms.ToolStripMenuItem
    $menuPushProfile.Text = "Push Profile"
    $menuPushProfile.Add_Click({
        $selectedRow = $dgvServers.CurrentRow
        if ($selectedRow) {
            $ip = $selectedRow.Cells["IPAddress"].Value
            if ($ip -and $cboProfiles.SelectedItem) {
                $profileName = $cboProfiles.SelectedItem.ToString()
                $confirmResult = [System.Windows.Forms.MessageBox]::Show(
                    "Push profile '$profileName' to $ip?",
                    "Confirm Deployment",
                    [System.Windows.Forms.MessageBoxButtons]::YesNo,
                    [System.Windows.Forms.MessageBoxIcon]::Question)
                if ($confirmResult -eq [System.Windows.Forms.DialogResult]::Yes) {
                    $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Starting push to $ip...`r`n")
                    try {
                        $profileObj = Get-Profile -Name $profileName
                        if ($profileObj) {
                            $pushResult = Push-ProfileToServer -ServerIP $ip -Profile $profileObj
                            if ($pushResult.Success) {
                                $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Push to $ip succeeded.`r`n")
                                $selectedRow.Cells["Status"].Value = "Configured"
                            } else {
                                $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Push to $ip failed: $($pushResult.Message)`r`n")
                            }
                        } else {
                            $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Profile '$profileName' not found.`r`n")
                        }
                    } catch {
                        $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Push to $ip error: $_`r`n")
                        Write-AppLog -Message "Push Profile to $ip failed: $_" -Level 'ERROR'
                    }
                }
            } else {
                [System.Windows.Forms.MessageBox]::Show("Please select a profile first.",
                    "No Profile", [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            }
        }
    })

    $contextMenu.Items.AddRange(@($menuViewDetails, $menuTestConnection, $menuPushProfile))
    $dgvServers.ContextMenuStrip = $contextMenu

    # --- Buttons below the grid ---
    $btnSelectAll = New-StyledButton -Text "Select All" -X 15 -Y 235 -Width 100 -Height 30
    $btnSelectAll.Add_Click({
        foreach ($row in $dgvServers.Rows) {
            $row.Cells["Select"].Value = $true
        }
        $selectedCount = $dgvServers.Rows.Count
        $lblTargetSummary.Text = "$selectedCount server(s) selected"
    })

    $btnDeselectAll = New-StyledButton -Text "Deselect All" -X 125 -Y 235 -Width 110 -Height 30
    $btnDeselectAll.Add_Click({
        foreach ($row in $dgvServers.Rows) {
            $row.Cells["Select"].Value = $false
        }
        $lblTargetSummary.Text = "0 servers selected"
    })

    $btnRefreshServers = New-StyledButton -Text "Refresh" -X 245 -Y 235 -Width 100 -Height 30
    $btnRefreshServers.Add_Click({
        # Re-trigger the last scan if results exist
        if ($script:AppState.LastScanResults.Count -gt 0) {
            $dgvServers.Rows.Clear()
            foreach ($server in $script:AppState.LastScanResults) {
                $statusText = if ($server.IsDisguise) { "Disguise" }
                              elseif ($server.Ports.Count -gt 0) { "Online" }
                              else { "Unreachable" }
                $apiText = if ($server.APIVersion) { $server.APIVersion } else { "N/A" }
                $portsText = if ($server.Ports.Count -gt 0) { $server.Ports -join ", " } else { "None" }
                $responseText = if ($server.ResponseTimeMs -ge 0) { "$($server.ResponseTimeMs) ms" } else { "N/A" }

                [void]$dgvServers.Rows.Add($false, $server.IPAddress, $server.Hostname,
                                            $statusText, $apiText, $portsText, $responseText)
            }
            $lblScanStatus.Text = "Refreshed: $($script:AppState.LastScanResults.Count) server(s)"
            $lblScanStatus.ForeColor = $script:Theme.TextMuted
        }
    })

    $btnViewDetails = New-StyledButton -Text "View Details" -X 355 -Y 235 -Width 120 -Height 30
    $btnViewDetails.Add_Click({
        # Trigger the same action as the context menu "View Details"
        $selectedRow = $dgvServers.CurrentRow
        if ($selectedRow) {
            $ip = $selectedRow.Cells["IPAddress"].Value
            if ($ip) {
                $lblScanStatus.Text = "Testing $ip..."
                $lblScanStatus.Refresh()
                try {
                    $details = Test-DisguiseServer -IPAddress $ip -TimeoutMs 3000
                    $detailMsg = "Server: $ip`n" +
                                 "Hostname: $($details.Hostname)`n" +
                                 "Is Disguise: $($details.IsDisguise)`n" +
                                 "API Available: $($details.APIAvailable)`n" +
                                 "SMC Available: $($details.SMCAvailable)`n" +
                                 "Open Ports: $($details.Ports -join ', ')`n" +
                                 "Designer Version: $($details.DesignerVersion)"
                    [System.Windows.Forms.MessageBox]::Show($detailMsg, "Server Details - $ip",
                        [System.Windows.Forms.MessageBoxButtons]::OK,
                        [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
                } catch {
                    [System.Windows.Forms.MessageBox]::Show("Failed to get details: $_",
                        "Error", [System.Windows.Forms.MessageBoxButtons]::OK,
                        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
                }
                $lblScanStatus.Text = "Ready"
                $lblScanStatus.ForeColor = $script:Theme.TextMuted
            }
        }
    })

    $serversCard.Controls.AddRange(@($dgvServers, $btnSelectAll, $btnDeselectAll,
                                      $btnRefreshServers, $btnViewDetails))

    $scrollContainer.Controls.Add($serversCard)

    # ===================================================================
    # Card 3: Deploy Configuration
    # ===================================================================
    $deployCard = New-StyledCard -Title "Deploy Configuration" -X 20 -Y 560 -Width 900 -Height 250

    # --- Profile selector ---
    $lblProfile = New-StyledLabel -Text "Profile:" -X 15 -Y 48 -FontSize 9
    $profileNames = @()
    try {
        $allProfiles = Get-AllProfiles
        $profileNames = $allProfiles | ForEach-Object { $_.Name }
    } catch {
        Write-AppLog -Message "New-DeployView: Could not load profiles - $_" -Level 'WARN'
    }
    $cboProfiles = New-StyledComboBox -X 80 -Y 45 -Width 250 -Items $profileNames
    if ($cboProfiles.Items.Count -gt 0) {
        $cboProfiles.SelectedIndex = 0
    }

    # --- Target summary label ---
    $lblTargetSummary = New-StyledLabel -Text "0 servers selected" -X 350 -Y 48 -FontSize 9 -IsSecondary

    $deployCard.Controls.AddRange(@($lblProfile, $cboProfiles, $lblTargetSummary))

    # --- Credential section ---
    $lblUsername = New-StyledLabel -Text "Username:" -X 15 -Y 85 -FontSize 9
    $txtUsername = New-StyledTextBox -X 95 -Y 82 -Width 160
    $txtUsername.Text = "Administrator"

    $lblPassword = New-StyledLabel -Text "Password:" -X 270 -Y 85 -FontSize 9
    $txtPassword = New-StyledTextBox -X 345 -Y 82 -Width 160
    $txtPassword.UseSystemPasswordChar = $true

    $chkCurrentCreds = New-StyledCheckBox -Text "Use Current Credentials" -X 525 -Y 83
    $chkCurrentCreds.Add_CheckedChanged({
        $isChecked = $this.Checked
        $txtUsername.Enabled = -not $isChecked
        $txtPassword.Enabled = -not $isChecked
        if ($isChecked) {
            $txtUsername.Text = $env:USERNAME
            $txtPassword.Text = ""
        } else {
            $txtUsername.Text = "Administrator"
        }
    })

    $deployCard.Controls.AddRange(@($lblUsername, $txtUsername, $lblPassword, $txtPassword, $chkCurrentCreds))

    # --- Deploy button ---
    $btnDeploy = New-StyledButton -Text "Deploy to Selected Servers" -X 15 -Y 120 `
        -Width 250 -Height 40 -IsPrimary

    # Deployment progress bar
    $deployProgressBar = New-Object System.Windows.Forms.ProgressBar
    $deployProgressBar.Location = New-Object System.Drawing.Point(280, 125)
    $deployProgressBar.Size = New-Object System.Drawing.Size(600, 22)
    $deployProgressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $deployProgressBar.Minimum = 0
    $deployProgressBar.Maximum = 100
    $deployProgressBar.Value = 0

    $deployCard.Controls.AddRange(@($btnDeploy, $deployProgressBar))

    # --- Deployment log (read-only multi-line textbox) ---
    $txtDeployLog = New-Object System.Windows.Forms.TextBox
    $txtDeployLog.Location = New-Object System.Drawing.Point(15, 160)
    $txtDeployLog.Size = New-Object System.Drawing.Size(870, 75)
    $txtDeployLog.Multiline = $true
    $txtDeployLog.ReadOnly = $true
    $txtDeployLog.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
    $txtDeployLog.BackColor = $script:Theme.InputBackground
    $txtDeployLog.ForeColor = $script:Theme.TextSecondary
    $txtDeployLog.Font = New-Object System.Drawing.Font('Consolas', 9)
    $txtDeployLog.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $txtDeployLog.Text = "[$(Get-Date -Format 'HH:mm:ss')] Deploy log initialized. Select a profile and target servers to begin.`r`n"

    $deployCard.Controls.Add($txtDeployLog)

    $scrollContainer.Controls.Add($deployCard)

    # ===================================================================
    # Event Handlers - Scan Network Button
    # ===================================================================
    $btnScanNetwork.Add_Click({
        $subnet = $txtSubnet.Text.Trim()
        $startIP = 1
        $endIP = 254
        $timeout = 200

        # Validate inputs
        try { $startIP = [int]$txtStartIP.Text.Trim() } catch { $startIP = 1 }
        try { $endIP = [int]$txtEndIP.Text.Trim() } catch { $endIP = 254 }
        try { $timeout = [int]$txtTimeout.Text.Trim() } catch { $timeout = 200 }

        if ([string]::IsNullOrWhiteSpace($subnet)) {
            $subnet = "10.0.0"
        }

        # Disable button during scan
        $btnScanNetwork.Enabled = $false
        $btnQuickScan.Enabled = $false
        $lblScanStatus.Text = "Scanning $subnet.$startIP - $subnet.$endIP ..."
        $lblScanStatus.ForeColor = $script:Theme.Accent
        $lblScanStatus.Refresh()
        $scanProgressBar.Value = 0
        $dgvServers.Rows.Clear()

        try {
            # Run the scan with progress callback
            $progressAction = {
                param($currentIP, $percentComplete, $statusMessage)
                # UI updates must be done via Invoke if cross-thread, but since
                # Find-DisguiseServers runs in the same thread context with runspaces
                # collecting results, we can update controls directly here.
                $scanProgressBar.Value = [Math]::Min(100, $percentComplete)
                $lblScanStatus.Text = $statusMessage
                # Force repaint to show progress
                $scanProgressBar.Refresh()
                $lblScanStatus.Refresh()
                [System.Windows.Forms.Application]::DoEvents()
            }

            $results = Find-DisguiseServers -SubnetBase $subnet -StartIP $startIP `
                -EndIP $endIP -TimeoutMs $timeout -ProgressCallback $progressAction

            # Populate the grid with results
            foreach ($server in $results) {
                $statusText = if ($server.IsDisguise) { "Disguise" }
                              elseif ($server.Ports.Count -gt 0) { "Online" }
                              else { "Unreachable" }
                $apiText = if ($server.APIVersion) { $server.APIVersion } else { "N/A" }
                $portsText = if ($server.Ports.Count -gt 0) { $server.Ports -join ", " } else { "None" }
                $responseText = if ($server.ResponseTimeMs -ge 0) { "$($server.ResponseTimeMs) ms" } else { "N/A" }

                [void]$dgvServers.Rows.Add($false, $server.IPAddress, $server.Hostname,
                                            $statusText, $apiText, $portsText, $responseText)
            }

            # Apply row coloring based on status
            foreach ($row in $dgvServers.Rows) {
                $statusVal = $row.Cells["Status"].Value
                if ($statusVal -eq "Disguise") {
                    $row.Cells["Status"].Style.ForeColor = $script:Theme.Success
                    $row.Cells["Status"].Style.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
                } elseif ($statusVal -eq "Online") {
                    $row.Cells["Status"].Style.ForeColor = $script:Theme.Warning
                }
            }

            $scanProgressBar.Value = 100
            $disguiseCount = ($results | Where-Object { $_.IsDisguise }).Count
            $lblScanStatus.Text = "Scan complete: Found $($results.Count) host(s), $disguiseCount disguise server(s)"
            $lblScanStatus.ForeColor = $script:Theme.Success

        } catch {
            $lblScanStatus.Text = "Scan failed: $_"
            $lblScanStatus.ForeColor = $script:Theme.Error
            Write-AppLog -Message "Scan error: $_" -Level 'ERROR'
        } finally {
            $btnScanNetwork.Enabled = $true
            $btnQuickScan.Enabled = $true
        }
    })

    # ===================================================================
    # Event Handlers - Quick Scan Button (common IPs only)
    # ===================================================================
    $btnQuickScan.Add_Click({
        $subnet = $txtSubnet.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($subnet)) { $subnet = "10.0.0" }

        $btnScanNetwork.Enabled = $false
        $btnQuickScan.Enabled = $false
        $lblScanStatus.Text = "Quick scan on common IPs..."
        $lblScanStatus.ForeColor = $script:Theme.Accent
        $lblScanStatus.Refresh()
        $scanProgressBar.Value = 0
        $dgvServers.Rows.Clear()

        try {
            # Quick scan targets: common disguise server IPs (low range and .10x, .20x patterns)
            $quickTargets = @(1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 30, 50, 100,
                              101, 102, 103, 104, 105, 110, 150, 200, 201, 210, 250, 251, 252, 253, 254)
            $totalTargets = $quickTargets.Count
            $results = [System.Collections.ArrayList]::new()

            for ($idx = 0; $idx -lt $totalTargets; $idx++) {
                $ip = "$subnet.$($quickTargets[$idx])"
                $lblScanStatus.Text = "Quick scan: $ip ($($idx + 1)/$totalTargets)"
                $scanProgressBar.Value = [int](($idx / $totalTargets) * 100)
                $scanProgressBar.Refresh()
                $lblScanStatus.Refresh()
                [System.Windows.Forms.Application]::DoEvents()

                try {
                    $testResult = Test-DisguiseServer -IPAddress $ip -TimeoutMs 500
                    if ($testResult.Ports.Count -gt 0) {
                        $serverObj = [PSCustomObject]@{
                            IPAddress      = $testResult.IPAddress
                            Hostname       = $testResult.Hostname
                            IsDisguise     = $testResult.IsDisguise
                            ResponseTimeMs = 0
                            Ports          = $testResult.Ports
                            APIVersion     = $testResult.DesignerVersion
                        }
                        [void]$results.Add($serverObj)
                    }
                } catch {
                    # Skip unreachable hosts silently
                }
            }

            # Store results in app state
            $script:AppState.LastScanResults = $results.ToArray()

            # Populate the grid
            foreach ($server in $results) {
                $statusText = if ($server.IsDisguise) { "Disguise" }
                              elseif ($server.Ports.Count -gt 0) { "Online" }
                              else { "Unreachable" }
                $apiText = if ($server.APIVersion) { $server.APIVersion } else { "N/A" }
                $portsText = if ($server.Ports.Count -gt 0) { $server.Ports -join ", " } else { "None" }

                [void]$dgvServers.Rows.Add($false, $server.IPAddress, $server.Hostname,
                                            $statusText, $apiText, $portsText, "N/A")
            }

            # Apply row coloring
            foreach ($row in $dgvServers.Rows) {
                $statusVal = $row.Cells["Status"].Value
                if ($statusVal -eq "Disguise") {
                    $row.Cells["Status"].Style.ForeColor = $script:Theme.Success
                    $row.Cells["Status"].Style.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
                } elseif ($statusVal -eq "Online") {
                    $row.Cells["Status"].Style.ForeColor = $script:Theme.Warning
                }
            }

            $scanProgressBar.Value = 100
            $disguiseCount = ($results | Where-Object { $_.IsDisguise }).Count
            $lblScanStatus.Text = "Quick scan complete: Found $($results.Count) host(s), $disguiseCount disguise server(s)"
            $lblScanStatus.ForeColor = $script:Theme.Success

        } catch {
            $lblScanStatus.Text = "Quick scan failed: $_"
            $lblScanStatus.ForeColor = $script:Theme.Error
            Write-AppLog -Message "Quick scan error: $_" -Level 'ERROR'
        } finally {
            $btnScanNetwork.Enabled = $true
            $btnQuickScan.Enabled = $true
        }
    })

    # ===================================================================
    # Event Handlers - Deploy Button
    # ===================================================================
    $btnDeploy.Add_Click({
        # Collect selected server IPs from the grid
        $selectedIPs = [System.Collections.ArrayList]::new()
        foreach ($row in $dgvServers.Rows) {
            if ($row.Cells["Select"].Value -eq $true) {
                [void]$selectedIPs.Add($row.Cells["IPAddress"].Value)
            }
        }

        if ($selectedIPs.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show(
                "No servers selected. Please check the servers you want to deploy to.",
                "No Selection",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            return
        }

        if (-not $cboProfiles.SelectedItem) {
            [System.Windows.Forms.MessageBox]::Show(
                "Please select a profile to deploy.",
                "No Profile",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            return
        }

        # Confirm deployment
        $confirmResult = [System.Windows.Forms.MessageBox]::Show(
            "Deploy profile '$($cboProfiles.SelectedItem)' to $($selectedIPs.Count) server(s)?`n`nTargets:`n$($selectedIPs -join "`n")",
            "Confirm Deployment",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question)

        if ($confirmResult -ne [System.Windows.Forms.DialogResult]::Yes) {
            return
        }

        # Build credential object
        $credential = $null
        if (-not $chkCurrentCreds.Checked) {
            $username = $txtUsername.Text.Trim()
            $password = $txtPassword.Text
            if (-not [string]::IsNullOrWhiteSpace($username) -and -not [string]::IsNullOrWhiteSpace($password)) {
                $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
                $credential = New-Object System.Management.Automation.PSCredential($username, $securePassword)
            }
        }

        # Load the selected profile
        $profileObj = $null
        try {
            $profileObj = Get-Profile -Name $cboProfiles.SelectedItem
        } catch {
            $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] ERROR: Could not load profile '$($cboProfiles.SelectedItem)': $_`r`n")
            return
        }

        if (-not $profileObj) {
            $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] ERROR: Profile '$($cboProfiles.SelectedItem)' not found.`r`n")
            return
        }

        # Disable the deploy button during operation
        $btnDeploy.Enabled = $false
        $deployProgressBar.Value = 0

        $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Starting deployment of '$($profileObj.Name)' to $($selectedIPs.Count) server(s)...`r`n")
        $txtDeployLog.Refresh()

        $totalServers = $selectedIPs.Count
        $currentIdx = 0
        $successCount = 0

        foreach ($serverIP in $selectedIPs) {
            $currentIdx++
            $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] [$currentIdx/$totalServers] Deploying to $serverIP...`r`n")
            $txtDeployLog.Refresh()
            $deployProgressBar.Value = [int](($currentIdx / $totalServers) * 100)
            $deployProgressBar.Refresh()
            [System.Windows.Forms.Application]::DoEvents()

            try {
                $pushParams = @{
                    ServerIP = $serverIP
                    Profile  = $profileObj
                }
                if ($credential) {
                    $pushParams.Credential = $credential
                }

                $pushResult = Push-ProfileToServer @pushParams

                foreach ($step in $pushResult.Steps) {
                    $stepStatus = if ($step.Success) { "OK" } else { "FAILED" }
                    $txtDeployLog.AppendText("    $($step.StepName): $stepStatus - $($step.Message)`r`n")
                }

                if ($pushResult.Success) {
                    $successCount++
                    $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] $serverIP: Deployment SUCCEEDED`r`n")
                } else {
                    $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] $serverIP: Deployment FAILED - $($pushResult.ErrorMessage)`r`n")
                }
            } catch {
                $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] $serverIP: EXCEPTION - $_`r`n")
            }

            $txtDeployLog.Refresh()
            [System.Windows.Forms.Application]::DoEvents()
        }

        $deployProgressBar.Value = 100
        $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Deployment complete: $successCount/$totalServers succeeded.`r`n")
        $txtDeployLog.AppendText("------------------------------------------------------------`r`n")

        # Update app state with the last applied profile name
        $script:AppState.LastAppliedProfile = $profileObj.Name

        $btnDeploy.Enabled = $true
    })

    # ===================================================================
    # Update target summary when checkbox values change in the grid
    # ===================================================================
    $dgvServers.Add_CellValueChanged({
        param($sender, $e)
        if ($e.ColumnIndex -eq 0) {
            # Checkbox column changed - recalculate selected count
            $selectedCount = 0
            foreach ($row in $dgvServers.Rows) {
                if ($row.Cells["Select"].Value -eq $true) {
                    $selectedCount++
                }
            }
            $lblTargetSummary.Text = "$selectedCount server(s) selected"
        }
    })

    # Ensure cell value changes are committed immediately (needed for checkbox columns)
    $dgvServers.Add_CurrentCellDirtyStateChanged({
        if ($this.IsCurrentCellDirty) {
            $this.CommitEdit([System.Windows.Forms.DataGridViewDataErrorContexts]::Commit)
        }
    })

    # ===================================================================
    # Add the scroll container to the content panel
    # ===================================================================
    $ContentPanel.Controls.Add($scrollContainer)
}
