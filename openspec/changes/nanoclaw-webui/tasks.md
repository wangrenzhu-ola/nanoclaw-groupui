# 任务清单：NanoClaw WebUI

此任务清单将 NanoClaw WebUI 的开发工作分解为可管理、可验证的步骤。

## 后端开发 (Backend Development)

- [ ] **Task 1.1: 项目初始化** <!-- id: 1.1 -->
  - **描述**: 初始化一个新的 Next.js 14+ (App Router) 项目，包含 TypeScript, Tailwind CSS 和 Shadcn/ui。设置用于 Socket.io 集成的自定义服务器 (`server.ts`)。
  - **前置任务**: 无
  - **验收标准**: 项目成功构建并运行。`npm run dev` 启动自定义服务器。HTTP 和 WebSocket 连接可在同一端口上正常工作。

- [ ] **Task 1.2: 数据库与 Prisma 设置** <!-- id: 1.2 -->
  - **描述**: 配置 Prisma 使用 SQLite。根据 `design.md` 定义 Schema。运行迁移以创建 `messages.db`。
  - **前置任务**: Task 1.1
  - **验收标准**: `npx prisma db push` 成功执行。`messages.db` 创建成功，包含表：`RegisteredGroup`, `ScheduledTask`, `Message`, `Chat`。

- [ ] **Task 1.3: 认证实现** <!-- id: 1.3 -->
  - **描述**: 使用 CredentialsProvider 实现 NextAuth.js。通过中间件保护 `/api/*` 路由和仪表盘页面。
  - **前置任务**: Task 1.1
  - **验收标准**: 访问根 URL 重定向至登录页。有效凭证可进入。无效凭证显示错误。

- [ ] **Task 1.4: API 路由 - Agents** <!-- id: 1.4 -->
  - **描述**: 实现 Agent 的 CRUD API 路由 (`/api/agents`)。支持从文件系统读写 `CLAUDE.md` 和 `sender-allowlist.json`。
  - **前置任务**: Task 1.2
  - **验收标准**: `GET /api/agents` 返回 Agent 列表。`PATCH` 更新 Agent 配置。`POST` 更新记忆/白名单。

- [ ] **Task 1.5: API 路由 - 聊天与消息** <!-- id: 1.5 -->
  - **描述**: 实现获取聊天记录 (`/api/chats`) 和发送消息 (`POST /api/messages`) 的 API 路由。通过 `multipart/form-data` 处理图片上传。
  - **前置任务**: Task 1.2
  - **验收标准**: 可以获取和保存消息。图片保存到本地磁盘并返回 URL。

- [ ] **Task 1.6: Socket.io 实时层** <!-- id: 1.6 -->
  - **描述**: 实现 Socket.io 事件：`client:message`, `agent:typing`, `agent:response`。集成文件监听器，将 NanoClaw Core 的日志/输出流式传输到前端。
  - **前置任务**: Task 1.1, Task 1.5
  - **验收标准**: 发送消息触发 Socket 事件。写入模拟日志文件会在客户端触发 `agent:response` 事件。

## 前端开发 (Frontend Development)

- [ ] **Task 2.1: 布局与导航** <!-- id: 2.1 -->
  - **描述**: 创建包含响应式侧边栏的 App Shell 布局。实现从 API 获取数据的“私聊”和“群组”列表。
  - **前置任务**: Task 1.4
  - **验收标准**: 侧边栏显示 Agent/群组。聊天间导航正常工作。移动端响应式正常。

- [ ] **Task 2.2: 聊天控制台 UI** <!-- id: 2.2 -->
  - **描述**: 构建主聊天界面。实现带自动滚动的消息列表。构建带自动扩展文本框和图片上传按钮的输入区域。
  - **前置任务**: Task 2.1
  - **验收标准**: 消息正确渲染（用户右侧，Agent 左侧）。Markdown 渲染正常。输入区域可处理文本和图片。

- [ ] **Task 2.3: 实时聊天集成** <!-- id: 2.3 -->
  - **描述**: 将聊天控制台连接到 Socket.io。处理 `agent:response` 以实现流式文本（打字机效果）。实现已发送消息的乐观更新。
  - **前置任务**: Task 1.6, Task 2.2
  - **验收标准**: 消息即时显示。Agent 回复逐字流式显示。

- [ ] **Task 2.4: Agent 资料页** <!-- id: 2.4 -->
  - **描述**: 创建 Agent 详情页面。实现概览、记忆（Markdown 编辑器）、任务、沙箱和安全标签页。
  - **前置任务**: Task 1.4
  - **验收标准**: Agent 详情加载成功。可以编辑并保存记忆。

- [ ] **Task 2.5: 群组与提及功能** <!-- id: 2.5 -->
  - **描述**: 在输入区域实现 `@mention` 弹出层。添加“创建群组”模态框。处理 `@everyone` 高亮显示。
  - **前置任务**: Task 2.3
  - **验收标准**: 输入 `@` 显示 Agent 列表。创建群组后添加到侧边栏。

## 测试与验证 (Testing & Validation)

- [ ] **Task 3.1: 单元测试** <!-- id: 3.1 -->
  - **描述**: 使用 `webapp-testing` 技能为工具函数（Markdown 解析器、日期格式化）和 API 路由处理程序编写单元测试。
  - **前置任务**: Task 1.5
  - **验收标准**: 所有单元测试通过。

- [ ] **Task 3.2: 集成测试** <!-- id: 3.2 -->
  - **描述**: 测试从 API -> DB -> 文件系统的流程。验证 Socket.io 连接和事件处理。补充 “图片上传与 MiniMax API 交互” 的测试场景。
  - **前置任务**: Task 1.6
  - **验收标准**: 集成测试通过。数据库和文件系统状态一致。图片功能对接无异常。

- [ ] **Task 3.3: 端到端测试** <!-- id: 3.3 -->
  - **描述**: 使用 Playwright/Cypress（通过 `webapp-testing` 技能）测试完整用户流程：登录 -> 选择 Agent -> 发送消息 -> 接收回复。
  - **前置任务**: Task 2.5
  - **验收标准**: E2E 场景通过。关键路径（聊天、配置）已验证。

## 部署与交付 (Deployment & Delivery)

- [ ] **Task 4.1: Docker 设置** <!-- id: 4.1 -->
  - **描述**: 为 WebUI 创建 `Dockerfile`。更新 `docker-compose.yml` 以包含 WebUI、Nginx 和 NanoClaw Core，确保共享卷和网络配置正确。
  - **前置任务**: Task 3.3
  - **验收标准**: `docker-compose up` 启动所有服务。容器间可通信。重启后数据持久化。

- [ ] **Task 4.2: 文档编写** <!-- id: 4.2 -->
  - **描述**: 编写 `README.md`（部署指南）和 `USER_GUIDE.md`。包含测试账号凭证。补充docker-compose.yml关键配置说明。
  - **前置任务**: Task 4.1
  - **验收标准**: 文档完整准确。指令可验证。

- [ ] **Task 4.3: 最终验收** <!-- id: 4.3 -->
  - **描述**: 使用测试账号进行最终人工验证。确保满足 `spec.md` 中的所有需求。
  - **前置任务**: Task 4.2
  - **验收标准**: 系统功能完整。无关键 Bug。准备好移交。
