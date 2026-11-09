@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desinstaller-windows.ps1" %*
pause
