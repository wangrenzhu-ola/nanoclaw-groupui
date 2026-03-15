# NanoClaw WebUI 任务拆解（tasks.md）

## 0. 文档元数据

| 字段     | 内容                                |
| -------- | ----------------------------------- |
| 文档 ID  | OSP-NCW-TASK-001                    |
| 版本     | v2.9                                |
| 状态     | In Execution                        |
| 生效日期 | 2026-03-15                          |
| 责任人   | 项目经理 / 前后端负责人 / QA 负责人 |
| 关联规格 | OSP-NCW-SPEC-001                    |

## 1. WBS 总览

1. 阶段 A：项目准备
2. 阶段 B：基础框架
3. 阶段 C：核心功能模块
4. 阶段 D：测试与验收
5. 阶段 E：部署与上线

## 2. 任务明细

| 任务ID | 阶段     | 任务名称                       | 对应需求ID                | 优先级 | 依赖项        | 交付物                        | 验收标准                       | 可观测来源                    | 预估工时 |
| ------ | -------- | ------------------------------ | ------------------------- | ------ | ------------- | ----------------------------- | ------------------------------ | ----------------------------- | -------- |
| A-01   | 项目准备 | 建立OpenSpec基线与需求编号     | 全部                      | P0     | 无            | 需求基线文档                  | 需求ID覆盖率=100%              | `docs_traceability_report`    | 8h       |
| A-02   | 项目准备 | 定义术语与边界词典             | NCW-FR-001~028            | P0     | A-01          | 术语表、边界矩阵              | 评审无歧义项                   | `review_minutes`              | 4h       |
| A-03   | 项目准备 | 输出风险与里程碑计划           | 全部                      | P1     | A-01          | 风险台账、里程碑图            | 风险项含应对策略               | `risk_register`               | 4h       |
| B-01   | 基础框架 | 统一会话域数据模型             | NCW-FR-001~005            | P0     | A-01          | 会话/线程 ERD 与 migration    | 迁移可执行且回滚可用           | `migration_ci_log`            | 12h      |
| B-02   | 基础框架 | 完成Socket.io ACK重连机制      | NCW-FR-024~025            | P0     | B-01          | 事件协议与重连补偿模块        | 断网重连恢复≤5秒               | `socket_reconnect_p95`        | 12h      |
| B-03   | 基础框架 | 建立统一错误码体系             | NCW-FR-006~028            | P1     | B-01          | 错误码文档与中间件            | API错误码覆盖率=100%           | `api_error_catalog_cov`       | 6h       |
| B-04   | 基础框架 | 建立审计日志落库能力           | NCW-FR-020                | P0     | B-01          | audit_log 表与写入服务        | 关键操作审计落库率=100%        | `audit_write_success_rate`    | 8h       |
| C-01   | 核心模块 | 实现侧边栏分区与会话导航       | NCW-FR-001~003            | P0     | B-01          | Sidebar 组件与路由            | 创建频道跳转零404              | `frontend_route_404_count`    | 10h      |
| C-02   | 核心模块 | 实现1v1与Group DM              | NCW-FR-002                | P0     | C-01          | DM API + UI                   | DM隔离用例100%通过             | `dm_isolation_e2e_pass`       | 12h      |
| C-03   | 核心模块 | 实现线程抽屉与归档             | NCW-FR-004~005            | P0     | B-01,C-01     | Thread Drawer + API           | 线程写入隔离正确               | `thread_write_isolation_rate` | 12h      |
| C-04A  | 核心模块 | 消息操作后端协议与权限实现     | NCW-FR-006~007            | P0     | B-03          | Message Actions API           | 协议与权限测试通过率=100%      | `message_action_api_pass`     | 6h       |
| C-04B  | 核心模块 | 消息操作前端状态与交互实现     | NCW-FR-006~007            | P0     | C-04A         | Message Actions UI 状态机     | 编辑撤回状态一致性=100%        | `ui_state_consistency`        | 5h       |
| C-04C  | 核心模块 | 消息操作回归与并发验证         | NCW-FR-006~007            | P0     | C-04B         | 回归测试报告                  | 时限/并发用例100%通过          | `message_action_regression`   | 3h       |
| C-05   | 核心模块 | 完成频道公开私有与归档策略     | NCW-FR-003,NCW-FR-019     | P0     | C-01,B-04     | Channel Policy API            | 越权拦截率100%                 | `rbac_block_rate`             | 10h      |
| C-06   | 核心模块 | 实现@agent/@everyone/@here规则 | NCW-FR-008~010            | P0     | C-01,C-02     | Mention 引擎与高亮            | 空频道@禁用生效                | `mention_rule_pass`           | 10h      |
| C-07A  | 核心模块 | 未读计数后端聚合与存储实现     | NCW-FR-011~013            | P0     | B-02          | Unread 聚合服务               | 未读一致性=100%                | `unread_counter_consistency`  | 5h       |
| C-07B  | 核心模块 | 在线状态与静音前端状态实现     | NCW-FR-011~013            | P0     | C-07A         | Presence/静音 UI              | 状态同步延迟≤5秒               | `presence_sync_p95`           | 4h       |
| C-07C  | 核心模块 | 未读在线静音回归测试           | NCW-FR-011~013            | P0     | C-07B         | 回归测试报告                  | 关键场景通过率=100%            | `unread_presence_regression`  | 3h       |
| C-08A  | 核心模块 | 搜索索引与检索后端实现         | NCW-FR-014~015            | P1     | B-01,B-03     | Search API                    | Top-10命中率≥90%               | `search_top10_hit_rate`       | 6h       |
| C-08B  | 核心模块 | 搜索与文件中心前端实现         | NCW-FR-014~015            | P1     | C-08A         | Search UI + File Center       | 检索体验用例通过率=100%        | `search_ui_e2e_pass`          | 5h       |
| C-08C  | 核心模块 | 搜索精确率召回率回归验证       | NCW-FR-014~015            | P1     | C-08B         | 检索评测报告                  | 精确率≥85%召回率≥80%           | `search_precision_recall`     | 3h       |
| C-09   | 核心模块 | 实现通知偏好关键词与DND        | NCW-FR-016~018B           | P1     | C-07C         | Notification Center           | DND期间误通知=0                | `notification_false_alert`    | 10h      |
| C-10   | 核心模块 | 完成Agent全局管理边界重构      | NCW-FR-021~023            | P0     | C-01,B-04     | Agent Profile/Channel Details | 边界混淆缺陷=0                 | `boundary_defect_count`       | 10h      |
| C-11   | 核心模块 | 补强异常处理与重试入口         | NCW-FR-024~026            | P0     | B-02,C-03     | 断网/中断/超时处理逻辑        | 异常恢复用例100%通过           | `recovery_flow_pass`          | 8h       |
| D-01   | 测试验收 | 编写单元测试套件               | NCW-FR-001~028            | P0     | C阶段全部任务 | 单测代码与报告                | 语句覆盖率≥90%                 | `unit_coverage_report`        | 16h      |
| D-02   | 测试验收 | 编写API与集成测试              | NCW-FR-001~028            | P0     | C阶段全部任务 | 集成测试脚本                  | P0/P1接口通过率=100%           | `integration_pass_rate`       | 16h      |
| D-03   | 测试验收 | 编写E2E流程测试                | NCW-FR-001~028            | P0     | D-01,D-02     | E2E脚本与报告                 | 关键业务链路通过率=100%        | `e2e_pass_rate`               | 18h      |
| D-04   | 测试验收 | 执行安全与权限回归测试         | NCW-FR-019~020,NCW-FR-027 | P0     | D-02          | 权限矩阵测试报告              | 越权通过数=0                   | `security_regression_report`  | 10h      |
| D-05   | 测试验收 | 执行部署与备份恢复演练         | NCW-FR-028                | P0     | D-02          | 演练记录与恢复报告            | RPO≤15m，RTO≤30m               | `backup_restore_sla`          | 10h      |
| E-01   | 部署上线 | 产出发布包与部署手册           | NCW-FR-028                | P0     | D-01~D-05     | 发布包、部署文档              | 新环境一键部署成功             | `deployment_checklist`        | 8h       |
| E-02   | 部署上线 | 执行灰度发布与监控接入         | NCW-FR-024~028            | P1     | E-01          | 灰度方案与监控看板            | 灰度期间P0故障=0               | `release_incident_count`      | 8h       |
| E-03   | 部署上线 | 上线后验收与归档               | 全部                      | P0     | E-02          | 验收报告、OpenSpec归档材料    | 验收项完成率=100%              | `go_live_acceptance_report`   | 6h       |
| D-06   | 测试验收 | 执行全功能QA用例文档           | NCW-FR-001~028            | P0     | C阶段全部任务 | `qa-test-cases.md`执行报告    | 用例执行率=100%，P0通过率=100% | `qa_execution_tracking`       | 12h      |
| E-04   | 部署上线 | 执行按轮次交付与人工验收通知   | 全部                      | P0     | D-06,E-03     | 每轮验收通知与结论记录        | 每轮均有人工验收结论           | `round_acceptance_log`        | 8h       |
| E-05   | 部署上线 | 维护PMO轮次排期与任务联动      | 全部                      | P1     | E-04          | `pmo-round-schedule.md`       | 轮次与任务ID映射完整率=100%    | `pmo_schedule_trace`          | 4h       |

