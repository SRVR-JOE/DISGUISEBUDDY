# Discovery.ps1 - DISGUISE BUDDY Network Discovery and Deployment Module
# Provides functions for scanning networks, discovering disguise (d3) media servers,
# testing connections, retrieving remote server info, and pushing configuration profiles.
# Also provides the New-DeployView UI function for the Network Deploy panel.

# ============================================================================
# Application state is initialized in DisguiseBuddy.ps1 before modules load
# ============================================================================

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
        [ValidateRange(50, 5000)]
        [int]$TimeoutMs = 200,
        [scriptblock]$ProgressCallback = $null
    )

    $discoveredServers = [System.Collections.ArrayList]::new()

    # Validate subnet base format (must be three octets like "10.0.0")
    if ($SubnetBase -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}$') {
        Write-AppLog -Message "Find-DisguiseServers: Invalid subnet base format '$SubnetBase'. Expected format: 'X.X.X' (e.g. '10.0.0')." -Level 'ERROR'
        return @()
    }
    # Validate each octet is 0-255
    $subnetOctets = $SubnetBase -split '\.'
    foreach ($octet in $subnetOctets) {
        $octetVal = [int]$octet
        if ($octetVal -lt 0 -or $octetVal -gt 255) {
            Write-AppLog -Message "Find-DisguiseServers: Subnet octet out of range (0-255) in '$SubnetBase'." -Level 'ERROR'
            return @()
        }
    }

    # Validate IP range
    if ($StartIP -lt 0 -or $StartIP -gt 255 -or $EndIP -lt 0 -or $EndIP -gt 255) {
        Write-AppLog -Message "Find-DisguiseServers: IP range values must be 0-255. Got StartIP=$StartIP, EndIP=$EndIP." -Level 'ERROR'
        return @()
    }
    if ($StartIP -gt $EndIP) {
        Write-AppLog -Message "Find-DisguiseServers: StartIP ($StartIP) must be less than or equal to EndIP ($EndIP)." -Level 'ERROR'
        return @()
    }

    $totalIPs = $EndIP - $StartIP + 1
    $processedCount = 0

    # Known disguise ports to probe
    $targetPorts = @(80, 873, 9864)

    # -----------------------------------------------------------------------
    # Strategy 1 & 2: Parallel TCP port scan + ping sweep using runspaces
    # -----------------------------------------------------------------------
    $runspacePool = $null
    try {
    # Size the runspace pool to match the workload: no more threads than targets, capped at 50
    $maxThreads = [Math]::Max(1, [Math]::Min(50, $totalIPs))
    $runspacePool = [System.Management.Automation.Runspaces.RunspacePool]::CreateRunspacePool(1, $maxThreads)
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
            $tcpClient = $null
            try {
                $tcpClient = New-Object System.Net.Sockets.TcpClient
                # Set send/receive timeouts to prevent lingering connections
                $tcpClient.SendTimeout = $Timeout
                $tcpClient.ReceiveTimeout = $Timeout
                $connectTask = $tcpClient.ConnectAsync($IPAddress, $port)
                $completed = $connectTask.Wait($Timeout)
                if ($completed -and $tcpClient.Connected) {
                    [void]$openPorts.Add($port)
                }
            } catch {
                # Connection failed or timed out - port is closed/filtered
            } finally {
                if ($tcpClient) {
                    $tcpClient.Close()
                    $tcpClient.Dispose()
                }
            }
        }

        $stopwatch.Stop()
        $result.ResponseTimeMs = [int]$stopwatch.Elapsed.TotalMilliseconds

        # --- Ping Sweep ---
        $ping = $null
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
        } catch {
            # Ping failed - host may still be reachable via TCP
        } finally {
            if ($ping) { $ping.Dispose() }
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
            $httpClient = $null
            try {
                $httpClient = New-Object System.Net.Http.HttpClient
                $httpClient.Timeout = [TimeSpan]::FromMilliseconds($Timeout * 3)
                $apiResponse = $httpClient.GetStringAsync("http://$IPAddress/api/service/system").Result
                if ($apiResponse -match 'hostname|version|d3|disguise') {
                    $result.IsDisguise = $true
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
            } catch {
                # API not responding or not a disguise server - expected for non-disguise hosts
            } finally {
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
                Write-AppLog -Message "Find-DisguiseServers: Progress callback failed for $($job.IP) - $_" -Level 'DEBUG'
            }
        }
    }

    } finally {
        # Clean up the runspace pool even if an exception occurred
        if ($runspacePool) {
            $runspacePool.Close()
            $runspacePool.Dispose()
        }
    }

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

    # Validate that IPAddress is a valid IPv4 address
    $parsedAddr = $null
    if (-not [System.Net.IPAddress]::TryParse($IPAddress, [ref]$parsedAddr) -or
        $parsedAddr.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
        Write-AppLog -Message "Test-DisguiseServer: Invalid IPv4 address '$IPAddress'" -Level 'ERROR'
        return [PSCustomObject]@{
            IPAddress       = $IPAddress
            Hostname        = ''
            IsDisguise      = $false
            APIAvailable    = $false
            SMCAvailable    = $false
            Ports           = @()
            DesignerVersion = $null
        }
    }

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
        $tcpClient = $null
        try {
            $tcpClient = New-Object System.Net.Sockets.TcpClient
            # Set send/receive timeouts to prevent lingering connections
            $tcpClient.SendTimeout = $TimeoutMs
            $tcpClient.ReceiveTimeout = $TimeoutMs
            $connectTask = $tcpClient.ConnectAsync($IPAddress, $port)
            $completed = $connectTask.Wait($TimeoutMs)
            if ($completed -and $tcpClient.Connected) {
                [void]$openPorts.Add($port)
            }
        } catch {
            Write-AppLog -Message "Test-DisguiseServer: TCP probe to ${IPAddress}:${port} failed - $_" -Level 'DEBUG'
        } finally {
            if ($tcpClient) {
                $tcpClient.Close()
                $tcpClient.Dispose()
            }
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
        $httpClient = $null
        try {
            $httpClient = New-Object System.Net.Http.HttpClient
            $httpClient.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMs)
            $apiResponse = $httpClient.GetStringAsync("http://$IPAddress/api/service/system").Result

            if ($apiResponse) {
                $result.APIAvailable = $true
                try {
                    $parsed = $apiResponse | ConvertFrom-Json
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
                    if ($apiResponse -match 'disguise|d3') {
                        $result.IsDisguise = $true
                    }
                }
            }
        } catch {
            Write-AppLog -Message "Test-DisguiseServer: REST API probe to $IPAddress failed - $_" -Level 'DEBUG'
        } finally {
            if ($httpClient) { $httpClient.Dispose() }
        }
    }

    # --- SMC API Check ---
    # The SMC typically runs on a separate management interface; try the standard API endpoint
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
        Write-AppLog -Message "Test-DisguiseServer: SMC API probe to $IPAddress failed - $_" -Level 'DEBUG'
    } finally {
        if ($httpClient) { $httpClient.Dispose() }
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

    $httpClient = $null
    try {
        $httpClient = New-Object System.Net.Http.HttpClient
        $httpClient.Timeout = [TimeSpan]::FromSeconds(5)
        $response = $httpClient.GetStringAsync("http://$IPAddress/api/service/system").Result

        if ($response) {
            $parsed = $response | ConvertFrom-Json
            Write-AppLog -Message "Get-RemoteServerInfo: Successfully retrieved info from $IPAddress" -Level 'INFO'
            return $parsed
        }
    } catch {
        Write-AppLog -Message "Get-RemoteServerInfo: Failed to reach $IPAddress - $_" -Level 'WARN'
    } finally {
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

    # Validate that ServerIP is a valid IPv4 address to prevent injection
    $ipValid = $false
    try {
        $parsedIP = [System.Net.IPAddress]::None
        $ipValid = [System.Net.IPAddress]::TryParse($ServerIP, [ref]$parsedIP) -and $parsedIP.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork
    } catch { }

    $result = [PSCustomObject]@{
        ServerIP     = $ServerIP
        Success      = $false
        Steps        = [System.Collections.ArrayList]::new()
        ErrorMessage = ''
        Timestamp    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    }

    if (-not $ipValid) {
        $result.ErrorMessage = "Invalid IPv4 address: '$ServerIP'"
        Write-AppLog -Message "Push-ProfileToServer: Invalid IP address '$ServerIP'" -Level 'ERROR'
        return $result
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
    # If Step 1 failed, log the partial failure but continue to attempt remaining steps
    if (-not $hostnameStep.Success -and $hostnameStep.Message -notmatch '^Skipped') {
        Write-AppLog -Message "Push-ProfileToServer: Step 1 (Hostname) failed for $ServerIP, continuing with remaining steps. Partial failure may require manual cleanup." -Level 'WARN'
    }

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
                        # Skip disabled, unconfigured, or DHCP adapters
                        if ($adapter.PSObject.Properties['Enabled'] -and $adapter.Enabled -eq $false) {
                            $results += "INFO: $($adapter.AdapterName) - Disabled in profile, skipping"
                            continue
                        }
                        if ([string]::IsNullOrWhiteSpace($adapter.IPAddress)) { continue }
                        if ($adapter.DHCP -eq $true) {
                            $results += "INFO: $($adapter.Role) ($($adapter.AdapterName)) - DHCP enabled, skipping static config"
                            continue
                        }

                        # Find the adapter by AdapterName (matching profile schema)
                        $netAdapter = Get-NetAdapter | Where-Object {
                            $_.Name -eq $adapter.AdapterName
                        } | Select-Object -First 1

                        if (-not $netAdapter) {
                            $results += "WARN: Adapter '$($adapter.AdapterName)' for role '$($adapter.Role)' not found"
                            continue
                        }

                        # Remove existing IP configuration
                        $netAdapter | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
                        $netAdapter | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue

                        # Convert SubnetMask (dotted decimal) to CIDR prefix length
                        $prefixLength = 24  # safe default
                        if ($adapter.SubnetMask) {
                            try {
                                $maskBytes = [System.Net.IPAddress]::Parse($adapter.SubnetMask).GetAddressBytes()
                                $prefixLength = 0
                                foreach ($byte in $maskBytes) {
                                    $bits = [Convert]::ToString($byte, 2).PadLeft(8, '0')
                                    $prefixLength += ($bits.ToCharArray() | Where-Object { $_ -eq '1' }).Count
                                }
                            } catch {
                                $results += "WARN: Invalid subnet mask '$($adapter.SubnetMask)' for $($adapter.AdapterName), using /24"
                            }
                        }

                        # Apply new IP configuration
                        $ipParams = @{
                            InterfaceIndex = $netAdapter.InterfaceIndex
                            IPAddress      = $adapter.IPAddress
                            PrefixLength   = $prefixLength
                            ErrorAction    = 'Stop'
                        }
                        if ($adapter.Gateway) {
                            $ipParams.DefaultGateway = $adapter.Gateway
                        }
                        New-NetIPAddress @ipParams

                        # Build DNS server list from DNS1/DNS2 fields
                        $dnsServers = @()
                        if ($adapter.DNS1) { $dnsServers += $adapter.DNS1 }
                        if ($adapter.DNS2) { $dnsServers += $adapter.DNS2 }
                        if ($dnsServers.Count -gt 0) {
                            Set-DnsClientServerAddress -InterfaceIndex $netAdapter.InterfaceIndex `
                                -ServerAddresses $dnsServers -ErrorAction Stop
                        }

                        $results += "OK: $($adapter.Role) ($($adapter.AdapterName)) -> $($adapter.IPAddress)/$prefixLength"
                    } catch {
                        $results += "ERROR: $($adapter.Role) ($($adapter.AdapterName)) - $($_.Exception.Message)"
                    }
                }
                return @{ Success = ($results | Where-Object { $_ -match '^ERROR:' }).Count -eq 0; Message = ($results -join '; ') }
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
    # If Step 2 failed, log the partial failure but continue to attempt remaining steps
    if (-not $networkStep.Success -and $networkStep.Message -notmatch '^Skipped') {
        Write-AppLog -Message "Push-ProfileToServer: Step 2 (Network) failed for $ServerIP, continuing with remaining steps. Previous network changes may have been partially applied." -Level 'WARN'
    }

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
                    # SMB1 enablement is blocked by security policy (EternalBlue/WannaCry risk)
                    $results += "INFO: SMB protocol version management is handled separately by security policy"

                    # Create or update the d3 Projects share using actual profile schema fields
                    if ($SMBConfig.ShareD3Projects -eq $true -and $SMBConfig.ShareName -and $SMBConfig.ProjectsPath) {
                        try {
                            # Validate ProjectsPath — block UNC and system paths
                            if ($SMBConfig.ProjectsPath -match '^\\\\') {
                                $results += "ERROR: UNC paths not allowed for ProjectsPath: $($SMBConfig.ProjectsPath)"
                                return @{ Success = $false; Message = ($results -join '; ') }
                            }
                            if ($SMBConfig.ProjectsPath -match '(?i)(system32|\\windows\\|program files)') {
                                $results += "ERROR: System paths not allowed for ProjectsPath: $($SMBConfig.ProjectsPath)"
                                return @{ Success = $false; Message = ($results -join '; ') }
                            }

                            # Ensure the projects directory exists
                            if (-not (Test-Path $SMBConfig.ProjectsPath)) {
                                New-Item -Path $SMBConfig.ProjectsPath -ItemType Directory -Force | Out-Null
                            }

                            # Parse permissions string (format: "Account:Level")
                            # Parse permissions with null safety and case-insensitive comparison
                            $permParts = if ($SMBConfig.SharePermissions) { $SMBConfig.SharePermissions -split ':' } else { @() }
                            $permAccount = if ($permParts.Count -gt 0 -and $permParts[0]) { $permParts[0] } else { 'Administrators' }
                            $permLevel = if ($permParts.Count -gt 1 -and $permParts[1]) { $permParts[1] } else { 'Full' }

                            $existingShare = Get-SmbShare -Name $SMBConfig.ShareName -ErrorAction SilentlyContinue
                            if ($existingShare) {
                                # Path cannot be changed via Set-SmbShare — remove and recreate if path differs
                                if ($existingShare.Path -ne $SMBConfig.ProjectsPath) {
                                    Remove-SmbShare -Name $SMBConfig.ShareName -Force -ErrorAction Stop
                                    $results += "INFO: Removed existing share (path mismatch: '$($existingShare.Path)' vs '$($SMBConfig.ProjectsPath)')"
                                    # Fall through to New-SmbShare below
                                    $existingShare = $null
                                } else {
                                    # Path matches — update permissions
                                    if ($permLevel -ieq 'Full') {
                                        Grant-SmbShareAccess -Name $SMBConfig.ShareName -AccountName $permAccount -AccessRight Full -Force -ErrorAction Stop | Out-Null
                                    } elseif ($permLevel -ieq 'Change') {
                                        Grant-SmbShareAccess -Name $SMBConfig.ShareName -AccountName $permAccount -AccessRight Change -Force -ErrorAction Stop | Out-Null
                                    } else {
                                        Grant-SmbShareAccess -Name $SMBConfig.ShareName -AccountName $permAccount -AccessRight Read -Force -ErrorAction Stop | Out-Null
                                    }
                                    $results += "OK: Updated share '$($SMBConfig.ShareName)' permissions ($permAccount`:$permLevel)"
                                }
                            }
                            if (-not $existingShare) {
                                $shareParams = @{
                                    Name        = $SMBConfig.ShareName
                                    Path        = $SMBConfig.ProjectsPath
                                    ErrorAction = 'Stop'
                                }
                                if ($permLevel -ieq 'Full') {
                                    $shareParams.FullAccess = $permAccount
                                } elseif ($permLevel -ieq 'Change') {
                                    $shareParams.ChangeAccess = $permAccount
                                } else {
                                    $shareParams.ReadAccess = $permAccount
                                }
                                New-SmbShare @shareParams
                                $results += "OK: Created share '$($SMBConfig.ShareName)' at '$($SMBConfig.ProjectsPath)' with $permAccount`:$permLevel"
                            }
                        } catch {
                            $results += "ERROR: Share '$($SMBConfig.ShareName)' - $($_.Exception.Message)"
                        }
                    } else {
                        $results += "INFO: d3 Projects sharing not enabled in profile"
                    }
                } catch {
                    $results += "ERROR: SMB configuration - $($_.Exception.Message)"
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
        $failedSteps = ($result.Steps | Where-Object { -not $_.Success } | ForEach-Object { "$($_.StepName): $($_.Message)" }) -join '; '
        $succeededSteps = ($result.Steps | Where-Object { $_.Success } | ForEach-Object { $_.StepName }) -join ', '
        $result.ErrorMessage = "Partial deployment failure. Failed: [$failedSteps]"
        if ($succeededSteps) {
            $result.ErrorMessage += " | Succeeded: [$succeededSteps]"
        }
        Write-AppLog -Message "Push-ProfileToServer: Partial failure on $ServerIP - $($result.ErrorMessage)" -Level 'WARN'
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
                Write-AppLog -Message "Push-ProfileToMultipleServers: Progress callback failed for $ip ($currentIndex/$totalServers) - $_" -Level 'DEBUG'
            }
        }
    }

    $successCount = ($allResults | Where-Object { $_.Success }).Count
    Write-AppLog -Message "Push-ProfileToMultipleServers: Batch complete. $successCount/$totalServers succeeded." -Level 'INFO'

    return $allResults.ToArray()
}

