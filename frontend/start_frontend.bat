@echo off
setlocal

cd /d "%~dp0"

set "CODEX_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if exist "dist\index.html" (
  echo Starting EV Motor ERP frontend...
  echo.
  echo Open this in your browser:
  echo http://localhost:5173
  echo.
  if exist "%CODEX_PYTHON%" (
    cd /d "%~dp0dist"
    "%CODEX_PYTHON%" -m http.server 5173 --bind 127.0.0.1
    goto :end
  )
  where py >nul 2>nul
  if %errorlevel%==0 (
    cd /d "%~dp0dist"
    py -m http.server 5173 --bind 127.0.0.1
    goto :end
  )
  where python >nul 2>nul
  if %errorlevel%==0 (
    cd /d "%~dp0dist"
    python -m http.server 5173 --bind 127.0.0.1
    goto :end
  )
  echo Python was not found. Please install Python, then run this file again.
  pause
  goto :end
)

echo Frontend build files were not found.
echo Please tell Codex: "frontend dist missing"
pause

:end
endlocal
