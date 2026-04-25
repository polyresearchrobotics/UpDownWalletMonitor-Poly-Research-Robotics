@echo off
REM Double-click this file on Windows to start Wallet Tracker.
REM Installs dependencies on first run, builds the app, and opens it
REM in your browser at http://localhost:3030.
REM Close this window to stop the server.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found on PATH.
  echo Install it from https://nodejs.org (LTS is fine^), then re-open this file.
  pause
  exit /b 1
)

call npm run launch
