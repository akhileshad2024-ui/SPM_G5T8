# Sprint 4 接口核对 — 2026-11-03

性质：现有源码契约核对，不代表队友已确认任何新增草案。未发送群消息。
基准：本地 438c581；远端 main 01744ce；US14 分支 5b22577。已用 `git ls-remote --heads origin` 核实哈希未变化。

## 已确认的现有接口

| 接口 | 输入／输出、权限、事务 | 可复用范围与限制 |
|---|---|---|
| POST `/events/{event_id}/change-requests/{request_id}/decision` | `EventChangeDecisionIn`: `{outcome:"accepted"或"rejected", reason?:string}`；额外字段禁止；assigned coordinator；锁请求记录，保存决定、通知及 commit；返回 EventChangeRequestResponse | 接受边界确定，但没有有效新值字段、快照表或交接调用。不能向现接口塞 proposed_after 或解析自由文本代替事实 |
| GET `/safety-checks` | Safety Officer；返回 SafetyCheck 列表，含 eventId、status、areas、reviews 等 | 可复用安全审查展示；areas 是审阅类别，不是被点名安排 ID |
| POST `/events/{event_id}/safety-check` | `SafetyDecisionIn`: `{outcome:"approved"或"changes_requested"或"rejected", comment?:string}`；非批准备注必填；Safety Officer；`run_review_step(..., lock=True)` 保存结果／历史／通知并提交；返回 SafetyCheck | 决定入口确定，无 named_arrangements 输入／持久化；不能依赖未声明字段被使用，也不能从备注猜目标 |
| POST `/events/{event_id}/safety-check/request` | 无业务请求体；assigned coordinator；从 approved、safety_changes_requested、safety_rejected 请求；检查 booking_state／equipment_state，经共享 review_step 提交，返回 EventView | 重新送审入口已有；没有 unresolved reassessment 检查。需要扩展现入口，不另建送审流程 |
| POST `/events/{event_id}/confirm`（仅 US14 分支） | 无业务请求体；assigned coordinator；`event_confirmation.confirm` 检查，记录确认时间／操作者及通知；返回 EventView | 尚未合入 main。`outstanding` 检查 holding 场地状态及 flag/reassessment、设备进度和 safety_approved；缺少 US50／51 标记条件 |
| GET `/events/{event_id}/confirmation`（仅 US14 分支） | involved user；返回 `{ready,confirmed,outstanding:string[],confirmedAt,confirmedBy,lockedFields}` | 应扩展同一个 outstanding 检查供显示及 POST 使用，不能只改 UI |

源码：`backend/main.py`、`schemas.py`、`event_changes.py`、`safety_check.py`；US14 分支 `event_confirmation.py`、`main.py`、`schemas.py`。

## 共享数据与通知

- 现有 `VenueBooking.reassessment` 是 JSON，但 API `BookingReassessment.reason` 只允许 `venue_time_changed`，并要求 setup_minutes／turnaround_minutes。不能只往 JSON 写新原因，必须同步 schema、类型、展示和清除逻辑。
- US38 `venue_reassessment.refresh` 在部分非 holding／已结束记录上清除 reassessment；扩展不同原因前必须检查不会误清安全／活动变更标记。不是通用解决接口。
- 设备负责人当前是 `EquipmentAssignment(event_id, tech_id)`，每个活动一位 technician；预留是 `EquipmentReservation`，按 event_id/item_id 唯一。通知可以据当前映射找负责人，但逐预留关联／通知内容还未实现；并无预留专属负责人字段。
- `messaging.equipment_reassess(db,event)` 只按活动通知 assigned technician；`attendees_affected(db,event,what_changed)` 在本任务分支仅筛 registered，不判断影响；都不 commit。
- main 尚未包含 Yangbo 的 registered-only 修正，不能将远端旧 handover 的候补范围当作当前 US51 要求。
- 未找到 US49 共享标记实现、准备阶段写接口或明确 preparation 状态；准备门禁无法仅通过现确认入口替代。

## US45 的实际返工断点

