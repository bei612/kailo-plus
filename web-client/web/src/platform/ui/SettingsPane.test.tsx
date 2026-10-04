import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceNotifications } from "./SettingsPane";

const state = vi.hoisted(() => ({
  workspaces: {
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: [{ id: "workspace-a", name: "A" }],
  },
  preferences: {
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: {
      version: 7,
      workspacePreferences: { "workspace-a": { starred: true, muted: false } },
    },
  },
  write: vi.fn(),
  invalidate: vi.fn(),
  mutate: null as null | ((input: { id: string; muted: boolean }) => Promise<void>),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) =>
    options.queryKey[1] === "workspaces" ? state.workspaces : state.preferences,
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useMutation: (options: { mutationFn: typeof state.mutate }) => {
    state.mutate = options.mutationFn;
    return { isError: false, isPending: false };
  },
}));
vi.mock("@/platform/bff-client", () => ({
  bff: { workspaces: vi.fn() },
  fetchUserState: vi.fn(),
  setWorkspacePreference: state.write,
}));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en" }));

beforeEach(() => {
  state.write.mockReset().mockResolvedValue({ version: 8 });
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.workspaces.isSuccess = true;
  state.workspaces.isError = false;
  state.workspaces.isFetching = false;
  state.preferences.isSuccess = true;
  state.preferences.isError = false;
  state.preferences.isFetching = false;
});
describe("Web settings existing user-state CAS consumer", () => {
  it("writes exact workspace/current version while preserving the existing star", async () => {
    renderToStaticMarkup(<WorkspaceNotifications />);
    await state.mutate!({ id: "workspace-a", muted: true });
    expect(state.write).toHaveBeenCalledExactlyOnceWith("workspace-a", {
      starred: true,
      muted: true,
      version: 7,
    });
    expect(state.invalidate).toHaveBeenCalledOnce();
  });
  it("never writes an unlisted workspace or unverified preference snapshot", async () => {
    renderToStaticMarkup(<WorkspaceNotifications />);
    await state.mutate!({ id: "workspace-b", muted: true });
    state.preferences.isSuccess = false;
    await state.mutate!({ id: "workspace-a", muted: true });
    expect(state.write).not.toHaveBeenCalled();
  });
  it("refetches after a lost response without replaying the write", async () => {
    state.write.mockRejectedValue(new Error("private native detail"));
    renderToStaticMarkup(<WorkspaceNotifications />);
    await expect(state.mutate!({ id: "workspace-a", muted: true })).rejects.toThrow();
    expect(state.write).toHaveBeenCalledTimes(1);
    expect(state.invalidate).toHaveBeenCalledOnce();
  });
  it("does not turn failed reads into unmuted defaults", () => {
    state.preferences.isSuccess = false;
    state.preferences.isError = true;
    const markup = renderToStaticMarkup(<WorkspaceNotifications />);
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain("private native detail");
    expect(markup).toContain('role="status"');
  });
});
