# NanoClaw WebUI 规格说明书

本规格说明书基于 `01_Proposal.md` 提案，详细定义了 NanoClaw WebUI 的功能、数据、API 及交互规范。系统旨在为 NanoClaw 提供一套完全私有化、可视化的管理界面，实现沉浸式聊天体验与全功能 Agent 管理。

## ADDED Requirements

### Requirement: 实时聊天交互 (Real-time Chat Interaction)

系统 MUST 提供用户与 Agent 之间的实时聊天能力，支持文本消息的发送与流式响应渲染，并具备输入状态提示。

#### Scenario: 实时聊天交互

Given 用户已登录 WebUI
When 他们在聊天输入框发送消息
Then 消息应通过 Socket.io 发送到 NanoClaw 后端
And 后端响应应实时流式传输回 UI
And 响应中的 Markdown 内容应被正确渲染

#### Scenario: LLM 输入态提示

Given 用户已发送消息，等待 LLM 回复
When LLM 正在处理或生成内容但尚未返回文本时
Then 聊天界面底部应显示“Agent正在输入...”的提示
And 当收到流式回复内容或回复结束时，提示应自动消失

### Requirement: 群聊管理 (Group Chat Management)

系统 MUST 允许用户创建、删除和管理包含多个 Agent 的群组聊天（频道），支持成员的增删。

#### Scenario: 群聊创建与自动跳转

Given 用户在聊天控制台点击“创建群组”
When 输入有效名称并确认创建
Then 系统应在后台创建群组数据
And 页面应自动无缝跳转至新创建的群组聊天页
And 不应出现 404 或页面加载错误

#### Scenario: 群聊删除

Given 用户是群组管理员或创建者
When 在频道详情页点击“删除频道”并确认二次弹窗
Then 该频道应从侧边栏移除
And 相关的聊天记录和任务数据应被清理或归档
And 页面应跳转至默认页或“所有频道”页

### Requirement: @提及与全员广播（@mention & @everyone Broadcast）

系统 MUST 支持在群聊中 @提及特定 Agent。**特别约束：当频道内无 Agent 成员时，禁止触发 @提及功能。**

#### Scenario: @单个Agent定向触发

Given 用户在群聊会话中且群内**至少有一名 Agent 成员**
When 他们输入`@`
Then 应弹出当前频道内的 Agent 成员列表供选择
When 选择指定Agent发送消息
Then 被@的Agent应被定向触发响应

#### Scenario: 空频道禁止 @提及

Given 用户在一个**没有任何 Agent 成员**的频道中
When 他们输入`@`
Then **系统不应弹出任何提及列表**
And 无法选中或触发任何 Agent
And 界面应（可选）提示“请先邀请 Agent 加入频道”

### Requirement: 频道成员管理 (Channel Member Management)

系统 MUST 在频道详情页提供成员列表，并支持对 Agent 成员的邀请和移除，交互对标 Slack。

#### Scenario: 查看频道成员列表

Given 用户在频道详情页
When 点击“成员 (Members)”标签或模块
Then 应列出当前频道内的所有 Agent 成员
And 每个成员应显示头像、名称及在线状态

#### Scenario: 邀请 Agent 加入频道

Given 用户在频道详情页或聊天页
When 点击“添加成员”或“邀请 Agent”
Then 应弹出全局可用 Agent 列表
When 选择 Agent 并确认
Then 该 Agent 应加入频道成员列表
And 聊天区域应显示“xxx 已加入频道”的系统消息
And 此时该 Agent 可被 @提及

#### Scenario: 移除频道成员

Given 用户在频道详情页的成员列表中
When 对某个 Agent 点击“移除”并确认
Then 该 Agent 应从成员列表中消失
And 该 Agent 不再响应频道的 @everyone 消息
And 该 Agent 不再出现在 @提及列表中

#### Scenario: @everyone全员广播

Given 用户在群聊会话中
When 他们输入包含`@everyone`的消息并发送
Then 群内所有Agent都应被触发响应
And 消息中应高亮显示`@everyone`标识

