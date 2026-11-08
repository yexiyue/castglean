# LLM 通信与分章恢复的踩坑记录

日期：2026-11-06。状态：已验证。适用环境：macOS、Rig 0.46.0、graph-flow 0.8.1、Tauri 2、AI SDK UI 7；其他版本需重新核验。完整范围和平台限制见[分章验证](../../desktop-studio/chapter-splitting-validation.md)，修复依据见[双轴审查](../../desktop-studio/chapter-splitting-review.md)。

## 本机请求可能被系统代理截走

现象：可控 loopback HTTP 夹具没有生成 502，客户端却偶发收到 502。检查发现本机启用了系统代理。

处理：仅对明确的 localhost、IPv4/IPv6 loopback 禁用代理，远程端点继续使用系统代理策略；不要通过自动重试掩盖本机路由错误。实现见 [LLM transport](../../../src-tauri/src/llm/transport.rs)。

测试服务也有独立问题：macOS/BSD 上非阻塞监听器接受的 socket 需要显式切回阻塞读取，完成写响应后再结束写半部，避免尚未读全请求就关闭连接。对应修复只属于[测试夹具](../../../src-tauri/src/llm/tests.rs)，不能据此修改生产请求协议。

## 收到文本不代表流已正常结束

使用 Rig 原始 stream 时，耗尽片段后还要调用 `finish()` 检查协议结束；诊断 agent 则检查最终响应，不把部分文本当作成功。三协议的结束和截断回归见[协议测试](../../../src-tauri/src/llm/tests/protocols.rs)。原生厂商与兼容网关、文本/工具/Schema/流式能力分别验证，不能互相代替。

## 无效工具也必须进入预算

Rig 对未知工具名或非法参数的拒绝可能发生在普通 dispatch 钩子之前。只在 dispatch 计数会漏掉这些尝试；在 invalid-tool-call 钩子持久化计数和安全失败记录后停止，不隐式修复或重试。超大参数的拒绝也不能因事务回滚而抹去已消耗次数。实现和回归见[诊断执行](../../../src-tauri/src/novel_import/splitting/execution.rs)及其[测试](../../../src-tauri/src/novel_import/splitting/graph/tests.rs)。

## 启动返回错误时，宿主运行可能已经存在

宿主先持久化运行，后读取启动快照。如果后一步失败，前端可能收到结构化 `project/read_failed`，但任务仍在运行。

处理：按原命令身份补读权威快照；相同 run 仍活动时重新订阅，已完成时恢复结果，真正失败时报告错误。不能仅按“异常是否结构化”判断任务未启动，也不能重发模型请求来恢复丢失响应。回归必须覆盖未知通信错误和结构化读取错误，验证只启动一次且最终能收到终态。见[自定义 transport](../../../src/lib/ai/transport.ts)及[契约测试](../../../tests/ai-transport.test.mjs)。

恢复读取与显式启动共享运行注册锁，避免把刚启动的运行标记为旧中断。取消等待已派发的本地 worker 退出后才发布终态；图的节点后 checkpoint 不等于副作用恰好执行一次，应用预算、工具结果和采用回执仍需自己的原子恢复事务。

## 空白与 BOM 也属于不可变来源

全角空格前缀和人工空白行边界可能形成未覆盖范围。检测器将空白范围并入相邻章节，保留每个来源从 0 到末尾的完整分区；首章读取也从并入的前缀开始。TXT 解码和便携工程校验一致拒绝只有 BOM/空白的来源。

验证不能只比较章节数：还要逐字节重建全文，覆盖混合换行、中文、emoji、组合字符、BOM 和人工拆合。坐标约定归[数据格式](../../data-format.md)，检测回归归[本地检测器](../../../src-tauri/src/novel_import/detection.rs)。

## 后台实验也必须选中后台 HTTP 客户端

2026-11-08，Rig 0.46.0/macOS 章节协议实验：仅调用 `complete` 的 600 秒外层期限还不够。`configured_model` 的 accounting 为 `None` 时，`providers::model_with_account` 选择 `BoundedHttp::new` 的 120 秒探测客户端；`Some` 才选择 `for_run` 的 600 秒客户端。因此实验曾在 120 秒收到安全归一化的 `network_failed`，不能据此断言服务商限制或模型质量。

实验桥改为显式传入无副作用的 accounting hook，选择与正式任务相同的后台传输。旧预跑结果及被中断请求保留在本机忽略目录，未纳入修正后的配对结果；中断请求的远端完成与费用未知。配置路径和原生凭据只读，不启动应用运行时或写工程库。入口见 `src-tauri/src/llm/test_support.rs::experiment_call`，方法与结果见[协议对照](../plans/chapter-protocol-experiment.md)。此约束只适用于当前构造方式，后续 API 修改后应重新核对，不能将归一化错误类别当作原始 HTTP 状态。
