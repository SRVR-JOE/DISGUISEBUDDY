#!/bin/bash
echo "============================================"
echo "  DISGUISE BUDDY - Starting..."
echo "============================================"
echo ""

cd "$(dirname "$0")/disguise-buddy-ui"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies (first run only)..."
    echo ""
    npm install
    echo ""
fi

echo "Starting DISGUISE BUDDY..."
echo ""
echo "  API Server:  http://localhost:47100"
echo "  Web UI:      http://localhost:5173"
echo ""
echo "  The browser will open automatically."
echo "  Press Ctrl+C to stop."
echo ""
echo "============================================"
echo ""

npm run start