`safety_check.decide` 将两类结果写为 safety_changes_requested／safety_rejected，且两者可再次送审。
但 `event_updates.PLANNING_STATUSES` 和 `equipment.PLANNING` 仅包含 submitted、under_review、pending_clarification、approved。
因此 coordinator 在这两个安全状态下不能通过现有接口修改活动详情或设备需求；technician 的现有单项进度入口另有校验，不能代替 coordinator 的返工编辑。
需要明确是转换回约定规划阶段还是扩展安排编辑资格，并确保旧安全批准失效。该选择涉及正式 AC 的“相关较早规划阶段”，不能静默决定。

## 必须确认的问题与最小建议（尚未采纳／未实现）

1. **Yuetong／US34 + 需求方**：谁提供接受时的有效新值？建议独立保存经校验的变更快照，在决定事务中交给 US49–51，保持活动字段不变。需要明确可变字段、缺少快照时的兼容行为及新旧数据验证；不能直接将它设为新必填字段破坏 US34-TC01。
2. **Chin Hui／US49 + Yangbo**：是否共用标记 schema、目标 ID、来源、多原因及解决权限？建议扩展现机制并兼容 US38；向 US14 的 outstanding 提供设备／报名未解决项，禁止另建确认入口。
3. **Akhi／US44 + 需求方**：如何点名具体 venue booking／equipment reservation，保存在哪？建议向现安全决定扩展可验证的目标列表并关联 SafetyReview，拒绝跨活动 ID；不要用备注匹配名字。需确认旧输入兼容规则。
4. **Akhi + Chin Hui**：两类安全结果的返工阶段／编辑资格、解决完成定义、再次送审前的检查及 preparation 后端入口是什么？建议只扩展现 request_check 和 confirm/outstanding，保持单事务及权限校验；不从批准备注推断当前有效批准。
5. **需求方 + 团队**：设备／报名何时无效、何时影响 registered，容量与日期变化如何处理？这不是缺一个函数名，必须有业务规则才能验证。

## 可直接发群（草案，未发送）

> I've checked main 01744ce and the US14 branch 5b22577. US44 request/decision and US14 confirmation endpoints are reusable. Before wiring US50/51/45, can we confirm: (1) Yuetong: where do validated post-change values come from at acceptance, without changing event fields or breaking the existing US34 input? (2) Chin Hui: is US49's shared flag/resolution contract available, and can US50/51 unresolved items feed the existing US14 outstanding check? (3) Akhi: can the existing safety decision carry/persist exact booking/reservation targets, and what planning stage/edit permissions should follow each non-approval? Currently those safety statuses cannot edit event details/equipment requests. (4) Where is preparation enforced, and should the existing resubmission endpoint reject unresolved flags? My recommendation is to extend these existing endpoints with a validated snapshot, typed target references and shared unresolved checks, not add parallel workflows. Please also confirm invalidity/attendee-impact rules or point me to the agreed clarification. Please share branch/commit if any of this is already implemented.

本轮是静态接口核对，没有接口变更或新测试运行。T4 历史回归证明现 US44 流程可运行，不证明上述缺失契约已经存在或 US45 已满足。

## 后续实施更新（2026-11-03）

US14 分支 5b22577 随后按用户授权合入当前任务分支，产生 c2c4c17；确认接口现在本地可用，不再是“只有远端分支”。未修改其门禁代码，新增 US45 跨模块集成测试覆盖非批准→重送审→批准→确认，及现有场地标记阻止确认；结果见 T6。共享数据库 US14 迁移未执行。preparation／设备和报名重评契约仍缺。

上述是核查时快照。随后已在现 `safety_check.request_check` 接入本活动 approved 场地预订 reassessment 校验，仅对安全拒绝／要求修改后的重送审生效：有标记 409，解决后允许；不改变初次送审，不新增 schema。T5 真实 API 集成验证 US38 自动标记／清标与本入口联动；安全点名、设备／报名标记等缺口仍在。详见进度表 T5，尚未提交／push。
