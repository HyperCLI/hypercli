#!/bin/bash

# Simple script to switch between mock and real API endpoints

if [ "$1" = "mock" ]; then
    cp .env.mock .env.local
    echo "✅ Switched to MOCK server (localhost:8000)"
    echo "📍 API: http://localhost:8000"
    echo "💬 Chat: http://localhost:4002"
    echo ""
    echo "Start mock servers with: npm run mock-server:all"
elif [ "$1" = "real" ]; then
    cp .env.real .env.local
    echo "✅ Switched to REAL API (api.dev.hypercli.com)"
    echo "📍 API: https://api.dev.hypercli.com"
    echo "💬 Chat: https://chat.dev.hypercli.com"
elif [ "$1" = "status" ]; then
    echo "Current API configuration:"
    grep "NEXT_PUBLIC_API_BASE_URL" .env.local
    grep "NEXT_PUBLIC_CHAT_URL" .env.local
else
    echo "Usage: ./switch-api.sh [mock|real|status]"
    echo ""
    echo "Examples:"
    echo "  ./switch-api.sh mock    - Switch to local mock servers"
    echo "  ./switch-api.sh real    - Switch to real API (dev environment)"
    echo "  ./switch-api.sh status  - Show current API configuration"
fi
