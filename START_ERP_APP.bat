@echo off
setlocal

cd /d "%~dp0"

echo Starting EV Motor Manufacturing ERP...
echo.
echo Two black windows will open:
echo 1. Backend
echo 2. Frontend
echo.
echo Please keep both black windows open while using the app.
echo.

start "EV ERP Backend" cmd /k ""%~dp0backend\start_backend.bat""
timeout /t 3 /nobreak >nul

start "EV ERP Frontend" cmd /k ""%~dp0frontend\start_frontend.bat""
timeout /t 4 /nobreak >nul

start http://localhost:5173

echo App opening at http://localhost:5173
echo.
echo If the browser says it cannot connect, wait 10 seconds and refresh.
pause

endlocal
