@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0Start-DisguiseBuddy.ps1"
if %errorlevel% neq 0 pause
