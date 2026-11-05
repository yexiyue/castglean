# 实现任务

## 1. 正文边界

- [x] 1.1 实现不可变快照、元数据、已校验字节范围，补充 Unicode、换行、摘要、边界测试和 rustdoc，以 core 单元测试及 doctest 验证。

## 2. 草案标注协议

- [x] 2.1 实现独立 ID、严格 DTO、归属状态、完整证据校验与只读结果；补充覆盖、修订、引用、归属测试及格式文档，以 core 测试验证。

## 3. 可移植离线数据

- [x] 3.1 增加 JSON 流读写和生成的 Schema，更新原样例摘要，增加两个公开场景及结构、语义无效样例和 README；验证 JSON 往返、样例、Schema 同步及离线 Schema 测试。

## 4. 使用入口

- [x] 4.1 增加通用库使用与 Schema 导出示例、支持显式重复配对的 CLI validate；记录命令并测试成功、无效、配对错误及输入不变，以 CLI 测试和运行示例验证。

## 5. 集成检查

- [x] 5.1 更新 README、路线图、工程说明、AGENTS 状态并执行 simplify；运行 workspace 测试、doctest、格式、Clippy、rustdoc、OpenSpec 严格校验和差异检查，确认任务与交付一致。
