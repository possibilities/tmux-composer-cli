# Tmux Composer Events Documentation

This document describes all events emitted by the tmux-composer CLI commands.

## Overview

The tmux-composer CLI emits JSON-formatted events to stdout and optionally publishes them via ZeroMQ. Each event has the following structure:

```json
{
  "event": "event-name",
  "data": { ... },
  "timestamp": "2023-12-07T10:30:45.123Z",
  "sessionId": "uuid-v4"
}
```

## Commands and Their Events

### 1. watch-session

Monitors tmux session changes including windows and panes.

#### Events

- **`session-changed`** - Emitted when the session structure changes (windows/panes added, removed, renamed, resized, or focus changed)
  ```json
  {
    "event": "session-changed",
    "data": {
      "sessionId": "$0",
      "sessionName": "my-project",
      "focusedWindowId": "@1",
      "focusedPaneId": "%0",
      "windows": [
        {
          "windowId": "@1",
          "windowIndex": "0",
          "windowName": "editor",
          "isActive": true,
          "panes": [
            {
              "paneId": "%0",
              "paneIndex": "0",
              "command": "vim",
              "width": 120,
              "height": 40,
              "isActive": true
            }
          ]
        }
      ]
    },
    "timestamp": "2023-12-07T10:30:45.123Z",
    "sessionId": "uuid-v4"
  }
  ```

### 2. watch-panes

Monitors pane content changes within the current tmux session.

#### Events

- **`pane-changed`** - Emitted when pane content changes (throttled to 100ms)
  ```json
  {
    "event": "pane-changed",
    "data": {
      "sessionId": "$0",
      "paneId": "%1",
      "windowName": "server",
      "windowIndex": "1",
      "content": "Full pane content...\n..."
    },
    "timestamp": "2023-12-07T10:30:45.123Z",
    "sessionId": "uuid-v4"
  }
  ```

### 3. create-session

Creates a new tmux session with multiple windows based on project configuration. Supports two modes:

- **Worktree mode (default)**: Creates a new git worktree for the session
- **Non-worktree mode (`--no-worktree`)**: Creates session in the current directory

In non-worktree mode:

- Session name is just the project name (no worktree number)
- Always fails if repository has uncommitted changes (no prompt)
- Fails if a session with the same name already exists
- No worktree creation or dependency installation

#### Events

##### Initialization Events

- **`initialize-session-creation:start`** - Session creation process begins

  ```json
  {
    "event": "initialize-session-creation:start",
    "data": {
      "projectPath": "/path/to/project",
      "options": {
        "socketName": null,
        "socketPath": null,
        "terminalWidth": 120,
        "terminalHeight": 40,
        "attach": true,
        "worktreeMode": true
      }
    }
  }
  ```

- **`initialize-session-creation:end`** - Initialization complete
  ```json
  {
    "event": "initialize-session-creation:end",
    "data": {
      "duration": 15
    }
  }
  ```

##### Project Analysis Events

- **`analyze-project-metadata:start`** - Starting project analysis

- **`analyze-project-metadata:end`** - Project metadata analyzed

  ```json
  {
    "event": "analyze-project-metadata:end",
    "data": {
      "projectPath": "/path/to/project",
      "projectName": "my-project",
      "worktreeNumber": 1,
      "sessionName": "my-project-worktree-1",
      "worktreeMode": true,
      "duration": 10
    }
  }
  ```

  Note: When `worktreeMode` is false:

  - `worktreeNumber` will be undefined
  - `sessionName` will be just the project name (e.g., "my-project")

- **`analyze-project-structure:start`** - Analyzing project structure

- **`analyze-project-structure:end`** - Project structure analyzed

  ```json
  {
    "event": "analyze-project-structure:end",
    "data": {
      "hasPackageJson": true,
      "packageJsonPath": "/path/to/project/package.json",
      "worktreeMode": true,
      "duration": 5
    }
  }
  ```

- **`analyze-project-scripts:start`** - Analyzing package.json scripts

- **`analyze-project-scripts:end`** - Scripts analysis complete

  ```json
  {
    "event": "analyze-project-scripts:end",
    "data": {
      "availableScripts": [
        "dev",
        "build",
        "test",
        "lint:watch",
        "types:watch",
        "test:watch"
      ],
      "plannedWindows": ["server", "lint", "types", "test", "control"],
      "duration": 8
    }
  }
  ```

  Note: The `plannedWindows` array is dynamically generated:

  - Includes "server" only if a `dev` script exists
  - Includes a window for each script ending in `:watch` (window name = script name without `:watch`)
  - Always includes "control" as the last window

