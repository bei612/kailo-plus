// Kailo 平台页（SS-WEB-01）：成员、本人审计、本人设备。Web 与 Desktop 渲染的是同
// 一份组件，数据全部经 BFF（传输由宿主经 PlatformProvider 给出）。这里没有 Relay
// 地址、没有 signer、没有 Nostr filter。
//
// 未启用的能力不在这里出现：不渲染一个点进去说「未启用」的入口。

import {
  BuzzIdentityState,
  type ClientKeyView,
  WorkspaceMembershipState,
} from "@kailo/contracts";
import { type ReactNode, useState } from "react";
import { truncatePubkey, relativeTime } from "../format";
import { type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useT } from "./context";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { type Loaded, useLoad } from "./use-load";

/** 按读取状态渲染：载入中、结果不明（可重试）、或数据。 */
export function Resource<T>({
  state,
  reload,
  children,
}: {
  state: Loaded<T>;
  reload: () => void;
  children: (data: T) => ReactNode;
}) {
  const t = useT();
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (state.status === "error")
    return (
      <Notice role="alert">
        <span>{t("platform.loadFailed")}</span>
        <Button onClick={reload}>{t("platform.retry")}</Button>
      </Notice>
    );
  return <>{children(state.data)}</>;
}

/** 一个 Workspace 的成员，按人聚合；每人列出全部 ACTIVE 的协议公钥（DD-77）。 */
export function MembersPane({ workspaceId }: { workspaceId: string }) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`members:${workspaceId}`, () => client.members(workspaceId));
  return (
    <Resource state={state} reload={reload}>
      {(rows) =>
        rows.length === 0 ? (
          <Notice>{t("platform.members.none")}</Notice>
        ) : (
          <Table head={[t("platform.member"), t("platform.state"), t("platform.protocolIdentity")]}>
            {rows.map((m) => (
              <tr key={m.principalId}>
                <Cell>{m.displayName}</Cell>
                <Cell>
                  <Badge
                    tone={m.state === WorkspaceMembershipState.Active ? "positive" : "neutral"}
                  >
                    {m.state}
                  </Badge>
                </Cell>
                <Cell mono>
                  {m.pubkeys.length > 0 ? m.pubkeys.map(truncatePubkey).join(" · ") : "—"}
                </Cell>
              </tr>
            ))}
          </Table>
        )
      }
    </Resource>
  );
}

/**
 * 成员页的独立形态：自己取可进入的 Workspace 并提供选择。宿主已有 Workspace 选择
 * （Web 的平台页头部）时直接用 MembersPane。
 */
export function WorkspaceMembersPage() {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("workspaces", client.workspaces);
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <Resource state={state} reload={reload}>
      {(rows) => {
        if (rows.length === 0) return <Notice>{t("platform.noWorkspace")}</Notice>;
        // 只认列表里的：列表已经排除了进不去的
        const active = rows.find((w) => w.id === chosen)?.id ?? rows[0]?.id;
        return (
          <div className="flex flex-col gap-3">
            {rows.length > 1 ? (
              <select
                aria-label={t("platform.workspace")}
                className="h-8 w-fit rounded-md border border-input bg-transparent px-2 text-sm"
                value={active}
                onChange={(e) => setChosen(e.target.value)}
              >
                {rows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            ) : (
              <h2 className="text-sm font-medium">{rows[0]?.name}</h2>
            )}
            {active ? <MembersPane key={active} workspaceId={active} /> : null}
          </div>
        );
      }}
    </Resource>
  );
}

/** 本人在当前 Tenant 内的动作（.design/03 §14 的最小集合）。 */
export function AuditPage() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad("audit", client.ownAudit);
  return (
    <Resource state={state} reload={reload}>
      {(rows) =>
        rows.length === 0 ? (
          <Notice>{t("platform.audit.none")}</Notice>
        ) : (
          <Table
            head={[t("platform.time"), t("platform.type"), t("platform.action"), t("platform.result")]}
          >
            {rows.map((a, i) => (
              // 审计行没有对外 id；它们只追加、按时间排序返回，位置即身份
              // biome-ignore lint/suspicious/noArrayIndexKey: 见上
              <tr key={i}>
                <Cell title={a.occurredAt}>{relativeTime(locale, a.occurredAt)}</Cell>
                <Cell>{a.eventType}</Cell>
                <Cell>{a.actionKey}</Cell>
                <Cell>
                  <Badge tone={a.decision === "ALLOW" ? "positive" : "negative"}>{a.decision}</Badge>{" "}
                  {a.resultCode}
                </Cell>
              </tr>
            ))}
          </Table>
        )
      }
    </Resource>
  );
}

/**
 * 本人的原生设备（DD-77/79）。
 *
 * 登记只能在设备上完成——私钥在那里生成、从不离开。这里只能查看与撤销：设备丢了，
 * 应当能在任一端把它撤掉。撤销只移出这一把公钥，Relay 随即拒绝它；其他设备与
 * Web 身份不受影响。`currentDevicePubkey` 由原生宿主给出，用于标出本机。
 */
export function DevicesPage({ currentDevicePubkey }: { currentDevicePubkey?: string }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad("client-keys", client.clientKeys);
  const [revoking, setRevoking] = useState<string | null>(null);
  const failureText = useFailureText();
  const [outcome, setOutcome] = useState<WriteFailure | null>(null);

  const revoke = async (key: ClientKeyView) => {
    setRevoking(key.pubkey);
    setOutcome(null);
    try {
      await client.revokeClientKey(key.pubkey);
    } catch (e) {
      // 结果不明不说成失败：撤销可能已经生效，只能提示去确认
      setOutcome(writeFailure(e));
    } finally {
      setRevoking(null);
      reload();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("platform.devices.explain")}</p>
      {outcome ? (
        <div className={`text-xs ${outcome.kind === "rejected" ? "text-destructive" : ""}`} role="alert">
          {outcome.kind === "unknown"
            ? t("platform.devices.revokeUnknown", { operation: outcome.operationId ?? "—" })
            : t("platform.devices.revokeRejected", { reason: failureText(outcome) })}
        </div>
      ) : null}
      <Resource state={state} reload={reload}>
        {(keys) =>
          keys.length === 0 ? (
            <Notice>{t("platform.devices.none")}</Notice>
          ) : (
            <Table
              head={[t("platform.protocolIdentity"), t("platform.state"), t("platform.devices.added"), ""]}
            >
              {keys.map((k) => (
                <tr key={k.pubkey}>
                  <Cell mono>
                    {truncatePubkey(k.pubkey)}
                    {k.pubkey === currentDevicePubkey ? (
                      <span className="ml-2 font-sans text-muted-foreground">
                        {t("platform.devices.thisDevice")}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell>
                    <Badge tone={k.state === BuzzIdentityState.Active ? "positive" : "neutral"}>
                      {k.state}
                    </Badge>
                  </Cell>
                  <Cell title={k.createdAt}>{relativeTime(locale, k.createdAt)}</Cell>
                  <Cell>
                    {k.state === BuzzIdentityState.Revoking ? null : (
                      <Button disabled={revoking !== null} onClick={() => void revoke(k)}>
                        {t("platform.devices.revoke")}
                      </Button>
                    )}
                  </Cell>
                </tr>
              ))}
            </Table>
          )
        }
      </Resource>
    </div>
  );
}
