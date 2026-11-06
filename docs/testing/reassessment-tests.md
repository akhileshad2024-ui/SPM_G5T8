# Reassessment Test Specifications and Execution Evidence

Historical execution records retain their original dates, source revisions and results. They are not a statement of current PR or release status. Current story status is maintained in Notion; the shared TC workbook is the canonical story-level record.

## US50 US51 US45 test specifications

日期：2026-10-31。正式 AC 见 [Product Backlog](https://www.notion.so/3e19922d71f881b29bdef4797725bb80)。

## 范围与执行约定

本文件完成确定性验收场景的设计；依赖业务规则的具体测试数据、接口路径和阶段枚举明确留待确认，不能称为可直接自动运行的完整测试套件。
最新 T8 已在隔离环境执行三条故事的真实浏览器／API 场景，下方初版 BLOCKED 列是设计时快照，具体规则现见 `docs/operations/backend-operations.md`。T5/T6 历史局部结果保留，不能代替 T8；共享生产数据库未执行，也没有预先宣称非作者批准或 main 合并。
条件式前置数据“已确认无效／受影响”必须由正式规则和真实服务判断建立，不能靠 mock 评估器或在数据库直接写标记代替自动触发验收。

执行环境：隔离测试数据库及真实 API／UI；不能修改共享生产数据。记录应用和队友模块提交、schema 版本、执行时间、操作者、测试 ID、请求／响应、前后状态及必要截图，隐藏凭据。
权限账号：事件 organiser、assigned coordinator、另一 coordinator、负责 technician、无关 technician、registered／waitlisted／withdrawn attendee、Safety Officer（待 US44）。
每个案例独立数据，不共享可变活动；检查数据库/API 持久化并重新加载界面，不只检查 toast。

## 确定的验收场景

步骤中的“接受”“送审”“准备”“确认”均指最终团队实现的真实操作入口，后端负向用例必须直接发请求，不能仅检查按钮隐藏。

| ID / AC | 前置条件及步骤 | 确定的预期 | 当前阻塞 |
|---|---|---|---|
| FT50-01 / US50-1,2,3 | 有设备预留，其中一项按确认规则已不再适用于接受的新值。assigned coordinator 接受变更；读取预留和负责人员通知，再重载 | 无需另按重评按钮；无效预留有 Requires Reassessment；负责该预留的技术人员收到可对应此预留的通知；活动字段仍保持原值 | 新值交接、无效规则、标记契约 |
| FT50-02 / US50-2 | 同一活动同时有经确认有效和无效的预留；接受变更并检查全部预留 | 无效项被标记；不能仅因同属活动便将有效项当作无效；其他活动不受影响 | 有效性规则与样本 |
| FT50-03 / US50-3 | 多个被标记预留，负责人按真实映射建立；接受并分别查看通知 | 每个被标记预留均有负责人员通知依据；无关技术人员不收到；不预设通知必须几条或能否合并 | 负责人映射、通知关联形式 |
| FT51-01 / US51-1,2 | 报名设置按确认规则会失效；接受变更，读取设置及标记并重载 | 自动重评；无效设置显示 Requires Reassessment；活动字段不被接受动作直接覆盖 | 新值、设置有效性规则 |
| FT51-02 / US51-2 | 报名设置按确认规则仍有效；接受变更 | 无错误失效标记；其他活动的设置不变 | 有效样本与规则 |
| FT51-03 / US51-3 | 一个变更按确认规则影响 registered attendees；另有 waitlisted、withdrawn 及其他活动参会者；接受并逐账号查看通知 | 受影响 registered 收到通知；无关活动不收到；本 US51 路径按已限定范围不向 waitlisted／withdrawn 自动发送 | 影响规则与 accepted 接入 |
| FT51-04 / US51-3 | 变更按确认规则不影响任何 registered attendee；接受 | 不因接受动作本身就自动向 registered 发“受影响”通知 | 不受影响样本与规则 |
| FT45-01R / US45-1,2 | Safety Officer 以 rejection 结果点名场地安排；提交结果并重载 | 返回约定的相关规划阶段；只标记点名场地；不将安全拒绝误写为终态活动 rejected | US44、阶段映射、共享标记 |
| FT45-01C / US45-1,2 | 同上，结果改为 request changes，点名设备安排 | 同样返工并标记点名设备；未点名场地和设备保持不变 | 同上 |
| FT45-02 / US45-1,2 | 对 rejection 和 request changes 分别参数化：仅场地、仅设备、混合多个安排；读取全部安排 | 两类结果、三类目标组合均覆盖；标记集合等于点名集合，不扩大范围 | 目标 ID 和阶段规则 |
| FT45-03 / US45-3 | 有未解决的点名标记；assigned coordinator 直接调用重新送审；按正式解决操作处理全部标记，再送审 | 未解决时后端拒绝；解决后允许发起下一轮真实安全审查；重载可见该轮次 | 解决操作、US44 重送审 |
| FT45-04 / US45-4 | 无批准／rejection／request changes／返工后待复审分别准备数据；直接调用准备和确认 | 所有未获当前有效安全批准的情况均被后端拒绝；无状态变化 | US44 当前批准、准备／确认入口 |
| FT45-05 / US45-4 + US49 AC4 用户约束 | 当前安全批准有效，但逐一保留 US49、US50、US51 未解决标记；调用确认 | 共享后端门禁拒绝确认；清除一个标记不能绕过其他未解决项 | US49／US14 共享门禁 |
| FTX-01 / US50-1, US51-1 兼容边界 | 同等有效样本分别接受／拒绝提案；记录活动所有字段、预订和预留前后快照 | 接受触发两项重评，拒绝不触发本 accepted 路径；二者均保存决定；不直接应用提案字段、不创建预订或设备预留 | 接入新流程；US34 原有边界已有独立回归 |
| FTX-02 / 权限约束 | 未登录、organiser、无关 coordinator 尝试接受；无关人员尝试解决／重送审／准备／确认 | 后端拒绝越权，决定、标记、通知及状态均不被越权改变；具体 401/403/404 按团队既有约定 | 新入口和角色权限契约 |
| FTX-03 / 实现质量、非新增客户 AC | 在接受后重评／通知写入失败时注入一次故障；再查询决定、标记及通知；重试／双击接受 | 不留下半完成事务；既有决定不得被覆盖；重复请求的行为与 US34 契约一致，不重复产生效果 | 同事务接口与可控故障测试 |

## 待确认规则：不填充虚构预期

| ID | 待确认规则／数据 | 确认方 | 确认后展开 |
| R1 | 接受时新值的权威来源、验证及版本；无新值是否允许接受 | Yuetong + 团队 | FTX-01、FT50-01、FT51-01 的真实请求及样本 |
| R2 | 时间、数量、库存、技术需求变化分别怎样使设备预留失效；原库存占用如何处理 | 需求方 + Yangbo，协调设备模块负责人 | 设备边界矩阵；不预设自动释放 |
| R3 | 容量下降、报名关闭、日期／截止日期变化的设置有效性；何种变化影响 registered | 需求方 + Yangbo | 有效／无效与受影响／不受影响的独立样本；不预设退报名或转候补 |
| R4 | 场地、设备、混合目标分别返回何规划阶段；无目标／非法目标的决定规则 | Akhi + Chin Hui + 需求方 | 两类安全结果的阶段矩阵及非法 ID 负向测试 |
| R5 | 共享标记 schema、多原因共存、解决权限与证据；旧批准失效和当前轮次 | Chin Hui + Akhi + Yangbo | 清除、复审、并发及陈旧批准测试 |
| R6 | 逐预留负责人映射、通知关联／合并及幂等方式 | 设备模块负责人 + Zhenhan | 多预留收件人及重复接受测试 |

## 真实执行记录

| 执行 ID | 覆盖 | 实际结果 | 代码版本／证据 |
|---|---|---|---|
| FT50/FT51/FT45/FTX 全部 | 上述真实业务流程 | NOT RUN / BLOCKED；未以 mock 替代 | 本文件仅规格；无故事集成提交 |
| T1 | 历史基础回归 | 见进度表 T1；不是本轮执行 | HEAD cae5273，无故事实现 |
| T2 | 本轮 US51 收件人辅助函数及既有通知／US34 回归 | 见进度表 T2 的实际命令与结果；不作为上述 FT 通过 | cae5273 + 本轮未提交补丁 |
| T5 / FT45-03 部分 | 两类安全返工→US38 真实场地修改标记→重送审 409→真实场地恢复清标→重送审成功；另测权限、隔离及无副作用 | 新文件 4 passed、7 subtests；先前通知／US34／US44 合并回归 178 passed、330 subtests，二者不累加 | 438c581 + 未提交补丁；`tests/integration/test_us45_existing_venue_reassessment.py`；隔离 SQLite／FastAPI，不是安全点名流程 |
| T6 / FT45-04 确认部分、FT45-05 现有场地部分 | 直接 POST confirm 检查两类非批准结果／待审核；无副作用；新批准后确认成功；实际 US38 标记阻止确认、恢复后允许 | 后端测试集 230 passed、356 subtests；前端 34 passed、TypeScript 通过，浏览器结果见进度表 T6；不是 preparation 验收 | c2c4c17 + 未提交补丁；`tests/integration/test_us45_confirmation_gate.py`；真实 API，无 mock |

后续逐案例追加实测记录：`时间 | FT ID | 构建/提交与 schema | 操作者 | 实际输入 | 实际结果 | PASS/FAIL/BLOCKED | 证据路径 | 缺陷`。

## T8 — 实施后真实执行（2026-11-03）

构建：最新 main d993a41 已合入本地（基线 dafea69）+ 本轮未提交实现；正式源码 SHA 在进度表交付记录中补齐。操作者：Codex；隔离 SQLite、真实 FastAPI／Next.js、Chromium；不是共享数据库手工验收。

| FT / AC | 真实输入和操作 | 实际结果与证据 |
|---|---|---|
| FT50-01/03，US50-AC1/2/3 | 真 API 建立一件已预留 Wireless microphone；协调员 UI 提供 qty=2 并接受；技术员查看通知；独立释放／应用／预留／UI 解决 | PASS。接受后 qty 仍为 1；重评 1 个预留、标记持久化并通知负责技术员；显式应用后 qty=2，技术员记录证据解决。Playwright 同名测试 observed 附件 |
| FT51-01/03，US51-AC1/2/3 | 真注册 attendee；协调员 UI 接受 reg=false；检查通知／设置，独立应用、恢复报名并 UI 解决 | PASS。接受后原 reg=true；报名标记、registered 收到通知；没有取消报名；修复后解决。Playwright observed 附件 |
| FT45-01R/03/04，US45-AC1..4 | 安全员 UI rejection 点名 venue booking；协调员查看 venue planning、编辑资格；直接 API 测三门禁；UI 解决、重送、批准、准备、确认 | PASS。仅点名项标记；未批准直接请求 409；新批准后 UI 准备／确认成功。Playwright observed 附件 |
| FT45-01C/03/04，US45-AC1..4 | 同上，outcome=changes_requested | PASS。相同完整流程，不能用 rejection 单例代替本例 |
| FT50-02、FT51-02/04、FT45-02、FTX 权限／事务 | 见 `test_sprint4_reassessment_workflows.py`：有效／无效混合、通知与设置失效独立、registered/waitlisted、只点名、跨活动／重复目标、权限／重复决定／失败回滚 | API 测试 12 passed、2 subtests；纯规则单测 8 项先前同轮 16 项集合通过；最终全量结果见 T8，不重复累加 |

本轮浏览器命令包含新文件和旧 US34/US44：**15 passed (2.8m)**，其中新流程 4 例。`--reporter list` 未生成新 HTML；输出目录 `coverage/functional/sprint4-final`，测试运行时 `observed` 生成真实文本附件。没有截图成功记录时不虚构截图。
两次开发中问题已修正：单测导入路径导致收集失败；释放预留后的 status/notes 被误判为需求漂移导致 apply 409。修正后重跑新流程通过。实施选择仍需评审，不能以自动化测试代替客户批准。

最终时段一致性补充：`test_reviewed_period_change_cannot_bypass_the_shared_venue_gate` 通过原有取消／换订／批准 API 验证旧场地时段不能绕过新的申请时段；对应 33 项回归及 24 子测试通过（11.86s，见进度表）。这项新增场景是实际 API 集成，不宣称另外执行了浏览器换订场景。


## Additional original execution evidence

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



### T2 — 2026-10-31 收件人函数及既有 API 回归

版本：HEAD cae52735af7f86595949a56e4ae74cd6cd463fa0 + 未提交的 `backend/notifications/service.py`、US36 单测及文档补丁。没有对应实现提交，不引用 HEAD 为包含本轮改动的提交。

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

版本：438c581 + 未提交的 `backend/safety/checks.py` 和 `tests/integration/test_us45_existing_venue_reassessment.py`；无新实现提交。

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

功能规格 FT ID 定义在 [功能测试规格](reassessment-tests.md)；“规格已写”不表示已有可执行自动化或通过记录。

| AC | 状态 | 已有代码及缺口 | 测试关联与真实执行证据 |
|---|---|---|---|
| US50-1 | 阻塞 | `main.py:review_event_change` 接受后只保存决定／通知；没有 US50 重评调用或有效新值。main 最新源码也相同 | FT50-01、FTX-01 规格已写，自动重评流程未执行；US34 历史 T6 接受边界通过不等于本 AC |
| US50-2 | 阻塞 | `VenueBooking.reassessment` 是场地标记，设备预留模型／schema／视图尚无相应标记 | FT50-01/02 规格已写；设备标记执行证据无 |
| US50-3 | 部分满足 | `messaging.equipment_reassess` 能找活动 assigned technician，但 accepted 未调用，通知未关联每个被标记预留 | `test_US36_US50_AC3_assigned_technician_is_told_equipment_needs_reassessing`、`...no_technician_means_no_notice` 本轮 T7 通过；仅辅助函数。FT50-03 未执行 |
| US51-1 | 阻塞 | US34 无新值／报名重评调用；`registrations/service.py` 原有报名规则不等于变更重评 | FT51-01、FTX-01 规格已写；自动重评无执行证据 |
| US51-2 | 阻塞 | 无报名设置重评标记及显示／解决链路 | FT51-01/02 规格已写；无执行证据 |
| US51-3 | 部分满足 | `messaging.attendees_affected` 本分支限定本活动 registered，保留通用候补通知函数；未接 accepted 或影响判断 | 本轮 T7 中 `test_US36_US51_AC3_only_registered_attendees_are_told`、`test_US51_notification_does_not_include_registrations_for_other_events`、`test_US51_recipient_filter_does_not_change_general_attendee_audience`、`test_US51_notification_is_rolled_back_with_callers_transaction` 通过；FT51-03/04 真正变更通知未执行 |
| US45-1 | 部分满足 | `safety_check.decide` 两类结果／历史均已有；`event_updates.PLANNING_STATUSES`、`equipment.PLANNING` 不含安全返工状态，相关可编辑规划阶段仍缺 | FT45-01R/01C/02 规格已写；T6/T7 覆盖两类结果，但没有目标规划阶段及返工编辑验收 |
| US45-2 | 阻塞 | `SafetyDecisionIn` 只有 outcome/comment；无点名安排 ID、对应持久化或安全原因共享标记 | FT45-01R/01C/02 规格已写，未执行安全点名流程；US38 自动产生的时间冲突标记不能当作安全点名实现 |
| US45-3 | 部分满足 | `safety_check.request_check` 本地补丁拦截本活动 approved 场地预订 reassessment；解决后允许；未覆盖设备或安全点名全部标记 | `test_real_venue_change_flags_and_resolution_gate_both_rework_outcomes` 本轮 T7 真 API 通过；`test_both_nonapproval_outcomes_refuse_flags_without_side_effects_then_resubmit`、`test_other_events_flags_do_not_block_this_event`、`test_resubmission_still_rejects_other_coordinators_and_roles` 通过。FT45-03 仅现有场地子场景完成；后三项使用明确标注的标记 fixture |
| US45-4 | 部分满足 | 复用 US14 `event_confirmation.confirm/outstanding`：安全未批准备案不能直接 POST confirm；preparation 入口／门禁缺失，设备／报名重评门禁缺失 | `test_both_rework_outcomes_and_resubmission_need_new_safety_approval`、`test_safety_approval_does_not_bypass_the_existing_venue_reassessment_gate` 本轮 T7 真 API 通过；T6 US14 六例浏览器通过。FT45-04 确认部分、FT45-05 现有场地部分通过，不能覆盖 preparation 或 US49–51 全部标记 |

以上 T7 测试名分别位于 `tests/us36_notifications/test_us36_notifications_unit.py`、`tests/integration/test_us45_existing_venue_reassessment.py`、`tests/integration/test_us45_confirmation_gate.py`。总数为同一次执行集合，不为每条 AC 虚构独立通过数。



## T8 — 完整实施后的验证与最新 DoD（2026-11-03）

本节取代前面实现前审核的当前结论，不删除历史证据。初版源码 **561b70d8a57217c35b9d6ff015064c9f4895cf00**，最终时段一致性补充 **2bb5aa6861947faf7539167393ccc74dec75620b**（基线 dafea69，含 main d993a41），均已推送现有 PR #43。规则、兼容取舍、迁移、回滚和运行方法见 `docs/operations/backend-operations.md`；当前十条 AC 表已逐行映射实现和测试。增量修正和各自实测分开记录；仅改文档的记录提交不等同新源码版本。



### T8 最终一致性补充 — 场地时段

最终自查补充了 `venue_period_matches`：已接受日期／时间变更后，旧时段的场地预订也通过同一共享机制标记、通知，不让新 apply 路径保留“旧预订仍有效”的假象。保持原预订／活动在 acceptance 时不变；应用之后必须使用原有 cancel／request／approve 换订，再解决对应标记。没有另建 US49 审批流程或自动重新预订。

在 364999c + 此补丁上实测：`pytest test_sprint4_reassessment_workflows.py test_us45_existing_venue_reassessment.py test_us45_confirmation_gate.py test_event_changes_integration.py -q`，**33 passed、24 subtests passed，11.86s**；相同源码随后提交为 **2bb5aa6**。新增 `test_reviewed_period_change_cannot_bypass_the_shared_venue_gate` 真实覆盖接受→应用新时段→旧订不能解决／送审→取消／换订／批准→解决→送审；“报名设置有效但时间影响参会者”测试明确允许 venue 标记、仍不误标 registration。[该版全量 PR CI](https://github.com/akhileshad2024-ui/SPM_G5T8/actions/runs/41624901570) 与最新文档 head 的 Checks 分开核查，旧 561b70d 全绿只作为前一版证据。


## Original equipment registration and SMTP verification

Copied from the original US25–US32 delivery notes; these are historical measurements, not a new execution or current sign-off.

- Frontend unit tests: 351 passed, 21 files.
- TypeScript: passed.
- Production `npm run build`: passed, without font mocks.
- Equipment + registration tests: 75 passed; opt-in PostgreSQL test skipped (no local PostgreSQL available).
- US27 local API performance: 1,000 historical reservations, 5 requests; measured maximum 0.0391 seconds. This verifies local API latency, not a deployed end-to-end SLA.
- Full backend regression: 1,434 tests passed and 609 subtests passed; one opt-in PostgreSQL test skipped.
- The full browser run exposed two legacy equipment-card tests that assumed all requests were displayed at once. US13/US15 now explicitly select the assigned event before inspecting its card; these updates need a fresh run.
- Revised module browser suite: 13 passed on Chromium Headless Shell 134. The full 180-test browser suite is being verified separately; GitHub uses its own installed browser version.
- SMTP delivery tests: a real SMTP connection to a local test receiver passed (no external mail sent). Adapter tests: verify TLS usage, saved recipient, message body, durable retry after transport failure and no resend after successful delivery. TLS/failure adapter tests use mocked transport; the local receiver test uses a real socket. External mailbox receipt is NOT verified.
