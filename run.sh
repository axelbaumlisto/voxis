#!/bin/bash
# Voice app launcher with display detection

set -e

# Find X display
find_display() {
    # Check common X sockets
    for socket in /tmp/.X11-unix/X*; do
        if [ -S "$socket" ]; then
            DISPLAY_NUM=$(basename "$socket" | sed 's/X//')
            echo ":$DISPLAY_NUM"
            return 0
        fi
    done
    return 1
}

# Find X auth
find_xauth() {
    # 1. Check if XAUTHORITY is set
    if [ -n "$XAUTHORITY" ] && [ -f "$XAUTHORITY" ]; then
        echo "$XAUTHORITY"
        return 0
    fi

    # 2. Check ~/.Xauthority
    if [ -f "$HOME/.Xauthority" ]; then
        echo "$HOME/.Xauthority"
        return 0
    fi

    # 3. Find SDDM auth from Xorg process
    XAUTH_PATH=$(ps aux | grep -oP '(?<=-auth )[^ ]+' | head -1)
    if [ -n "$XAUTH_PATH" ] && [ -f "$XAUTH_PATH" ]; then
        # Copy to temp (may need sudo)
        if [ -r "$XAUTH_PATH" ]; then
            cp "$XAUTH_PATH" /tmp/xauth_cookie
        else
            sudo cat "$XAUTH_PATH" > /tmp/xauth_cookie 2>/dev/null
        fi
        chmod 644 /tmp/xauth_cookie
        echo "/tmp/xauth_cookie"
        return 0
    fi

    return 1
}

# Main
DISPLAY=${DISPLAY:-$(find_display)}
if [ -z "$DISPLAY" ]; then
    echo "Error: No X display found"
    exit 1
fi

XAUTHORITY=$(find_xauth)
if [ -z "$XAUTHORITY" ]; then
    echo "Error: No X authority found"
    exit 1
fi

export DISPLAY
export XAUTHORITY

echo "Using DISPLAY=$DISPLAY, XAUTHORITY=$XAUTHORITY"

# Run the app
cd "$(dirname "$0")"
exec ./src-tauri/target/debug/voice "$@"
