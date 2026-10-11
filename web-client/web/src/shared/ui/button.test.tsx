// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Button, buttonVariants } from "./button";
import * as shared from "@client-kit/platform/react/button";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
});

it("Web consumes the existing original shared Button", () => {
  expect(Button).toBe(shared.Button);
  expect(buttonVariants).toBe(shared.buttonVariants);
});

it.each([
  ["default", ["h-9", "px-4", "py-2"]],
  ["sm", ["h-8", "px-3", "text-xs"]],
  ["xs", ["h-6", "px-2", "text-xs"]],
  ["lg", ["h-10", "px-8"]],
  ["icon", ["h-8", "w-8"]],
  ["icon-xs", ["h-6", "w-6", "[&_svg]:size-3.5"]],
] as const)("retains original %s geometry", async (size, tokens) => {
  await act(async () => root.render(<Button size={size}>Original</Button>));
  const button = host.querySelector("button")!;
  for (const token of ["gap-1.5", "rounded-lg", ...tokens]) {
    expect(button.classList.contains(token)).toBe(true);
  }
});

it("retains the original outline treatment", async () => {
  await act(async () => root.render(<Button variant="outline">Original</Button>));
  const button = host.querySelector("button")!;
  for (const token of ["border-input/40", "hover:bg-muted/70"]) {
    expect(button.classList.contains(token)).toBe(true);
  }
  expect(button.classList.contains("shadow-xs")).toBe(false);
});

it("keeps refs, disabled guards, and click handlers on the original element", async () => {
  const ref = createRef<HTMLButtonElement>();
  const onClick = vi.fn();
  await act(async () => root.render(<Button ref={ref} disabled onClick={onClick}>Original</Button>));
  expect(ref.current).toBe(host.querySelector("button"));
  await act(async () => ref.current!.click());
  expect(onClick).not.toHaveBeenCalled();
  await act(async () => root.render(<Button ref={ref} onClick={onClick}>Original</Button>));
  await act(async () => ref.current!.click());
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("keeps Slot children and caller class overrides", async () => {
  await act(async () => root.render(<Button asChild className="rounded-none gap-3"><a href="#original">Original</a></Button>));
  const link = host.querySelector("a")!;
  expect(host.querySelector("button")).toBeNull();
  expect(link.getAttribute("href")).toBe("#original");
  expect(link.classList.contains("rounded-none")).toBe(true);
  expect(link.classList.contains("rounded-lg")).toBe(false);
  expect(link.classList.contains("gap-3")).toBe(true);
  expect(link.classList.contains("gap-1.5")).toBe(false);
});
