// DD-170 (.design/20 §16): the shared list, state, structured-data and confirmation components.
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ErrorClass } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { DataTable, pageCount, pageWindow, Pagination, type DataColumn } from "../src/react/data-table";
import { EmptyState, ErrorState, readRefusal } from "../src/react/state-views";
import { humanizeKey, IdText, KeyValueList, shortId, StructuredValue } from "../src/react/key-value";
import { ConfirmDialog } from "../src/react/confirm-dialog";
import { BffError } from "../src/transport";
import type { PlatformLocale } from "../src/i18n";
import { button, click, render, settle, type } from "./render";

function wrap(ui: React.ReactNode, locale: PlatformLocale = "zh-CN") {
  const client = createBffClient({ send: vi.fn(async () => ({ status: 200, body: {} })) });
  return render(<PlatformProvider locale={locale} client={client}>{ui}</PlatformProvider>);
}

type Row = { id: string; name: string; size: number };
const rows: Row[] = Array.from({ length: 45 }, (_, i) => ({ id: `r${i + 1}`, name: `item-${String(i + 1).padStart(2, "0")}`, size: 100 - i }));
const columns: DataColumn<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  { key: "size", header: "Size", cell: (r) => r.size, sortValue: (r) => r.size, align: "end" },
];
const bodyRows = (host: HTMLElement) => [...host.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-row-key"));

describe("page arithmetic", () => {
  it("counts pages and never returns zero pages", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
  });
  it("shows first, last and neighbours with gaps", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    expect(pageWindow(12, 12)).toEqual([1, null, 9, 10, 11, 12]);
  });
});

