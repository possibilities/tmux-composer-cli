#!/bin/bash

# Test script to verify that start-system assigns unique ports to each session

echo "Testing start-system command..."
echo "This will create multiple tmux sessions with unique ports"
echo ""

# Run the start-system command without attaching
node dist/cli.js start-system --no-attach

echo ""
echo "Checking assigned ports..."

# Check the PORT environment variable for each session
for session in tmux claude observe proxy; do
    port=$(tmux -S /tmp/tmux-composer-system list-sessions -F '#{session_name}' 2>/dev/null | grep "^$session$" > /dev/null && tmux -S /tmp/tmux-composer-system show-environment -t "$session" PORT 2>/dev/null | cut -d= -f2)
    if [ -n "$port" ]; then
        echo "$session: PORT=$port"
    fi
done

echo ""
echo "To clean up, run: tmux -S /tmp/tmux-composer-system kill-server"