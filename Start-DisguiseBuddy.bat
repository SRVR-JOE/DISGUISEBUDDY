@echo off
setlocal enabledelayedexpansion
title DISGUISE BUDDY
color 0A
echo.
echo   ============================================
echo   DISGUISE BUDDY
echo   ============================================
echo.

:: Check Node.js is installed — auto-install if missing
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   Node.js not found. Installing automatically...
    echo.
    call :INSTALL_NODE
    if !ERRORLEVEL! NEQ 0 (
        pause
        exit /b 1
    )
)

:: Show Node version
for /f "tokens=*" %%v in ('node --version') do echo   Node.js %%v detected

:: Move to the UI directory
cd /d "%~dp0disguise-buddy-ui"
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo   ERROR: Cannot find disguise-buddy-ui folder
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules\" (
    echo.
    echo   Installing dependencies (first run only, this may take a minute)...
    echo.
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        color 0C
        echo.
        echo   ERROR: npm install failed
        pause
        exit /b 1
    )
    echo.
    echo   Dependencies installed.
    echo.
)

echo.
echo   Starting servers...
echo.

:: Start API server in background
start "" /b npx tsx electron/dev-server.ts

:: Wait for API to be ready (use PowerShell to check)
echo   Waiting for API server...
:WAIT_API
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:47100/api/dashboard' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto WAIT_API
echo   API server ready on http://localhost:47100

:: Start Vite dev server in background
start "" /b npx vite

:: Wait for Vite to be ready
echo   Waiting for web UI...
:WAIT_VITE
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto WAIT_VITE
echo   Web UI ready on http://localhost:5173

echo.
echo   ============================================
echo   DISGUISE BUDDY is running!
echo   ============================================
echo.

:: Open the browser
start "" http://localhost:5173

echo   Close this window or press Ctrl+C to stop.
echo.

:: Keep the window open so the background processes stay alive
cmd /k
goto :eof

:: ============================================================
:: Subroutine: Download and install Node.js LTS
:: ============================================================
:INSTALL_NODE
    :: Detect architecture
    if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
        set "NODE_ARCH=x64"
    ) else (
        set "NODE_ARCH=x86"
    )

    set "NODE_MSI=%TEMP%\node-install.msi"
    echo   Downloading Node.js 22 LTS for !NODE_ARCH!...
    echo.

    powershell -NoProfile -Command ^
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
        "$page = Invoke-WebRequest -Uri 'https://nodejs.org/dist/latest-v22.x/' -UseBasicParsing;" ^
        "$msi = ($page.Links | Where-Object { $_.href -match 'node-v.+-!NODE_ARCH!\.msi$' } | Select-Object -First 1).href;" ^
        "if (-not $msi) { Write-Host '  ERROR: Could not find installer'; exit 1 }" ^
        "$url = 'https://nodejs.org/dist/latest-v22.x/' + $msi;" ^
        "Write-Host \"  Downloading $url\";" ^
        "Invoke-WebRequest -Uri $url -OutFile '!NODE_MSI!' -UseBasicParsing"

    if not exist "!NODE_MSI!" (
        color 0C
        echo.
        echo   ERROR: Failed to download Node.js installer.
        exit /b 1
    )

    :: Silent install (requires admin for Program Files)
    echo.
    echo   Installing Node.js (this may take a minute)...
    msiexec /i "!NODE_MSI!" /qn /norestart
    if !ERRORLEVEL! NEQ 0 (
        echo   Silent install needs elevation, retrying with UI...
        msiexec /i "!NODE_MSI!" /passive /norestart
    )

    :: Clean up
    del "!NODE_MSI!" >nul 2>nul

    :: Add to PATH for this session
    set "PATH=%ProgramFiles%\nodejs;%PATH%"

    :: Verify
    where node >nul 2>nul
    if !ERRORLEVEL! NEQ 0 (
        color 0C
        echo.
        echo   ERROR: Node.js installation failed.
        echo   Try right-clicking Start-DisguiseBuddy.bat
        echo   and selecting "Run as Administrator".
        exit /b 1
    )

    for /f "tokens=*" %%v in ('node --version') do echo   Node.js %%v installed successfully.
    echo.
    exit /b 0
