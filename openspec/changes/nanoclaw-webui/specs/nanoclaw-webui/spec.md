# Delta for NanoClaw WebUI

## ADDED Requirements

### Requirement: NCW-V2 Baseline Capability Set

The system MUST deliver the NCW-FR-001~NCW-FR-028 capability set for private Slack-style AI collaboration, and MUST keep compatibility with Socket.io, local persistence, and MiniMax integration.

#### Scenario: Baseline capability set is available

- GIVEN the change `nanoclaw-webui` is deployed
- WHEN QA executes baseline acceptance suites
- THEN all baseline requirements NCW-FR-001~NCW-FR-028 MUST be testable and traceable
- AND deployment compatibility constraints MUST be satisfied

# NanoClaw WebUI 规格说明书（spec.md）

## 0. 文档元数据

| 字段     | 内容                                                    |
| -------- | ------------------------------------------------------- |
| 文档 ID  | OSP-NCW-SPEC-001                                        |
| 版本     | v2.0                                                    |
| 状态     | Draft-Ready for Review                                  |
| 生效日期 | 2026-03-15                                              |
| 责任人   | 产品架构组 / 技术架构组 / QA 负责人                     |
| 需求规范 | RFC 2119（MUST / MUST NOT / SHOULD / SHOULD NOT / MAY） |
| 场景规范 | BDD（Given-When-Then）                                  |

## 1. 范围边界

1. 本规格覆盖 NanoClaw WebUI 的会话、消息、权限、通知、搜索、文件与部署验收要求。
2. 本规格 MUST 兼容既有 NanoClaw 私有化架构，不改变 Core 语义。
3. 本规格 MUST NOT 引入第三方云存储或云消息中间件依赖。

## 2. 术语定义

| 术语      | 定义                                               |
| --------- | -------------------------------------------------- |
| Workspace | 私有化部署实例内的协作域                           |
| Channel   | 频道会话，分公开（Public）与私有（Private）        |
| DM        | 私信会话，包含 1v1 与 Group DM                     |
| Thread    | 由单条主消息派生的子会话                           |
| Agent     | NanoClaw RegisteredGroup 语义实体                  |
| Soul      | Agent 全局人格配置文件 `groups/{folder}/CLAUDE.md` |
| Sandbox   | Agent 容器挂载与隔离配置                           |
| Audit Log | 关键操作审计记录（操作者、时间、内容、IP）         |

## 3. 依赖与约束

1. 前端 MUST 基于 Next.js App Router 与现有 UI 组件体系实现。
2. 实时层 MUST 使用 Socket.io，并支持 ACK 与重连恢复。
3. 数据层 MUST 使用 SQLite 与本地文件系统。
4. LLM 接入 MUST 兼容 MiniMax API 既有调用方式。
5. 部署 MUST 支持 Docker Compose 与容器网络互通。

## 4. 功能需求（RFC 2119）

### 4.1 会话结构与导航

#### Requirement NCW-FR-001: 侧边栏分区

系统 MUST 将侧边栏分为 `Channels`、`Direct Messages`、`Agents` 三个逻辑分区；各分区数据 MUST 独立加载与缓存。

#### Requirement NCW-FR-002: 私信能力

系统 MUST 支持用户与 Agent 的 1v1 DM；系统 MUST 支持 2 人及以上 Group DM，并与频道数据隔离。

#### Requirement NCW-FR-003: 频道类型与归档

系统 MUST 支持公开频道与私有频道；频道关闭操作 SHOULD 采用归档（Archive）代替物理删除；物理删除 MUST 仅限管理员执行。

#### Scenario: 创建公开频道成功

Given 用户角色为工作区管理员  
When 用户创建公开频道并提交合法名称  
Then 频道 MUST 在 2 秒内显示于 `Channels` 列表  
And 系统 MUST 自动跳转至该频道会话页且不出现 404

#### Scenario: 私有频道越权访问失败

Given 用户不是目标私有频道成员  
When 用户通过 URL 直接访问频道页面  
Then 系统 MUST 返回 403 页面  
And 页面 MUST 不渲染任何频道消息内容

#### Scenario: 频道归档边界

Given 频道已有历史消息与文件  
When 频道管理员执行归档  
Then 频道 MUST 从默认会话列表隐藏  
And 历史数据 MUST 可被管理员检索恢复

### 4.2 线程（Threads）

#### Requirement NCW-FR-004: 线程视图

系统 MUST 支持“基于单条消息开启线程”，线程在右侧抽屉展示；主会话与线程会话 MUST 分离渲染。

