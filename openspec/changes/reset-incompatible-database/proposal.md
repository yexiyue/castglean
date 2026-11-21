## Why

不支持的 SQLite 版本会阻止启动。开发测试需要能从原生提示归档旧库并打开空库。

## What Changes

- 不兼容版本提示提供「备份并重置」和「退出」。
- 确认后独占处理当前数据目录的数据库，归档原库并重启应用。
- 通用读取、权限和迁移错误保留退出路径。

## Capabilities

### Modified Capabilities

- `local-project-storage` 管理不兼容库的手动重置。

## Impact

启动阶段、原生错误弹窗和本地数据库归档。沿用现有 SQLite 结构。
