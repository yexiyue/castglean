## ADDED Requirements
### Requirement: 隔离真实 agent 内核
原型 SHALL 使用 rig-ecs 0.46.0 AgentPlugin 与真实模型 effect 路径，显式启用实验 feature，保持正式应用默认行为。
#### Scenario: 三路分析
- **WHEN** 角色快照已冻结
- **THEN** 三个分析 agent 在相同角色与来源身份下并发执行，宿主校验完整输出后才允许只读预审

### Requirement: 取消与禁止隐式重发
原型 SHALL 传播父取消并记录失败/超时；恢复 SHALL 复用身份匹配且已校验的完成结果，SHALL NOT 自动重发已开始但结果未知的请求。
#### Scenario: 中断恢复
- **WHEN** 两项完成、一项在途时进程中断
- **THEN** 恢复保留两项结果与第三项 unknown 证据，不重新发送第三项，不伪造整章成功

### Requirement: 共享可观测与评测
原型 SHALL 对齐公共评测契约，记录 run/span/parent/stage/route/attempt/status/时间、来源/模型/配置/提示/协议身份；未知 token SHALL 为缺失，质量由固定 gold 和宿主校验决定。
#### Scenario: 只读预审
- **WHEN** 预审返回建议
- **THEN** 宿主验证片段引用，保存未采用建议，分析和人工状态不被修改

### Requirement: 独立任务与已知角色评测
公共适配器 SHALL 区分 analysis/review，SHALL NOT 将植错候选传入首次分析。公共 suite SHALL 使用 known-only scope，SHALL NOT 按姓名猜测或对齐新身份。
#### Scenario: 独立植错预审
- **WHEN** evaluationTask=review 且提供 reviewInput
- **THEN** 只启动一个只读预审 agent，以候选真实边界生成 sN targets；不启动三个分析请求，不读取 gold，建议通过宿主校验后仍未采用

### Requirement: 可选原生凭据桥模型边界
Live 模式 SHALL 显式启用，SHALL 通过原生 call helper 委托 CompletionRequest，不复制凭据、不冒用其他模型能力。每请求 SHALL 600 秒且无自动重试；取消 SHALL 管理并回收本地子进程，但保持远端未知。
#### Scenario: 取消在途 live 请求
- **WHEN** helper 已启动后收到父取消或请求超时
- **THEN** 原型终止并回收 helper，保存 unknown 子结果和取消/超时 trace，恢复不重新发送且不宣称提供商停止计算
#### Scenario: 公共配置身份
- **WHEN** 选择实际模型配置
- **THEN** 从非密钥配置核验 selection/revision/model/capacity，以与主线相同 canonical JSON 计算配置 hash，并将 mode/代码/路由/提示/协议与恢复身份分开记录
