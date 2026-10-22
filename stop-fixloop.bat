@echo off
title FixLoop Stopper
echo Stopping FixLoop servers (ports 3001 and 3002)...

for %%p in (3001 3002) do (
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":%%p .*LISTENING"') do (
        taskkill /PID %%a /T /F >nul 2>&1
        if not errorlevel 1 echo   killed PID %%a on port %%p
    )
)

echo Done.
timeout /t 2 /nobreak >nul
exit