#### Requirement NCW-FR-005: 线程状态

线程 MUST 支持未读计数与归档状态；线程归档后 MUST NOT 接受新回复。

#### Scenario: 开启线程并回复

Given 频道中存在一条主消息  
When 用户点击“在线程中回复”并发送内容  
Then 右侧线程抽屉 MUST 打开  
And 回复 MUST 仅写入线程消息流，不写入主频道流

#### Scenario: 已归档线程禁止写入

Given 线程状态为 Archived  
When 用户尝试发送新回复  
Then 系统 MUST 拒绝写入并返回明确错误码  
And UI MUST 显示“线程已归档，无法回复”

### 4.3 消息能力

#### Requirement NCW-FR-006: 消息操作

系统 MUST 支持编辑、撤回、引用回复、Emoji 反应、复制、转发。

#### Requirement NCW-FR-007: 编辑与撤回约束

编辑与撤回 MUST 支持时限约束；默认时限 MAY 配置为 15 分钟。

#### Scenario: 编辑消息成功

Given 用户在可编辑时限内  
When 用户编辑并保存消息  
Then 消息内容 MUST 更新  
And 消息元数据 MUST 标记 `edited=true` 与编辑时间

#### Scenario: 超时撤回失败

Given 用户消息发送时间超过撤回时限  
When 用户点击撤回  
Then 系统 MUST 返回 `MESSAGE_RECALL_EXPIRED`  
And 原消息 MUST 保持可见

#### Scenario: Emoji 反应并发

Given 多用户同时对同一消息添加同一 Emoji  
When 并发提交反应  
Then 系统 MUST 合并计数且不产生重复用户记录

### 4.4 提及体系与状态

#### Requirement NCW-FR-008: 提及类型

系统 MUST 支持 `@agent`、`@everyone`、`@here` 三类提及。

#### Requirement NCW-FR-009: 空频道约束

频道无 Agent 成员时，系统 MUST NOT 弹出 `@agent` 选择列表；系统 SHOULD 提示“请先邀请 Agent”。

#### Requirement NCW-FR-010: `@here` 语义

`@here` MUST 仅触发当前频道在线 Agent，不触发离线 Agent。

#### Scenario: `@here` 精确触发

Given 频道内有 2 个在线 Agent、1 个离线 Agent  
When 用户发送包含 `@here` 的消息  
Then 在线 Agent MUST 被触发  
And 离线 Agent MUST NOT 被触发

#### Scenario: 提及高亮与未读聚合

Given 用户在其他页面未打开目标频道  
When 该用户被 `@agent` 或 `@here` 提及  
Then 侧边栏 MUST 显示提及高亮  
And 未读聚合视图 MUST 增加对应计数

### 4.5 未读、在线状态与静音

#### Requirement NCW-FR-011: 未读体系

系统 MUST 提供频道/DM 未读角标、最近未读聚合视图、首条未读定位跳转。

#### Requirement NCW-FR-012: 在线状态

系统 MUST 展示用户与 Agent 在线状态；状态更新 SHOULD 在 5 秒内同步。

#### Requirement NCW-FR-013: 静音规则

会话静音后 MUST 抑制普通消息通知，但 MUST 保留提及类通知（可被用户策略覆盖）。

#### Scenario: 静音后通知抑制

Given 用户已将频道设为静音  
When 频道出现普通新消息  
Then 系统 MUST 不弹出通知  
And 未读计数 MUST 继续累加

### 4.6 搜索与文件管理

#### Requirement NCW-FR-014: 全域搜索

系统 MUST 支持按关键词、时间范围、发送者过滤检索频道/DM/线程消息。

#### Requirement NCW-FR-015: 文件管理

系统 MUST 支持多类型文件上传、预览、下载、搜索；图片预览 MUST 保持兼容既有能力。

#### Scenario: 多条件检索

Given 工作区存在 30 天消息数据  
When 用户设置关键词 + 时间范围 + 发送者筛选  
Then 系统 MUST 返回满足全部条件的结果  
And 结果 MUST 按时间倒序呈现

#### Scenario: 非支持类型预览降级

Given 用户上传不可内嵌预览文件类型  
When 打开文件详情  
Then 系统 MUST 显示基础元数据与下载入口  
And MUST NOT 阻塞会话渲染

### 4.7 通知与免打扰

#### Requirement NCW-FR-016: 全局通知

系统 MUST 支持全局通知级别配置（全部消息、仅提及、关闭）。

