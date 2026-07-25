@echo off
setlocal
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════╗
echo  ║     Light Maestro v1.0          ║
echo  ║  QLC+ × SoundSwitch Fusion     ║
echo  ╚══════════════════════════════════╝
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo [!] Installing dependencies first...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [X] Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Always rebuild to ensure latest code
echo [!] Building latest code...
call npx vite build 2>&1
if %ERRORLEVEL% neq 0 (
    echo [X] Vite build failed
    pause
    exit /b 1
)
del /q "dist\tsconfig.electron.tsbuildinfo" 2>nul
call npx tsc -p tsconfig.electron.json 2>&1
if %ERRORLEVEL% neq 0 (
    echo [X] TypeScript build failed
    pause
    exit /b 1
)

echo [*] Starting Light Maestro...
echo.

REM Copy USB output child process script to dist
if exist "electron\dmx\usb-output.js" copy /Y "electron\dmx\usb-output.js" "dist\electron\dmx\usb-output.js" >nul
if exist "electron\splash.html" copy /Y "electron\splash.html" "dist\electron\splash.html" >nul

call npx electron . 2>&1

if %ERRORLEVEL% neq 0 (
    echo.
    echo [X] Application exited with error code %ERRORLEVEL%
    pause
)
