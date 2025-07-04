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

### 1. observe-session

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

### 2. observe-panes

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

### 3. start-session

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

  - Includes "agent" first if `commands.run-agent` is configured
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

Windows are created dynamically based on the project's package.json scripts and configuration:

- **`agent`** - Created first if `commands.run-agent` is configured (runs the specified command)
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

  Example for agent window:

  ```json
  {
    "event": "create-tmux-window:agent:end",
    "data": {
      "windowName": "agent",
      "windowIndex": 0,
      "windowId": "@1",
      "command": "claude",
      "duration": 100
    }
  }
  ```

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

### 4. continue-session

Continues the latest worktree session, creating it if it doesn't exist. Similar to start-session but uses an existing worktree.

#### Events

##### Initialization Events

- **`initialize-continue-session:start`** - Starting continuation process

- **`initialize-continue-session:end`** - Initialization complete

  ```json
  {
    "event": "initialize-continue-session:end",
    "data": {
      "duration": 10
    }
  }
  ```

- **`continue-session:start`** - Session continuation begins
  ```json
  {
    "event": "continue-session:start",
    "data": {
      "projectPath": "/path/to/project",
      "options": {
        "socketName": null,
        "socketPath": null,
        "terminalWidth": 120,
        "terminalHeight": 40,
        "attach": true
      }
    }
  }
  ```

##### Validation Events

- **`validate-existing-session:start`** - Checking if session already exists

- **`validate-existing-session:end`** - Session validation complete

  ```json
  {
    "event": "validate-existing-session:end",
    "data": {
      "sessionName": "my-project-worktree-00001",
      "exists": false,
      "duration": 15
    }
  }
  ```

- **`validate-existing-session:fail`** - Session validation failed

##### Session Mode Events

- **`set-tmux-composer-mode:start`** - Setting TMUX_COMPOSER_MODE environment variable

- **`set-tmux-composer-mode:end`** - Mode set successfully

  ```json
  {
    "event": "set-tmux-composer-mode:end",
    "data": {
      "mode": "worktree",
      "sessionName": "my-project-worktree-00001",
      "duration": 5
    }
  }
  ```

- **`set-tmux-composer-mode:fail`** - Failed to set mode

### 5. resume-session

Displays an interactive menu to select and resume or create worktree sessions. Supports direct worktree selection with `--worktree` flag.

#### Usage Modes

- **Interactive mode (default)**: Shows a menu to select from available worktrees
- **Direct mode (`--worktree <worktree>`)**: Directly resumes or creates a specific worktree session
  - Accepts worktree number (e.g., `3`), padded number (e.g., `00003`), or full session name
  - Validates `--no-attach` flag usage when not in tmux

#### Events

##### Initialization Events

- **`resume-session:start`** - Resume session process begins
  ```json
  {
    "event": "resume-session:start",
    "data": {
      "projectPath": "/path/to/project",
      "options": {
        "socketName": null,
        "socketPath": null,
        "terminalWidth": 120,
        "terminalHeight": 40,
        "attach": true,
        "worktree": "3"
      }
    }
  }
  ```

##### Direct Worktree Selection Events (when --worktree is provided)

- **`find-worktree:start`** - Searching for specified worktree

  ```json
  {
    "event": "find-worktree:start",
    "data": {
      "worktreeInput": "3"
    }
  }
  ```

- **`find-worktree:end`** - Worktree found

  ```json
  {
    "event": "find-worktree:end",
    "data": {
      "worktreeInput": "3",
      "worktree": {
        "number": 3,
        "path": "/home/user/code/.worktrees/my-project-worktree-00003",
        "branch": "feature-branch",
        "projectName": "my-project"
      },
      "duration": 10
    }
  }
  ```

- **`find-worktree:fail`** - Worktree not found

  ```json
  {
    "event": "find-worktree:fail",
    "data": {
      "error": "Worktree '999' not found",
      "errorCode": "WORKTREE_NOT_FOUND",
      "duration": 10
    }
  }
  ```

- **`check-session-exists:start`** - Checking if session exists

  ```json
  {
    "event": "check-session-exists:start",
    "data": {
      "sessionName": "my-project-worktree-00003"
    }
  }
  ```

