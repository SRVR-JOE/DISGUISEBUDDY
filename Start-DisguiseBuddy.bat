@echo off
title DISGUISE BUDDY
color 0A
echo.
echo   ============================================
echo   DISGUISE BUDDY
echo   ============================================
echo.

:: Check Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo   ERROR: Node.js is not installed or not in PATH
    echo.
    echo   Download it from: https://nodejs.org
    echo   Install the LTS version, then restart this script.
    echo.
    pause
    exit /b 1
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
