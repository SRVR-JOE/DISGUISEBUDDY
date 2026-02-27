@echo off
title DISGUISE BUDDY
echo ============================================
echo   DISGUISE BUDDY - Starting...
echo ============================================
echo.

cd /d "%~dp0disguise-buddy-ui"

:: Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies (first run only)...
    echo.
    call npm install
    echo.
)

echo Starting DISGUISE BUDDY...
echo.
echo   API Server:  http://localhost:47100
echo   Web UI:      http://localhost:5173
echo.
echo   The browser will open automatically.
echo   Press Ctrl+C to stop.
echo.
echo ============================================
echo.

npm run start
