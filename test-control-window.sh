#!/bin/bash

echo "Testing control window creation with --no-attach flag inside tmux..."
echo ""

# Clean up any existing test sessions
tmux kill-session -t test-control-session 2>/dev/null || true

# Test 1: Create session with --no-attach
echo "Test 1: Creating session with --no-attach..."
node dist/cli.js create-session ~/code/tmux-composer-cli --no-attach

# Check if session was created
if tmux has-session -t tmux-composer-cli-worktree-* 2>/dev/null; then
    SESSION_NAME=$(tmux list-sessions -F '#{session_name}' | grep 'tmux-composer-cli-worktree-' | head -1)
    echo "✓ Session created: $SESSION_NAME"
    
    # Check for control window
    WINDOWS=$(tmux list-windows -t "$SESSION_NAME" -F '#{window_name}')
    echo ""
    echo "Windows in session:"
    echo "$WINDOWS"
    echo ""
    
    if echo "$WINDOWS" | grep -q "control"; then
        echo "✓ Control window EXISTS!"
        
        # Check panes in control window
        PANES=$(tmux list-panes -t "$SESSION_NAME:control" -F '#{pane_index}: #{pane_current_command}')
        echo ""
        echo "Panes in control window:"
        echo "$PANES"
    else
        echo "✗ Control window MISSING!"
    fi
    
    # Clean up
    tmux kill-session -t "$SESSION_NAME"
else
    echo "✗ Session was not created"
fi

echo ""
echo "Test complete."