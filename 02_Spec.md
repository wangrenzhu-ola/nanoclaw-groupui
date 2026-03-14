# 02_Spec.md - NanoClaw WebUI 规格说明书

## 1. 概述 (Overview)

本规格说明书基于 `01_Proposal.md` 提案，详细定义了 NanoClaw WebUI 的功能、数据、API 及交互规范。系统旨在为 NanoClaw 提供一套完全私有化、可视化的管理界面，实现沉浸式聊天体验与全功能 Agent 管理。

## 2. 用户角色权限 (User Roles & Permissions)

本系统为**单租户私有化系统**，主要面向内部管理员使用。

| 角色               | 权限描述                                                                                                                                                                                | 备注                                                      |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| **Admin (管理员)** | 拥有所有权限：<br>1. 访问所有聊天会话（群聊/单聊）。<br>2. 管理所有 Agent（创建/编辑/配置/权限）。<br>3. 发送文本/图片消息，使用 @mention 和 @everyone。<br>4. 查看系统日志和任务状态。 | 默认唯一的登录角色，通过 Basic Auth 或 NextAuth.js 认证。 |
| **Agent (机器人)** | 被动响应角色：<br>1. 接收并响应被提及的消息 (@mention)。<br>2. 响应群广播 (@everyone)。<br>3. 执行定时任务并推送结果。                                                                  | 由 NanoClaw Core 驱动，非人类用户。                       |

## 3. 功能规格 (Functional Specifications)

### 3.1 聊天控制台 (Chat Console)

#### 3.1.1 会话列表

- **展示内容**：左侧侧边栏展示所有 Registered Groups (Agents) 和群组 (Groups)。
- **分类**：
  - **Direct Messages (1v1)**: 与单个 Agent 的私聊。
  - **Channels (群组)**: 多 Agent 参与的群聊。
- **状态指示**：展示 Agent 在线状态（基于 Docker 容器运行状态）和最后活跃时间。
- **操作**：搜索会话、点击切换会话、创建新群组。

#### 3.1.2 消息交互

- **发送消息**：
  - 支持 Markdown 格式文本。
  - 支持上传图片（jpg, png, webp），限制 10MB/张，本地预览。
- **接收消息**：
  - 流式显示 (Streaming) Agent 回复。
  - 实时渲染 Markdown 和代码高亮。
  - 实时显示图片消息。
- **群聊特性**：
  - **@mention**: 输入 `@` 触发 Agent 列表，选择特定 Agent 回复。
  - **@everyone**: 广播消息给群内所有 Agent。
  - **群管理**: 创建群组、添加 Agent 到群组、从群组移除 Agent。

#### 3.1.3 实时同步

- **Socket.io**: 建立 WebSocket 连接，实时接收：
  - Agent 的异步回复（如定时任务触发的消息）。
  - Agent 状态变更（启动/停止）。

### 3.2 Agent 资料页 (Agent Profile)

#### 3.2.1 基本信息

- **展示**：头像、名称 (Name)、触发词 (Trigger)、文件夹路径 (Folder)、创建时间、最后活跃时间。
- **编辑**：允许修改名称和触发词。

#### 3.2.2 核心配置 (Configuration)

- **Docker 沙箱**：
  - 展示当前 `containerConfig.additionalMounts` 列表。
  - 操作：新增/编辑/删除挂载点（Host Path <-> Container Path，Readonly 开关）。
- **记忆 (Soul)**：
  - 集成 Markdown 编辑器。
  - 读取/保存 `groups/{folder}/CLAUDE.md` 文件内容。

#### 3.2.3 任务管理 (Tasks)

- **列表**：展示该 Agent 关联的所有 Scheduled Tasks。
- **字段**：ID, Schedule (Cron/Interval), Prompt, Status (Active/Paused), Next Run。
- **操作**：暂停/恢复任务，手动触发一次。

#### 3.2.4 权限控制 (Security)

- **白名单管理**：
  - 读取 `sender-allowlist.json`。
  - 配置该 Agent 的允许发送者列表 (Allow List) 和模式 (Trigger/Drop)。

## 4. 数据规格 (Data Specifications)

### 4.1 数据库模式 (SQLite Schema)

_复用 NanoClaw 现有的 `messages.db`，并可能通过 Prisma 扩展（如果需要存储 WebUI 特有数据，暂定复用现有表结构）。_

- **registered_groups**: Agent 注册表。
- **tasks**: 定时任务表。
- **messages**: 消息记录表（NanoClaw 核心表）。
- **chats**: 会话元数据表。

### 4.2 文件存储 (File System)

- **Agent Config**: `groups/{folder}/config.json` (如果 NanoClaw 支持) 或直接操作 DB。
- **Soul Memory**: `groups/{folder}/CLAUDE.md`。
- **Images**: `groups/{folder}/uploads/{filename}`。
  - 命名规则：`{timestamp}_{uuid}.{ext}`。
  - 访问路径：`/api/uploads/{folder}/{filename}` (需鉴权)。
- **Security Config**: `~/.config/nanoclaw/sender-allowlist.json`。

## 5. API 规格 (API Specifications)

采用 Next.js API Routes (App Router Route Handlers)。

### 5.1 Agent 管理

- `GET /api/agents`: 获取所有 Agent 列表。
- `GET /api/agents/{id}`: 获取特定 Agent 详情。
- `PATCH /api/agents/{id}`: 更新 Agent 配置（名称、触发词）。
- `GET /api/agents/{id}/memory`: 获取 `CLAUDE.md` 内容。
- `POST /api/agents/{id}/memory`: 保存 `CLAUDE.md` 内容。
- `POST /api/agents/{id}/mounts`: 更新 Docker 挂载配置。

### 5.2 消息与聊天

- `GET /api/chats`: 获取会话列表。
- `GET /api/chats/{id}/messages`: 获取历史消息（分页）。
- `POST /api/chats/{id}/messages`: 发送消息（支持文本/图片）。
  - Payload: `{ content: string, images?: File[], mentions?: string[] }`。
- `POST /api/chats/group`: 创建新群组。
- `POST /api/chats/group/{id}/members`: 管理群成员。

### 5.3 任务管理

- `GET /api/tasks`: 获取任务列表。
- `PATCH /api/tasks/{id}/status`: 暂停/恢复任务。

### 5.4 认证

- `POST /api/auth/signin`: 登录 (Basic Auth/NextAuth)。

## 6. UI/UX 规格 (UI/UX Specifications)

### 6.1 布局 (Layout)

- **响应式设计**：适配 Desktop (侧边栏展开) 和 Mobile (侧边栏抽屉)。
- **主题**：Dark Mode (默认，符合开发者习惯)。

### 6.2 交互细节

- **输入框**：
  - 支持 `Shift + Enter` 换行，`Enter` 发送。
  - 输入 `@` 时弹出 Agent 建议列表 (Popover)。
  - 粘贴图片直接上传并预览。
- **流式反馈**：
  - Agent 回复时显示打字机效果。
  - 底部显示 "Agent is thinking..." 状态指示器。
- **图片预览**：
  - 点击缩略图进入全屏 Lightbox 模式查看原图。

### 6.3 视觉风格

- **色彩**：Slate/Zinc 色系为主，Primary Color 使用 Indigo 或 Violet。
- **字体**：Inter 或 System UI Font，代码块使用 JetBrains Mono / Fira Code。
- **组件库**：基于 Shadcn/ui (Radix UI + Tailwind) 构建，保证一致性和可访问性。

---

**请审核以上规格说明书。**
