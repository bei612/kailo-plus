// 平台页的最小外观。两端宿主都是 Tailwind 加同一套语义色（border、muted-foreground、
// secondary、destructive……），这里只用这些类名，不依赖任一宿主的组件库；宿主把本包
// 登记为 Tailwind 的扫描源（@source），类名就按宿主自己的主题生成。

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Notice({ children, role }: { children: ReactNode; role?: "alert" | "status" }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground" role={role}>
      {children}
    </div>
  );
}

type Tone = "neutral" | "positive" | "negative";

const toneClass: Record<Tone, string> = {
  neutral: "border-border text-muted-foreground",
  positive: "border-transparent bg-secondary text-secondary-foreground",
  negative: "border-transparent bg-destructive text-destructive-foreground",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 ${className ?? ""}`}
      {...props}
    />
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-muted-foreground">
        <tr>
          {head.map((cell, i) => (
            // 表头是固定列，位置即身份
            // biome-ignore lint/suspicious/noArrayIndexKey: 见上
            <th key={i} className="px-2 py-1 font-medium">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function Cell({ children, mono, title }: { children?: ReactNode; mono?: boolean; title?: string }) {
  return (
    <td className={`border-t px-2 py-1 ${mono ? "font-mono text-xs" : ""}`} title={title}>
      {children}
    </td>
  );
}
