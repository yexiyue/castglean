# 后端JSON与库能力收敛

2026-11-09，已实现并完成本轮自动化与独立审查。复用现有Serde、Schemars、Rig 0.46、SeaORM 2.0.4、thiserror和tempfile，无新增依赖。不迁移或删除旧工程与运行产物，不重写Git历史。

工具参数与Schema同源，固定Schema只生成一次并在添加动态约束前克隆；C7三个分析工具和独立审阅使用Rig typed Tool。运行时身份枚举、候选跨字段条件保留小范围Schema约束；分章工具参数也使用同源DTO，保留作用域绑定的DynamicTool。模型上下文、audit、错误码、检查点与预审、生成配置均以业务结构表达；开放角色扩展、异构反馈和诊断IPC编码边界继续使用Value。

重要修复：直接将Tool::Args设为普通DTO时，解码错误在进入Draft前返回，会漏记calls/repair_rounds/拒绝audit，可能把修正成功误算首次成功。独立审阅发现后，改为保留原JSON与解码Result的typed Invocation；成功后直接执行类型化Command，失败也进入同一准入/反馈/计数路径。真实Rig+本地HTTP夹具覆盖“类型错误→修正成功”和连续三次失败终止，不把仅ToolAdapter直调当成Agent循环证据。JSON语法本身非法仍由既有运行时拒绝。

窗口格式6由SeaORM映射为WindowRecord，固定plan、checkpoint和traces字段；不再混用动态trace:key与任意字段patch。保存分析、保存预审、追加trace分别在租约/依赖事务内执行，保留其他阶段与失败成本。已存预审恢复时重新校验，字段缺失或损坏不当作无问题。取消与人工保护继续沿用原事务约束。

目录/问题查询使用FromQueryResult解码行，保留SQLite JSON聚合与有界分页。mutable JSON保存复用小型tempfile函数，保留文件同步与写入限额，目录同步只在替换后尽力执行；CAS/凭据发布和不可变来源的noclobber仍由原模块负责。

参数Schema变化会影响模型输入，不能仅凭类型检查宣称token、耗时或AI质量改善。正式评测继续直接调用当前核心与运行时，保留实现/输入/配置身份、失败分母和未知用量。本轮未进行付费模型对照或原生桌面验收。

验证：269项Rust库测试、2项集成测试、45项Node测试和6项Python评测测试通过；6项库测试与2项原生资源测试按原有外部条件忽略。Specta绑定导出、前端生产构建、rustfmt、全目标Clippy -D warnings、rustdoc -D warnings、27项OpenSpec严格校验通过；公开两套数据共16例预检通过，文档相对链接无缺失。前端构建仍有既有大chunk/静态动态导入提示，不是新增UI或打包策略变更。

独立子agent发现1项P2（typed解码拒绝绕过失败计数），已修复并复核关闭，无新增P1/P2。对应实际native Rig/HTTP夹具验证修正成功2次调用与三次连续失败终止。六处重点生产模块的json!使用从93处降至41处，仅为局部代码统计，不是性能或AI质量证据。新的参数/Schema/实现摘要与旧冻结评测不同；若比较模型质量必须另跑同一公开集并保留失败分母。
