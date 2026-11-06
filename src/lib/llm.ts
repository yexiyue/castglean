import { msg } from "@lingui/core/macro";
import type { LlmError } from "@/lib/bindings";

export const llmErrors = {
  invalid_configuration: msg`请检查连接名称、服务地址和模型 ID。`,
  unsupported_version: msg`连接配置版本不受支持，原文件已保留。`,
  conflict: msg`配置已变化，请重新读取后再操作。`,
  busy: msg`连接正在使用中，请等待任务结束后修改。`,
  read_failed: msg`无法读取连接配置，请检查存储权限。`,
  write_failed: msg`连接配置未能保存，请检查存储空间和权限。`,
  credential_unavailable: msg`系统凭据不可用，请解锁或重新配置密钥后重试。`,
  model_not_found: msg`找不到模型，请检查模型 ID 和服务地址。`,
  authentication: msg`鉴权失败，请检查 API 密钥。`,
  network: msg`无法连接服务，请检查网络和地址。`,
  timeout: msg`请求超时，请稍后重试。`,
  capability_unavailable: msg`服务未完成所需能力测试，可以检查模型或更换服务。`,
  invalid_response: msg`服务返回了无法使用的结果，请检查模型和协议。`,
  cancelled: msg`请求已取消。`,
  too_large: msg`请求或结果超过大小限制。`,
} satisfies Record<LlmError, ReturnType<typeof msg>>;

export function llmErrorKey(error: unknown): LlmError {
  return typeof error === "string" && error in llmErrors
    ? (error as LlmError)
    : "invalid_response";
}
