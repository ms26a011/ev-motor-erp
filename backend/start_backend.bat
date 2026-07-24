@echo off
setlocal

cd /d "%~dp0"

set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "CODEX_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"

where npm >nul 2>nul
if %errorlevel%==0 (
  if not exist node_modules npm install
  npm run dev
  goto :end
)

if exist "%CODEX_PNPM%" (
  if not exist node_modules call "%CODEX_PNPM%" install
)

if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" --watch src/server.js
  goto :end
)

where node >nul 2>nul
if %errorlevel%==0 (
  if not exist node_modules npm install
  node --watch src/server.js
  goto :end
)

echo Node.js was not found. Please install Node.js, then run this file again.
pause

:end
endlocal
