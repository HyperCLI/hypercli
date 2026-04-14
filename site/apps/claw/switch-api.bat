@echo off
REM Simple script to switch between mock and real API endpoints

if "%1"=="mock" (
    copy .env.mock .env.local
    echo.
    echo ✅ Switched to MOCK server (localhost:8000)
    echo 📍 API: http://localhost:8000
    echo 💬 Chat: http://localhost:4002
    echo.
    echo Start mock servers with: npm run mock-server:all
) else if "%1"=="real" (
    copy .env.real .env.local
    echo.
    echo ✅ Switched to REAL API (api.dev.hypercli.com)
    echo 📍 API: https://api.dev.hypercli.com
    echo 💬 Chat: https://chat.dev.hypercli.com
) else if "%1"=="status" (
    echo Current API configuration:
    findstr "NEXT_PUBLIC_API_BASE_URL" .env.local
    findstr "NEXT_PUBLIC_CHAT_URL" .env.local
) else (
    echo Usage: switch-api.bat [mock^|real^|status]
    echo.
    echo Examples:
    echo   switch-api.bat mock    - Switch to local mock servers
    echo   switch-api.bat real    - Switch to real API (dev environment)
    echo   switch-api.bat status  - Show current API configuration
)