- **`check-session-exists:end`** - Session existence check complete

  ```json
  {
    "event": "check-session-exists:end",
    "data": {
      "sessionName": "my-project-worktree-00003",
      "exists": false,
      "duration": 15
    }
  }
  ```

- **`switch-to-existing-session:start`** - Switching to existing session

  ```json
  {
    "event": "switch-to-existing-session:start",
    "data": {
      "sessionName": "my-project-worktree-00003"
    }
  }
  ```

- **`switch-to-existing-session:end`** - Switch complete

  ```json
  {
    "event": "switch-to-existing-session:end",
    "data": {
      "sessionName": "my-project-worktree-00003",
      "duration": 20
    }
  }
  ```

- **`create-new-session:start`** - Creating new session for worktree

  ```json
  {
    "event": "create-new-session:start",
    "data": {
      "sessionName": "my-project-worktree-00003",
      "worktreePath": "/home/user/code/.worktrees/my-project-worktree-00003"
    }
  }
  ```

- **`create-new-session:end`** - New session created
  ```json
  {
    "event": "create-new-session:end",
    "data": {
      "sessionName": "my-project-worktree-00003",
      "worktreePath": "/home/user/code/.worktrees/my-project-worktree-00003",
      "duration": 5000
    }
  }
  ```

##### Session Discovery Events

- **`check-existing-sessions:start`** - Checking which worktrees have active sessions

- **`check-existing-sessions:end`** - Session check complete
  ```json
  {
    "event": "check-existing-sessions:end",
    "data": {
      "sessionsWithWorktrees": [
        {
          "sessionName": "my-project-worktree-00001",
          "worktreeNumber": "00001",
          "worktreePath": "/path/to/worktree",
          "exists": true
        }
      ],
      "duration": 50
    }
  }
  ```

##### Analysis Events

- **`analyze-worktree-sessions:start`** - Analyzing worktree and session states

- **`analyze-worktree-sessions:end`** - Analysis complete
  ```json
  {
    "event": "analyze-worktree-sessions:end",
    "data": {
      "totalWorktrees": 3,
      "activeSessions": 1,
      "worktreesWithoutSessions": 2,
      "duration": 10
    }
  }
  ```

##### Menu Events

- **`prepare-menu-items:start`** - Building menu items

- **`prepare-menu-items:end`** - Menu preparation complete
  ```json
  {
    "event": "prepare-menu-items:end",
    "data": {
      "menuItemCount": 3,
      "duration": 20
    }
  }
  ```

##### Display Menu Events

- **`display-menu:start`** - Showing interactive menu

  ```json
  {
    "event": "display-menu:start",
    "data": {
      "worktreeCount": 3
    }
  }
  ```

- **`display-menu:end`** - Menu interaction complete

  ```json
  {
    "event": "display-menu:end",
    "data": {
      "duration": 5000
    }
  }
  ```

- **`display-menu:cancel`** - User cancelled menu

  ```json
  {
    "event": "display-menu:cancel",
    "data": {
      "duration": 3000
    }
  }
  ```

- **`display-menu:fail`** - Menu display failed
  ```json
  {
    "event": "display-menu:fail",
    "data": {
      "error": "Failed to display menu: Error message",
      "duration": 100
    }
  }
  ```

##### Selection Events

- **`select-worktree-session:fail`** - User cancelled menu or selection failed
  ```json
  {
    "event": "select-worktree-session:fail",
    "data": {
      "error": "Menu cancelled",
      "errorCode": "MENU_CANCELLED",
      "cancelled": true,
      "duration": 5000
    }
  }
  ```

##### Completion Events

- **`resume-session:end`** - Resume session process complete

  ```json
  {
    "event": "resume-session:end",
    "data": {
      "sessionName": "my-project-worktree-00003",
      "action": "switched",
      "worktreePath": "/home/user/code/.worktrees/my-project-worktree-00003",
      "duration": 100
    }
  }
  ```

  Note: The `action` field can be:

  - `"switched"` - Switched to existing session
  - `"created"` - Created new session
  - When using interactive mode, `worktreePath` may not be included