### Requirement: Slack 风格交互界面 (Slack-like Interaction UI)

系统 MUST 提供类似于 Slack 的频道与成员分离的交互界面，明确区分“频道配置”与“Agent 详情”。

#### Scenario: 频道详情查看

Given 用户在频道聊天界面
When 他们点击“查看详情”
Then 应展示频道的配置信息（如名称、文件夹路径、沙箱配置、频道定时任务）
And 不应展示 Agent 的记忆或全局安全设置

#### Scenario: Agent 详情查看

Given 用户在侧边栏或频道成员列表中
When 他们点击 Agent 头像
Then 应进入 Agent 全局详情页
And 应展示 Agent 的全局记忆（Global CLAUDE.md）和安全白名单
And 支持编辑保存

#### Scenario: 邀请 Agent 入群

Given 用户在一个未关联 Agent 的频道中
When 他们点击“添加 Agent”或“邀请成员”
Then Agent 应被加入该频道
And 用户可在该频道中使用 `@` 提及该 Agent

### Requirement: 图片上传 (Image Upload)

系统 MUST 支持在聊天会话中上传图片，并适配 MiniMax 2.5 的图片支持特性。

#### Scenario: 图片上传

Given 用户在聊天会话中
When 他们粘贴图片或点击上传按钮
Then 图片应在本地预览
And 发送后，图片应上传到本地文件系统
And 图片应显示在聊天记录中

### Requirement: 查看 Agent 详情 (View Agent Details)

系统 MUST 显示每个 Agent 的详细信息，包括基础元数据和活跃状态。

#### Scenario: 查看 Agent 详情

Given 用户点击侧边栏中的 Agent
When 资料页加载时
Then 应显示 Agent 的名称、头像和触发词
And 应显示 Agent 的创建时间和最后活跃时间

### Requirement: Agent Soul（记忆）编辑管理

系统 MUST 支持在 Agent 资料页查看和编辑 Agent 的 Soul 内容 ([CLAUDE.md](CLAUDE.md))。

#### Scenario: 查看与编辑Agent记忆

Given 用户进入Agent资料页
When 他们打开「记忆(Soul)」模块
Then 应加载并展示该Agent对应`groups/{folder}/CLAUDE.md`的完整内容
And 用户可通过Markdown编辑器修改内容
And 点击保存后，修改应实时写入原CLAUDE.md文件
And 无需重启NanoClaw服务即可生效

### Requirement: Agent定时任务（Scheduled Task）管理

系统 MUST 支持在 Agent 资料页查看和管理该 Agent 关联的定时任务。

#### Scenario: 定时任务查看与管理

Given 用户进入Agent资料页
When 他们打开「任务管理」模块
Then 应列表展示该Agent关联的所有Scheduled Task，包含ID、Cron/Interval规则、触发Prompt、运行状态、下次执行时间
And 用户可一键暂停/恢复指定任务
And 用户可手动触发一次任务执行
And 操作结果应实时同步到NanoClaw的tasks数据库表

### Requirement: 配置 Docker 沙箱 (Configure Docker Sandbox)

系统 MUST 允许管理员配置每个 Agent 的 Docker 沙箱挂载路径。

#### Scenario: 配置 Docker 沙箱

Given 用户在 Agent 资料页
When 他们编辑“Docker 沙箱”部分
Then 他们应能够添加或删除宿主机路径挂载
And 更改应保存到 Agent 的配置中

### Requirement: Agent权限白名单管理

系统 MUST 支持为每个 Agent 配置发送者白名单及其拦截模式。

#### Scenario: 白名单配置

Given 用户进入Agent资料页
When 他们打开「权限控制」模块
Then 应加载并展示`sender-allowlist.json`中该Agent的白名单配置
And 用户可新增/删除允许发送者、修改触发/拦截模式
And 保存后修改应实时写入原配置文件，无需重启服务即可生效

### Requirement: 内部认证 (Internal Authentication)

系统 MUST 强制执行内部访问认证，确保只有授权人员可访问管理后台。

#### Scenario: 内部认证