## 3. 测试任务与验收场景映射

| 测试任务 | 对应规格章节 | 核心场景                                   |
| -------- | ------------ | ------------------------------------------ |
| D-01     | 4.1~4.11     | 状态管理、策略计算、错误码                 |
| D-02     | 5、5.1       | 消息/线程/审计/通知接口与保留策略          |
| D-03     | 4.1~4.11     | 登录、建频道、DM、线程、消息操作、搜索文件 |
| D-04     | 4.8、4.11    | RBAC越权、审计完整性、鉴权拦截             |
| D-05     | 6.4          | 容器互通、持久化、备份恢复                 |

## 4. 执行顺序与关键依赖

1. B 阶段完成后才可进入 C 阶段高风险模块开发。
2. C-07C（未读/状态回归）是 C-09（通知）前置条件。
3. D-05（恢复演练）必须在 E-01（发布包）前完成。
4. E-03 完成后才可执行 OpenSpec archive 流程。

## 5. 风险与缓冲

1. 高并发消息路径在 C-04、C-07 预留 20% 缓冲工时。
2. MiniMax 兼容风险在 C-11 增设协议适配回归测试。
3. 若需求新增超出 NCW-FR-028 边界，必须新增 proposal，不允许直接插入当前任务。

## 6. 变更记录

