@echo off
title FixLoop Launcher
cd /d "%~dp0"

echo ============================================
echo  FixLoop - Broken Link ^& SEO Crawler
echo ============================================
echo  Starting API server and web UI...
echo ============================================
echo.

rem -- Start the API server (port 3002) in its own window
start "FixLoop API (port 3002)" cmd /k "cd server && npm run dev"
timeout /t 4 /nobreak >nul

rem -- Start the web UI dev server (port 3001) in its own window
start "FixLoop Web (port 3001)" cmd /k "cd web && npm run dev"

echo.
echo   API  : http://localhost:3002/api/health
echo   UI   : http://localhost:3001
echo   Demo : http://localhost:3001/demo/  (prefilled in the UI)
echo.
echo Both servers open in their own windows. Close those windows to stop.
echo Opening the UI now...
timeout /t 6 /nobreak >nul
start "" http://localhost:3001

exit
