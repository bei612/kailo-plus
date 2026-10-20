// 读取的三态。关键区分是：取不到不是「空」。把失败渲染成空列表，等于把结果不明说成
// 了确定的「没有」——用户会以为自己没有 Workspace、没有成员、没有记录。

import { useCallback, useEffect, useState } from "react";

export type Loaded<T> =
  | { status: "pending" }
  | { status: "error"; error: unknown }
  | { status: "ok"; data: T };

export type LoadOptions = {
  /**
   * 同一 key 的重读期间继续呈现上一次成功的结果，直到新结果到达（成功或失败都替换）。
   * 只用于“每次使用前都会再次新鲜准入”的列表（例如原生页面入口：启动时 Core 重新核对
   * binding 与 origin），以免后台重读把正在被点击的控件卸载。key 变化时仍先回到 pending。
   */
  keepWhileRevalidating?: boolean;
};

/**
 * 调用 `load` 并跟踪其结果。`key` 变化即重新读取；`reload` 手动重读。
 * 返回值只属于当前 key 与刷新轮次：切换后的首次渲染也不能显示上一请求的数据。
 * 过期的回应（key 已变或组件已卸载）被丢弃，不会覆盖较新的结果。
 * `keepWhileRevalidating` 只放宽同一 key 的重读，见 LoadOptions。
 */
export function useLoad<T>(key: string, load: () => Promise<T>, options: LoadOptions = {}): [Loaded<T>, () => void] {
  const keep = options.keepWhileRevalidating === true;
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    round: number;
    state: Loaded<T>;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只按 key 与 round 重读；load 每次渲染都是新函数
  useEffect(() => {
    let current = true;
    setResult((previous) => keep && previous?.key === key && previous.state.status === "ok"
      ? previous
      : { key, round, state: { status: "pending" } });
    load().then(
      (data) => current && setResult({ key, round, state: { status: "ok", data } }),
      (error: unknown) => current && setResult({ key, round, state: { status: "error", error } }),
    );
    return () => {
      current = false;
    };
  }, [key, round]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  const state: Loaded<T> = result?.key === key
    && (result.round === round || (keep && result.state.status === "ok"))
    ? result.state
    : { status: "pending" };
  return [state, reload];
}
