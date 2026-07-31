@echo off
cd /d "%~dp0"
title Chinese Chess Build

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

REM Optional: build.bat [key]  or set PACK_KEY / BUILD_KEY
node "%~dp0build.js" %*
exit /b %ERRORLEVEL%