#### Requirement NCW-FR-017: 会话级通知

系统 MUST 支持频道与 DM 级别通知覆盖策略。

#### Requirement NCW-FR-018: 关键词与 DND

系统 MUST 支持关键词提醒与免打扰时段；DND 时段内 MUST 延迟非紧急通知。

#### Requirement NCW-FR-018A: 通知冲突优先级链

系统 MUST 按以下优先级处理冲突：`用户级强制关闭通知` > `会话级静音` > `DND时段` > `提及类型规则(@everyone/@here/@agent)` > `全局默认通知级别`。

#### Requirement NCW-FR-018B: 会话静音与提及冲突

会话静音后，普通消息 MUST NOT 触发即时通知；`@agent` 和 `@here` MAY 触发提醒；`@everyone` SHOULD 受工作区策略门禁控制。

#### Scenario: DND 生效

Given 用户设置 22:00-08:00 为 DND  
When 23:00 收到普通消息  
Then 系统 MUST 不发送即时通知  
And 08:00 后 MUST 在通知中心展示汇总提醒

#### Scenario: 会话静音与@here冲突

Given 用户已将频道设置为静音  
When 用户在该频道被 `@here` 提及  
Then 系统 MUST 按工作区策略判断是否发送即时提醒  
And 若策略允许，通知中心 MUST 保留该提及记录

#### Scenario: 用户级关闭通知覆盖其他策略

Given 用户将全局通知设置为“关闭”  
When 任意频道发生普通消息或提及消息  
Then 系统 MUST 不发送即时推送  
And 所有未读状态 MUST 继续累计

### 4.8 权限与审计

#### Requirement NCW-FR-019: RBAC

系统 MUST 提供工作区管理员、频道管理员、普通成员三类角色模型。

#### Requirement NCW-FR-020: 审计日志

关键操作 MUST 写入审计日志，至少包含操作者、时间、对象、变更内容、来源 IP。

#### Requirement NCW-FR-020A: 角色旅程与页面可见性

系统 MUST 提供管理员、频道管理员、普通成员的页面可见性差异规则，且规则 MUST 与 RBAC 权限一致。

#### Scenario: 管理员旅程

Given 用户角色为工作区管理员  
When 用户进入控制台  
Then 用户 MUST 可见审计页、权限管理页、频道归档与物理删除入口  
And 用户 MUST 可访问 Agent 全局配置页

#### Scenario: 频道管理员旅程

Given 用户角色为频道管理员  
When 用户进入其管理的频道详情  
Then 用户 MUST 可见频道成员管理与频道归档入口  
And 用户 MUST NOT 可见工作区审计总览与全局权限策略页

#### Scenario: 普通成员旅程

Given 用户角色为普通成员  
When 用户进入控制台  
Then 用户 MUST 可见消息发送、线程回复、个人通知设置入口  
And 用户 MUST NOT 可见频道删除、权限变更、Agent全局配置入口

#### Scenario: 频道权限控制

Given 用户角色为普通成员  
When 用户尝试修改频道权限或归档频道  
Then 系统 MUST 返回权限不足  
And 审计日志 MUST 记录失败尝试

#### Scenario: 审计查询

Given 管理员打开审计页面  
When 按对象 ID 与时间范围查询  
Then 系统 MUST 返回可追溯记录  
And 记录字段 MUST 完整

### 4.9 Agent 全局管理

#### Requirement NCW-FR-021: Agent 详情边界

Agent 全局详情页 MUST 展示 Soul、全局安全白名单、基础元数据；频道详情页 MUST NOT 展示这些全局配置。

#### Requirement NCW-FR-022: Soul 与白名单

系统 MUST 支持读写 `CLAUDE.md` 与 `sender-allowlist.json`，写入后无需重启生效。

#### Requirement NCW-FR-023: 任务与沙箱

系统 MUST 支持 ScheduledTask 查看/暂停/恢复/手动触发；MUST 支持 Sandbox 挂载配置管理。

#### Scenario: Soul 修改即时生效

Given 用户有 Agent 管理权限  
When 用户编辑并保存 Soul  
Then 文件 MUST 在 1 秒内持久化  
And 后续对话 MUST 使用新配置

### 4.10 异常与恢复

#### Requirement NCW-FR-024: 断网重连

客户端断网重连后 MUST 自动恢复 Socket.io 连接并补拉未确认消息。

#### Requirement NCW-FR-025: 流式中断处理

