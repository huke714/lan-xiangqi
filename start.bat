@echo off
cd /d "%~dp0"
title Chinese Chess

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\express\package.json" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

node "%~dp0start.js"
exit /b %ERRORLEVEL%
