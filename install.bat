@echo off
REM free-pi browser bridge - one-shot setup for Windows.
REM Double-click this file, or run it in a terminal. No admin rights needed.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ==^> free-pi browser bridge - Windows setup
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not installed. Get Node 18+ from https://nodejs.org
  echo     Install it, close this window, and run install.bat again.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo [X] Node is too old - need 18 or newer.
  pause
  exit /b 1
)
echo   OK node
node -e "const p=require('./bin/lib/platform');const f=p.findFirefox();if(!f){console.log('[X] Firefox not found - install Firefox, or set BX_FIREFOX_BIN');process.exit(1)}console.log('  OK firefox: '+f)"
if errorlevel 1 pause & exit /b 1

echo.
echo   installing dependencies...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo [X] npm install failed
  pause
  exit /b 1
)

echo.
echo   writing Firefox prefs and building the add-on...
node bin\bx forever
node bridge\make-xpi.js

echo.
echo   starting the bridge...
node bin\bx up

echo.
echo   creating the launcher commands in this folder...
> bx.cmd echo @echo off
>> bx.cmd echo node "%%~dp0bin\bx" %%*
> bx-firefox.cmd echo @echo off
>> bx-firefox.cmd echo node "%%~dp0bin\bx-firefox.mjs" %%*

echo.
echo ==========================================================
echo   Almost done. Two steps:
echo.
echo   1. Quit Firefox completely, then start it with:
echo        %~dp0bx-firefox.cmd
echo      (or make a desktop shortcut to that file)
echo.
echo   2. Wait ~10 seconds, then in a terminal:
echo        bx status      (should say "extension": true)
echo        bx read        (reads the page in front of you)
echo        bx panel on    (puts the chat box on this tab)
echo.
echo   To use "bx" from anywhere, add this folder to your PATH:
echo        %~dp0
echo.
echo   Something off?   bx doctor
echo ==========================================================
echo.
pause
