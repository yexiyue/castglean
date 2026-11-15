import { useCallback, useEffect, useState } from "react";
import { commands } from "@/lib/bindings";
import { desktop } from "@/lib/local-projects";

/**
 * 宿主持有的应用级状态。首次使用引导的完成标记只写入宿主，
 * 前端不缓存判定依据，浏览器预览没有该状态。
 */
export function useOnboardingState() {
  // 浏览器预览没有宿主状态可读，直接视为不在读取中。
  const [onboardingCompleted, setOnboardingCompleted] = useState<
    boolean | null
  >(null);
  const [loading, setLoading] = useState(desktop);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    commands
      .appStateSnapshot()
      .then((snapshot) => {
        if (active) setOnboardingCompleted(snapshot.onboardingCompleted);
      })
      .catch(() => {
        // 读取失败按未完成处理：引导仍可继续，不向用户暴露底层异常。
        if (active) setOnboardingCompleted(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const completeOnboarding = useCallback(async () => {
    // 本次会话先按已完成处理，写入失败不应让引导反复弹回。
    setOnboardingCompleted(true);
    if (!desktop) return;
    try {
      await commands.appStateCompleteOnboarding();
    } catch {
      // 宿主持久化失败只影响下次启动的判定，不打断当前流程。
    }
  }, []);

  return { loading, onboardingCompleted, completeOnboarding };
}