流式响应中断时，系统 MUST 提供重试或继续生成入口，并保留已生成片段。

#### Requirement NCW-FR-026: Agent 无响应

Agent 在超时窗口内无响应时，系统 MUST 返回可识别错误状态并允许用户重试。

#### Scenario: 重连补偿

Given 用户发送消息后发生网络断开  
When 网络恢复并重连成功  
Then 客户端 MUST 同步服务端 ACK 状态  
And 未 ACK 消息 MUST 执行一次性补发

### 4.11 认证与私有化部署

#### Requirement NCW-FR-027: 内部认证

系统 MUST 使用 Basic Auth 或 NextAuth Credentials 保护管理与 API 路径。

#### Requirement NCW-FR-028: 私有化部署

系统 MUST 支持 Docker Compose 私有部署、容器互通、数据持久化与备份恢复。

#### Scenario: 未认证访问拦截

Given 用户未登录  
When 用户访问受保护页面  
Then 系统 MUST 重定向到登录页  
And API MUST 返回 401/403

## 5. API 与数据约束

1. 消息、线程、反应、通知、审计 API MUST 返回稳定错误码。
2. 会话查询 API MUST 支持分页参数 `cursor` 与 `limit`。
3. 文件上传 API MUST 提供类型白名单、大小限制与校验失败错误码。
4. 审计日志写入 MUST 为不可变追加模型，客户端不可直接修改。

## 5.1 数据保留与合规策略

1. 消息数据默认保留周期 MUST 为 365 天，超过周期的数据 SHOULD 自动转冷存储或归档。
2. 文件元数据与二进制文件保留周期 MUST 不短于消息保留周期，删除策略 MUST 保持主从一致。
3. 审计日志保留周期 MUST 不短于 730 天，且 MUST NOT 被普通管理员直接物理删除。
4. 频道归档后，历史消息和文件 MUST 对原成员按权限可读；归档内容 MUST NOT 允许新增写入。
5. 数据导出 MUST 仅允许工作区管理员执行；导出内容 MUST 支持消息、文件索引、审计摘要三类边界。
6. 导出文件 MUST 包含操作者、时间窗、数据范围元信息，并记录到审计日志。

## 6. 验收标准（可量化）

### 6.1 功能验收

1. 频道/DM/线程核心流程自动化用例通过率 MUST 为 100%（P0）。
2. 消息编辑/撤回/反应/转发场景用例通过率 MUST 为 100%（P0）。
3. `@here`、空频道 `@` 约束、提及高亮、未读聚合 MUST 全量通过。
4. 角色旅程与页面可见性测试通过率 MUST 为 100%（管理员/频道管理员/成员三类）。
5. 通知冲突优先级用例通过率 MUST 为 100%（静音、DND、提及、全局策略）。

### 6.2 兼容性验收

1. Chrome、Edge 最新两个稳定版本 MUST 全部通过核心流程。
2. Socket.io 断线重连恢复时间 SHOULD ≤ 5 秒。
3. MiniMax 流式消息渲染乱码率 MUST 为 0。
4. 搜索 Top-10 命中率 MUST ≥ 90%（基于标准评测集）。
5. 搜索精确率 MUST ≥ 85%，召回率 MUST ≥ 80%（按周回归统计）。

### 6.3 安全性验收

1. 未授权访问拦截成功率 MUST 为 100%。
2. RBAC 越权测试拦截率 MUST 为 100%。
3. 审计日志关键字段缺失率 MUST 为 0。

### 6.4 部署与运维验收

1. Docker Compose 全部容器健康检查通过率 MUST 为 100%。
2. 本地卷断电重启后数据恢复成功率 MUST 为 100%。
3. 备份恢复演练（消息 + 文件 + 配置）RPO MUST ≤ 15 分钟，RTO MUST ≤ 30 分钟。
4. 数据保留策略执行成功率 MUST 为 100%，并可提供周期执行审计记录。

## 7. 风险与限制

1. SQLite 高并发写入存在锁竞争风险，需通过 WAL 与重试缓解。
2. 本地文件存储容量需由部署方评估并配置配额阈值。
3. 如果 MiniMax 接口协议变化，适配层 MUST 提供向后兼容策略。

## 8. 变更记录

| 版本 | 日期       | 变更人       | 说明                                                            |
| ---- | ---------- | ------------ | --------------------------------------------------------------- |
| v2.0 | 2026-03-15 | 架构与文档组 | 全量重构规格，补齐 Slack 核心能力、异常场景、量化验收、依赖约束 |
