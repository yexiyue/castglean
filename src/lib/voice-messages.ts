import { msg } from "@lingui/core/macro";

export const voiceFailureMessages = {
  UnsupportedFormat: msg({
    comment: "音色包版本不支持，当前不提供旧格式兼容",
    message: "此音色包格式不受支持，请使用当前版本重新导出。",
  }),
  InvalidPackage: msg({ message: "音色包结构或信息无效，请检查文件。" }),
  LimitExceeded: msg({ message: "超过音色数量或文件大小限制，请分批处理。" }),
  InvalidAudio: msg({ message: "参考录音无效或不完整，请检查文件。" }),
  ContentMismatch: msg({ message: "文件内容与记录不一致，请重新获取音色包。" }),
  Conflict: msg({ message: "音色身份发生冲突，请重新检查并选择处理方式。" }),
  StalePreview: msg({ message: "预览已失效，请重新检查音色包。" }),
  Busy: msg({ message: "请先完成或取消当前音色任务，再继续操作。" }),
  Cancelled: msg({ message: "已取消，已经导入的音色会保留。" }),
  Disk: msg({ message: "磁盘空间不足，已完成的音色和原有文件会保留。" }),
  Io: msg({ message: "无法读写音色文件，请检查磁盘和文件权限。" }),
  Unavailable: msg({ message: "音色库暂时不可用，请重试。" }),
};
export const voiceConflictMessages = {
  AlreadyPresent: msg({
    comment: "同 ID 同内容音色已在本地库中",
    message: "已存在",
  }),
  MetadataDifference: msg({
    comment: "音色内容相同但名称或来源信息不同，保留本地信息",
    message: "信息有差异，保留本地",
  }),
  IdentityConflict: msg({
    comment: "同一音色 ID 对应不同录音内容",
    message: "身份冲突",
  }),
  SameName: msg({
    comment: "名称相同但可以独立存在的音色",
    message: "同名音色",
  }),
  DuplicateContent: msg({
    comment: "不同 ID 的音色具有相同声音内容",
    message: "可能重复",
  }),
};
export const voiceStatusMessages = {
  Imported: msg({ comment: "音色已实际写入库", message: "已导入" }),
  AlreadyPresent: voiceConflictMessages.AlreadyPresent,
  Skipped: msg({ comment: "用户决定不导入此音色", message: "已跳过" }),
  Failed: msg({ comment: "音色单项写入失败", message: "失败" }),
  Cancelled: msg({ comment: "此音色尚未发布时取消", message: "已取消" }),
  NotAttempted: msg({
    comment: "批次故障后未开始写入的音色",
    message: "未执行",
  }),
};
export const voiceTaskStageMessages = {
  Checking: msg({ comment: "正在完整检查音色包和录音", message: "检查文件" }),
  Planning: msg({ comment: "生成音色导入决定和 ID 映射", message: "准备导入" }),
  Writing: msg({ comment: "正在写入导出的音色包", message: "写入音色包" }),
  Committing: msg({
    comment: "正在逐项发布音色到真实音色库",
    message: "保存音色",
  }),
  Completed: msg({
    comment: "音色后台任务已停止，结果可能成功、部分成功或失败",
    message: "处理结束",
  }),
};
