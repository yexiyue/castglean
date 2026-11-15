export type FirstRunStep = "new" | "draft" | "done";

/**
 * 引导步骤只由真实工程状态推导：没有任何工程就新建工程，
 * 有工程但还没有章节就继续导入，出现章节即视为引导完成。
 */
export function firstRunStep(
  projects: { chapterCount: number }[],
): FirstRunStep {
  if (projects.some((project) => project.chapterCount > 0)) return "done";
  // 有工程但还没有章节：引导继续指向导入，不谎称已完成。
  if (projects.length > 0) return "draft";
  return "new";
}
