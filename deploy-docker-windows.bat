@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker Desktop is not installed or docker.exe is not in PATH.
  exit /b 1
)

docker compose version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker Compose v2 is required. Install or update Docker Desktop.
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker is not running. Start Docker Desktop and try again.
  exit /b 1
)

if not defined NEURAL_CHAT_PORT set "NEURAL_CHAT_PORT=3000"
if not defined NEURAL_CHAT_UID set "NEURAL_CHAT_UID=1000"
if not defined NEURAL_CHAT_GID set "NEURAL_CHAT_GID=1000"

if not exist "data" mkdir "data"

echo [1/2] Building and deploying Neural Chat with Docker...
docker compose up --detach --build --remove-orphans
if errorlevel 1 exit /b 1

echo [2/2] Checking the container...
docker compose ps
if errorlevel 1 exit /b 1

echo.
echo Neural Chat is deployed at http://localhost:%NEURAL_CHAT_PORT%
echo Data is stored in %CD%\data
echo Run "docker compose logs -f neural-chat" to follow the logs.
exit /b 0

