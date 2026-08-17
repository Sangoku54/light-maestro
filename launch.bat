@echo off
setlocal
cd /d "%~dp0"

echo.
echo  ============================================
echo    Light Maestro v1.0
echo    QLC+ - SoundSwitch Fusion
echo  ============================================
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

REM Compile the Electron main process once (first run only). The renderer is
REM rebuilt in the background by the app itself, right after the splash screen
REM is shown, so the splash window appears instantly at launch.
if not exist "dist\electron\main.js" (
    echo [!] First run: compiling main process...
    call npx tsc -p tsconfig.electron.json
    if %ERRORLEVEL% neq 0 (
        echo [X] TypeScript build failed
        pause
        exit /b 1
    )
)

REM Copy the USB output child-process script into dist
if exist "electron\dmx\usb-output.js" copy /Y "electron\dmx\usb-output.js" "dist\electron\dmx\usb-output.js" >nul

echo [*] Starting Light Maestro...
echo.

REM Standalone launch flag: tells the app to rebuild the renderer in the
REM background and skip the Vite dev-server probe.
set LIGHT_MAESTRO_LAUNCH=1
call npx electron .

if %ERRORLEVEL% neq 0 (
    echo.
    echo [X] Application exited with error code %ERRORLEVEL%
    pause
)
