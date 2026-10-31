# Sprint 4 — Yangbo 进度与证据

最后更新：2026-10-31（Asia/Shanghai）。范围：US50（3 点）、US51（3 点）、US45（5 点），共 11 点。

当前分支：`yangbo-sprint4-us50-us51`。本轮核实 HEAD：`b6f82bf03b370983bc577ab1dbd5e28c475f7404`，已将 origin/main e6ab88c 合入任务分支。
US51 收件人修正和文档已在 `01be1d3` 提交，包含于当前合并提交；仍未接入业务流程。本轮仅更新测试记录，按用户要求不 push。此前的 handoff 文档是 2026-10-30 历史快照，其中“尚未取得 AC”的描述已被用户随后提供的正式原文取代；以本文件为当前进度入口。下文 T1/T2 及此前日志保留当时事实，不当作当前提交状态。

## 记录规则与需求来源

- 正式需求：用户在本会话提供的三条 Story 与全部 10 条 AC，原文逐项保留如下。原始页面：[Product Backlog](https://app.notion.com/p/ConnectSphere-Product-Backlog-3e19922d71f881b29bdef4797725bb80)。本地已有原文，不宣称已在线读回。
- 用户约束／澄清：保留 US34 接受后不直接修改活动字段的边界；US51 AC3 不自动扩大到候补者；US45 只标记点名安排；准备、确认和重新送审必须后端校验；与团队共享机制对齐。
- 用户提供的跨故事约束：US49 AC4 要求未解决的 US49–US51 标记阻止确认。尚未独立取得 US49 全部原文。
- 现有测试行为只作为兼容边界，不提升为客户 AC。建议、假设、mock、临时方案不能当作已采纳需求。
- 状态分别记录实现、接入和验证；单测通过不等于流程已集成，流程已验证不等于 DoD 完成。
- 每轮交付更新此表、测试证据及交付日志。测试绑定实际运行时的提交；未提交改动必须另注，不能把 HEAD 当作包含改动的提交。

## 10 条 AC 跟踪表

以下代码路径均相对仓库根目录。T1 是已有基础行为的历史基线；T2 是本轮函数测试及既有 API 回归，均不是三条新故事端到端验收结果；T0 表示尚无该 AC 流程的执行证据。全部 AC 已有[功能规格](SPRINT4-YANGBO-functional-tests.md)，均未执行真实流程。

| AC 与正式原文 | 当前状态 | 已实现的具体行为及代码位置 | 尚未实现／尚未接入 | 测试命令、实际结果、对应提交 | 阻塞项及需要谁提供什么 |
|---|---|---|---|---|---|
| US50-1: Has the event's equipment reservations re-evaluated automatically when a change is accepted | 未实现；未接入；未验收 | `backend/event_changes.py:prepare_decision`、`backend/main.py:review_event_change` 保存接受决定；`backend/equipment.py:availability` 有库存／时段计算基础 | accepted 尚未调用重评；没有有效新值交接 | T1 覆盖既有决定边界；本 AC 为 T0；实现提交：无 | Yuetong／US34：提供结构化有效新值来源、验证及接受时交接契约；确认设备无效规则 |
| US50-2: Sees equipment reservations that are no longer valid flagged as "Requires Reassessment" | 未实现；未接入；未验收 | `backend/models.py:VenueBooking.reassessment`、`backend/schemas.py:BookingReassessment` 仅提供 US38 场地标记基础 | 无设备预留标记、API 返回及显示；不能直接套用场地时间专用 schema | T0；实现提交：无 | Chin Hui／US49 与 Yangbo：共享标记结构、目标 ID、原因、读取和解决契约；需求方确认无效判定 |
| US50-3: Has the responsible Technical Support Staff notified of each flagged reservation | 辅助函数已存在；故事未接入；未验收 | `backend/messaging.py:equipment_reassess` 通知活动 assigned technician；US36 有辅助函数测试 | 未在 accepted 中调用；未证明每个被标记预留及其负责人员均正确关联／通知 | T1 的 US36 测试覆盖辅助函数；本 AC 流程 T0；基础提交 cae5273，故事实现提交无 | Zhenhan／US36：逐预留通知与重复保护约定；设备负责人数据映射需团队确认 |
| US51-1: Has the event's registration settings re-evaluated automatically when a change is accepted | 未实现；未接入；未验收 | `backend/registrations.py` 有报名、容量及候补基础；US34 保存决定 | 无 accepted 自动重评、有效新值输入及同事务接入 | T1 覆盖既有决定边界；本 AC 为 T0；实现提交：无 | Yuetong／US34：新值交接；需求方确认设置有效性规则 |
| US51-2: Sees registration settings that are no longer valid flagged as "Requires Reassessment" | 未实现；未接入；未验收 | 有现成报名视图及场地标记展示思路，不构成本 AC 实现 | 无报名设置持久化标记、显示及解决流程 | T0；实现提交：无 | Chin Hui／US49：共享标记契约；需求方确认容量下降、禁用报名、日期／截止日期变化的判定与解决方式 |
| US51-3: Sees registered attendees notified where the change affects them | 收件人筛选已修改并通过函数测试；未接入；未验收 | `backend/messaging.py:attendees_affected` 仅选择本活动 registered；通用 `attendees()` 保留候补范围；函数不 commit | 无 accepted 接入及影响判定；函数通过不等于 AC 完成 | 修正提交 01be1d3；T3 在合并提交 b6f82bf 上通过 67 后端测试、29 子测试及 17 前端单测（测试集总数）；本 AC 流程 T0 | 需求方确认“影响参会者”的规则；Yuetong 提供 accepted 新值；Zhenhan 确认后续流程接入 |
| US45-1: Has the event returned to the relevant earlier planning stage when the Safety Officer rejects the safety arrangement or requests changes | 未实现；未接入；未验收 | `backend/event_status.py:change_status` 有集中转换及历史记录；`backend/messaging.py:safety_check_decided` 支持两类结果通知 | 无 US44 安全决定接入、返回阶段映射；现转换表没有所需返工路径，不能将安全拒绝当作活动终态 rejected | T1 仅覆盖安全通知 helper；本 AC 为 T0；实现提交：无 | Akhi／US44：实际结果枚举、审查记录／轮次及调用接口；需求方确认目标阶段 |
| US45-2: Sees the venue or equipment arrangements named in the request flagged as "Requires Reassessment", reusing the flag from US49–US51 | 未实现；未接入；未验收 | US38 场地标记基础存在；当前 schema 原因仅允许 venue_time_changed | 无安全原因共享标记及点名目标输入／校验；必须只处理被点名安排 | T0；实现提交：无 | Akhi／US44：点名安排类型及 ID；Chin Hui／US49：共享标记和多原因兼容契约 |
| US45-3: Can resubmit the event for another Operational Safety Check once the flagged arrangements are resolved | 未实现；未接入；未验收 | `backend/messaging.py:safety_check_ready` 仅提供通知基础 | 无后端送审接口、标记解决校验及新审查轮次 | T0；实现提交：无 | Akhi／US44：送审／重送审接口、审查状态与轮次；共享机制提供解决状态及权限 |
| US45-4: Cannot move the event to preparation or confirm it until the Safety Officer approves | 未实现；未接入；未验收 | `components/queue/EventWorkspace.tsx` 暂不向已存储活动提供确认；`lib/state/app-context.tsx:confirmEvent` 仅本地状态更新，不是后端门禁 | 无准备／确认的安全资格后端校验；没有已接入的 US49–US51 统一门禁 | T0；实现提交：无 | Chin Hui／US14、US49：准备／确认后端入口及统一资格契约；Akhi／US44：当前有效批准状态 |

## 测试与核查证据

### T0 — 尚无故事验收执行

US50、US51、US45 的功能测试规格已建立；真实功能流程均 NOT RUN / BLOCKED。US51 收件人函数有 T2 测试证据。不将 mock、计划或辅助函数测试填为故事通过。

### T1 — 历史既有功能基线（2026-10-30）

运行时 HEAD：`cae52735af7f86595949a56e4ae74cd6cd463fa0`；当时仅有未提交的 handoff 文档，无生产代码改动。

PowerShell，在仓库根目录执行：

```powershell
$env:TMP = (Get-Location).Path
$env:TEMP = (Get-Location).Path
.\.venv312\Scripts\python.exe -m pytest -p no:cacheprovider tests/unit/event_request/test_event_changes.py tests/unit/event_request/test_event_updates.py tests/integration/test_event_changes_integration.py tests/us36_notifications/test_us36_notifications_unit.py -q
```

实际结果：`73 passed, 1 warning, 29 subtests passed in 9.70s`。警告为 Starlette TestClient 的 httpx 弃用提示。
使用隔离 SQLite；不是 Supabase、PostgreSQL 并发、浏览器或团队跨模块流程验证。
此前首次运行因临时 SQLite `unable to open database file` 在收集阶段失败；调整临时目录并获批在沙箱外重跑后得到上述结果。
本轮未重跑，因此不能把该结果表述为 2026-10-31 的新执行。

### V1 — 2026-10-31 仓库核查

- `git status --short --branch`、`git rev-parse HEAD`：当前任务分支，HEAD 为 cae5273；原有已跟踪代码无改动。Git 对 `.pytest_cache/` 有权限警告，不宣称已全面枚举该目录。
- 上一轮 `git ls-remote --heads origin` 成功核实远端 main 为 cae5273，US34 分支为 7c86015；公开分支列表没有 US44／US49／US14 开发分支。不能据此断言队友本地没有实现。
- US34 分支相对 main 的已查差异主要为测试／执行配置，未提供新值契约。
- 本轮仅文档更新；实际文件及内容检查结果见下方交付日志。

### T2 — 2026-10-31 收件人函数及既有 API 回归

版本：HEAD cae52735af7f86595949a56e4ae74cd6cd463fa0 + 未提交的 `backend/messaging.py`、US36 单测及文档补丁。没有对应实现提交，不引用 HEAD 为包含本轮改动的提交。

```powershell
$env:TMP = (Get-Location).Path
$env:TEMP = (Get-Location).Path
.\.venv312\Scripts\python.exe -m pytest -p no:cacheprovider tests/us36_notifications/test_us36_notifications_unit.py tests/us36_notifications/test_us36_notifications_api.py tests/integration/test_event_changes_integration.py -q
```

实际结果：`57 passed, 1 warning, 13 subtests passed in 24.14s`。警告仍是 TestClient 的 httpx 弃用提示。
首次沙箱运行在收集阶段因 SQLite `unable to open database file` 失败；获批沙箱外重跑后通过。隔离 SQLite，未连接共享 Supabase。

具体改动／证据：将一个原先要求候补也收到 US51 通知的测试按用户明确范围修订；新增其他活动隔离、通用收件人范围不变及调用方 rollback 三项测试。使用实际 SQLAlchemy／SQLite 和 Notification 行，无新增 mock。既有通知 API 测试及 US34 接受不改活动字段的集成回归通过。
限制：没有 US34→US51 新流程集成、影响判断、浏览器执行、PostgreSQL 行为、US50／US45 功能验证或 DoD 完成证据。

静态核查：`git diff --check` 通过（针对已跟踪改动）；新文档另行检查全部 10 条 AC、测试规格覆盖 ID 及文件存在。分支及 HEAD 未变。

### T3 — 合并 main 后通知与 US34 回归（2026-10-31）

测试版本：`b6f82bf03b370983bc577ab1dbd5e28c475f7404`；包括修正提交 `01be1d3` 和 main `e6ab88c`。测试前已跟踪工作区干净。

```powershell
$env:TMP = (Get-Location).Path
$env:TEMP = (Get-Location).Path
.\.venv312\Scripts\python.exe -m pytest -p no:cacheprovider tests/us36_notifications/test_us36_notifications_unit.py tests/us36_notifications/test_us36_notifications_api.py tests/unit/event_request/test_event_changes.py tests/integration/test_event_changes_integration.py -q
.\node_modules\.bin\vitest.cmd run tests/us36_notifications/notifications.unit.test.ts
```

实际结果：后端 `67 passed, 1 warning, 29 subtests passed in 22.95s`；前端 `1 file / 17 tests passed`，1.07 秒。后端警告为既有 TestClient/httpx 弃用提示。首次沙箱执行分别因 SQLite 文件访问失败及 Vite spawn EPERM 未能启动；获批在沙箱外重跑后通过。

覆盖 US51 registered-only、其他活动隔离、通用候补范围保留、事务 rollback；既有通知 API；US34 决定持久化、活动／安排不被自动改写、重复决定、权限及本次 main 新增回归。不是 US34→US51 自动重评集成证据。

US34 浏览器回归命令（真实本地应用和隔离 SQLite，非共享验收配置）：

```powershell
$env:PYTHON = Join-Path (Get-Location).Path '.venv312\Scripts\python.exe'
$env:TC_SHARED_DB = '0'
.\node_modules\.bin\playwright.cmd test tests/functional/us34-review-event-changes.spec.ts --config playwright.config.ts
```

实际结果：Chromium `3 passed (1.7m)`。US34-TC01 accepted 和 TC02 rejected 均验证决定持久化、organiser 通知及原活动字段不变；第三例验证已有场地／设备／报名安排可见且未自动应用提案。TC01 EVENT_ID=1、Request #1；TC02 EVENT_ID=2、Request #2；执行记录均注明 isolated regression。启动时有请求重试和 NO_COLOR 警告，未导致测试失败。
HTML 报告：`coverage/functional/report/index.html`（本地生成、被 Git 忽略，后续运行可能覆盖）。不是共享数据库验收，也不是三条新故事流程集成。

## 尚未采纳的建议与待决规则

以下都是建议／待确认问题，不是新增客户 AC，也不是已实现方案：

1. 建议使用独立、经验证且关联 accepted 决定的变更快照进行重评，同时保留活动原值；US34 的具体提交／存储接口尚未确定。
2. 设备“不再有效”需确认时段、数量、库存、需求及技术要求的判定；不假定自动释放或删除预留。
3. 报名设置“不再有效”和“影响参会者”需确认容量、报名开关、活动时间及截止日期规则；不假定自动退报名／转候补。
4. 返工目标阶段、标记解决权限／证据、旧批准失效及重送审轮次需确认；不假定任意手动清标即可重新送审。
5. 建议扩展共享标记并兼容 US38，统一后端资格校验；具体 schema 和团队接口尚未达成约定。

当前未引入 mock 或临时业务实现。既有 SQLite 是测试替身，不构成生产数据库行为验证。

## DoD（独立于 AC／测试状态）

| 项目 | 当前状态／证据 |
|---|---|
| 全部 AC 实现及逐条验证 | 未完成，见上表 |
| 适用单元／集成测试 | T3 在合并提交 b6f82bf 上通过 67 后端测试／29 子测试、17 前端单测及 3 个 US34 浏览器回归；新故事流程未完成 |
| 功能测试规格及真实执行记录 | 规格文档完成（含明确待确认规则）；所有新流程 NOT RUN / BLOCKED，无虚构执行结果 |
| US34／US36／US44／US49／US14 联调 | 未完成 |
| 非作者评审 | 无本故事评审证据 |
| 合并 main | 未合并；不得将现有 main 当作本故事已交付 |
| 合并提交 CI | 无本故事合并提交／CI 证据 |
| 无阻断缺陷 | 未验证；当前存在接口／规则阻塞 |
| 必要文档更新 | 本进度表已建立；交付文档仍需随实现更新 |

## 每轮交付日志

### 2026-10-31 — 合并后实测（不 push）

- 做了什么：确认用户已提交 01be1d3 并合并 main，HEAD b6f82bf；运行 T3 后端、前端及真实 US34 浏览器回归；更新本记录。
- 没做什么：未修改生产／测试代码；未新增故事接口集成；未 commit、push 或创建 PR。
- 验证了什么：67 后端测试／29 子测试、17 前端单测、3 个 Chromium 回归全部通过；保留 US34 接受不直接修改活动字段的边界。首次沙箱启动失败及重跑情况见 T3。
- 下一步：本次合并回归无测试失败；如需 Draft PR 可使用本批提交，但 US50／51 自动重评和 US45 仍需团队接口及规则，不能宣称 DoD 完成。
- 对应提交：测试代码 b6f82bf03b370983bc577ab1dbd5e28c475f7404；本轮记录为未提交文档。

### 2026-10-31 — fetch 与 Draft PR 建议

- 做了什么：成功 `git fetch origin`；读取 `git log --oneline HEAD..origin/main`、`git diff --stat HEAD..origin/main` 及关键后端文件差异。
- 远端变化：`origin/main` 从 cae5273 更新至 e6ab88c，包含 US16／US33／US34 相关合并；US34 分支更新至 a9f67cb。七个差异文件属于文档、测试和执行配置；关键后端 `event_changes.py`、`main.py`、`schemas.py`、`messaging.py` 无差异，因此没有取得 US34 新值接口。
- 没做什么：未合并远端、未切分支、未提交／推送／创建 PR。当前任务 HEAD 仍为 cae5273，工作区补丁保留。
- 验证了什么：fetch 成功，日志及差异已读取；未重跑测试，T2 不覆盖新 main 的新增测试。
- 下一步：建议在整理并提交当前补丁、同步最新 main 及运行相关回归后开 Draft PR，明确仅交付规格和 US51 收件人修正，不宣称三个故事完成；接口阻塞仍在。

### 2026-10-31 — 建立进度基线

- 做了什么：建立 10 条 AC 实现／接入／验证跟踪、依赖责任、历史测试证据及独立 DoD 清单。
- 没做什么：未修改生产／测试代码，未新建业务 mock，未运行测试，未提交／推送／合并。
- 验证了什么：核实当前分支、HEAD 和文档创建前的工作区；创建后检查 10 条 AC 行及文档差异。
- 下一步：先确定 US34 新值交接、共享标记／确认门禁、US44 安全契约和未展开的业务规则；可独立补功能规格，但待决预期必须标为待确认，不填写虚构执行结果。
- 对应提交：无；本轮交付为工作区未提交文档。

### 2026-10-31 — 独立通知修正与功能规格

- 做了什么：完成 [功能测试规格与执行状态](SPRINT4-YANGBO-functional-tests.md)；限定 US51 专用通知到 registered；保留通用候补通知范围；新增三个测试并修订一个旧范围测试；更新 US36 handover；整理[英文群询问和推荐契约](SPRINT4-YANGBO-team-question.md)，尚未发送。
- 没做什么：未定义无效／影响／阶段业务规则，未新增共享抽象或数据库 schema；未接入 accepted／安全／门禁流程；未提交、推送或合并。
- 验证了什么：T2 57 passed、13 subtests passed；含筛选、活动隔离、rollback、通用范围保持及既有通知 API／US34 回归。功能测试规格不是可执行流程已通过的证据。
- 下一步：由用户发出接口询问并收集团队确认；按确认的快照、共享标记及安全契约接入 US50／51，再完成 US45。其余业务代码都依赖尚未定义的数据或规则，不能安全独立实现。
- 对应提交：无；版本为 cae5273 + 本轮未提交补丁。