| 版本 | 日期       | 变更人       | 说明                                                            |
| ---- | ---------- | ------------ | --------------------------------------------------------------- |
| v2.0 | 2026-03-15 | 项目与架构组 | 按WBS重构任务，补齐需求映射、优先级、依赖、交付物、验收、工时   |
| v2.1 | 2026-03-15 | 执行Agent    | 新增任务状态跟踪机制，并回填R1当前执行状态                      |
| v2.2 | 2026-03-15 | 执行Agent    | 增补R1可视化验收入口与状态证据链接                              |
| v2.3 | 2026-03-15 | 执行Agent    | 补充MiniMax2.5基础联通性测试映射，并更新轮次状态跟踪            |
| v2.4 | 2026-03-15 | 执行Agent    | 修正联通性门禁轮次映射：由R6前移到R2执行                        |
| v2.5 | 2026-03-15 | 执行Agent    | 启动R2迭代并落地消息操作/提及规则/联通性测试基线                |
| v2.6 | 2026-03-15 | 执行Agent    | 启动R3迭代并落地未读/在线/静音/通知冲突后端与验收基线           |
| v2.7 | 2026-03-15 | 执行Agent    | 启动R4迭代并建立搜索/文件中心任务状态跟踪                       |
| v2.8 | 2026-03-15 | 执行Agent    | 完成R4开发与测试并提交人工验收，补齐搜索/文件中心能力与证据链   |
| v2.9 | 2026-03-15 | 执行Agent    | 收敛R1-R4风险并切换逐轮验收状态，补齐线程/并发去重/通知中心链路 |

## 7. QA任务文档关联

1. QA用例主文档：`qa-test-cases.md`。
2. 执行任务映射：`D-01~D-06` 对应 `qa-test-cases.md` 第 4 章全量用例。
3. 交付门禁：每轮 P0 用例 MUST 全通过，且 MUST 通知人工验收。

## 8. PMO轮次排期关联

1. PMO排期文档：`pmo-round-schedule.md`。
2. 轮次到任务映射：R1~R8 对应 `C-01` 到 `E-05`。
3. 推进规则：仅在当前轮人工验收通过后进入下一轮。

## 9. 任务状态跟踪（执行中持续更新）

| 轮次 | 任务ID                 | 当前状态             | 最近更新   | 证据链接                                                                                         | 说明                                                               |
| ---- | ---------------------- | -------------------- | ---------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| R1   | C-01,C-02,C-03         | Ready for Acceptance | 2026-03-15 | `src/db.ts`、`src/webui-api.ts`、`src/webui-api.test.ts`、`src/r1-acceptance.ts`                 | 已补齐会话导航、DM与线程能力，待人工验收                           |
| R2   | C-04A,C-04B,C-04C,C-06 | Ready for Acceptance | 2026-03-15 | `src/db.ts`、`src/webui-api.ts`、`src/webui-api.test.ts`、`src/r2-acceptance.ts`                 | 已补齐并发去重接口与R2验收交互，待人工验收                         |
| R3   | C-07A,C-07B,C-07C,C-09 | Ready for Acceptance | 2026-03-15 | `src/db.ts`、`src/webui-api.ts`、`src/webui-api.test.ts`、`src/r3-acceptance.ts`、`package.json` | 已补齐通知中心回放链路与R3验收交互，待人工验收                     |
| R4   | C-08A,C-08B,C-08C      | Ready for Acceptance | 2026-03-15 | `src/db.ts`、`src/webui-api.ts`、`src/webui-api.test.ts`、`src/r4-acceptance.ts`、`package.json` | 已完成搜索/文件中心实装与自动化验证，待人工验收确认                |
| R6   | C-11                   | Pending              | 2026-03-15 | `qa-test-cases.md`、`pmo-round-schedule.md`                                                      | 本轮仅执行异常恢复与认证拦截门禁（TC-NCW-REC-\*、TC-NCW-AUTH-001） |
