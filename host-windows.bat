@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22 or newer is required.
  exit /b 1
)

node -e "process.exit(Math.sign(Number(process.versions.node.split('.')[0])-22)===-1?1:0)"
if errorlevel 1 (
  echo [ERROR] Node.js 22 or newer is required. Current version:
  node --version
  exit /b 1
)

set "NEEDS_BUILD=0"
if /I "%~1"=="--rebuild" set "NEEDS_BUILD=1"
if not exist "node_modules\.package-lock.json" set "NEEDS_BUILD=1"
if not exist ".next\standalone\server.js" set "NEEDS_BUILD=1"

if "%NEEDS_BUILD%"=="1" (
  echo [1/3] Installing dependencies...
  call npm ci
  if errorlevel 1 exit /b 1

  echo [2/3] Building Neural Chat...
  call npm run build
  if errorlevel 1 exit /b 1
)

echo [3/3] Preparing runtime files...
if not exist ".next\standalone\.next\static" mkdir ".next\standalone\.next\static"
xcopy /E /I /Y /Q ".next\static\*" ".next\standalone\.next\static\" >nul
if exist "public" (
  if not exist ".next\standalone\public" mkdir ".next\standalone\public"
  xcopy /E /I /Y /Q "public\*" ".next\standalone\public\" >nul
)

if not defined NEURAL_CHAT_DATA_DIR set "NEURAL_CHAT_DATA_DIR=%CD%\data"
if not exist "%NEURAL_CHAT_DATA_DIR%" mkdir "%NEURAL_CHAT_DATA_DIR%"

set "NODE_ENV=production"

if /I "%~1"=="--check" (
  node "scripts\start-server.mjs" --check
  if errorlevel 1 exit /b 1
  echo Neural Chat hosting files are ready.
  exit /b 0
)

echo.
echo Press Ctrl+C to stop. Use host-windows.bat --rebuild after updating the source.
echo.
node "scripts\start-server.mjs" start
exit /b %ERRORLEVEL%