Given WebUI 已部署
When 用户访问根 URL
Then 应提示他们通过 Basic Auth 或 NextAuth 登录
And 只有经过身份验证的用户才能访问聊天控制台

### Requirement: 私有化部署 (Private Deployment)

系统 MUST 支持完全私有化的 Docker Compose 部署方案，确保数据不外流。

#### Scenario: 私有化部署

Given 系统通过 Docker Compose 运行
When WebUI 容器启动
Then 它应连接到 NanoClaw 后端容器
And 它应将数据持久化到映射的本地卷

## 6. 测试验收标准

### 6.1 功能验收标准

#### 6.1.1 实时聊天交互验收

- 验收场景：正常消息发送与流式响应
  Given 用户已登录系统，进入与Agent的1v1会话
  When 用户发送合法文本消息
  Then 消息应立即展示在聊天记录中
  And Agent响应应通过流式传输逐字渲染
  And Markdown内容应正确格式化展示
  验收通过条件：100%消息发送成功，流式响应无卡顿、无乱码，Markdown渲染正确

- 验收场景：异常场景（API调用失败）
  Given MiniMax API调用异常
  When 用户发送消息
  Then 系统应在3秒内展示友好的错误提示
  And 不影响后续消息发送
  验收通过条件：异常提示清晰，无系统崩溃，后续功能正常可用

#### 6.1.2 群聊管理验收

- 验收场景：创建与管理群组
  Given 用户已登录系统
  When 用户创建一个新群组并添加Agent
  Then 群组应出现在侧边栏列表中
  And 用户可在群组内发送消息
  验收通过条件：群组创建成功，消息可正常发送至群组

#### 6.1.3 @提及与全员广播验收

- 验收场景：@mention特定Agent
  Given 用户在群聊中
  When 用户输入`@AgentName`并发送消息
  Then 只有被提及的Agent响应
  And 消息中Agent名称高亮显示
  验收通过条件：仅目标Agent回复，UI显示正确

- 验收场景：@everyone全员广播
  Given 用户在群聊中
  When 用户输入`@everyone`并发送消息
  Then 群内所有Agent均响应
  And 消息中`@everyone`高亮显示
  验收通过条件：所有Agent均回复，UI显示正确

#### 6.1.4 Agent资料页管理验收

- 验收场景：编辑Agent记忆(Soul)
  Given 用户在Agent资料页的记忆模块
  When 用户修改`CLAUDE.md`内容并保存
  Then 文件内容应实时更新
  And Agent行为应反映新的记忆设置
  验收通过条件：文件写入成功，Agent行为符合预期

- 验收场景：管理定时任务
  Given 用户在Agent资料页的任务管理模块
  When 用户暂停一个定时任务
  Then 任务状态应变为Paused
  And 数据库中该任务状态同步更新
  验收通过条件：UI状态与数据库状态一致，任务不再触发

### 6.2 兼容性验收标准

- 验收场景：图片上传与渲染
  Given 用户发送一张10MB内的图片
  When 图片上传完成
  Then 图片应在聊天窗口中正确显示缩略图
  And 点击缩略图可查看原图
  验收通过条件：图片上传成功，预览和原图查看功能正常

### 6.3 安全性验收标准

- 验收场景：未授权访问拦截
  Given 用户未登录
  When 用户尝试访问聊天控制台URL
  Then 系统应重定向至登录页面
  验收通过条件：未登录用户无法访问受保护页面

- 验收场景：权限白名单配置
  Given 用户在Agent资料页配置白名单
  When 用户添加一个新的允许发送者
  Then 配置文件`sender-allowlist.json`应更新
  And 该发送者应能触发Agent
  验收通过条件：配置文件更新正确，权限控制生效

### 6.4 私有化部署验收标准

- 验收场景：Docker Compose部署
  Given 使用Docker Compose启动服务
  When 所有容器状态为Up
  Then WebUI应能连接到NanoClaw后端
  And 数据应持久化到宿主机挂载目录
  验收通过条件：服务互通，重启容器后数据不丢失
