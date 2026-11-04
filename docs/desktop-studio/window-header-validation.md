# 平台标题栏验收

日期：2026-11-04。源码分支 `codex/platform-window-header`，本次不发布应用。

## 已完成

- macOS 左侧保留原生交通灯，44px 自绘 header 左侧预留 78px；首页、工程标签、加号继续可点击，剩余空白可拖动。右侧不重复显示 CastGlean。
- Windows 右侧顺序为最小化、最大化/还原、关闭。状态从真实窗口同步；专用 Snap Layout 插件提供原生命中测试，按钮 ID 与实际元素矩形绑定。全屏时不绘制这些自定义按钮。
- Linux 保留原生装饰，浏览器不绘制可误操作的桌面窗口按钮。
- 窗口动作的四项 ACL 限 main；Windows 原生命中测试的两项 ACL 限 windows/main。不开放全局 Tauri API、前端 destroy 或 exit 权限。
- Rust 宿主统一拦截关闭和退出，前端确认未保存会话与活动任务，确认后由宿主关闭。活动任务目前包括模型下载、音色检查/导入/导出；并非未来全部制作任务的通用登记。

## 检查与实机结果

- Rust 24 项宿主测试、specta 导出、fmt、Clippy `-D warnings` 通过。生成命令/事件保持类型安全，没有 OS 原生句柄进入 IPC。
- TypeScript/Vite 构建、改动文件 Biome、Lingui 严格编译通过；新增 11 条中英文文案，catalog 共 752 条。
- 在隔离标识 `com.yexiyue.castglean.window-header-qa` 的 macOS 调试包中检查完整 header，保留基础窗口标题与尺寸；实际点击首页、加号并填写合成测试草稿，确认交互区域可用。
- 原生关闭按钮、Cmd+W、Cmd+Q 均展示未保存草稿确认。取消后草稿仍在；重复 Cmd+Q 不会叠加弹窗；点击“仍然关闭”实际退出隔离进程。
- 原生全屏进入与退出通过，退出后恢复原生窗口操作按钮。对 header 空白区执行拖动，界面保持可操作。
- 自动化截图中的紫色共享控件占用了交通灯区域；系统仍能识别并执行原生关闭与全屏按钮，不能把截图上的共享控件当成应用绘制的按钮或交通灯缺失证据。未修改系统共享指示或隐私设置。
- 右侧产品名字样移除后重新构建原生调试包，截图与辅助功能树确认 header 不再重复显示产品名；空会话 Cmd+Q 正常退出。

## 尚未验收

Windows 10/11 和 Linux 原生界面未在本次环境验收；Windows 目标工具链下载未完成，未声称 Windows 交叉编译通过。Windows 11 仍须实机检查 Snap 悬停、拖动还原、多显示器 DPI、键盘焦点及按钮点击。当前产品最小宽度 1024 会限制较窄的分屏区域，本变更未重构全应用为 500px 工作台。

后台活动计数来自现有宿主快照；本次 GUI 验收未启动模型下载或进行任务中途退出。关闭提示不会自动保存工程、恢复未持久化任务，也不代表操作系统强制终止或 WebView 崩溃能够保留未保存内容。

## 官方与依赖依据

- [Tauri 窗口定制](https://v2.tauri.app/learn/window-customization/)
- [Tauri Core ACL](https://v2.tauri.app/reference/acl/core-permissions/)
- [微软 Snap Layouts](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)
- [Snap Layout 插件源码及 MIT 许可](https://github.com/Hyph-M/tauri-plugin-snap-layout)
