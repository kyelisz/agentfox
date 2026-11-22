@echo off
REM agentfox - a browser AI agent. One-shot setup for Windows.
REM Needs Node 22+ and Firefox. Double-click this file. No admin rights needed.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ==^> free-pi browser bridge
echo     drive your real Firefox from a terminal agent
echo.

REM ---- 1. Node 22 ----
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not installed.
  echo     Install Node 22 from https://nodejs.org , then run install.bat again.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo [X] Node %NODE_MAJOR% is too old - this needs Node 22 or newer.
  echo     Download the LTS/current Node 22 from https://nodejs.org
  pause
  exit /b 1
)
echo   OK node
node --version

REM ---- 2. Firefox ----
node -e "const p=require('./bin/lib/platform');const f=p.findFirefox();if(!f){console.log('[X] Firefox not found - install Firefox, or set BX_FIREFOX_BIN');process.exit(1)}console.log('  OK firefox: '+f)"
if errorlevel 1 pause & exit /b 1

REM ---- 3. free-pi ----
set HAVE_PI=0
where free-pi >nul 2>nul && set HAVE_PI=1
if "%HAVE_PI%"=="0" (
  call npx --yes free-pi-cli@latest --version >nul 2>nul && set HAVE_PI=1
)
if "%HAVE_PI%"=="1" (
  echo   OK free-pi found
) else (
  echo   !  free-pi not found - the box will queue messages instead of answering them.
  echo      Install it with:  npm install -g free-pi-cli@latest
)

REM ---- 4. dependencies ----
echo.
echo   installing dependencies...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo [X] npm install failed
  pause
  exit /b 1
)

REM ---- 5. prefs + add-on ----
echo.
echo   writing Firefox prefs and building the add-on...
node bin\bx forever
node bridge\make-xpi.js

REM ---- 6. launchers ----
> bx.cmd echo @echo off
>> bx.cmd echo node "%%~dp0bin\bx" %%*
> bx-firefox.cmd echo @echo off
>> bx-firefox.cmd echo node "%%~dp0bin\bx-firefox.mjs" %%*

REM ---- 7. bridge ----
echo.
echo   starting the bridge...
node bin\bx up

echo.
echo ==========================================================
echo   Almost done. Two steps:
echo.
echo   1. Quit Firefox completely, then start it with:
echo        %~dp0bx-firefox.cmd
echo      (or point your Firefox shortcut at that file - see
echo       docs\WINDOWS.md)
echo.
echo   2. Wait ~10 seconds, then in a terminal:
echo        bx status      (should say "extension": true)
echo        bx read
echo        bx panel on
echo.
echo   Make the box answer on its own:  bx chatagent on   (needs WSL + tmux)
echo   Anything broken?                 bx doctor
echo.
echo   To use "bx" anywhere, add this folder to PATH:
echo        %~dp0
echo ==========================================================
echo.
pause
