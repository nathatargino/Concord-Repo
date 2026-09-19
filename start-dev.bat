@echo off
title Concord Desktop Dev
cd /d "%~dp0"
echo Starting Concord Server and Desktop Client in Development Mode...
call pnpm electron:dev
if errorlevel 1 (
    echo.
    echo An error occurred while starting Concord.
    pause
)
