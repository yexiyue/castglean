## Context
Apalis 的 Persisted 在注册、心跳或事件持久化失败后进入 Dead，Worker::run 返回错误。现 spawn 丢弃结果，派发器仍每 30 秒重投 queued 意图。原生日志明确记录 WORKER_ALREADY_EXISTS：快速重启复用固定 local-ai 名称，旧注册在 30 秒内仍有效，新消费器在注册阶段即进入 Dead；该依赖将注册失败也记成 HeartBeat failed。

## Decisions
新增私有消费器监督模块。每轮从 SqliteStorage 克隆新后端，使用宿主 owner 加递增序号命名。监督 JoinHandle 捕获退出及 panic；退避从 1 秒指数增长至最多 30 秒，稳定运行 60 秒后重置间隔。恢复频率有界，不修改模型重试预算。
复用同一 Runtime，绝不调用 interrupt_previous 或清理在途任务。现有 run CAS 与 admission 保护旧/重复交付；已开始工作继续由原执行所有者处理。退出记录分类及退避，不记录正文、凭据或原始供应商响应。

## Validation
真实 SQLite trigger 让心跳更新失败，确认消费器能重建、排队任务不需重启即可执行；在途模型调用不能被重复发起。既有取消、重启中断、孤儿交付与晚到写入回归继续通过。