- **`resume-session:fail`** - Resume session process failed
  ```json
  {
    "event": "resume-session:fail",
    "data": {
      "error": "Worktree '999' not found",
      "errorCode": "WORKTREE_NOT_FOUND",
      "duration": 50
    }
  }
  ```

### 6. finish-session

Finishes a tmux-composer session, syncing changes and cleaning up.

#### Events

##### Initialization Events

- **`finish-session:start`** - Session finishing process begins
  ```json
  {
    "event": "finish-session:start",
    "data": {
      "options": {
        "socketName": null,
        "socketPath": null
      }
    }
  }
  ```

##### Configuration Events

- **`load-configuration:start`** - Loading tmux-composer configuration

- **`load-configuration:end`** - Configuration loaded
  ```json
  {
    "event": "load-configuration:end",
    "data": {
      "hasBeforeFinishCommand": true,
      "duration": 10
    }
  }
  ```

##### Validation Events

- **`validate-composer-session:start`** - Validating this is a composer session

- **`validate-composer-session:end`** - Validation complete

  ```json
  {
    "event": "validate-composer-session:end",
    "data": {
      "isValid": true,
      "sessionName": "my-project-worktree-00001",
      "duration": 5
    }
  }
  ```

- **`get-session-mode:start`** - Getting session mode (worktree/project)

- **`get-session-mode:end`** - Mode retrieved
  ```json
  {
    "event": "get-session-mode:end",
    "data": {
      "mode": "worktree",
      "sessionName": "my-project-worktree-00001",
      "duration": 5
    }
  }
  ```

##### Hook Events

- **`run-before-finish-command:start`** - Running before-finish hook

- **`run-before-finish-command:end`** - Hook completed
  ```json
  {
    "event": "run-before-finish-command:end",
    "data": {
      "command": "npm run test",
      "exitCode": 0,
      "duration": 3000
    }
  }
  ```

##### Worktree Sync Events

- **`sync-worktree-to-main:start`** - Syncing worktree changes to main branch

- **`sync-worktree-to-main:end`** - Sync complete

  ```json
  {
    "event": "sync-worktree-to-main:end",
    "data": {
      "worktreePath": "/path/to/worktree",
      "mainBranch": "main",
      "commitsMerged": 5,
      "duration": 2000
    }
  }
  ```

- **`check-install-dependencies:start`** - Checking and installing dependencies

- **`check-install-dependencies:end`** - Dependencies check complete
  ```json
  {
    "event": "check-install-dependencies:end",
    "data": {
      "worktreePath": "/path/to/worktree",
      "dependenciesInstalled": true,
      "packageManager": "npm",
      "duration": 5000
    }
  }
  ```

##### Session Management Events

- **`find-alternative-session:start`** - Finding alternative session to switch to

- **`find-alternative-session:end`** - Alternative session found

  ```json
  {
    "event": "find-alternative-session:end",
    "data": {
      "currentSession": "my-project-worktree-00001",
      "alternativeSession": "my-project-worktree-00002",
      "hasAlternative": true,
      "duration": 10
    }
  }
  ```

- **`switch-before-kill:start`** - Switching to alternative session

- **`switch-before-kill:end`** - Switch complete

  ```json
  {
    "event": "switch-before-kill:end",
    "data": {
      "fromSession": "my-project-worktree-00001",
      "toSession": "my-project-worktree-00002",
      "duration": 50
    }
  }
  ```

- **`kill-current-session:start`** - Killing the current session

- **`kill-current-session:end`** - Session killed

  ```json
  {
    "event": "kill-current-session:end",
    "data": {
      "sessionName": "my-project-worktree-00001",
      "duration": 20
    }
  }
  ```

- **`finish-session:end`** - Session finishing complete
  ```json
  {
    "event": "finish-session:end",
    "data": {
      "sessionName": "my-project-worktree-00001",
      "mode": "worktree",
      "duration": 10500
    }
  }
  ```

### 7. close-session

Closes the current tmux session, switching to another if available.

#### Events

##### Initialization Events

- **`close-session:start`** - Session closing process begins
  ```json
  {
    "event": "close-session:start",
    "data": {
      "options": {
        "socketName": null,
        "socketPath": null
      }
    }
  }
  ```

