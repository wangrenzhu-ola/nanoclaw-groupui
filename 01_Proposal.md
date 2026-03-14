# 01_Proposal.md - NanoClaw WebUI 开发提案

## 1. 项目背景

NanoClaw 目前主要通过 CLI 或第三方聊天应用（WhatsApp, Telegram 等）进行交互，缺乏一个原生的、可视化的管理和交互界面。本项目的目标是为 NanoClaw 开发一套**完全私有化**的 WebUI，提供类似 ChatGPT 的聊天体验，并集成强大的 Agent（即 Registered Group）管理功能，包括 Docker 沙箱配置、定时任务管理和权限控制。

## 2. 核心目标

构建一个基于 **Next.js + NanoClaw Core** 的现代化 Web 界面，实现：

1.  **沉浸式聊天体验**：支持流式响应、富文本编辑（TipTap）、多会话切换、**群聊与广播**、**图片发送**。
2.  **全功能 Agent 管理**：可视化的 Agent 资料页，管理配置、记忆、任务和权限。
3.  **完全私有化**：所有数据存储在本地，仅依赖 NanoClaw 现有的 SQLite 和文件系统，具备**内部安全认证**。

## 3. MVP 功能清单

### 3.1 聊天控制台 (Chat Console)

- **左侧侧边栏**：展示所有 Registered Groups (Agents) 列表，支持搜索和切换。
- **对话区域**：
  - 流式显示 Agent 回复 (Streaming Response)。
  - 支持 Markdown 渲染。
  - **群聊功能**：支持创建新群组、加入/退出群组，明确区分群聊与单 Agent 1v1 会话。
  - **Mention & 广播**：输入框支持 `@mention` (提及特定 Agent)，新增 `@everyone` 实现全员广播消息。
  - **图片发送功能**：
    - 支持群聊、单 Agent 1v1 会话中上传、发送图片，适配 MiniMax 2.5 图片支持特性，可正常调用 MiniMax API 进行图片相关交互。
    - 图片支持预览（点击放大）、查看原图，上传后与文本消息、流式响应同步显示，不影响原有聊天体验。
    - 图片存储遵循完全私有化要求，仅保存至本地文件系统（与 Agent 配置文件同目录），不上传任何第三方云服务，确保数据安全。
- **实时同步**：使用 Socket.io 实时接收来自 NanoClaw 后端的后台消息（如定时任务执行结果）。
- **内部安全认证**：集成 Basic Auth 或 NextAuth.js (Credentials Provider)，仅限内部人员登录，保障私有化部署的安全性。

### 3.2 Agent 资料页 (Agent Profile)

- **入口**：侧边栏点击 Agent 头像/名称进入详情页。
- **通用信息**：
  - Agent 名称 (Name)
  - 触发词 (Trigger)
  - 对应文件夹 (Folder)
  - **创建时间 (Created At)**
  - **最后活跃时间 (Last Active)**
- **核心配置 (Configuration)**：
  - **Docker 沙箱 (Sandbox)**: 可视化管理 `containerConfig.additionalMounts` (挂载宿主机路径到容器)。
  - **记忆 (Memory)**: 查看和编辑 `groups/{folder}/CLAUDE.md` (即 Agent 的 Soul)。
- **任务管理 (Tasks/Heartbeat)**：
  - 列出该 Agent 下的所有 `ScheduledTask`。
  - 支持暂停/恢复任务，查看下次运行时间。
- **权限控制 (Security)**：
  - 管理 `sender-allowlist.json` 中针对该 Agent 的白名单配置。

## 4. 技术栈确认

严格遵循用户约束：

- **Frontend**: React, Next.js 14+ (App Router), Tailwind CSS, TipTap (Editor), Vercel AI SDK (UI Components).
- **Backend**: Next.js API Routes (BFF), Socket.io (Server), Prisma (ORM).
- **Data**: SQLite (NanoClaw `messages.db`), File System (Config files).
- **Infra**: Docker Compose (用于部署 WebUI 容器，与 NanoClaw 容器网络互通).
- **Model**: MiniMax API (通过 Vercel AI SDK 或 NanoClaw Core 转发).

## 5. NanoClaw 与 OpenClaw 结构对比 (调研结果)

