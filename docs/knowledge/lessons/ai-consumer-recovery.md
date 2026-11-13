# 快速重启的 AI 消费器注册冲突

日期：2026-11-13。适用：macOS 原生 CastGlean、Apalis/apalis-sqlite 1.0.0。

## 触发与原因

原生日志记录 `WORKER_ALREADY_EXISTS`，随后消费器不再更新心跳，派发器仍每 30 秒重投 queued run，generation 保持 0，用户看到排队但没有模型请求。

宿主此前固定使用 `local-ai` 名称。Apalis 注册 SQL 拒绝覆盖最近 30 秒仍有效的同名 Worker；快速重启因此在注册阶段失败。依赖的 Persisted 将注册、心跳及持久化失败置为 Dead（注册失败也打印 HeartBeat failed），Worker::run 返回错误。宿主丢弃该 future 的退出结果，消费器没有恢复。

## 修复

[`jobs/runtime/consumer.rs`](../../../src-tauri/src/jobs/runtime/consumer.rs) 使用宿主 owner UUID 加消费器序号命名，监督正常意外退出、错误与 panic；退避 1–30 秒，运行稳定 60 秒后重置间隔。Worker 在 spawn 前构造，以免泛型异步闭包触发 Send/lifetime 推断问题。

同一 Runtime、admission、run CAS、owner/generation 与预算保持原样，不调用启动中断恢复，不把 running 改回 queued，不自动重发已开始的模型请求。记录分类与退避日志，不记录正文或原始模型响应。

## 验证

`heartbeat_failure_restarts_consumer_without_replaying_an_active_model_request` 预置仍有效的旧 local-ai 注册，启动实际 SQLite 消费器并阻塞一个真实 HTTP 夹具请求；通过 SQLite trigger 强制心跳更新失败，确认自动建立新消费器。第二连接的 queued run 无需宿主重启即可完成；重复交付的旧在途任务只调用一次模型，两任务 generation 与请求计数均为 1。

本轮全目标 398 项库测试和 2 项集成测试、fmt、全目标 Clippy 与私有 rustdoc 通过。尚未直接注入操作系统睡眠/网络掉线、长时间进程暂停或消费器 future 永久挂起；不把对退出的监督等同于所有停滞均已解决。

修复后原生复验：在前一消费器最后心跳后 25 秒（仍处于旧注册 30 秒有效期内）启动新应用实例，新身份成功注册并启动 Worker。更新后的应用恢复原工程，既有第二章 81/81 音频和整章就绪状态仍可见；未为该注册验证重新调用付费模型。
