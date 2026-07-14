@echo off
setlocal

cd /d "%~dp0"
set "URL=http://localhost:3000"

if not exist "node_modules" (
  echo node_modules not found. Run: npm install
  pause
  exit /b 1
)

rem Start server in a minimized console window
start "" /min cmd /c "cd /d ""%~dp0"" && npm start"

rem Give server a moment to start
timeout /t 1 /nobreak >nul

set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if defined BROWSER (
  start "" "%BROWSER%" --new-window --app="%URL%" --start-fullscreen --kiosk-printing
) else (
  start "" "%URL%"
)

endlocal
exit /b 0