为了满足“新增Agent资料页要求”，我们对比了两者结构：

| OpenClaw 概念        | NanoClaw 对应实现            | WebUI 展示策略                                                       |
| :------------------- | :--------------------------- | :------------------------------------------------------------------- |
| **Soul** (人设)      | `groups/{folder}/CLAUDE.md`  | 提供 Markdown 编辑器直接修改 `CLAUDE.md`                             |
| **Tool** (能力)      | Skills (全局安装) + Mounts   | 展示已安装 Skills (全局)，重点管理 `additionalMounts` (文件访问权限) |
| **Heartbeat** (心跳) | `ScheduledTask` (DB Table)   | 列表展示 Cron/Interval 任务，提供开关和日志查看                      |
| **Config** (配置)    | `RegisteredGroup` (DB Table) | 表单编辑 Name, Trigger, Container Config                             |

## 6. 风险评估

1.  **数据库锁 (Database Locking)**: NanoClaw 主进程和 WebUI (Prisma) 同时操作 SQLite 可能会遇到锁问题。
    - _对策_: WebUI 尽量只读，写操作通过 IPC 或 确保短事务；或者 WebUI 仅作为 Viewer，写操作调用 NanoClaw 的 CLI/API (如果存在)。考虑到 NanoClaw 架构，Prisma 直连 SQLite 是最简单的，但需注意 WAL 模式。
2.  **配置热重载**: 修改 `CLAUDE.md` 或 `sender-allowlist.json` 后，NanoClaw 是否需要重启？
    - _对策_: NanoClaw 通常在运行时读取这些文件，或者通过文件监听 (IPC Watcher) 自动重载。无需重启。
3.  **Socket.io 集成**: Next.js App Router 对 WebSocket 支持有限。
    - _对策_: 需要一个独立的 Server 入口 (Custom Server) 或者将 Socket.io 挂载在 Next.js 的 HTTP Server 上。
4.  **MiniMax API 调用兼容性风险**: MiniMax 的流式响应格式可能与 Vercel AI SDK 或 NanoClaw Core 默认预期不完全一致。
    - _对策_: 提前在 NanoClaw Core 或 WebUI BFF 层适配 MiniMax 的响应结构，确保 SSE (Server-Sent Events) 流式解析正常，避免因格式差异导致的聊天卡顿或乱码。
5.  **图片上传与渲染兼容性风险**: 图片格式、大小不兼容 MiniMax API，或本地存储路径配置不当，导致图片无法发送、渲染，或与 Socket.io 实时同步异常。
    - _对策_: 适配 MiniMax 2.5 支持的图片格式（jpg、png、webp 等），限制单张图片上传大小（建议不超过 10MB）；图片存储路径与 NanoClaw 本地文件系统保持一致，挂载至宿主机持久化目录，确保 WebUI 与 NanoClaw 容器可正常访问，同时优化图片渲染逻辑，避免影响流式响应流畅度。

## 7. 部署初步规划

为了实现完全私有化且与 NanoClaw 无缝集成，我们将采用 **Docker Compose** 进行编排：

1.  **网络互通**: WebUI 容器将与 NanoClaw 主容器（及 Agent 容器）加入同一个 Docker Network (`nanoclaw-net`)，确保可以直接访问 NanoClaw 暴露的内部端口（如 IPC 或 API）。
2.  **数据持久化与共享**:
    - **SQLite**: 将宿主机的 `store/messages.db` 同时挂载到 NanoClaw 和 WebUI 容器中（WebUI 需以只读模式挂载或处理好 WAL 锁）。
    - **配置文件**: 挂载宿主机的 `groups/` 目录和 `~/.config/nanoclaw/`，以便 WebUI 可以读取和修改 Agent 配置及白名单。
3.  **端口映射**: WebUI 容器暴露端口（如 3000），宿主机通过反向代理（可选 Nginx）或直接访问，配合 Basic Auth 实现安全访问。

## 8. 时间预估

- **Phase 1 (Spec & Design)**: 1 天
- **Phase 2 (Chat UI & Integration)**: 2 天
- **Phase 3 (Agent Profile & Management)**: 2 天
- **Phase 4 (Testing & Refinement)**: 1 天

---

**请审核以上提案。**
