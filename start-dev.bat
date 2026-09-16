@echo off
title Concord Desktop Dev
cd /d "%~dp0"
echo Starting Concord Desktop in Development Mode...
call pnpm --filter client electron:dev
if errorlevel 1 (
    echo.
    echo An error occurred while starting Concord.
    pause
)
