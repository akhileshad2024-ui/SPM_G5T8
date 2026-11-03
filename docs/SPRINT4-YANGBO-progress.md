# Sprint 4 — Yangbo 进度与证据

**当前交付状态：三条故事已完成编码接入及匹配 API／浏览器验证；PR #43 已更新并 Ready for review。非作者批准、正式 main 合并及该合并提交 CI 仍不能预先勾选。** 精确源码提交及验证见 T8，PR 实时检查见下方链接；此前“接口缺失／未完成”审核均保留为历史快照，不代表最终源码。

最后更新：2026-11-03（Asia/Shanghai）。范围：US50（3 点）、US51（3 点）、US45（5 点），共 11 点。

当前分支：`yangbo-sprint4-us50-us51`。最新源码提交 `2bb5aa6861947faf7539167393ccc74dec75620b`（初版 561b70d，基线 dafea69，包含 main d993a41 和 US14）。后续仅更新记录时，源码证据仍绑定此 SHA，最新 PR head／检查以 Checks 为准。
US50／51／45 现已接入实际流程；早期 handoff、T1–T7 和初版 DoD 审核均是历史快照，不得据旧“仍待接口”描述断言最终实现缺失。用户本轮要求推进至可合并 PR，取代早先仅测试不 push 的阶段安排；不会代替非作者批准或执行 main 合并。共享数据库 DDL 仍未执行。

## 记录规则与需求来源

