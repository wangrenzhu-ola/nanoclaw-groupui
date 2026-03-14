# NanoClaw WebUI User Guide

## Introduction
NanoClaw WebUI provides a modern, responsive interface for managing your NanoClaw agents, viewing chat history, and configuring agent memory.

## Deployment

### Prerequisites
- Docker and Docker Compose installed.

### Quick Start
1. Ensure you are in the project root.
2. Run:
   ```bash
   docker-compose up -d --build
   ```
3. Access the WebUI at: http://localhost

### Configuration
The WebUI is configured via environment variables in `docker-compose.yml`:
- `ADMIN_PASSWORD`: Password for login (default: `admin`).
- `AUTH_SECRET`: Secret for session encryption.
- `DATABASE_URL`: Path to SQLite database (inside container).
- `GROUPS_PATH`: Path to groups directory (inside container).

## Usage

### Login
- **Username**: `admin` (Fixed)
- **Password**: `admin` (Default, change in `docker-compose.yml`)

### Creating Agents
1. Click the **+** button in the sidebar "Channels" section.
2. Enter Agent Name (e.g., "Research Agent").
3. Enter JID (e.g., `research@nanoclaw`).
4. Enter Folder Name (e.g., `research`).
5. Click **Create**.

### Chatting
- Select an agent from the sidebar.
- Type messages in the input box.
- Upload images using the image icon.
- Messages are saved to the database and processed by NanoClaw Core.

### Agent Configuration
- Click **View Details** in the chat header or navigate to the agent profile.
- **Memory Tab**: Edit `CLAUDE.md` to change the agent's system prompt and context.
- **Security Tab**: Edit `sender-allowlist.json` to control who can message this agent.

## Troubleshooting
- If chat doesn't load, check if `nanoclaw-core` is running.
- If images fail to upload, check permissions on `groups/` directory.
- Logs: `docker-compose logs -f webui`
