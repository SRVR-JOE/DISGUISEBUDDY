@echo off
:: DISGUISE BUDDY - Fallback Launcher
:: Requires PowerShell 5.1+ and Administrator privileges.
:: Use this if the .exe fails or for troubleshooting (console output is visible).

:: Check if already elevated
net session >nul 2>&1
if %errorLevel% == 0 (
    goto :run
) else (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0DisguiseBuddy.ps1"