- 正式需求：用户在本会话提供的三条 Story 与全部 10 条 AC，原文逐项保留如下。原始页面：[Product Backlog](https://app.notion.com/p/ConnectSphere-Product-Backlog-3e19922d71f881b29bdef4797725bb80)。本地已有原文，不宣称已在线读回。
- 用户约束／澄清：保留 US34 接受后不直接修改活动字段的边界；US51 AC3 不自动扩大到候补者；US45 只标记点名安排；准备、确认和重新送审必须后端校验；与团队共享机制对齐。
- 用户提供的跨故事约束：US49 AC4 要求未解决的 US49–US51 标记阻止确认。尚未独立取得 US49 全部原文。
- 现有测试行为只作为兼容边界，不提升为客户 AC。建议、假设、mock、临时方案不能当作已采纳需求。
- 状态分别记录实现、接入和验证；单测通过不等于流程已集成，流程已验证不等于 DoD 完成。
- 每轮交付更新此表、测试证据及交付日志。测试绑定实际运行时的提交；未提交改动必须另注，不能把 HEAD 当作包含改动的提交。

## 10 条 AC 跟踪表

**下表为当前实现。** 历史「Sprint 4 九项 DoD 正式审核」记录的是实现前缺口；本轮已补齐技术实现，最终交付签核见 T8／最新 DoD 表。Not Reviewed／未勾选仅表示未签核，不自动表示失败。

以下代码路径均相对仓库根目录。T1 是已有基础行为的历史基线；T2 是本轮函数测试及既有 API 回归，均不是三条新故事端到端验收结果；T0 表示尚无该 AC 流程的执行证据。全部 AC 已有[功能规格](SPRINT4-YANGBO-functional-tests.md)，均未执行真实流程。

| AC 与正式原文 | 当前状态 | 已实现的具体行为及代码位置 | 尚未实现／尚未接入 | 测试命令、实际结果、对应提交 | 阻塞项及需要谁提供什么 |
|---|---|---|---|---|---|
| US50-1: Has the event's equipment reservations re-evaluated automatically when a change is accepted | 已实现；API／浏览器验证通过；待评审 | main.py:review_event_change → arrangement_reassessment.accepted；锁定接受事务自动检查全部设备预留，保存 before/effective 快照；旧调用标明 saved_details | 实现选择见 delivery；非作者签核仍待 | T8：新流程 API、FT50 浏览器及旧 US34 回归；源码提交 SHA 在本轮交付记录补齐 | 无编码接口阻塞；评审人审核快照兼容选择 |
| US50-2: Sees equipment reservations that are no longer valid flagged as "Requires Reassessment" | 已实现；API／浏览器验证通过；待评审 | equipment_reasons、ArrangementReassessment、ReassessmentPanel；仅失效预留标记，可持久化读取并按负责人员解决 | 不自动释放库存；需显式修订及审核 | 纯规则边界、mixed valid/invalid API、FT50 UI 标记／重载通过；T8 | 非作者审核有效性选择；共享库迁移部署前执行 |
| US50-3: Has the responsible Technical Support Staff notified of each flagged reservation | 已实现；API／浏览器验证通过；待评审 | accepted 为每个被标记 reservation ID 通知该活动 assigned technician；同事务保存，重复决定 409 | 没有负责人数据时不会虚构收件人；当前受支持流程创建预留前必须分配技术员 | 逐预留通知／无关技术员权限／rollback API 与 FT50 技术员 UI 通过；T8 | 非作者评审及正式 main 合并 |
| US51-1: Has the event's registration settings re-evaluated automatically when a change is accepted | 已实现；API／浏览器验证通过；待评审 | accepted 同事务自动检查 registration settings；快照保留原事件字段 | 旧文本只检查保存事实，不解析提案文字；UI 明确可供结构化值 | reg capacity/disable/valid settings API、FT51 接受 UI 通过；T8 | 非作者审核明确记录的兼容选择 |
| US51-2: Sees registration settings that are no longer valid flagged as "Requires Reassessment" | 已实现；规则／API／浏览器验证通过；待评审 | registration_reasons 与共享表／RegistrationTab 面板，容量不足、关闭但有人注册、截止晚于活动标记 | 不擅自取消／转候补；实际设置有效后才能解决 | 8 条纯规则测试中相关边界、实际 API 修正与 FT51 UI 通过；T8 | 非作者审核规则；schema 迁移部署前执行 |
| US51-3: Sees registered attendees notified where the change affects them | 已实现；API／浏览器验证通过；待评审 | accepted 比较 impact_keys，受影响才调用 registered-only attendees_affected；通知与是否设置失效独立 | 不把 waitlisted 自动纳入；影响选择见 delivery | 有效设置但时间受影响通知、purpose-only 不通知、候补排除 API，FT51 真通知通过；T8 | 非作者评审及 main 合并／对应 CI |
| US45-1: Has the event returned to the relevant earlier planning stage when the Safety Officer rejects the safety arrangement or requests changes | 已实现；两种结果 API／浏览器验证通过；待评审 | typed targets 决定后由 change_status(rework=True) 回 Approved arrangement planning，按目标显示 venue/equipment 阶段并开放编辑；未点名旧调用兼容 | 具体阶段映射作为实现选择供评审，不改变旧状态表默认语义 | 两种结果完整 API；FT45 rejected／changes_requested 两条浏览器流程均通过；T8 | 非作者审核阶段映射 |
| US45-2: Sees the venue or equipment arrangements named in the request flagged as "Requires Reassessment", reusing the flag from US49–US51 | 已实现；API／浏览器验证通过；待评审 | SafetyDecisionIn.targets、target_rows 校验所属活动／重复／类型，shared flags 关联具体 SafetyReview；不解析备注 | 既有 US38 JSON 保留，不能由新原因覆盖 | only named/cross-event/duplicate/approval-target API 及 FT45 点名 UI 通过；T8 | 非作者评审；新共享表部署迁移 |
| US45-3: Can resubmit the event for another Operational Safety Check once the flagged arrangements are resolved | 已实现并接入；API／浏览器验证通过；待评审 | 原 request_check 拦截所有未解决共享标记及旧场地重评；responsible resolve 校验实际安排并记录证据，之后同一接口再送审 | 没有另建重送审流程；旧文本与旧 US38 路径保留 | 完整设备／场地解决→再送审 API；原 US38 跨模块测试；两条 FT45 通过；T8 | 非作者评审及 main 合并／对应 CI |
| US45-4: Cannot move the event to preparation or confirm it until the Safety Officer approves | 已实现并接入；API／浏览器验证通过；待评审 | 现 US14 outstanding/confirm 与新 preparation 入口共用未解决项及当前安全批准；准备记录关联 SafetyReview，直接请求未批准均 409 | Preparation 为独立实际动作，不凭隐藏按钮；确认不新增必须先准备的条件 | 直接 API gates、当前批准绑定／幂等准备；两条 FT45 准备→确认及旧 US34/US44 浏览器通过；T8 | 非作者评审；合并后 CI 才能签最终 DoD |

## 测试与核查证据

### T0 — 尚无故事验收执行

本条保留初版含义：没有结果的 FT 不能填 PASS。最新 T8 已新增三条故事的真实 API／浏览器结果，以 T8 和更新后的功能执行表为准，不能继续将全部场景标为未执行。

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

### T4 — 2026-11-03 合并 US44 后回归

测试提交：`438c5812b28bc75cf3b7666a18bbf42beaec6f88`，由 a589dfc 合并 origin/main 01744ce 产生，无冲突。生产／测试代码无额外补丁；进度文档未提交改动保留。未 push。

```powershell
$env:TMP = (Get-Location).Path
$env:TEMP = (Get-Location).Path
.\.venv312\Scripts\python.exe -m pytest -p no:cacheprovider tests/unit/safety/test_us44_operational_safety_check.py tests/integration/test_us44_operational_safety_check_integration.py tests/us36_notifications/test_us36_notifications_unit.py tests/us36_notifications/test_us36_notifications_api.py tests/unit/event_request/test_event_changes.py tests/integration/test_event_changes_integration.py -q
.\node_modules\.bin\vitest.cmd run tests/us36_notifications/notifications.unit.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
$env:PYTHON = Join-Path (Get-Location).Path '.venv312\Scripts\python.exe'
$env:TC_SHARED_DB = '0'
.\node_modules\.bin\playwright.cmd test tests/functional/us34-review-event-changes.spec.ts tests/functional/us44-operational-safety-check.spec.ts --config playwright.config.ts
```

- 后端实际结果：`175 passed, 1 warning, 325 subtests passed in 42.00s`，警告是既有 TestClient/httpx 弃用提示。
- 前端通知：`17 passed`，1.00 秒；TypeScript 检查退出码 0。
- 浏览器首轮：`1 failed, 10 passed (2.2m)`；US44 全部 8 例、US34 拒绝和已有安排 2 例通过；US34-TC01 首次在 login 的 URL 跳转断言处 10 秒超时，尚未到接受操作，保留失败记录。不能据此宣称产品接受逻辑有缺陷或整轮通过。
- 首轮失败证据：`coverage/functional/report/index.html` 及 `coverage/functional/results/us34-review-event-changes--cd9c9--and-notifies-the-organiser-chromium/` 下的 error-context.md、截图和 trace.zip。独立重查使用 `--grep US34-TC01 --output coverage/functional/us34-recheck --reporter list`，不覆盖首轮报告，结果随后补充。
- 独立重查实际结果：`1 passed (35.9s)`，无代码修改；完整 accepted 流程、organiser 通知及活动字段保持旧值通过，EVENT_ID=1、Request #1，isolated regression。首轮登录超时未再现，根因未确认，保留为测试稳定性观察；不把重跑结果改写成首轮全绿。
- 均使用隔离 SQLite／本地服务器；US44 现有流程回归不等于 US45 点名重评和门禁已完成；没有共享数据库、US14 分支或完整新故事验收。

### T5 — 2026-11-03 US45 现有场地重评标记接入

版本：438c581 + 未提交的 `backend/safety_check.py` 和 `tests/integration/test_us45_existing_venue_reassessment.py`；无新实现提交。

```powershell
$env:TMP = (Get-Location).Path
$env:TEMP = (Get-Location).Path
.\.venv312\Scripts\python.exe -m pytest -p no:cacheprovider tests/integration/test_us45_existing_venue_reassessment.py tests/unit/safety/test_us44_operational_safety_check.py tests/integration/test_us44_operational_safety_check_integration.py tests/us36_notifications/test_us36_notifications_unit.py tests/us36_notifications/test_us36_notifications_api.py tests/unit/event_request/test_event_changes.py tests/integration/test_event_changes_integration.py -q
```

实际结果：`178 passed, 1 warning, 330 subtests passed in 35.66s`（当时新文件含 3 项测试）。随后只新增一个真实跨模块 API 场景，不再修改业务代码，执行：

```powershell
.\.venv312\Scripts\python.exe -m pytest -p no:cacheprovider tests/integration/test_us45_existing_venue_reassessment.py -q
```

实际结果：`4 passed, 1 warning, 7 subtests passed in 3.63s`。两次警告均是既有 TestClient/httpx 弃用提示；不能将重叠测试数相加。

真实 API 集成流程：两个相邻已批准预订→安全拒绝或要求修改→Venue Staff 将 setup 改为 60，US38 自动标记→重送审返回 409→将 setup 恢复为 0，US38 自动清标→重送审成功。两类结果均验证，不使用 mock 或直接注入该流程的标记。
另外三项测试使用明确标注的持久化 US38 标记 fixture，验证失败无状态／历史／通知／安全记录副作用、其他活动隔离、角色及 assigned coordinator 权限；清标 fixture 仅测试重送审条件，不宣称是新解决接口。
范围：真正接入现有 POST 重送审入口，但只覆盖现有场地标记；未覆盖安全点名目标、设备／报名共享标记、返工编辑、准备／确认。未做本轮浏览器运行、生产数据库或完整 AC／DoD 验收。无 schema 或临时业务抽象新增。

### T6 — 2026-11-03 接入 US14 确认门禁

版本：合并提交 c2c4c17，包含 US14 5b22577；保留未提交 US45 request_check 补丁，新增 `tests/integration/test_us45_confirmation_gate.py`，测试记录尚未提交。

```powershell
$env:TMP = (Get-Location).Path
$env:TEMP = (Get-Location).Path
.\.venv312\Scripts\python.exe -m pytest -p no:cacheprovider tests/integration/test_us45_confirmation_gate.py tests/integration/test_us45_existing_venue_reassessment.py tests/unit/safety/test_us14_confirm_event.py tests/us14_confirm_event tests/unit/safety/test_us44_operational_safety_check.py tests/integration/test_us44_operational_safety_check_integration.py tests/us36_notifications/test_us36_notifications_unit.py tests/us36_notifications/test_us36_notifications_api.py tests/unit/event_request/test_event_changes.py tests/integration/test_event_changes_integration.py -q
.\node_modules\.bin\vitest.cmd run tests/unit/event-review/confirmation.unit.test.ts tests/us36_notifications/notifications.unit.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
$env:PYTHON = Join-Path (Get-Location).Path '.venv312\Scripts\python.exe'
$env:TC_SHARED_DB = '0'
.\node_modules\.bin\playwright.cmd test tests/functional/us14-confirm-event.spec.ts tests/functional/us34-review-event-changes.spec.ts --config playwright.config.ts --output coverage/functional/us14-integration --reporter list
```

实际结果：后端 `230 passed, 1 warning, 356 subtests passed in 62.03s`；警告为既有 TestClient/httpx 弃用提示。前端 2 文件、34 测试通过，614ms，TypeScript 退出码 0。浏览器 `9 passed (1.3m)`，含 US14 六例及 US34 三例；本轮没有浏览器失败／重试。日志中的 NO_COLOR 警告未导致失败。使用 reporter list，产物目录为 coverage/functional/us14-integration，不声称生成了新的 HTML 报告。
US34 接受案例 EVENT_ID=7、Request #1，拒绝案例 EVENT_ID=8、Request #2；均标为 isolated regression，验证决定／通知及原字段保持。US14 覆盖实际确认、缺项清单、未安全批准禁止确认、场地不可用禁止确认、通知及确认后锁定。
新增 API 场景覆盖 approved、pending review、rejected／changes_requested 和重新送审待批准阶段，均直接 POST confirm 拒绝且无状态／历史／通知／审查副作用；新安全批准后允许确认。另以真实 US38 场地变更产生重评标记，证明 safety_approved 也不能绕过同一个确认门禁，恢复场地后可确认。均无 mock，不证明 preparation 或安全点名流程完成。

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

### 2026-11-03 — T8 完整实现并推进 PR

- 做了什么：合并最新 main d993a41；完成 accepted 结构化快照／自动重评、共享目标标记、逐预留和 registered 通知、显式应用及解决审计、安全点名返工、统一重送审／准备／确认门禁；提供页面入口及私有表迁移。详细实现选择和接口在 [交付文档](SPRINT4-YANGBO-delivery.md)。
- 没做什么：未解析自由文本猜新值，未自动释放库存／取消报名，未伪造客户规则批准、非作者评审或 main 合并；未执行共享库 DDL，未修改 Notion。
- 验证了什么：T8 中的真实 API／浏览器流程；原 US34 接受不改活动字段的兼容测试保持通过。新测试中的一次通知异常注入只用于失败回滚，其他流程不 mock 成功服务。
- 下一步：完成全量检查后提交并更新现有 PR #43，核对其精确 head CI；非作者 review 后由用户合并。main 实际合并 SHA 的 CI 必须合并后再核对。
- 对应提交：初版 561b70d；最终时段一致性补充 2bb5aa6；各轮测试保留实际执行时基线／补丁，不把前一轮执行当作最新 revision 全套验证。

### 2026-11-03 — 合并 US14 并复用确认门禁

- 做了什么：在当前任务分支合并 origin/sprint4_US14_chinhui，产生 c2c4c17，无冲突；复用现有 confirm/outstanding 及确认页，不创建另一套门禁；增加 US45→US44→US14 真实 API 集成测试。
- 没做什么：未定义 preparation／新值／无效性／安全点名规则；未修改队友门禁实现、未执行共享数据库迁移，未 push。
- 验证了什么：T6 记录实际结果；文档更新，确认门禁代码已合入且有后端入口，整条 US45-4 仍部分完成。
- 下一步：补齐业务规则及共享重评契约后完成剩余故事；保留一个 confirmation 和一个 safety request 流程。
- 对应提交：c2c4c17 + 未提交 US45 补丁／集成测试。

### 2026-11-03 — 完善现有重送审接口

- 做了什么：在真实 US44 request_check 增加 US45 现有场地标记后端校验；对两类返工结果生效；新增真实跨模块 API 场景及副作用／权限／活动隔离测试；更新 AC3 和功能记录。
- 没做什么：未猜新值／无效规则／目标阶段，未引入设备标记 schema 或新解决 API，未合并 US14 分支，未修改初次送审行为，未 commit／push。
- 验证了什么：T5 首轮 178 passed／330 子测试；追加真实 API 流程后新文件 4 passed／7 子测试。文档完成；现有场地标记校验代码完成并已接入；API 集成已验证；整条 US45、其他故事和 DoD 未完成。
- 下一步：接口齐备后将同一校验扩展到共享设备／点名标记；其余 US45-1/2/4 和 US50／51 自动重评继续按阻塞项推进。
- 对应提交：438c581 + 本轮未提交补丁。

### 2026-11-03 — 接口契约核对

- 做了什么：只读核实远端哈希未变；建立 [接口核对表](SPRINT4-YANGBO-interface-audit.md)，记录 US34／US44／US14 实际路径、输入输出、权限、事务和缺口，附待确认问题与英文群询问草案。
- 新发现：安全返工状态不在 event_updates／equipment 的规划编辑状态集合，coordinator 无法通过原编辑入口修改详情／设备需求；US45 必须明确阶段或编辑资格，不能仅接重新送审。设备负责人是活动级映射，预留有实际 ID，可以定位，但逐预留通知尚未接入。
- 已确认可复用：现 US44 的两个 POST；US14 分支 confirm/outstanding。未确认：US34 新值来源、US49 标记契约、安全点名输入／阶段、preparation 入口及业务有效性规则。
- 没做什么：未发送消息、未把建议当作队友同意、未修改生产／测试代码、未新建业务抽象、未 push。
- 验证了什么：源码和 schema 静态核查，无本轮测试执行；T4 是历史结果。
- 下一步：由队友确认文档中的五项契约问题或提供既有实现提交，再开展 accepted／返工接入。

### 2026-11-03 — 同步 main 并测试

- 做了什么：确认 fetch 后 origin/main 01744ce；在当前任务分支执行 `git merge --no-edit origin/main`，产生 438c581，无冲突；保留未提交进度记录并刷新 US45 AC1/3 基础状态；运行 T4。
- 没做什么：未合并 US14 开发分支、未修改业务或测试代码、未 push，也未把 US44 通过当作 US45 完成。
- 验证了什么：main 已是 HEAD 祖先；175 后端测试及 325 子测试、17 前端单测和 TypeScript 通过；浏览器首轮 10 通过／1 登录超时，独立重查见 T4。
- 下一步：确认 US34 新值、US49 共享标记、US44 点名目标和返工阶段；准备阶段及 US14 门禁继续对齐。当前合并提交留在本地。
- 对应提交：438c5812b28bc75cf3b7666a18bbf42beaec6f88；进度文档未提交。

### 2026-11-03 — 队友远端更新核查

- 做了什么：成功 fetch；当前任务 HEAD a589dfc（含此前回归记录），origin/main 从 e6ab88c 更新至 01744ce。只读检查远端代码，没有合并或 push。
- 已看到：US44 通过 PR #46 合入 main，新增 Safety Officer、SafetyReview、两类非批准状态、决定接口及重新送审入口。`safety_check.request_check` 可从 safety_changes_requested／safety_rejected 重送，但只检查 booking_state／equipment_state，尚未检查点名重评标记。`SafetyDecisionIn` 只有 outcome/comment，没有点名安排 ID；US45-1/2 仍需阶段与目标契约，不能宣称已完成。US45-3 有可复用后端入口，尚未满足解决标记条件。
- US14：远端分支 origin/sprint4_US14_chinhui 为 5b22577，尚未合入当前 origin/main。`event_confirmation.outstanding/confirm` 提供后端确认资格检查，要求 safety_approved，检查场地 flag/reassessment 及设备进度；未发现设备／报名重评标记校验。可作为 US45-4 确认门禁接入点，准备阶段门禁仍待明确。
- US34：origin/main 接受接口仍只有 outcome/reason，保存决定但不交接新值；US50-1／US51-1 的首要阻塞未解除。未找到 US49 实现提交或共享标记扩展；仅有通知 helper，不能当作队友 US49 已完成。
- 没做什么：未运行新 main／US44／US14 测试，未修改业务实现，未将远端代码合并到任务分支；既有测试结果不覆盖这些新提交。
- 下一步：先同步 main 获取 US44 基础并跑相关回归；与 Chin Hui 确认 US14 合并和 US49 标记契约，与 Akhi 确认点名安排及返工阶段，与 Yuetong 确认接受时新值。US45 可复用的基础增加了，但三个故事仍不能无规则完成。
- 本轮验证：git fetch、提交日志及远端源码静态检查；文档完成，业务代码无新增，未做新流程验证。上方 AC 表中的旧“无 US44 接口”描述按本条刷新理解，后续正式接入时逐行更新。

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

## Sprint 4 九项 DoD 正式审核（2026-11-03 历史快照；后续实施见 T8）

### 审核基准及结论

来源：[Sprint 4 DoD](https://app.notion.com/p/Sprint-4-US-Definition-of-Done-Checklist-4049922d71f881f1a2b8e21976218b5d)。网页工具本轮无法读取该页，以用户本轮完整提供的九项 DoD、Pending 和已提供的正式 AC 为基准；没有修改 Notion、勾选或较早 Sprint 记录。

结论：**US50、US51、US45 均不建议标为 Done。** 原因是实现／集成及交付证据尚不完整，而不是 Not Reviewed 或未勾选本身。九项对三条故事全部适用，没有“不适用”项：三条均跨模块，需要集成测试；即使某次改动无需新 schema，也仍需核实 setup/run 文档适用性。

本轮只实施审核、针对性复核测试及文档记录，不重复实现已有功能，不合并新 main、不修改业务代码。缺失功能作为后续实施清单；实现选择由 Yangbo 负责设计，只有业务语义／团队协作及非作者签核属于待确认依赖。

### GitHub、版本与证据范围

- 本地 HEAD：`c2c4c17a9c2731b4b4aeb013629d668b110f9210`；含 US14 5b22577。US45 request_check 改动及两份集成测试仍是未提交工作区补丁。本轮新增审核文档也未提交。
- fetch 后远端 main：`d993a410cd3096a063c631a685a20cf62675d583`；本地尚未包含其 US19 等新增变更。旧本地回归不能声称覆盖最新 main。
- [Yangbo Draft PR #43](https://github.com/akhileshad2024-ui/SPM_G5T8/pull/43)：open、draft、`merged=false`；作者 Lambert4EVER，head `a589dfcd1101babc667f22b7bc89971a5452b29c`；连接器返回 reviews=[]，没有非作者签核记录。本地后续合并及 US45 工作区改动未在该 PR head。
- PR #43 API 返回的 `merge_commit_sha=8ee2e82b17a53263f8c2970d322a39116f99ec92` **不是已合入 main 的证据**：PR 尚未 merged，不能把预合并值当正式合并提交。
- [PR #43 CI](https://github.com/akhileshad2024-ui/SPM_G5T8/actions/runs/41201199027)：event=pull_request、API head_sha=a589dfc，test/frontend/functional 三个 job success；只证明当时 PR 版本，不能覆盖本地未推送实现，也不是故事合并 main 的 CI。
- [US44 PR #46](https://github.com/akhileshad2024-ui/SPM_G5T8/pull/46)：作者 akhileshad2024-ui；yuetongwen2024-maker 于 2026-11-02 05:36:19Z APPROVED；正式合并 SHA `01744ce52a4b73b44a3d9ecdeff0a666965d33c5`；[该提交 push CI success](https://github.com/akhileshad2024-ui/SPM_G5T8/actions/runs/41395013624)。这是依赖 US44 的证据，不是 US45 签核。
- [US14 PR #47](https://github.com/akhileshad2024-ui/SPM_G5T8/pull/47)：作者 chyup3；zhenhanlin2024 于 2026-11-03 09:22:33Z APPROVED；正式合并 SHA `6f57df765c1422e70fe69c7c1270ed3898be7753`；[该提交 push CI](https://github.com/akhileshad2024-ui/SPM_G5T8/actions/runs/41610529095) 的 test/frontend/functional success。确认依赖已交付，不能代替 Yangbo 三条故事评审。
- [最新 main CI](https://github.com/akhileshad2024-ui/SPM_G5T8/actions/runs/41611443282)：push、SHA d993a41，test/frontend/functional success；main 不含 Yangbo 通知修正提交 01be1d3（祖先检查退出 1），也不含未提交 US45 补丁。
- GitHub 连接器 search 未返回已知 PR，改用公开 REST 读取 PR、run、job；后续 REST 遇到速率限制，正式 review 状态通过 GitHub 连接器 list_pull_request_reviews 交叉核实。未把中间丢失字段的 PowerShell review 投影作为批准证据。

### T7 — 本轮针对性实测

测试版本：本地 c2c4c17 + 未提交 US45 request_check／两份集成测试，业务代码自 T6 后未改。

```powershell
$env:TMP = (Get-Location).Path
$env:TEMP = (Get-Location).Path
.\.venv312\Scripts\python.exe -m pytest -p no:cacheprovider tests/us36_notifications/test_us36_notifications_unit.py tests/integration/test_us45_existing_venue_reassessment.py tests/integration/test_us45_confirmation_gate.py -k 'US50 or US51 or ExistingVenueReassessment or SafetyConfirmationGate' -q
```

实际结果：**12 passed, 16 deselected, 1 warning, 9 subtests passed in 5.56s**。警告为既有 Starlette TestClient/httpx 弃用提示。隔离 SQLite，真实 FastAPI/API／数据库查询；不是共享环境、PostgreSQL、全套 CI 或整个故事验收。前端／浏览器／TypeScript 本轮未重跑，历史 T6 为 230 后端测试／356 子测试、34 前端测试、9 浏览器场景及 TypeScript 通过。

### AC → 代码 → TC／测试 → 实际结果

功能规格 FT ID 定义在 [功能测试规格](SPRINT4-YANGBO-functional-tests.md)；“规格已写”不表示已有可执行自动化或通过记录。

| AC | 状态 | 已有代码及缺口 | 测试关联与真实执行证据 |
|---|---|---|---|
| US50-1 | 阻塞 | `main.py:review_event_change` 接受后只保存决定／通知；没有 US50 重评调用或有效新值。main 最新源码也相同 | FT50-01、FTX-01 规格已写，自动重评流程未执行；US34 历史 T6 接受边界通过不等于本 AC |
| US50-2 | 阻塞 | `VenueBooking.reassessment` 是场地标记，设备预留模型／schema／视图尚无相应标记 | FT50-01/02 规格已写；设备标记执行证据无 |
| US50-3 | 部分满足 | `messaging.equipment_reassess` 能找活动 assigned technician，但 accepted 未调用，通知未关联每个被标记预留 | `test_US36_US50_AC3_assigned_technician_is_told_equipment_needs_reassessing`、`...no_technician_means_no_notice` 本轮 T7 通过；仅辅助函数。FT50-03 未执行 |
| US51-1 | 阻塞 | US34 无新值／报名重评调用；`registrations.py` 原有报名规则不等于变更重评 | FT51-01、FTX-01 规格已写；自动重评无执行证据 |
| US51-2 | 阻塞 | 无报名设置重评标记及显示／解决链路 | FT51-01/02 规格已写；无执行证据 |
| US51-3 | 部分满足 | `messaging.attendees_affected` 本分支限定本活动 registered，保留通用候补通知函数；未接 accepted 或影响判断 | 本轮 T7 中 `test_US36_US51_AC3_only_registered_attendees_are_told`、`test_US51_notification_does_not_include_registrations_for_other_events`、`test_US51_recipient_filter_does_not_change_general_attendee_audience`、`test_US51_notification_is_rolled_back_with_callers_transaction` 通过；FT51-03/04 真正变更通知未执行 |
| US45-1 | 部分满足 | `safety_check.decide` 两类结果／历史均已有；`event_updates.PLANNING_STATUSES`、`equipment.PLANNING` 不含安全返工状态，相关可编辑规划阶段仍缺 | FT45-01R/01C/02 规格已写；T6/T7 覆盖两类结果，但没有目标规划阶段及返工编辑验收 |
| US45-2 | 阻塞 | `SafetyDecisionIn` 只有 outcome/comment；无点名安排 ID、对应持久化或安全原因共享标记 | FT45-01R/01C/02 规格已写，未执行安全点名流程；US38 自动产生的时间冲突标记不能当作安全点名实现 |
| US45-3 | 部分满足 | `safety_check.request_check` 本地补丁拦截本活动 approved 场地预订 reassessment；解决后允许；未覆盖设备或安全点名全部标记 | `test_real_venue_change_flags_and_resolution_gate_both_rework_outcomes` 本轮 T7 真 API 通过；`test_both_nonapproval_outcomes_refuse_flags_without_side_effects_then_resubmit`、`test_other_events_flags_do_not_block_this_event`、`test_resubmission_still_rejects_other_coordinators_and_roles` 通过。FT45-03 仅现有场地子场景完成；后三项使用明确标注的标记 fixture |
| US45-4 | 部分满足 | 复用 US14 `event_confirmation.confirm/outstanding`：安全未批准备案不能直接 POST confirm；preparation 入口／门禁缺失，设备／报名重评门禁缺失 | `test_both_rework_outcomes_and_resubmission_need_new_safety_approval`、`test_safety_approval_does_not_bypass_the_existing_venue_reassessment_gate` 本轮 T7 真 API 通过；T6 US14 六例浏览器通过。FT45-04 确认部分、FT45-05 现有场地部分通过，不能覆盖 preparation 或 US49–51 全部标记 |

以上 T7 测试名分别位于 `tests/us36_notifications/test_us36_notifications_unit.py`、`tests/integration/test_us45_existing_venue_reassessment.py`、`tests/integration/test_us45_confirmation_gate.py`。总数为同一次执行集合，不为每条 AC 虚构独立通过数。

### US50 — 九项 DoD

| # | DoD | 状态 | 证据／剩余工作 |
|---|---|---|---|
| 1 | Approved AC met | 阻塞 | AC1/2 未实现；AC3 仅通知 helper。补 accepted 新值交接、自动判断、设备标记及逐预留通知 |
| 2 | Peer-reviewed and merged to main | 阻塞 | #43 为 Draft、reviews=[]、未合并；需非作者评审及正式 main 合并 |
| 3 | Unit tests pass | 部分满足 | T7 两个 US50 helper 测试通过；重评／标记规则单测尚不存在，不能签整条故事 |
| 4 | Integration tests pass (if applicable) | 阻塞 | 适用：跨 US34／设备／US36；accepted→设备重评无实现及实测 |
| 5 | CI build and tests pass on merge commit | 待验证 | #43 PR CI 通过但无 US50 main 合并提交；完成合并后核对精确 SHA 的 build/test/functional |
| 6 | Tests linked to US / AC | 部分满足 | FT50-01/02/03 及 US50-AC3 helper 命名已关联；AC1/2 自动化与结果链接缺失 |
| 7 | Functional TC created and required tests pass | 部分满足 | TC 规格已写；FT50 真实流程未执行，无整条故事功能通过证据 |
| 8 | No workflow-blocking defects | 阻塞 | 接受后不会重评／标记是已证实功能缺口，不因旧回归通过而消失；补齐后再做完整流程审查 |
| 9 | Setup / schema / run documentation updated (if needed) | 部分满足 | 进度、规格、接口文档已有；实际设备标记 schema／迁移／运行说明随实现补齐，无新 schema 不等于本项不适用 |

### US51 — 九项 DoD

| # | DoD | 状态 | 证据／剩余工作 |
|---|---|---|---|
| 1 | Approved AC met | 阻塞 | AC1/2 未实现；AC3 registered-only helper 未接 accepted／影响判断 |
| 2 | Peer-reviewed and merged to main | 阻塞 | #43 无评审、未合并；01be1d3 不在 main，不能把依赖故事批准当作本故事批准 |
| 3 | Unit tests pass | 部分满足 | T7 四个 US51 helper／边界测试通过；报名重评和影响判断单测缺失 |
| 4 | Integration tests pass (if applicable) | 阻塞 | 适用：US34→报名设置／US36；真实接受→设置标记／通知尚未验证 |
| 5 | CI build and tests pass on merge commit | 待验证 | PR #43 CI 只覆盖 a589dfc；没有含完整 US51 的 main 合并提交及对应 CI |
| 6 | Tests linked to US / AC | 部分满足 | FT51-01/02/03/04 规格、US51 helper 命名已关联；AC1/2 自动化及影响结果证据缺失 |
| 7 | Functional TC created and required tests pass | 部分满足 | 规格已写；helper 通过不能替代 FT51 接受变更真实流程 |
| 8 | No workflow-blocking defects | 阻塞 | 自动重评链路缺失；需验证 registered 影响范围，不能用候补通知作为额外必需条件 |
| 9 | Setup / schema / run documentation updated (if needed) | 部分满足 | US36 handover 已改 registered；报名标记的实际数据／部署／运行说明尚未完成 |

### US45 — 九项 DoD

| # | DoD | 状态 | 证据／剩余工作 |
|---|---|---|---|
| 1 | Approved AC met | 部分满足 | 两类安全结果已有；场地标记重送审拦截与确认门禁局部实测通过。目标阶段、点名标记、全部标记解决、preparation 缺失 |
| 2 | Peer-reviewed and merged to main | 阻塞 | US45 补丁及两份测试未提交；#43 未更新到本地实现且无批准／合并；US14/US44 非作者评审不能替代本故事 |
| 3 | Unit tests pass | 部分满足 | T6 US44／US14 基础单测通过；US45 新代码主要经数据库 API 测试覆盖，完整返工／点名／阶段规则单测缺失 |
| 4 | Integration tests pass (if applicable) | 部分满足 | 适用；T7 六个 US45 API 测试及 9 子测试通过（同轮还有六个通知 helper 测试）；覆盖两类结果、US38 标记、重送审／确认／权限，无完整安全点名返工链 |
| 5 | CI build and tests pass on merge commit | 待验证 | US44 01744ce、US14 6f57df7、最新 main d993a41 的 push CI success 是依赖证据；US45 本地未提交代码无 PR／main CI |
| 6 | Tests linked to US / AC | 部分满足 | 新文件 docstring 标 US45-AC3／AC4，FT45 全部已编号；AC1 阶段及 AC2 安全点名的可执行测试缺失 |
| 7 | Functional TC created and required tests pass | 部分满足 | FT45 规格完整列出确定／待决预期；T7 局部真实 API 流程，T6 US14 浏览器通过；不是完整 US45 functional suite 通过 |
| 8 | No workflow-blocking defects | 阻塞 | 安全返工状态不能编辑协调员详情／设备需求；无点名标记、准备门禁。为已知功能缺口；首轮历史登录超时重跑通过，仍有稳定性观察，不能据此宣称全流程无阻断 |
| 9 | Setup / schema / run documentation updated (if needed) | 部分满足 | 进度／规格／接口文档已有；US14 migration 已有但本轮未在共享库执行；安全目标／标记／阶段最终 schema 和运行说明仍需补 |

### 剩余实施与责任（不把可决定的技术方案外推成等待队友）

1. **Yangbo 主责 US50/51 实现**：设计兼容 US34 的结构化快照／交接，保持接受不直接改活动字段；扩展共享标记到设备／报名，补重评、逐预留通知、影响 registered 通知。Yuetong 提供既有 US34 边界复核；业务有效性／影响判定由团队确认，不擅自取消报名或释放预留。
2. **Yangbo 主责 US45 剩余部分**：扩展现 US44 点名目标及持久化、两类结果对应的返工编辑路径，统一标记解决与重送审条件，确认 preparation 的实际业务动作后加后端门禁。Akhi／Chin Hui 协调既有 US44／US49/US14 契约；不另建重复门禁。
3. **测试**：补所有缺失规则单测、accepted→重评及安全点名→返工→解决→再送审→批准→准备／确认的匹配 API／浏览器场景，记录真实版本、输入输出和执行结果；当前规格不得填 PASS。
4. **外部签核**：用户尚要求不 push；只有获得后续发布授权并提交／推送完整补丁后，非作者才能评审准确版本。评审与正式 main 合并需队友参与；合并后核对该 SHA 的 CI build/tests，而不是引用 #43 旧 PR CI 或依赖故事 CI。
5. **main 同步**：本轮只 fetch 未合并 d993a41，后续实现／交付前同步并回归，尤其 US36 文档和通知接口兼容。

### Notion Pending 可复制英文（未写入 Notion）

- **US50:** Notification helper tests pass, but US34 accepted-change integration, equipment reassessment/flags and per-reservation notifications remain incomplete. Complete matching functional tests, peer review, main merge and CI on that merge commit.
- **US51:** Registered-only notification filtering is tested; accepted-change registration reassessment, flags and impact-triggered notifications are not integrated. Complete workflow tests, peer review, main merge and merge-commit CI.
- **US45:** Local API tests verify both non-approval outcomes, existing venue-flag resubmission checks and confirmation gating. Planning-stage rework, named venue/equipment flags and preparation gating remain incomplete. Full workflow verification, peer review, main merge and merge-commit CI are pending.

### 本轮交付

- 做了什么：按 27 个 DoD 项审核；读取 PR／非作者 review／合并 SHA／精确 CI job；复核最新 main 源码，执行 T7，更新进度表及 Pending 英文。
- 没做什么：未修改 Notion／旧 Sprint，未补勾、未提交／推送、未实施新业务功能，未把规格或局部测试包装为 Done。
- 验证了什么：T7 12 passed／9 子测试；#43 PR CI success 但未合并且无 reviews；依赖 US14／US44 评审／合并可核实，但不覆盖本地新补丁。
- 下一步：按上列剩余实施清单补齐功能，再提交准确版本供非作者评审及 main 合并／CI 审核；三条目前全部保留非 Done。

## T8 — 完整实施后的验证与最新 DoD（2026-11-03）

本节取代前面实现前审核的当前结论，不删除历史证据。初版源码 **561b70d8a57217c35b9d6ff015064c9f4895cf00**，最终时段一致性补充 **2bb5aa6861947faf7539167393ccc74dec75620b**（基线 dafea69，含 main d993a41），均已推送现有 PR #43。规则、兼容取舍、迁移、回滚和运行方法见 `SPRINT4-YANGBO-delivery.md`；当前十条 AC 表已逐行映射实现和测试。增量修正和各自实测分开记录；仅改文档的记录提交不等同新源码版本。

### 已实际执行

| 检查 | 命令／结果 | 范围 |
|---|---|---|
| 新故事初次规则／API | pytest `test_sprint4_reassessment_workflows.py` + `test_reassessment_rules.py`：16 passed、2 subtests；新增四项边界后 API 文件 12 passed、2 subtests | 三条故事真实事务及纯比较；不重复累加重叠集合 |
| 最终核心／旧标记兼容 | pytest 新两文件、US36 helper、US45 旧标记／确认文件：48 passed、11 subtests，36.76s | 实际通知、两种安全结果、权限／回滚、场地和设备／报名闭环 |
| 前端全量 | `npm test -- --reporter=dot`：27 files、467 tests passed，4.95s | 全部 Vitest，含 main 新依赖；先执行 npm ci |
| 单测独立入口 | `DATABASE_URL=sqlite://`，`python -m unittest discover -s tests/unit -q`：596 tests、OK，16.998s | CI 单测发现命令，本地 Python 3.12；CI Python 版本另由远端检查 |
| TypeScript | `node_modules/.bin/tsc --noEmit`：退出码 0 | 已补装 main 锁文件中的测试依赖 |
| 生产构建 | `npm run build`：成功，18 页面生成完成 | 前端生产编译、类型、打包；不等于部署共享库 |
| 新浏览器 + 兼容 | Playwright 新 Sprint 4 spec + 原 US34 + US44：15 passed，2.8m | 新故事四例 + US34 三例 + US44 八例；真实本地应用／隔离数据库，无成功流程 mock |
| 后端全量 | `python -m pytest tests -q -p no:cacheprovider`：1974 passed、1 skipped、979 subtests passed，1055.79s | 首次收集后追加的四个边界测试另行 12 项集合复核通过；不将未收集测试算入旧全量总数。Skip 是未设置 DOD_POSTGRES_TEST_URL 的实际 PostgreSQL 行锁专项；没有把它写成通过 |
| 已提交版本复核 | 561b70d 上 `npm run build` 成功；仅新故事 spec 再跑：4 passed (1.3m) | 覆盖最终 UI 刷新／UTC 审计修正；启动字体请求出现重试但测试通过，不隐去重试记录 |

最后的代码复核修正了三项问题：开发初次单测导入路径；释放库存后的 operational status/notes 被误认作 reviewed requirement 漂移；新审计时间统一输出 UTC。未修改旧 US34/US44 预期以迎合新流程。原纯文本调用仍自动检查保存事实，明确 basis，不把文本语义伪装为结构化值。

### 当前九项 DoD（每条独立签核）

| # | DoD | US50 | US51 | US45 | 当前证据／外部剩余 |
|---|---|---|---|---|---|
| 1 | Approved AC met | 部分满足 | 部分满足 | 部分满足 | 十条均有实现及匹配测试；用户提供 AC 不变，具体实现选择透明记录；待非作者最终核查，不能自己签客户认可 |
| 2 | Peer-reviewed and merged to main | 阻塞 | 阻塞 | 阻塞 | 等非作者批准准确 PR 版本，并由用户合并；不可用依赖 US14/US44 的 review 代替 |
| 3 | Unit tests pass | 已满足 | 已满足 | 已满足 | 规则／helper、单测发现 596 通过；最终 PR 精确提交 CI 另记 |
| 4 | Integration tests pass (if applicable) | 已满足 | 已满足 | 已满足 | 新真实 API 接受→重评→解决及两种安全返工→送审→批准→准备／确认通过；共享 PostgreSQL／部署 smoke 未执行 |
| 5 | CI build and tests pass on merge commit | 待验证 | 待验证 | 待验证 | PR CI 与正式 main 合并 SHA CI 分开；main 合并尚未发生，不能提前签核 |
| 6 | Tests linked to US / AC | 已满足 | 已满足 | 已满足 | 新 pytest/unittest/Playwright 名称与 docstring/FT 表关联全部十条 |
| 7 | Functional TC created and required tests pass | 已满足 | 已满足 | 已满足 | 规格更新，4 新浏览器闭环及对应 API 负向／边界通过；真实附件在测试输出，未伪造生产或手工签核 |
| 8 | No workflow-blocking defects | 待验证 | 待验证 | 待验证 | 当前已执行范围未发现剩余阻断；等待完整后端及 PR CI；PostgreSQL 行锁专项和共享环境未验证 |
| 9 | Setup / schema / run docs updated | 已满足 | 已满足 | 已满足 | delivery 文档、迁移 SQL、README、进度／规格已更新；迁移部署前由授权管理员执行，本轮无共享 DDL |

全部项适用。即使 PR CI 成功，也不应将整条故事提前标 Done；非作者批准、main 合并及对应合并提交 CI 是剩余外部交付步骤。

### PR 交付及可核查证据

- [PR #43](https://github.com/akhileshad2024-ui/SPM_G5T8/pull/43)：标题已改为 `US50/US51/US45: reassess accepted changes and rework safety arrangements`，已从 Draft 转 Ready for review，尚未合并。
- 本轮初版源码 561b70d 的 [PR CI run 41620715184](https://github.com/akhileshad2024-ui/SPM_G5T8/actions/runs/41620715184)：backend、frontend、functional 三项已核实全部 success。远端实际记录：645 unittest；2056 pytest passed／1 skipped／1022 subtests；467 frontend passed；231 browser passed／1 skipped（US01 的本地 HTTP 环境 HTTPS 场景）。PR 测试用合并模拟 SHA eb5f69ae5fcb4364481cb80d47dec979b6a8f179，不是正式 main 合并。最后 PR head 的全部检查以 [PR Checks](https://github.com/akhileshad2024-ui/SPM_G5T8/pull/43/checks) 为准，不能用旧 head 结果替代。
- 实际 GraphQL 核查：source head 561b70d，base d993a41，`isDraft=false`、`merged=false`、`mergeable=true`，`reviewDecision=REVIEW_REQUIRED`，reviews=[]。这是代码无冲突，不是已经满足非作者评审；不会自己批准或合并。
- 连接器修改 PR 返回 403，因此使用已成功推送仓库的本地 Git 身份执行同一授权的 GitHub API 更新；凭据仅在进程内存，不打印、不保存、不纳入任何提交。CI／PR 元数据以实际 API 查询为证据。
- PostgreSQL 行锁专项未运行，共享 Supabase 迁移／部署 smoke 未执行。SQL 文件和步骤已交付；部署前由授权管理员执行。没有修改 Notion／旧 Sprint，也没有自行勾 Done。

### T8 最终一致性补充 — 场地时段

最终自查补充了 `venue_period_matches`：已接受日期／时间变更后，旧时段的场地预订也通过同一共享机制标记、通知，不让新 apply 路径保留“旧预订仍有效”的假象。保持原预订／活动在 acceptance 时不变；应用之后必须使用原有 cancel／request／approve 换订，再解决对应标记。没有另建 US49 审批流程或自动重新预订。

在 364999c + 此补丁上实测：`pytest test_sprint4_reassessment_workflows.py test_us45_existing_venue_reassessment.py test_us45_confirmation_gate.py test_event_changes_integration.py -q`，**33 passed、24 subtests passed，11.86s**；相同源码随后提交为 **2bb5aa6**。新增 `test_reviewed_period_change_cannot_bypass_the_shared_venue_gate` 真实覆盖接受→应用新时段→旧订不能解决／送审→取消／换订／批准→解决→送审；“报名设置有效但时间影响参会者”测试明确允许 venue 标记、仍不误标 registration。[该版全量 PR CI](https://github.com/akhileshad2024-ui/SPM_G5T8/actions/runs/41624901570) 与最新文档 head 的 Checks 分开核查，旧 561b70d 全绿只作为前一版证据。

### 最新 Notion Pending 英文草案（未写入 Notion）

- US50: Implementation and matched local API/browser tests are complete in PR #43. Pending non-author review, main merge and CI on the actual main merge commit; apply the documented schema migration before deployment.
- US51: Accepted-change registration reassessment, flags and registered-attendee notifications are implemented and locally tested in PR #43. Pending non-author review, main merge and merge-commit CI.
- US45: Both safety outcomes, named arrangement rework, resolution/resubmission and backend preparation/confirmation gates are implemented and locally tested in PR #43. Pending non-author review, main merge and merge-commit CI.
