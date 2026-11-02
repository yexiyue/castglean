import { i18n } from "@lingui/core";

/** 支持的语言列表；新增语言需同步 lingui.config.ts 并运行 pnpm i18n:extract。 */
export const locales = {
  zh: "简体中文",
  en: "English",
} as const;

export type LocaleKey = keyof typeof locales;

export const defaultLocale: LocaleKey = "zh";

/** 收窄任意字符串（如持久化偏好读出的值）到受支持的语言。 */
export function isLocaleKey(value: string): value is LocaleKey {
  return value in locales;
}

/** 动态加载并激活指定语言；Vite 插件负责把 .po 编译为可导入模块。 */
export async function dynamicActivate(locale: LocaleKey) {
  const { messages } = await import(`../locales/${locale}/messages.po`);
  i18n.load(locale, messages);
  i18n.activate(locale);
}
