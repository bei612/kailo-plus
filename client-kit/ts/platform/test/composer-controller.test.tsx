// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useComposerAutoSubmit, useComposerSubmission } from "../src/react/composer/useMessageComposerController";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers(); });
function mount(child: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container); act(() => root!.render(child));
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }

it("the shared real submit owner refuses DM Agents and invalid captured threads before host publication", async () => {
  const prepare = vi.fn(async (_input: { content: string; context: string }) => {});
  const refused = vi.fn();
  let text = "@Agent please help";
  let context: string | undefined = "thread";
  let submit!: () => Promise<void>;
  function Consumer() {
    ({ submit } = useComposerSubmission({ getContent: () => text, hasMedia: () => false, canSubmit: () => true,
      isEditing: false, isDm: true, dmAgentNames: ["Agent"], refuseDmAgent: refused,
      capture: () => context, prepare }));
    return null;
  }
  mount(<Consumer />);
  await act(() => submit()); expect(refused).toHaveBeenLastCalledWith(true); expect(prepare).not.toHaveBeenCalled();
  text = "human message"; context = undefined;
  await act(() => submit()); expect(prepare).not.toHaveBeenCalled();
  context = "thread"; await act(() => submit());
  expect(prepare).toHaveBeenCalledOnce(); expect(prepare.mock.calls[0]![0]).toMatchObject({ content: text, context });
});

it("queue acceptance releases the shared editor once; late completion cannot unlock the next preparation", async () => {
  const first = deferred(), second = deferred();
  let releaseFirst!: () => void;
  const prepare = vi.fn(async ({ release }: { release: () => void }) => {
    if (prepare.mock.calls.length === 1) { releaseFirst = release; await first.promise; }
    else await second.promise;
  });
  let submit!: () => Promise<void>;
  function Consumer() {
    ({ submit } = useComposerSubmission({ getContent: () => "body", hasMedia: () => false, canSubmit: () => true,
      isEditing: false, isDm: false, dmAgentNames: [], refuseDmAgent: () => {}, capture: () => null, prepare }));
    return null;
  }
  mount(<Consumer />);
  let a!: Promise<void>, b!: Promise<void>;
  act(() => { a = submit(); });
  await act(() => submit()); expect(prepare).toHaveBeenCalledTimes(1);
  act(() => releaseFirst()); act(() => { b = submit(); });
  expect(prepare).toHaveBeenCalledTimes(2);
  await act(async () => { first.resolve(); await a; });
  await act(() => submit()); expect(prepare).toHaveBeenCalledTimes(2);
  await act(async () => { second.resolve(); await b; });
});

it("clearing the confirmed route trigger during consume still submits exactly once after StrictMode hydration", async () => {
  vi.useFakeTimers();
  const owner = {};
  const consume = vi.fn(() => { root!.render(<StrictMode><Consumer enabled={false} /></StrictMode>); });
  const submit = vi.fn();
  function Consumer({ enabled }: { enabled: boolean }) {
    useComposerAutoSubmit({ owner, enabled, ready: true, active: () => true, consume, submit }); return null;
  }
  mount(<StrictMode><Consumer enabled /></StrictMode>);
  await act(() => vi.runAllTimersAsync());
  expect(consume).toHaveBeenCalledOnce(); expect(submit).toHaveBeenCalledOnce();
  act(() => root!.render(<StrictMode><Consumer enabled /></StrictMode>));
  await act(() => vi.runAllTimersAsync()); expect(submit).toHaveBeenCalledOnce();
});

it("retiring an owner during async confirmation never submits its content in the next scope", async () => {
  vi.useFakeTimers(); const wait = deferred(); let active = true;
  const first = {}, next = {}; const submit = vi.fn();
  function Consumer({ owner }: { owner: object }) {
    useComposerAutoSubmit({ owner, enabled: owner === first, ready: true, active: () => active,
      consume: () => wait.promise, submit }); return null;
  }
  mount(<Consumer owner={first} />);
  await act(() => vi.runAllTimersAsync());
  active = false; act(() => root!.render(<Consumer owner={next} />));
  await act(async () => { wait.resolve(); await wait.promise; }); expect(submit).not.toHaveBeenCalled();
});