describe("DataTable", () => {
  it("states the total and page count, pages 20 rows at a time and turns pages", async () => {
    const host = await wrap(<DataTable label="Things" rows={rows} columns={columns} rowKey={(r) => r.id} empty={<EmptyState title="none" />} />);
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("共 45 条");
    expect(host.querySelector("[data-testid=list-page]")?.textContent).toBe("第 1 / 3 页");
    expect(bodyRows(host)).toHaveLength(20);
    await click(host.querySelector<HTMLButtonElement>("[aria-label='下一页']")!);
    expect(host.querySelector("[data-testid=list-page]")?.textContent).toBe("第 2 / 3 页");
    expect(bodyRows(host)[0]).toBe("r21");
    await click(host.querySelector<HTMLButtonElement>("[aria-label='第 3 页']")!);
    expect(bodyRows(host)).toEqual(["r41", "r42", "r43", "r44", "r45"]);
    expect(host.querySelector<HTMLButtonElement>("[aria-label='下一页']")!.disabled).toBe(true);
  });

  it("changes the page size and returns to the first page", async () => {
    const host = await wrap(<DataTable label="Things" rows={rows} columns={columns} rowKey={(r) => r.id} empty={null} />);
    await click(host.querySelector<HTMLButtonElement>("[aria-label='第 2 页']")!);
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "50"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    expect(bodyRows(host)).toHaveLength(45);
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("共 45 条");
    expect(host.querySelector("[data-testid=list-page]")).toBeNull();
  });

  it("filters locally and offers to clear a filter that matches nothing", async () => {
    const host = await wrap(<DataTable label="Things" rows={rows} columns={columns} rowKey={(r) => r.id} empty={null}
      search={{ text: (r) => r.name }} />);
    const input = host.querySelector<HTMLInputElement>("input[type=search]")!;
    await type(input, "item-4");
    expect(bodyRows(host)).toEqual(["r40", "r41", "r42", "r43", "r44", "r45"]);
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("共 6 条");
    await type(input, "zzz");
    expect(host.textContent).toContain("没有符合筛选条件的结果。");
    await click(button(host, "清除筛选"));
    expect(bodyRows(host)).toHaveLength(20);
  });

  it("sorts by a sortable column ascending then descending", async () => {
    const host = await wrap(<DataTable label="Things" rows={rows} columns={columns} rowKey={(r) => r.id} empty={null} />);
    const sizeHeader = [...host.querySelectorAll("th button")].find((b) => b.textContent?.includes("Size")) as HTMLButtonElement;
    await click(sizeHeader);
    expect(bodyRows(host)[0]).toBe("r45");
    expect(sizeHeader.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    await click(sizeHeader);
    expect(bodyRows(host)[0]).toBe("r1");
  });

  it("opens a row by click and by Enter, but not from its actions", async () => {
    const open = vi.fn();
    const act1 = vi.fn();
    const host = await wrap(<DataTable label="Things" rows={rows.slice(0, 2)} columns={columns} rowKey={(r) => r.id} empty={null}
      onRowClick={open} rowActions={(r) => <button type="button" onClick={() => act1(r.id)}>Act</button>} />);
    const tr = host.querySelector<HTMLTableRowElement>("tbody tr")!;
    await click(tr);
    expect(open).toHaveBeenCalledWith(rows[0]);
    await act(async () => { tr.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(open).toHaveBeenCalledTimes(2);
    await click(button(host, "Act"));
    expect(act1).toHaveBeenCalledWith("r1");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state instead of a table when there are no rows", async () => {
    const host = await wrap(<DataTable label="Things" rows={[]} columns={columns} rowKey={(r) => r.id}
      empty={<EmptyState title="还没有任务" description="发起的操作会出现在这里。" />} />);
    expect(host.querySelector("table")).toBeNull();
    expect(host.textContent).toContain("还没有任务");
  });
});

describe("Pagination", () => {
  it("always states the total, in English too", async () => {
    const host = await wrap(<Pagination total={3} page={1} pageSize={20} onPageChange={() => {}} />, "en");
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("3 total");
    expect(host.querySelector("[aria-label='Next page']")).toBeNull();
  });
});

describe("states", () => {
  it("maps a definitive 403 to the permission state and an unknown failure to a retry", async () => {
    expect(readRefusal(new BffError(403, "denied", { class: ErrorClass.Denied }))).toBe("denied");
    expect(readRefusal(new BffError(500, "boom", { class: ErrorClass.Unknown }))).toBeNull();
    const retry = vi.fn();
    const denied = await wrap(<ErrorState error={new BffError(403, "denied")} onRetry={retry} />);
    expect(denied.querySelector("[data-testid=permission-state]")?.textContent).toContain("没有访问权限");
    const unknown = await wrap(<ErrorState error={new Error("network")} onRetry={retry} />);
    expect(unknown.textContent).toContain("未能载入");
    await click(button(unknown, "重试"));
    expect(retry).toHaveBeenCalled();
  });
});

describe("structured data", () => {
  it("omits absent facts and shortens identifiers with a copy affordance", async () => {
    const host = await wrap(<KeyValueList items={[{ label: "所有者", value: "Ada" }, { label: "说明", value: undefined }, false]} />);
    expect(host.querySelectorAll("dt")).toHaveLength(1);
    expect(shortId("9997ef4b-2ad4-4b82-9ec2-bb0df59f1581")).toBe("9997ef4b…9f1581");
    const id = await wrap(<IdText value="9997ef4b-2ad4-4b82-9ec2-bb0df59f1581" />);
    expect(id.querySelector("code")?.textContent).toBe("9997ef4b…9f1581");
    expect(id.querySelector("code")?.getAttribute("title")).toBe("9997ef4b-2ad4-4b82-9ec2-bb0df59f1581");
    expect(id.querySelector("button")?.getAttribute("aria-label")).toBe("复制");
  });

  it("reads JSON as labelled rows and tags, never as a raw document", async () => {
    expect(humanizeKey("maxTokens")).toBe("Max tokens");
    expect(humanizeKey("allowed_hosts")).toBe("Allowed hosts");
    const host = await wrap(<StructuredValue value={{ maxTokens: 4096, allowedHosts: ["a.example", "b.example"], enabled: true }} labels={{ maxTokens: "最大 Token" }} />);
    expect([...host.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["最大 Token", "Allowed hosts", "Enabled"]);
    expect(host.textContent).toContain("a.example");
    expect(host.textContent).toContain("是");
    expect(host.textContent).not.toContain("{");
  });
});

describe("ConfirmDialog", () => {
  it("asks a question, states the consequence and only confirms from the action button", async () => {
    const confirm = vi.fn();
    const change = vi.fn();
    await wrap(<ConfirmDialog open onOpenChange={change} title="撤销这台设备？" description="该设备将无法再发送消息。"
      confirmLabel="撤销" onConfirm={confirm} />);
    const dialog = document.querySelector("[data-testid=confirm-dialog]") as HTMLElement;
    expect(dialog.textContent).toContain("撤销这台设备？");
    expect(dialog.textContent).toContain("该设备将无法再发送消息。");
    await click(button(dialog, "取消"));
    expect(confirm).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledWith(false);
    await click(dialog.querySelector("[data-testid=confirm-dialog-action]") as HTMLButtonElement);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