##### Session Discovery Events

- **`get-current-session:start`** - Getting current session name

- **`get-current-session:end`** - Current session retrieved

  ```json
  {
    "event": "get-current-session:end",
    "data": {
      "sessionName": "my-project-worktree-00001",
      "duration": 5
    }
  }
  ```

- **`list-all-sessions:start`** - Listing all available sessions

- **`list-all-sessions:end`** - Session list retrieved
  ```json
  {
    "event": "list-all-sessions:end",
    "data": {
      "sessions": ["my-project-worktree-00001", "my-project-worktree-00002"],
      "count": 2,
      "duration": 10
    }
  }
  ```

##### Session Management Events

- **`check-attached-session:start`** - Checking if attached to current session

- **`check-attached-session:end`** - Attachment check complete

  ```json
  {
    "event": "check-attached-session:end",
    "data": {
      "attachedSession": "my-project-worktree-00001",
      "isAttachedToCurrent": true,
      "currentSession": "my-project-worktree-00001",
      "duration": 5
    }
  }
  ```

- **`switch-before-close:start`** - Switching to alternative session before closing

- **`switch-before-close:end`** - Switch complete

  ```json
  {
    "event": "switch-before-close:end",
    "data": {
      "fromSession": "my-project-worktree-00001",
      "toSession": "my-project-worktree-00002",
      "duration": 50
    }
  }
  ```

- **`kill-session:start`** - Killing the session

- **`kill-session:end`** - Session killed

  ```json
  {
    "event": "kill-session:end",
    "data": {
      "sessionName": "my-project-worktree-00001",
      "duration": 20
    }
  }
  ```

- **`close-session:end`** - Session closed successfully
  ```json
  {
    "event": "close-session:end",
    "data": {
      "sessionName": "my-project-worktree-00001",
      "duration": 100
    }
  }
  ```

## Event Flow

### Typical start-session flow:

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
17. `create-tmux-window:agent:start` (if `commands.run-agent` is configured)
18. `create-tmux-window:agent:end`
19. `create-tmux-session:end` (emitted after first window creation)
20. `create-tmux-window:server:start` (if `dev` script exists)
21. `find-open-port:start` (for server window)
22. `find-open-port:end`
23. `create-tmux-window:server:end`
24. `create-tmux-window:{name}:start` (for each script ending in `:watch`)
25. `create-tmux-window:{name}:end`
26. (Repeat for each `:watch` script found)
27. `create-tmux-window:control:start`
28. `create-tmux-window:control:end`
29. `finalize-tmux-session:start`
30. `finalize-tmux-session:end`
31. `create-worktree-session:end`
32. `attach-tmux-session:start` (if --attach)
33. `switch-tmux-session:start` or `attach-tmux-session:end`

### Typical continue-session flow:

1. `initialize-continue-session:start`
2. `initialize-continue-session:end`
3. `continue-session:start`
4. `find-latest-worktree:start`
5. `find-latest-worktree:end`
6. `validate-existing-session:start`
7. `validate-existing-session:end`
8. `analyze-project-structure:start`
9. `analyze-project-structure:end`
10. `analyze-project-scripts:start`
11. `analyze-project-scripts:end`
12. `create-tmux-session:start`
13. Create windows (similar to start-session)
14. `create-tmux-session:end`
15. `continue-session:end`
16. `set-tmux-composer-mode:start`
17. `set-tmux-composer-mode:end`
18. `attach-tmux-session:start` (if --attach)
19. `attach-tmux-session:end`

### Typical resume-session flow:

#### Interactive mode (default):

1. `resume-session:start`
2. `find-all-worktrees:start`
3. `find-all-worktrees:end`
4. `check-existing-sessions:start`
5. `check-existing-sessions:end`
6. `analyze-worktree-sessions:start`
7. `analyze-worktree-sessions:end`
8. `prepare-menu-items:start`
9. `prepare-menu-items:end`
10. `display-menu:start`
11. User selects option
12. `display-menu:end` or `display-menu:cancel`
13. `resume-session:end` or `select-worktree-session:fail`

#### Direct mode (--worktree):

