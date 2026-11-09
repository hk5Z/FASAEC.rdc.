@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-windows.ps1" %*
pause
