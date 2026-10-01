// 本机设备密钥的启动关口（DD-79）。
//
// 设备私钥由 Rust 侧在首次启动时生成并存入 OS keyring，从不离开本机：这里没有导入、
// 导出或备份——那会让同一把设备密钥出现在另一台机器上。只处理三种不能继续的情况：
// keyring 锁着（钥匙还在，解锁后重启）、钥匙丢了（换一把新的设备密钥，重启后重新
// 登记；旧那把可在任一端的设备页撤销）、以及恢复之后必须重启。
import * as React from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { useQueryClient } from "@tanstack/react-query";

import { useIdentityQuery } from "@/shared/api/hooks";
import { persistCurrentIdentity } from "@/shared/api/tauriIdentity";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { Button } from "@/shared/ui/button";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";

type Stage =
  | "loading"
  | "unreadable"
  | "keyring-locked"
  | "lost"
  | "relaunch-required"
  | "ready";

function useDeviceIdentityStage(): { stage: Stage; error?: string } {
  const identityQuery = useIdentityQuery();
  const identity = identityQuery.data;
  const lost = identity?.lost === true;
  const locked = identity?.locked === true;

  // 启动时丢失或锁住的事实在本次会话里保持：恢复之后后端的启动例程没有以新
  // 钥匙运行过，只能重启
  const [bootedLost, setBootedLost] = React.useState(false);
  const [bootedLocked, setBootedLocked] = React.useState(false);
  React.useEffect(() => {
    if (lost) setBootedLost(true);
  }, [lost]);
  React.useEffect(() => {
    if (locked) setBootedLocked(true);
  }, [locked]);

  if (identityQuery.status === "pending") return { stage: "loading" };
  if (identityQuery.status === "error") {
    return {
      stage: "unreadable",
      error:
        identityQuery.error instanceof Error
          ? identityQuery.error.message
          : String(identityQuery.error),
    };
  }
  if (locked) return { stage: "keyring-locked" };
  if ((bootedLost && !lost) || (bootedLocked && !locked)) {
    return { stage: "relaunch-required" };
  }
  if (lost) return { stage: "lost" };
  return { stage: "ready" };
}

function Screen({
  testId,
  title,
  body,
  children,
}: {
  testId: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  const systemColorScheme = useSystemColorScheme();
  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell flex items-center justify-center bg-background px-4 py-8 text-foreground"
      data-system-color-scheme={systemColorScheme}
      data-testid={testId}
    >
      <StartupWindowDragRegion />
      <div className="relative flex w-full max-w-[500px] flex-col items-center text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
        <div className="mt-8 flex w-full max-w-[300px] flex-col gap-3">
          {children}
        </div>
      </div>
    </div>
  );
}

function RelaunchButton() {
  return (
    <Button
      className="h-10 w-full"
      data-testid="relaunch-app"
      onClick={() => {
        void relaunch();
      }}
      type="button"
    >
      Relaunch
    </Button>
  );
}

function DeviceKeyLostScreen() {
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const replaceKey = async () => {
    setPending(true);
    setError(null);
    try {
      queryClient.setQueryData(["identity"], await persistCurrentIdentity());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Screen
      body="The key this device used is no longer in the system keyring. Continue with a new device key: after a restart this device registers it again. The old key stays listed under Devices until you revoke it."
      testId="device-key-lost"
      title="This device's key is missing"
    >
      <Button
        className="h-10 w-full"
        data-testid="use-new-device-key"
        disabled={pending}
        onClick={() => void replaceKey()}
        type="button"
      >
        Use a new device key
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </Screen>
  );
}

export function DeviceIdentityGate({
  loading,
  children,
}: {
  loading: React.ReactNode;
  children: React.ReactNode;
}) {
  const { stage, error } = useDeviceIdentityStage();
  switch (stage) {
    case "loading":
      return <>{loading}</>;
    case "unreadable":
      return (
        <Screen
          body={`The device key could not be read: ${error}`}
          testId="device-key-unreadable"
          title="This device's key is unavailable"
        >
          <RelaunchButton />
        </Screen>
      );
    case "keyring-locked":
      return (
        <Screen
          body="This device's key is safe in the OS keyring, but it is unreachable this session. Unlock your keyring or sign into your desktop session, then relaunch."
          testId="keyring-locked"
          title="Unlock your system keyring"
        >
          <RelaunchButton />
        </Screen>
      );
    case "relaunch-required":
      return (
        <Screen
          body="The device key was replaced. Restart so syncing runs under it."
          testId="relaunch-required"
          title="Restart to finish recovery"
        >
          <RelaunchButton />
        </Screen>
      );
    case "lost":
      return <DeviceKeyLostScreen />;
    case "ready":
      return <>{children}</>;
  }
}