1. `resume-session:start`
2. `find-all-worktrees:start`
3. `find-all-worktrees:end`
4. `find-worktree:start`
5. `find-worktree:end` or `find-worktree:fail`
6. If worktree found:
   - `check-session-exists:start`
   - `check-session-exists:end`
   - If session exists and attach is true:
     - `switch-to-existing-session:start`
     - `switch-to-existing-session:end`
   - If session doesn't exist:
     - `create-new-session:start`
     - (continue-session events...)
     - `create-new-session:end`
7. `resume-session:end` or `resume-session:fail`

### Typical finish-session flow:

1. `finish-session:start`
2. `load-configuration:start`
3. `load-configuration:end`
4. `validate-composer-session:start`
5. `validate-composer-session:end`
6. `get-session-mode:start`
7. `get-session-mode:end`
8. `run-before-finish-command:start` (if configured)
9. `run-before-finish-command:end`
10. For worktree mode:
    - `sync-worktree-to-main:start`
    - `sync-worktree-to-main:end`
    - `check-install-dependencies:start`
    - `check-install-dependencies:end`
11. `find-alternative-session:start`
12. `find-alternative-session:end`
13. `switch-before-kill:start` (if attached and alternatives exist)
14. `switch-before-kill:end`
15. `kill-current-session:start`
16. `kill-current-session:end`
17. `finish-session:end`

### Typical close-session flow:

1. `close-session:start`
2. `get-current-session:start`
3. `get-current-session:end`
4. `list-all-sessions:start`
5. `list-all-sessions:end`
6. `check-attached-session:start`
7. `check-attached-session:end`
8. `switch-before-close:start` (if attached and alternatives exist)
9. `switch-before-close:end`
10. `kill-session:start`
11. `kill-session:end`
12. `close-session:end`

## Error Handling

All `:fail` events include:

- `error`: Human-readable error message
- `errorCode`: Machine-readable error code (when applicable)
- `duration`: Time elapsed before failure (in milliseconds)

Common error codes:

- `DIRTY_REPOSITORY`: Repository has uncommitted changes (both worktree and non-worktree modes)
- `SESSION_EXISTS`: Session with same name already exists
- `MISSING_PACKAGE_JSON`: No package.json found
- `TMUX_SERVER_FAILED`: Tmux server failed to start
- `PANE_NOT_READY`: Pane did not become ready within timeout
- `NO_WORKTREES`: No worktrees found for the repository
- `WORKTREE_NOT_FOUND`: Specified worktree not found (resume-session --worktree)
- `INVALID_WORKTREE_NAME`: Worktree name doesn't match expected pattern
- `NOT_COMPOSER_SESSION`: Command used on non-composer session
- `INVALID_MODE`: Invalid TMUX_COMPOSER_MODE value
- `SESSION_NOT_FOUND`: Failed to get current tmux session
- `CONFIG_LOAD_FAILED`: Failed to load configuration
- `BEFORE_FINISH_FAILED`: Before-finish command failed
- `SYNC_FAILED`: Failed to sync worktree to main branch
- `DEPS_INSTALL_FAILED`: Failed to install dependencies
- `SWITCH_FAILED`: Failed to switch sessions
- `KILL_FAILED`: Failed to kill session
- `LIST_SESSIONS_FAILED`: Failed to list tmux sessions
- `SET_MODE_FAILED`: Failed to set TMUX_COMPOSER_MODE
- `MENU_CANCELLED`: User cancelled interactive menu

## ZeroMQ Publishing

When ZeroMQ is enabled (default), events are also published to:

- Socket: `ipc:///tmp/tmux-composer-events.sock`
- Topic: All events published to single topic
- Format: UTF-8 JSON strings

All session commands support ZeroMQ options:

- `--no-zmq`: Disable ZeroMQ publishing
- `--zmq-socket <name>`: Custom ZeroMQ socket name
- `--zmq-socket-path <path>`: Custom ZeroMQ socket full path

## Observing Events

Use the `observe-observers` command to monitor all events:

```bash
# Output to stdout
tmux-composer observe-observers

# Pretty print with jq
tmux-composer observe-observers | jq .

# Also expose via WebSocket on port 31337
tmux-composer observe-observers --ws
```
