// 测试用的最小渲染器：jsdom + react-dom，不引入额外测试库。

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

export async function render(ui: ReactNode): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => root.render(ui));
  return host;
}

/** 让挂起的 promise 与随后的状态更新落定。 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

/**
 * 按条件等待：WebCrypto 摘要、Blob/FileReader 读取与计时器都在宏任务里完成，
 * 微任务次数（settle）在 CI 负载下不够。逐轮让出一个宏任务直到条件成立，超时报出等待对象。
 */
export async function until(condition: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await act(async () => {});
    if (condition()) return;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

export function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!found) throw new Error(`没有「${label}」按钮：${host.textContent}`);
  return found;
}

export async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
  await settle();
}

export async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