##### Repository Events

- **`ensure-clean-repository:start`** - Checking repository status

- **`ensure-clean-repository:end`** - Repository is clean

  ```json
  {
    "event": "ensure-clean-repository:end",
    "data": {
      "isClean": true,
      "branch": "main",
      "commitHash": "abc123...",
      "uncommittedFiles": [],
      "stagedFiles": [],
      "duration": 20
    }
  }
  ```

- **`ensure-clean-repository:fail`** - Repository has uncommitted changes (both worktree and non-worktree modes)
  ```json
  {
    "event": "ensure-clean-repository:fail",
    "data": {
      "isClean": false,
      "error": "Repository has uncommitted changes",
      "errorCode": "DIRTY_REPOSITORY",
      "duration": 20
    }
  }
  ```

##### Worktree Events

- **`create-project-worktree:start`** - Creating git worktree (worktree mode only)

- **`create-project-worktree:end`** - Worktree created successfully

  ```json
  {
    "event": "create-project-worktree:end",
    "data": {
      "sourcePath": "/path/to/project",
      "worktreePath": "/home/user/code/.worktrees/my-project-worktree-1",
      "branch": "main",
      "worktreeNumber": 1,
      "duration": 150
    }
  }
  ```

- **`create-project-worktree:fail`** - Worktree creation failed

- **`skip-worktree-creation`** - Worktree creation skipped (non-worktree mode only)

  ```json
  {
    "event": "skip-worktree-creation",
    "data": {
      "reason": "Non-worktree mode",
      "currentPath": "/path/to/project",
      "duration": 0
    }
  }
  ```

##### Dependency Events

- **`install-project-dependencies:start`** - Installing dependencies

- **`install-project-dependencies:end`** - Dependencies installed

  ```json
  {
    "event": "install-project-dependencies:end",
    "data": {
      "packageManager": "pnpm",
      "worktreePath": "/path/to/worktree",
      "hasPackageJson": true,
      "hasLockfile": true,
      "duration": 5000
    }
  }
  ```

- **`install-project-dependencies:fail`** - Dependency installation failed

##### Tmux Session Events

- **`create-tmux-session:start`** - Starting tmux session creation

- **`create-tmux-session:end`** - Session created with first window

  ```json
  {
    "event": "create-tmux-session:end",
    "data": {
      "sessionName": "my-project-worktree-1",
      "sessionId": "$0",
      "socketPath": "/tmp/tmux-1000/default",
      "firstWindow": "server",
      "terminalSize": {
        "width": 120,
        "height": 40
      },
      "duration": 50
    }
  }
  ```

- **`create-tmux-session:fail`** - Session creation failed

##### Window Creation Events

Windows are created dynamically based on the project's package.json scripts:

- **`server`** - Created only if a `dev` script exists in package.json
- **Dynamic windows** - Created for any script ending with `:watch` (e.g., `lint:watch` creates a `lint` window, `foo:watch` creates a `foo` window)
- **`control`** - Always created as the last window for monitoring

- **`create-tmux-window:{windowName}:start`** - Creating specific window where `{windowName}` is dynamically determined

- **`create-tmux-window:{windowName}:end`** - Window created successfully

  ```json
  {
    "event": "create-tmux-window:server:end",
    "data": {
      "windowName": "server",
      "windowIndex": 1,
      "windowId": "@2",
      "command": "PORT=3000 pnpm run dev",
      "port": 3000,
      "script": "dev",
      "duration": 100
    }
  }
  ```

- **`create-tmux-window:{windowName}:fail`** - Window creation failed

##### Port Finding Events

- **`find-open-port:start`** - Looking for available port

- **`find-open-port:end`** - Found available port

  ```json
  {
    "event": "find-open-port:end",
    "data": {
      "port": 52341,
      "windowName": "server",
      "duration": 5
    }
  }
  ```

- **`find-open-port:fail`** - Could not find available port

##### Finalization Events

- **`finalize-tmux-session:start`** - Finalizing session setup

