// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/SidebarDnd.tsx.
// Same drag model and outcomes: a channel row dropped on a custom section is assigned
// to it, dropped on the default Channels group it leaves its section, and a section
// header dropped on another section reorders the sections (arrayMove). The shared
// package does not carry @dnd-kit, so the browser's native drag-and-drop drives the
// same targets; the drag image is the browser's own instead of the original overlay.
import * as React from "react";
import { cn } from "../profile/buzz/shared/lib/cn";

export type SidebarDragItem =
  | { type: "channel"; channelId: string }
  | { type: "section"; sectionId: string };

type SidebarDndState = {
  enabled: boolean;
  dragging: SidebarDragItem | null;
  begin: (item: SidebarDragItem) => void;
  end: () => void;
  dropOnSection: (sectionId: string) => void;
  dropOnUngrouped: () => void;
};

const SidebarDnd = React.createContext<SidebarDndState | null>(null);
const DRAG_MIME = "application/x-buzz-sidebar-item";
const DROP_RING_CLASS = "ring-2 ring-primary/30";

/** Original `arrayMove` from @dnd-kit/sortable. */
export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/** Resolves a finished drag the way the original `handleDragEnd` did. */
export function resolveSidebarDrop(
  item: SidebarDragItem,
  target: { type: "section"; sectionId: string } | { type: "ungrouped" },
  sectionIds: readonly string[],
):
  | { type: "assign"; channelId: string; sectionId: string }
  | { type: "unassign"; channelId: string }
  | { type: "reorder"; sectionIds: string[] }
  | null {
  if (item.type === "channel") {
    return target.type === "section"
      ? { type: "assign", channelId: item.channelId, sectionId: target.sectionId }
      : { type: "unassign", channelId: item.channelId };
  }
  if (target.type !== "section") return null;
  const from = sectionIds.indexOf(item.sectionId);
  const to = sectionIds.indexOf(target.sectionId);
  if (from === -1 || to === -1 || from === to) return null;
  return { type: "reorder", sectionIds: arrayMove(sectionIds, from, to) };
}

export function SidebarDndContext({
  enabled,
  sectionIds,
  children,
  onAssignChannel,
  onUnassignChannel,
  onReorderSections,
}: {
  /** False while the Core preference state is unread, pending or unknown. */
  enabled: boolean;
  sectionIds: readonly string[];
  children: React.ReactNode;
  onAssignChannel: (channelId: string, sectionId: string) => void;
  onUnassignChannel: (channelId: string) => void;
  onReorderSections: (orderedIds: string[]) => void;
}) {
  const [dragging, setDragging] = React.useState<SidebarDragItem | null>(null);
  // Drop handlers read the live item: a drop can arrive before React re-renders.
  const current = React.useRef<SidebarDragItem | null>(null);
  const handlers = React.useRef({ sectionIds, onAssignChannel, onUnassignChannel, onReorderSections });
  handlers.current = { sectionIds, onAssignChannel, onUnassignChannel, onReorderSections };
  const finish = React.useCallback((target: { type: "section"; sectionId: string } | { type: "ungrouped" }) => {
    const item = current.current;
    current.current = null;
    setDragging(null);
    if (!item) return;
    const { sectionIds: ids, onAssignChannel: assign, onUnassignChannel: unassign, onReorderSections: reorder } = handlers.current;
    const outcome = resolveSidebarDrop(item, target, ids);
    if (outcome?.type === "assign") assign(outcome.channelId, outcome.sectionId);
    else if (outcome?.type === "unassign") unassign(outcome.channelId);
    else if (outcome?.type === "reorder") reorder(outcome.sectionIds);
  }, []);
  const value = React.useMemo<SidebarDndState>(() => ({
    enabled,
    dragging,
    begin: (item) => { current.current = item; setDragging(item); },
    end: () => { current.current = null; setDragging(null); },
    dropOnSection: (sectionId) => finish({ type: "section", sectionId }),
    dropOnUngrouped: () => finish({ type: "ungrouped" }),
  }), [enabled, dragging, finish]);
  React.useEffect(() => {
    if (!enabled) { current.current = null; setDragging(null); }
  }, [enabled]);
  return <SidebarDnd.Provider value={value}>{children}</SidebarDnd.Provider>;
}

