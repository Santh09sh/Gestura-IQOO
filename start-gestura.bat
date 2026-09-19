@echo off
REM ═══════════════════════════════════════════════
REM  Gestura — Start All Services
REM  Run this from the project root directory.
REM  
REM  Starts:
REM    1. Flask backend (localhost:5000)
REM    2. Express reverse proxy (localhost:3000)
REM    3. Cloudflare Quick Tunnel (public HTTPS URL)
REM ═══════════════════════════════════════════════

echo.
echo ╔══════════════════════════════════════════════╗
echo ║  Starting Gestura...                         ║
echo ╚══════════════════════════════════════════════╝
echo.

REM Start Flask backend
echo [1/3] Starting Flask backend on localhost:5000...
start "Gestura Flask" cmd /c "cd /d %~dp0server && python app.py --port 5000"
timeout /t 2 /nobreak >nul

REM Start Express proxy
echo [2/3] Starting proxy server on localhost:3000...
start "Gestura Proxy" cmd /c "cd /d %~dp0 && node proxy.js"
timeout /t 2 /nobreak >nul

REM Start Cloudflare tunnel
echo [3/3] Starting Cloudflare tunnel...
echo.
echo ═══════════════════════════════════════════════
echo  Look for the public URL below (*.trycloudflare.com)
echo  Open it on your phone to use Gestura!
echo ═══════════════════════════════════════════════
echo.
npx cloudflared tunnel --url http://localhost:3000
