# NanoClaw Deployment Guide

This guide details the environment requirements and steps to deploy NanoClaw locally with Docker Compose.

## 1. Environment Requirements

Ensure your environment matches these specifications for reproducibility:

- **OS**: macOS (Apple Silicon recommended) or Linux (x86_64/arm64). Windows via WSL2.
- **Node.js**: v20.18.0 or higher (LTS Iron).
- **Docker**: Docker Desktop 4.30+ or Docker Engine 26.1+.
- **Compose**: Docker Compose v2.27+.

### Verification
```bash
node -v
docker --version
docker compose version
```

## 2. Quick Start (Real LLM Mode)

To run with a real MiniMax or Anthropic API key (Required):

### Steps

1. **Clone & Setup**
   ```bash
   git clone <repo-url> nanoclaw
   cd nanoclaw/nanoclaw-groupui
   ```

2. **Configure API Key**
   Edit `docker-compose.yml` and set your API key:
   ```yaml
   environment:
     - ANTHROPIC_BASE_URL=https://api.minimax.chat/v1
     - ANTHROPIC_AUTH_TOKEN=sk-your-key-here
     - MODEL_NAME=abab6.5s-chat
   ```

3. **Build & Run**
   ```bash
   docker-compose up -d --build
   ```

4. **Verify**
   - Open [http://localhost](http://localhost) (Nginx proxy) or [http://localhost:3000](http://localhost:3000) (Direct).
   - Login: `admin` / `admin`.
   - Select "Test Agent".
   - Send "Hello".
   - **Expected**: You see a real response from the LLM streaming back.

### Logs
To debug, view logs:
```bash
docker-compose logs -f core
docker-compose logs -f webui
```

## 3. Data Persistence

## 4. Data Persistence

Data is persisted in `./groups` directory on the host.
- **Database**: `./groups/messages.db`
- **Memory**: `./groups/{agent}/CLAUDE.md`
- **Uploads**: `./groups/{agent}/uploads/`

Restarting containers (`docker-compose restart`) will preserve this data.