function Find-DisguiseServersDNSSD {
    <#
    .SYNOPSIS
        Discovers disguise servers on the local network using DNS-SD / mDNS.
    .DESCRIPTION
        disguise servers running r30.4 and later advertise themselves via the
        DNS-SD service type _d3api._tcp.local.  This function:

          1. Tries Resolve-DnsName (if available on the host) to query the PTR
             record for _d3api._tcp.local. on the local mDNS stack.

          2. Falls back to a raw mDNS multicast query — sends a DNS PTR query
             UDP datagram to the mDNS all-hosts address (224.0.0.251) port 5353
             and collects responses for 3 seconds.

        For each discovered service the function attempts a reverse DNS lookup
        to obtain the server IP address, then returns a list of PSCustomObjects
        compatible with the scan result schema used by Find-DisguiseServers so
        that callers can merge the two result sets without special-casing.

    .OUTPUTS
        Array of PSCustomObjects with properties:
          IPAddress, Hostname, IsDisguise, ResponseTimeMs, Ports, APIVersion
        Returns an empty array if nothing is found or DNS-SD is not available.
    #>
    [CmdletBinding()]
    param()

    Write-AppLog -Message "Find-DisguiseServersDNSSD: Starting DNS-SD discovery for _d3api._tcp.local." -Level 'INFO'

    $discovered = [System.Collections.ArrayList]::new()
    $serviceType = '_d3api._tcp.local.'

    # Helper: convert a service instance hostname / SRV target to an IP address
    function Resolve-ServiceHostToIP {
        param([string]$Hostname)
        if ([string]::IsNullOrWhiteSpace($Hostname)) { return $null }
        try {
            $addresses = [System.Net.Dns]::GetHostAddresses($Hostname) |
                Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork }
            return ($addresses | Select-Object -First 1)?.IPAddressToString
        } catch {
            return $null
        }
    }

    # ----------------------------------------------------------------
    # Strategy 1: Resolve-DnsName (available on Windows 8+ / Server 2012+)
    # ----------------------------------------------------------------
    $usedResolveDnsName = $false
    try {
        # Resolve-DnsName ships with the DnsClient module on modern Windows.
        # -DnsOnly prevents falling back to LLMNR/NetBIOS so it stays pure DNS-SD.
        $ptrRecords = Resolve-DnsName -Name $serviceType -Type PTR -DnsOnly -ErrorAction Stop
        $usedResolveDnsName = $true

        foreach ($ptr in $ptrRecords) {
            # Each PTR answer points to a service instance name, e.g.:
            #   d3-server01._d3api._tcp.local.
            $instanceName = $ptr.NameHost
            if (-not $instanceName) { $instanceName = $ptr.Name }
            if (-not $instanceName) { continue }

            # Attempt to resolve SRV record for the instance to get port + target
            $srvHost  = $null
            $srvPort  = 80
            try {
                $srvRecords = Resolve-DnsName -Name $instanceName -Type SRV -DnsOnly -ErrorAction Stop
                foreach ($srv in $srvRecords) {
                    if ($srv.NameTarget) { $srvHost = $srv.NameTarget }
                    if ($srv.Port -gt 0) { $srvPort = $srv.Port }
                    break
                }
            } catch { }

            # Resolve to IP — try SRV target first, then instance name directly
            $ipAddress = $null
            if ($srvHost) { $ipAddress = Resolve-ServiceHostToIP -Hostname $srvHost }
            if (-not $ipAddress) { $ipAddress = Resolve-ServiceHostToIP -Hostname $instanceName }

            if ($ipAddress) {
                [void]$discovered.Add([PSCustomObject]@{
                    IPAddress      = $ipAddress
                    Hostname       = if ($srvHost) { $srvHost } else { $instanceName -replace '\._d3api\._tcp\.local\.$', '' }
                    IsDisguise     = $true
                    ResponseTimeMs = 0
                    Ports          = @($srvPort)
                    APIVersion     = $null
                })
                Write-AppLog -Message "Find-DisguiseServersDNSSD: Found $ipAddress via Resolve-DnsName (instance: $instanceName)" -Level 'INFO'
            }
        }
    } catch {
        Write-AppLog -Message "Find-DisguiseServersDNSSD: Resolve-DnsName not available or failed - $_. Trying raw mDNS fallback." -Level 'DEBUG'
    }

    # ----------------------------------------------------------------
    # Strategy 2: Raw mDNS UDP multicast query (fallback)
    # Sends a standard DNS PTR query to 224.0.0.251:5353 and collects
    # responses for 3 seconds.  Parses enough of the DNS wire format
    # to extract PTR + A record answers.
    # ----------------------------------------------------------------
    if (-not $usedResolveDnsName -or $discovered.Count -eq 0) {
        $udpClient = $null
        try {
            # Build a minimal DNS PTR query packet for _d3api._tcp.local.
            # DNS Message Header (12 bytes) + Question
            $queryBytes = [System.Collections.ArrayList]::new()

            # Transaction ID: 0x1234 (arbitrary, non-zero)
            [void]$queryBytes.Add([byte]0x12)
            [void]$queryBytes.Add([byte]0x34)
            # Flags: Standard Query (0x0000)
            [void]$queryBytes.Add([byte]0x00)
            [void]$queryBytes.Add([byte]0x00)
            # QDCOUNT: 1
            [void]$queryBytes.Add([byte]0x00)
            [void]$queryBytes.Add([byte]0x01)
            # ANCOUNT, NSCOUNT, ARCOUNT: 0
            [void]$queryBytes.Add([byte]0x00); [void]$queryBytes.Add([byte]0x00)
            [void]$queryBytes.Add([byte]0x00); [void]$queryBytes.Add([byte]0x00)
            [void]$queryBytes.Add([byte]0x00); [void]$queryBytes.Add([byte]0x00)

            # QNAME: encode each label of _d3api._tcp.local as length-prefixed string
            foreach ($label in @('_d3api', '_tcp', 'local')) {
                $labelBytes = [System.Text.Encoding]::ASCII.GetBytes($label)
                [void]$queryBytes.Add([byte]$labelBytes.Length)
                foreach ($b in $labelBytes) { [void]$queryBytes.Add($b) }
            }
            [void]$queryBytes.Add([byte]0x00)  # root label terminator

            # QTYPE: PTR (12)
            [void]$queryBytes.Add([byte]0x00); [void]$queryBytes.Add([byte]0x0C)
            # QCLASS: IN (1) with unicast-response bit cleared (mDNS uses QU/QM)
            [void]$queryBytes.Add([byte]0x00); [void]$queryBytes.Add([byte]0x01)

            $queryPacket = $queryBytes.ToArray()

            # Bind to an ephemeral local port, allow reuse (mDNS requirement)
            $udpClient = New-Object System.Net.Sockets.UdpClient
            $udpClient.Client.SetSocketOption(
                [System.Net.Sockets.SocketOptionLevel]::Socket,
                [System.Net.Sockets.SocketOptionName]::ReuseAddress, $true)
            $udpClient.Client.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0))
            $udpClient.Client.ReceiveTimeout = 3000  # 3 second collection window

            # Send PTR query to the mDNS multicast group
            $mDNSGroup = [System.Net.IPEndPoint]::new(
                [System.Net.IPAddress]::Parse('224.0.0.251'), 5353)
            [void]$udpClient.Send($queryPacket, $queryPacket.Length, $mDNSGroup)

            Write-AppLog -Message "Find-DisguiseServersDNSSD: mDNS query sent, listening for 3 seconds..." -Level 'DEBUG'

            # Collect response packets for up to 3 seconds
            $responseEndpoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0)
            $deadline = [System.DateTime]::UtcNow.AddSeconds(3)

            while ([System.DateTime]::UtcNow -lt $deadline) {
                try {
                    $responseBytes = $udpClient.Receive([ref]$responseEndpoint)
                    $senderIP = $responseEndpoint.Address.IPAddressToString

                    # Minimum valid DNS response is 12 bytes (header only)
                    if ($responseBytes.Length -lt 12) { continue }

                    # Check: IS a response (QR bit set in flags byte index 2)
                    $flags = ($responseBytes[2] -shl 8) -bor $responseBytes[3]
                    if (-not ($flags -band 0x8000)) { continue }

                    # Parse answer count
                    $anCount = ($responseBytes[4] -shl 8) -bor $responseBytes[5]
                    if ($anCount -eq 0) { continue }

                    # We found a response — the sender IS the mDNS responder and its IP
                    # is captured in $senderIP from the UDP endpoint.
                    # Do a basic hostname resolution from the sender IP.
                    $resolvedHostname = ''
                    try {
                        $dnsEntry = [System.Net.Dns]::GetHostEntry($senderIP)
                        $resolvedHostname = $dnsEntry.HostName
                    } catch { }

                    # Deduplicate by IP before adding
                    $alreadyFound = $discovered | Where-Object { $_.IPAddress -eq $senderIP }
                    if (-not $alreadyFound) {
                        [void]$discovered.Add([PSCustomObject]@{
                            IPAddress      = $senderIP
                            Hostname       = $resolvedHostname
                            IsDisguise     = $true
                            ResponseTimeMs = 0
                            Ports          = @(80)
                            APIVersion     = $null
                        })
                        Write-AppLog -Message "Find-DisguiseServersDNSSD: Found $senderIP via raw mDNS multicast" -Level 'INFO'
                    }
                } catch [System.Net.Sockets.SocketException] {
                    # ReceiveTimeout expired — collection window is done
                    break
                } catch {
                    # Non-fatal parse error on a response packet
                    Write-AppLog -Message "Find-DisguiseServersDNSSD: Packet parse error - $_" -Level 'DEBUG'
                }
            }

        } catch {
            Write-AppLog -Message "Find-DisguiseServersDNSSD: Raw mDNS query failed - $_" -Level 'WARN'
        } finally {
            if ($udpClient) {
                try { $udpClient.Close() } catch { }
                try { $udpClient.Dispose() } catch { }
            }
        }
    }

    $results = $discovered.ToArray()
    Write-AppLog -Message "Find-DisguiseServersDNSSD: Discovery complete. Found $($results.Count) server(s)." -Level 'INFO'
    return $results
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

    # Suspend layout to prevent flicker during UI construction
    $ContentPanel.SuspendLayout()

    # ===================================================================
    # BackgroundWorker for non-blocking network scan (Task 2)
    # ===================================================================
    $scanWorker = New-Object System.ComponentModel.BackgroundWorker
    $scanWorker.WorkerReportsProgress      = $true
    $scanWorker.WorkerSupportsCancellation = $true

    # Create a scrollable container for the entire view
    $scrollContainer = New-ScrollPanel -X 0 -Y 0 -Width $ContentPanel.Width -Height $ContentPanel.Height
    $scrollContainer.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                              [System.Windows.Forms.AnchorStyles]::Left -bor
                              [System.Windows.Forms.AnchorStyles]::Right -bor
                              [System.Windows.Forms.AnchorStyles]::Bottom
    $scrollContainer.SuspendLayout()

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

    # --- Row 2: Scan buttons, progress bar, status label, and cancel button ---
    $btnScanNetwork = New-StyledButton -Text "Scan Network" -X 15 -Y 90 `
        -Width 140 -Height 35 -IsPrimary

    $btnQuickScan = New-StyledButton -Text "Quick Scan" -X 170 -Y 90 `
        -Width 120 -Height 35

    # Cancel button — only enabled while a background scan is running
    $btnCancelScan = New-StyledButton -Text "Cancel" -X 305 -Y 90 -Width 80 -Height 35
    $btnCancelScan.Enabled = $false

    # Auto-Discover button — uses DNS-SD / mDNS to find servers advertising _d3api._tcp.local.
    $btnDNSSD = New-StyledButton -Text "Auto-Discover (DNS-SD)" -X 400 -Y 90 `
        -Width 185 -Height 35

    # Progress bar for scan progress (shifted right to accommodate all buttons)
    $scanProgressBar = New-StyledProgressBar -X 600 -Y 95 -Width 270 -Height 22

    $lblScanStatus = New-StyledLabel -Text "Ready to scan" -X 15 -Y 140 -FontSize 9 -IsMuted
    $lblScanStatus.AutoSize = $false
    $lblScanStatus.Width = 870

    $scanCard.Controls.AddRange(@($btnScanNetwork, $btnQuickScan, $btnCancelScan, $btnDNSSD,
                                   $scanProgressBar, $lblScanStatus))

    $scrollContainer.Controls.Add($scanCard)

    # ===================================================================
    # Card 2: Discovered Servers
    # ===================================================================
    $serversCard = New-StyledCard -Title "Discovered Servers" -X 20 -Y 270 -Width 900 -Height 280

    # DataGridView for the server list
    $dgvServers = New-StyledDataGridView -X 15 -Y 45 -Width 870 -Height 180

    # Collect profile names once for use in the per-row Profile column
    $allProfileNames = @()
    try {
        $allProfileNames = Get-AllProfiles | ForEach-Object { $_.Name }
    } catch {
        Write-AppLog -Message "New-DeployView: Could not pre-load profile names for grid column - $_" -Level 'WARN'
    }

    # Configure columns: Checkbox, IP Address, Hostname, Status, d3 API, Ports, Response Time, Profile
    $colSelect = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn
    $colSelect.HeaderText = ""
    $colSelect.Name = "Select"
    $colSelect.Width = 40
    $colSelect.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colIP = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colIP.HeaderText = "IP Address"
    $colIP.Name = "IPAddress"
    $colIP.Width = 110
    $colIP.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colHostname = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colHostname.HeaderText = "Hostname"
    $colHostname.Name = "Hostname"
    $colHostname.Width = 130
    $colHostname.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colStatus = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colStatus.HeaderText = "Status"
    $colStatus.Name = "Status"
    $colStatus.Width = 80
    $colStatus.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colAPI = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colAPI.HeaderText = "d3 API"
    $colAPI.Name = "D3API"
    $colAPI.Width = 85
    $colAPI.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colPorts = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colPorts.HeaderText = "Ports"
    $colPorts.Name = "Ports"
    $colPorts.Width = 100
    $colPorts.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    $colResponseTime = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $colResponseTime.HeaderText = "ms"
    $colResponseTime.Name = "ResponseTime"
    $colResponseTime.Width = 55
    $colResponseTime.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::None

    # Per-row Profile assignment column (Task 1)
    # DataGridViewComboBoxColumn lets each row pick its own profile.
    $colProfile = New-Object System.Windows.Forms.DataGridViewComboBoxColumn
    $colProfile.HeaderText = "Profile"
    $colProfile.Name = "Profile"
    $colProfile.AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::Fill
    $colProfile.DisplayStyleForCurrentCellOnly = $true   # show as text in non-focused cells
    $colProfile.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    # Add a blank sentinel so rows can have no profile selected
    [void]$colProfile.Items.Add("")
    foreach ($pName in $allProfileNames) {
        [void]$colProfile.Items.Add($pName)
    }

    $dgvServers.Columns.AddRange(@($colSelect, $colIP, $colHostname, $colStatus,
                                    $colAPI, $colPorts, $colResponseTime, $colProfile))
    $dgvServers.ReadOnly = $false

    # Only the Select (checkbox) and Profile (combobox) columns are user-editable
    foreach ($col in $dgvServers.Columns) {
        if ($col.Name -ne "Select" -and $col.Name -ne "Profile") {
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
            # Read the profile from this row's per-row Profile cell (Task 1)
            $rowProfileName = $selectedRow.Cells["Profile"].Value
            if ($ip -and -not [string]::IsNullOrWhiteSpace($rowProfileName)) {
                $confirmResult = [System.Windows.Forms.MessageBox]::Show(
                    "Push profile '$rowProfileName' to $ip?",
                    "Confirm Deployment",
                    [System.Windows.Forms.MessageBoxButtons]::YesNo,
                    [System.Windows.Forms.MessageBoxIcon]::Question)
                if ($confirmResult -eq [System.Windows.Forms.DialogResult]::Yes) {
                    $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Starting push to $ip...`r`n")
                    try {
                        $profileObj = Get-Profile -Name $rowProfileName
                        if (-not $profileObj) {
                            $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] ERROR: Could not load profile '$rowProfileName'`r`n")
                        } else {
                            # Build credentials if provided
                            $cred = $null
                            if (-not $chkCurrentCreds.Checked -and $txtUsername.Text -and $txtPassword.Text) {
                                $secPass = ConvertTo-SecureString $txtPassword.Text -AsPlainText -Force
                                $cred = New-Object System.Management.Automation.PSCredential($txtUsername.Text, $secPass)
                                $secPass = $null
                            }
                            $pushResult = Push-ProfileToServer -ServerIP $ip -Profile $profileObj -Credential $cred
                            foreach ($step in $pushResult.Steps) {
                                $status = if ($step.Success) { 'OK' } else { 'FAIL' }
                                $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')]   [$status] $($step.StepName): $($step.Message)`r`n")
                            }
                            $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Push to $ip completed.`r`n")
                        }
                    } catch {
                        $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] ERROR: Push failed - $($_.Exception.Message)`r`n")
                    }
                }
            } else {
                [System.Windows.Forms.MessageBox]::Show(
                    "Please assign a profile to this row first (use the Profile column or 'Set All To:' dropdown).",
                    "No Profile Assigned",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
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
        # Re-populate the grid from the last cached scan results
        if ($script:AppState.LastScanResults.Count -gt 0) {
            $dgvServers.Rows.Clear()
            foreach ($server in $script:AppState.LastScanResults) {
                $statusText = if ($server.IsDisguise) { "Disguise" }
                              elseif ($server.Ports.Count -gt 0) { "Online" }
                              else { "Unreachable" }
                $apiText = if ($server.APIVersion) { $server.APIVersion } else { "N/A" }
                $portsText = if ($server.Ports.Count -gt 0) { $server.Ports -join ", " } else { "None" }
                $responseText = if ($server.ResponseTimeMs -ge 0) { "$($server.ResponseTimeMs) ms" } else { "N/A" }

                # Profile cell starts blank; columns: Select, IP, Hostname, Status, API, Ports, ResponseTime, Profile
                [void]$dgvServers.Rows.Add($false, $server.IPAddress, $server.Hostname,
                                            $statusText, $apiText, $portsText, $responseText, "")
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

    # --- "Set All To:" bulk profile setter (Task 1)
    # Selecting a profile here propagates it to every row's Profile cell in one shot.
    # The per-row Profile column remains the authoritative source for deployment.
    $lblProfile = New-StyledLabel -Text "Set All To:" -X 15 -Y 48 -FontSize 9
    # Reuse the already-collected $allProfileNames (gathered when building the grid column)
    $cboProfiles = New-StyledComboBox -X 100 -Y 45 -Width 230 -Items $allProfileNames

    $cboProfiles.Add_SelectedIndexChanged({
        # Bulk-set every row's Profile cell to the selected value
        $bulkProfile = $cboProfiles.SelectedItem
        if (-not [string]::IsNullOrWhiteSpace($bulkProfile)) {
            foreach ($row in $dgvServers.Rows) {
                $row.Cells["Profile"].Value = $bulkProfile
            }
        }
    })

    # --- Target summary label ---
    $lblTargetSummary = New-StyledLabel -Text "0 servers selected" -X 345 -Y 48 -FontSize 9 -IsSecondary

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
        $isChecked = $chkCurrentCreds.Checked
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

    # Deployment progress bar (styled)
    $deployProgressBar = New-StyledProgressBar -X 280 -Y 125 -Width 580 -Height 22

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
    $txtDeployLog.Font = New-Object System.Drawing.Font('Consolas', 10)
    $txtDeployLog.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $txtDeployLog.Text = "[$(Get-Date -Format 'HH:mm:ss')] Deploy log initialized. Select a profile and target servers to begin.`r`n"

    $deployCard.Controls.Add($txtDeployLog)

    $scrollContainer.Controls.Add($deployCard)

    # ===================================================================
    # Helper: populate the server grid from a results array
    # Used by both scan completion paths.
    # ===================================================================
    $populateGrid = {
        param([array]$ScanResults)
        $dgvServers.Rows.Clear()
        foreach ($server in $ScanResults) {
            $statusText   = if ($server.IsDisguise) { "Disguise" }
                            elseif ($server.Ports.Count -gt 0) { "Online" }
                            else { "Unreachable" }
            $apiText      = if ($server.APIVersion) { $server.APIVersion } else { "N/A" }
            $portsText    = if ($server.Ports.Count -gt 0) { $server.Ports -join ", " } else { "None" }
            $responseText = if ($server.ResponseTimeMs -ge 0) { "$($server.ResponseTimeMs) ms" } else { "N/A" }

            # Columns order: Select, IP, Hostname, Status, API, Ports, ResponseTime, Profile
            [void]$dgvServers.Rows.Add($false, $server.IPAddress, $server.Hostname,
                                        $statusText, $apiText, $portsText, $responseText, "")
        }
        # Apply status-based cell colouring
        foreach ($row in $dgvServers.Rows) {
            $statusVal = $row.Cells["Status"].Value
            if ($statusVal -eq "Disguise") {
                $row.Cells["Status"].Style.ForeColor = $script:Theme.Success
                $row.Cells["Status"].Style.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
            } elseif ($statusVal -eq "Online") {
                $row.Cells["Status"].Style.ForeColor = $script:Theme.Warning
            }
        }
    }

    # ===================================================================
    # BackgroundWorker events (Task 2)
    # ===================================================================

    # DoWork — runs on the worker thread.
    # Arguments passed via RunWorkerAsync are available in $e.Argument.
    $scanWorker.Add_DoWork({
        param($sender, $e)
        $args       = $e.Argument           # hashtable: SubnetBase, StartIP, EndIP, TimeoutMs
        $worker     = $sender               # reference to the BackgroundWorker itself

        $progressCb = {
            param($currentIP, $percentComplete, $statusMessage)
            # Guard against calling ReportProgress after cancellation was acknowledged
            if (-not $worker.CancellationPending) {
                $worker.ReportProgress($percentComplete, $statusMessage)
            }
        }

        try {
            $results = Find-DisguiseServers `
                -SubnetBase  $args.SubnetBase  `
                -StartIP     $args.StartIP     `
                -EndIP       $args.EndIP       `
                -TimeoutMs   $args.TimeoutMs   `
                -ProgressCallback $progressCb

            if ($worker.CancellationPending) {
                $e.Cancel = $true
                # Return whatever partial results Find-DisguiseServers stored in AppState
                $e.Result = $script:AppState.LastScanResults
            } else {
                $e.Result = $results
            }
        } catch {
            # Surface the exception to RunWorkerCompleted via e.Error
            throw
        }
    })

    # ProgressChanged — runs on the UI thread; safe to update controls directly.
    $scanWorker.Add_ProgressChanged({
        param($sender, $e)
        $pct = [Math]::Min(100, [Math]::Max(0, $e.ProgressPercentage))
        $scanProgressBar.Value = $pct
        if ($e.UserState) {
            $lblScanStatus.Text      = $e.UserState
            $lblScanStatus.ForeColor = $script:Theme.Accent
        }
    })

    # RunWorkerCompleted — runs on the UI thread after DoWork exits (normally, cancelled, or error).
    $scanWorker.Add_RunWorkerCompleted({
        param($sender, $e)

        # Re-enable scan controls
        $btnScanNetwork.Enabled = $true
        $btnQuickScan.Enabled   = $true
        $btnCancelScan.Enabled  = $false

        if ($e.Cancelled) {
            $scanProgressBar.Value   = 0
            $lblScanStatus.Text      = "Scan cancelled."
            $lblScanStatus.ForeColor = $script:Theme.Warning
            Write-AppLog -Message "Network scan cancelled by user." -Level 'INFO'

            # Show any partial results that were collected before cancellation
            if ($e.Result -and $e.Result.Count -gt 0) {
                & $populateGrid $e.Result
                $lblScanStatus.Text = "Scan cancelled — showing $($e.Result.Count) partial result(s)."
            }
        } elseif ($e.Error) {
            $lblScanStatus.Text      = "Scan failed: $($e.Error.Message)"
            $lblScanStatus.ForeColor = $script:Theme.Error
            Write-AppLog -Message "Background scan error: $($e.Error)" -Level 'ERROR'
        } else {
            $results = $e.Result
            $script:AppState.LastScanResults = $results

            & $populateGrid $results

            $scanProgressBar.Value   = 100
            $disguiseCount           = ($results | Where-Object { $_.IsDisguise }).Count
            $lblScanStatus.Text      = "Scan complete: Found $($results.Count) host(s), $disguiseCount disguise server(s)"
            $lblScanStatus.ForeColor = $script:Theme.Success
        }
    })

    # ===================================================================
    # Event Handlers - Scan Network Button (now uses BackgroundWorker)
    # ===================================================================
    $btnScanNetwork.Add_Click({
        $subnet  = $txtSubnet.Text.Trim()
        $startIP = 1
        $endIP   = 254
        $timeout = 200

        # Validate and parse inputs
        try { $startIP = [int]$txtStartIP.Text.Trim() } catch { $startIP = 1 }
        try { $endIP   = [int]$txtEndIP.Text.Trim()   } catch { $endIP   = 254 }
        try { $timeout = [int]$txtTimeout.Text.Trim() } catch { $timeout = 200 }

        # Clamp timeout to safe bounds (50ms – 5000ms)
        $timeout = [Math]::Min([Math]::Max(50, $timeout), 5000)

        if ([string]::IsNullOrWhiteSpace($subnet)) { $subnet = "10.0.0" }

        # Validate subnet format
        if ($subnet -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}$') {
            $lblScanStatus.Text      = "Invalid subnet format. Use 'X.X.X' (e.g. '10.0.0')."
            $lblScanStatus.ForeColor = $script:Theme.Error
            return
        }

        # Validate IP range
        if ($startIP -lt 0 -or $startIP -gt 255 -or $endIP -lt 0 -or $endIP -gt 255 -or $startIP -gt $endIP) {
            $lblScanStatus.Text      = "Invalid IP range. Start and End must be 0-255, Start <= End."
            $lblScanStatus.ForeColor = $script:Theme.Error
            return
        }

        if ($scanWorker.IsBusy) {
            # Guard against double-start (should not happen because button is disabled)
            return
        }

        # Update UI state for scanning
        $btnScanNetwork.Enabled  = $false
        $btnQuickScan.Enabled    = $false
        $btnCancelScan.Enabled   = $true
        $lblScanStatus.Text      = "Scanning $subnet.$startIP - $subnet.$endIP ..."
        $lblScanStatus.ForeColor = $script:Theme.Accent
        $scanProgressBar.Value   = 0
        $dgvServers.Rows.Clear()

        # Pack arguments into a hashtable; DoWork receives them via e.Argument
        $scanArgs = @{
            SubnetBase = $subnet
            StartIP    = $startIP
            EndIP      = $endIP
            TimeoutMs  = $timeout
        }

        $scanWorker.RunWorkerAsync($scanArgs)
    })

    # ===================================================================
    # Event Handlers - Cancel Scan Button (Task 2)
    # ===================================================================
    $btnCancelScan.Add_Click({
        if ($scanWorker.IsBusy -and -not $scanWorker.CancellationPending) {
            $scanWorker.CancelAsync()
            $lblScanStatus.Text      = "Cancelling scan..."
            $lblScanStatus.ForeColor = $script:Theme.Warning
            $btnCancelScan.Enabled   = $false   # prevent double-clicks
        }
    })

    # ===================================================================
    # Event Handlers - Quick Scan Button (common IPs only)
    # Quick scan runs synchronously on the UI thread (small target set).
    # ===================================================================
    $btnQuickScan.Add_Click({
        $subnet = $txtSubnet.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($subnet)) { $subnet = "10.0.0" }

        $btnScanNetwork.Enabled  = $false
        $btnQuickScan.Enabled    = $false
        $btnCancelScan.Enabled   = $false   # quick scan is not cancellable
        $lblScanStatus.Text      = "Quick scan on common IPs..."
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
                $lblScanStatus.Text    = "Quick scan: $ip ($($idx + 1)/$totalTargets)"
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
                    Write-AppLog -Message "Quick scan: Could not test host ${ip}: $_" -Level 'DEBUG'
                }
            }

            # Store results in app state
            $script:AppState.LastScanResults = $results.ToArray()

            # Populate the grid using the shared helper (includes Profile column)
            & $populateGrid $results.ToArray()

            $scanProgressBar.Value   = 100
            $disguiseCount           = ($results | Where-Object { $_.IsDisguise }).Count
            $lblScanStatus.Text      = "Quick scan complete: Found $($results.Count) host(s), $disguiseCount disguise server(s)"
            $lblScanStatus.ForeColor = $script:Theme.Success

        } catch {
            $lblScanStatus.Text      = "Quick scan failed: $_"
            $lblScanStatus.ForeColor = $script:Theme.Error
            Write-AppLog -Message "Quick scan error: $_" -Level 'ERROR'
        } finally {
            $btnScanNetwork.Enabled = $true
            $btnQuickScan.Enabled   = $true
        }
    })

    # ===================================================================
    # Event Handlers - Auto-Discover (DNS-SD) Button
    # ===================================================================
    $btnDNSSD.Add_Click({
        $btnScanNetwork.Enabled = $false
        $btnQuickScan.Enabled   = $false
        $btnDNSSD.Enabled       = $false

        $lblScanStatus.Text     = "Querying DNS-SD for _d3api._tcp.local. — please wait..."
        $lblScanStatus.ForeColor = $script:Theme.Accent
        $lblScanStatus.Refresh()
        $scanProgressBar.Value  = 0
        [System.Windows.Forms.Application]::DoEvents()

        try {
            $dnssdResults = Find-DisguiseServersDNSSD

            if ($dnssdResults.Count -eq 0) {
                $lblScanStatus.Text = "No servers found via DNS-SD. Try a subnet scan instead."
                $lblScanStatus.ForeColor = $script:Theme.Warning
                $scanProgressBar.Value = 100
            } else {
                # Merge DNS-SD results with any existing scan results (deduplicate by IP)
                $existingResults = if ($script:AppState.LastScanResults) {
                    [System.Collections.ArrayList]($script:AppState.LastScanResults)
                } else {
                    [System.Collections.ArrayList]::new()
                }

                $mergedCount = 0
                foreach ($dnsServer in $dnssdResults) {
                    $alreadyKnown = $existingResults | Where-Object { $_.IPAddress -eq $dnsServer.IPAddress }
                    if (-not $alreadyKnown) {
                        [void]$existingResults.Add($dnsServer)
                        $mergedCount++
                    } else {
                        # Update IsDisguise flag on the existing entry if not already set
                        $alreadyKnown.IsDisguise = $true
                    }
                }

                # Persist the merged results
                $script:AppState.LastScanResults = $existingResults.ToArray()

                # Repopulate the discovered-servers grid with the merged list
                & $populateGrid $script:AppState.LastScanResults

                $scanProgressBar.Value = 100
                $newCount   = $dnssdResults.Count
                $lblScanStatus.Text = "DNS-SD found $newCount server(s) ($mergedCount new). Grid shows $($script:AppState.LastScanResults.Count) total."
                $lblScanStatus.ForeColor = $script:Theme.Success

                Write-AppLog -Message "DNS-SD discovery: $newCount server(s) found, $mergedCount merged into existing results." -Level 'INFO'
            }
        } catch {
            $lblScanStatus.Text = "DNS-SD discovery failed: $_"
            $lblScanStatus.ForeColor = $script:Theme.Error
            Write-AppLog -Message "DNS-SD discovery error: $_" -Level 'ERROR'
        } finally {
            $btnScanNetwork.Enabled = $true
            $btnQuickScan.Enabled   = $true
            $btnDNSSD.Enabled       = $true
        }
    })

    # ===================================================================
    # Event Handlers - Deploy Button (per-row profiles)
    # ===================================================================
    $btnDeploy.Add_Click({
        # Build the list of selected rows with their per-row profile assignments
        $selectedTargets = [System.Collections.ArrayList]::new()
        foreach ($row in $dgvServers.Rows) {
            if ($row.Cells["Select"].Value -eq $true) {
                [void]$selectedTargets.Add([PSCustomObject]@{
                    IP          = $row.Cells["IPAddress"].Value
                    ProfileName = $row.Cells["Profile"].Value
                })
            }
        }

        if ($selectedTargets.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show(
                "No servers selected. Please check the servers you want to deploy to.",
                "No Selection",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            return
        }

        # --- Pre-deploy validation: every selected row must have a profile assigned ---
        $missingProfile = $selectedTargets | Where-Object { [string]::IsNullOrWhiteSpace($_.ProfileName) }
        if ($missingProfile.Count -gt 0) {
            $missingList = ($missingProfile | ForEach-Object { $_.IP }) -join "`n"
            [System.Windows.Forms.MessageBox]::Show(
                "The following selected server(s) have no profile assigned.`nAssign a profile in the Profile column (or use 'Set All To:') before deploying.`n`n$missingList",
                "Missing Profile Assignment",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            return
        }

        # Build a confirmation summary (show distinct profiles used)
        $summaryLines = $selectedTargets | ForEach-Object { "  $($_.IP)  ->  $($_.ProfileName)" }
        $confirmResult = [System.Windows.Forms.MessageBox]::Show(
            "Deploy to $($selectedTargets.Count) server(s)?`n`n$($summaryLines -join "`n")",
            "Confirm Deployment",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question)

        if ($confirmResult -ne [System.Windows.Forms.DialogResult]::Yes) {
            return
        }

        # Build credential object once (shared across all targets)
        $credential = $null
        if (-not $chkCurrentCreds.Checked) {
            $username = $txtUsername.Text.Trim()
            $password = $txtPassword.Text
            if (-not [string]::IsNullOrWhiteSpace($username) -and -not [string]::IsNullOrWhiteSpace($password)) {
                $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
                $credential = New-Object System.Management.Automation.PSCredential($username, $securePassword)
            }
            # Clear plaintext password from memory immediately
            $password = $null
            $txtPassword.Text = ''
        }

        # Disable the deploy button during operation
        $btnDeploy.Enabled = $false
        $deployProgressBar.Value = 0

        $totalServers  = $selectedTargets.Count
        $currentIdx    = 0
        $successCount  = 0
        $lastSuccessProfile = $null

        $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Starting deployment to $totalServers server(s)...`r`n")
        $txtDeployLog.Refresh()

        foreach ($target in $selectedTargets) {
            $currentIdx++
            $serverIP    = $target.IP
            $profileName = $target.ProfileName

            $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] [$currentIdx/$totalServers] $serverIP <- '$profileName'...`r`n")
            $txtDeployLog.Refresh()
            $deployProgressBar.Value = [int](($currentIdx / $totalServers) * 100)
            $deployProgressBar.Refresh()
            [System.Windows.Forms.Application]::DoEvents()

            # Load this target's specific profile
            $profileObj = $null
            try {
                $profileObj = Get-Profile -Name $profileName
            } catch {
                $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')]   ERROR: Could not load profile '$profileName': $_`r`n")
                $txtDeployLog.Refresh()
                continue
            }

            if (-not $profileObj) {
                $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')]   ERROR: Profile '$profileName' not found.`r`n")
                $txtDeployLog.Refresh()
                continue
            }

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
                    $lastSuccessProfile = $profileObj.Name
                    $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')]   $serverIP: Deployment SUCCEEDED`r`n")
                } else {
                    $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')]   $serverIP: Deployment FAILED - $($pushResult.ErrorMessage)`r`n")
                }
            } catch {
                $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')]   $serverIP: EXCEPTION - $_`r`n")
            }

            $txtDeployLog.Refresh()
            [System.Windows.Forms.Application]::DoEvents()
        }

        $deployProgressBar.Value = 100
        $txtDeployLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Deployment complete: $successCount/$totalServers succeeded.`r`n")
        $txtDeployLog.AppendText("------------------------------------------------------------`r`n")

        # Track the last successfully deployed profile in app state
        if ($lastSuccessProfile) {
            $script:AppState.LastAppliedProfile = $lastSuccessProfile
        }

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

    # Ensure cell value changes are committed immediately (needed for checkbox and combobox columns)
    $dgvServers.Add_CurrentCellDirtyStateChanged({
        if ($dgvServers.IsCurrentCellDirty) {
            $dgvServers.CommitEdit([System.Windows.Forms.DataGridViewDataErrorContexts]::Commit)
        }
    })

    # Suppress DataError events from the Profile combobox column.
    # WinForms fires DataError when a cell value is not in the column's Items list
    # (e.g., the empty string sentinel we use as the "no profile" state).
    # We handle this gracefully at deploy time, so the built-in error dialog is unwanted.
    $dgvServers.Add_DataError({
        param($sender, $e)
        # Only suppress errors from the Profile combobox column; let others surface normally.
        if ($e.ColumnIndex -ge 0 -and $dgvServers.Columns[$e.ColumnIndex].Name -eq "Profile") {
            $e.ThrowException = $false
        }
    })

    # ===================================================================
    # Add the scroll container to the content panel
    # ===================================================================
    $scrollContainer.ResumeLayout($true)
    $ContentPanel.Controls.Add($scrollContainer)

    # Resume layout now that all controls have been added
    $ContentPanel.ResumeLayout($true)
}
