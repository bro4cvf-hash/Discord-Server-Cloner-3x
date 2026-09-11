@echo off
setlocal
cd /d "%~dp0"
title Discord Server Cloner

echo Checking Node.js installation...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not found in your PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

echo.
echo ===================================================
echo             DISCORD SERVER CLONER 2.0
echo ===================================================
echo  [1] Web Dashboard (Modern UI in browser - Default)
echo  [2] Terminal CLI  (Original console mode)
echo ===================================================
set /p choice="Select mode (1 or 2, default is 1): "

if "%choice%"=="2" (
    echo Starting Terminal CLI...
    call npm run start:cli
) else (
    echo Starting Web UI Dashboard...
    timeout /t 2 /nobreak >nul
    start http://localhost:4567
    call npm start
)

if %errorlevel% neq 0 (
    echo.
    echo [The process exited with code %errorlevel%]
)

echo.
echo Press any key to exit...
pause >nul