- **`finalize-tmux-session:end`** - Session setup complete
  ```json
  {
    "event": "finalize-tmux-session:end",
    "data": {
      "sessionName": "my-project-worktree-1",
      "selectedWindow": "server",
      "totalWindows": 6,
      "worktreePath": "/path/to/worktree",
      "worktreeMode": true,
      "duration": 10,
      "totalDuration": 7500
    }
  }
  ```

##### Session Management Events

- **`create-worktree-session:start`** - Overall session creation process start

- **`create-worktree-session:end`** - Overall session creation complete

  ```json
  {
    "event": "create-worktree-session:end",
    "data": {
      "sessionName": "my-project-worktree-1",
      "worktreePath": "/path/to/worktree",
      "windows": ["server", "lint", "types", "test", "control"],
      "worktreeMode": true,
      "duration": 7450,
      "totalDuration": 7500
    }
  }
  ```

  Note: The `windows` array contains the actual windows created, which depends on the scripts in package.json

- **`create-worktree-session:fail`** - Overall session creation failed

##### Attachment Events

- **`attach-tmux-session:start`** - Attaching to created session

- **`attach-tmux-session:end`** - Successfully attached

  ```json
  {
    "event": "attach-tmux-session:end",
    "data": {
      "sessionName": "my-project-worktree-1",
      "windowsReady": true,
      "waitDuration": 150,
      "attachMethod": "switch-client",
      "duration": 200
    }
  }
  ```

- **`attach-tmux-session:fail`** - Failed to attach

- **`switch-tmux-session:start`** - Switching to session (when already in tmux)

  ```json
  {
    "event": "switch-tmux-session:start",
    "data": {
      "sessionName": "my-project-worktree-1",
      "fromInsideTmux": true
    }
  }
  ```

- **`select-window:fail`** - Failed to select window

## Event Flow

### Typical create-session flow:

1. `initialize-session-creation:start`
2. `initialize-session-creation:end`
3. `analyze-project-metadata:start`
4. `analyze-project-metadata:end`
5. `create-worktree-session:start`
6. `ensure-clean-repository:start`
7. `ensure-clean-repository:end`
8. `create-project-worktree:start`
9. `create-project-worktree:end`
10. `install-project-dependencies:start`
11. `install-project-dependencies:end`
12. `analyze-project-structure:start`
13. `analyze-project-structure:end`
14. `analyze-project-scripts:start`
15. `analyze-project-scripts:end`
16. `create-tmux-session:start`
17. `create-tmux-window:server:start` (if `dev` script exists)
18. `find-open-port:start` (for server window)
19. `find-open-port:end`
20. `create-tmux-window:server:end`
21. `create-tmux-session:end`
22. `create-tmux-window:{name}:start` (for each script ending in `:watch`)
23. `create-tmux-window:{name}:end`
24. (Repeat for each `:watch` script found)
25. `create-tmux-window:control:start`
26. `create-tmux-window:control:end`
27. `finalize-tmux-session:start`
28. `finalize-tmux-session:end`
29. `create-worktree-session:end`
30. `attach-tmux-session:start` (if --attach)
31. `switch-tmux-session:start` or `attach-tmux-session:end`

## Error Handling

All `:fail` events include:

- `error`: Human-readable error message
- `errorCode`: Machine-readable error code (when applicable)
- `duration`: Time elapsed before failure (in milliseconds)

Common error codes:

- `DIRTY_REPOSITORY`: Repository has uncommitted changes (both worktree and non-worktree modes)
- `SESSION_EXISTS`: Session with same name already exists (non-worktree mode)
- `MISSING_PACKAGE_JSON`: No package.json found
- `TMUX_SERVER_FAILED`: Tmux server failed to start
- `PANE_NOT_READY`: Pane did not become ready within timeout

## ZeroMQ Publishing

When ZeroMQ is enabled (default), events are also published to:

- Socket: `ipc:///tmp/tmux-composer-events.sock`
- Topic: All events published to single topic
- Format: UTF-8 JSON strings

To disable ZeroMQ publishing, use the `--no-zmq` flag with any command.

## Observing Events

Use the `observe-events` command to monitor all events:

```bash
# Output to stdout
tmux-composer observe-events

# Pretty print with jq
tmux-composer observe-events | jq .

# Also expose via WebSocket on port 31337
tmux-composer observe-events --ws
```
