// 读取的三态。关键区分是：取不到不是「空」。把失败渲染成空列表，等于把结果不明说成
// 了确定的「没有」——用户会以为自己没有 Workspace、没有成员、没有记录。

import { useCallback, useEffect, useState } from "react";

export type Loaded<T> =
  | { status: "pending" }
  | { status: "error"; error: unknown }
  | { status: "ok"; data: T };

/**
 * 调用 `load` 并跟踪其结果。`key` 变化即重新读取；`reload` 手动重读。
 * 过期的回应（key 已变或组件已卸载）被丢弃，不会覆盖较新的结果。
 */
export function useLoad<T>(key: string, load: () => Promise<T>): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>({ status: "pending" });
  const [round, setRound] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只按 key 与 round 重读；load 每次渲染都是新函数
  useEffect(() => {
    let current = true;
    setState({ status: "pending" });
    load().then(
      (data) => current && setState({ status: "ok", data }),
      (error: unknown) => current && setState({ status: "error", error }),
    );
    return () => {
      current = false;
    };
  }, [key, round]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  return [state, reload];
}