function dragStartHandler(state: SidebarDndState, item: SidebarDragItem, data: string) {
  return (event: React.DragEvent<HTMLElement>) => {
    event.stopPropagation();
    // The item itself travels in context; the payload only marks this as a sidebar drag.
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(DRAG_MIME, data);
    }
    state.begin(item);
  };
}

function useDropTarget(accepts: (item: SidebarDragItem) => boolean, onDrop: (state: SidebarDndState) => void) {
  const state = React.useContext(SidebarDnd);
  const [over, setOver] = React.useState(false);
  const depth = React.useRef(0);
  const active = Boolean(state?.enabled && state.dragging && accepts(state.dragging));
  React.useEffect(() => {
    if (!active) { depth.current = 0; setOver(false); }
  }, [active]);
  const props: React.HTMLAttributes<HTMLDivElement> = active && state ? {
    onDragEnter: (event) => { event.preventDefault(); depth.current += 1; setOver(true); },
    onDragOver: (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); },
    onDrop: (event) => {
      event.preventDefault();
      event.stopPropagation();
      depth.current = 0;
      setOver(false);
      onDrop(state);
    },
  } : {};
  return { isOver: active && over, props };
}

export function DraggableChannelRow({ channelId, children }: { channelId: string; children: React.ReactNode }) {
  const state = React.useContext(SidebarDnd);
  const enabled = Boolean(state?.enabled);
  const isDragging = state?.dragging?.type === "channel" && state.dragging.channelId === channelId;
  return (
    <div
      className={cn(
        "transition-[opacity,transform] duration-100 ease-out motion-reduce:transition-none",
        isDragging && "opacity-30",
      )}
      data-sidebar-draggable-channel
      data-sidebar-drag-state={isDragging ? "dragging" : undefined}
      draggable={enabled || undefined}
      onDragEnd={enabled && state ? () => state.end() : undefined}
      onDragStart={enabled && state ? dragStartHandler(state, { type: "channel", channelId }, channelId) : undefined}
    >
      {children}
    </div>
  );
}

export function DroppableSectionBody({
  sectionId,
  children,
  className,
}: {
  sectionId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { isOver, props } = useDropTarget(
    (item) => item.type === "channel" || item.sectionId !== sectionId,
    (state) => state.dropOnSection(sectionId),
  );
  return (
    <div
      {...props}
      className={cn("rounded-md transition-all", isOver && DROP_RING_CLASS, className)}
      data-sidebar-drop-target={`section:${sectionId}`}
    >
      {children}
    </div>
  );
}

export function DroppableUngroupedBody({ children, className }: { children: React.ReactNode; className?: string }) {
  const { isOver, props } = useDropTarget(
    (item) => item.type === "channel",
    (state) => state.dropOnUngrouped(),
  );
  return (
    <div
      {...props}
      className={cn("rounded-md transition-all", isOver && DROP_RING_CLASS, className)}
      data-sidebar-drop-target="ungrouped"
    >
      {children}
    </div>
  );
}

export function SortableSectionShell({
  sectionId,
  children,
}: {
  sectionId: string;
  children: (props: {
    dragHandleProps: React.HTMLAttributes<HTMLElement>;
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const state = React.useContext(SidebarDnd);
  const enabled = Boolean(state?.enabled);
  const isDragging = state?.dragging?.type === "section" && state.dragging.sectionId === sectionId;
  const dragHandleProps: React.HTMLAttributes<HTMLElement> = enabled && state ? {
    draggable: true,
    onDragStart: dragStartHandler(state, { type: "section", sectionId }, sectionId),
    onDragEnd: () => state.end(),
  } : {};
  return <div data-sidebar-section-shell={sectionId}>{children({ dragHandleProps, isDragging })}</div>;
}
