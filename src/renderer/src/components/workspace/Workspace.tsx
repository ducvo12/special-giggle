import {
  Fragment,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import WorkspaceRegion, {
  type RegionPaneProps,
} from "./region/WorkspaceRegion";
import { tabDropAt, tabDropMargin, type DropPreview } from "./layout/tab-drop";
import { addTab, closeTab, selectTab, type Tab } from "./layout/tabs";
import {
  dockPane,
  dockTab,
  groupDockEdge,
  tabDockEdge,
  layoutFits,
  splitSeam,
  resizeSplit,
  removePane,
  updatePane,
  type SplitPath,
  type Layout,
  type PaneNode,
  type Rect,
} from "./layout/layout";
import { paneTypes, type PaneType } from "./layout/pane-types";
import {
  regionGap,
  regionMinimum,
  regionSwapAt,
  resizeRegions,
  swapRegions,
  updateRegion,
  type RegionLayout,
} from "./layout/regions";
import { runScopedTransition } from "./layout/transition";

export type LayoutUpdate = (current: RegionLayout) => RegionLayout;

interface WorkspaceProps {
  layout: RegionLayout;
  tabCloseReason: (tab: Tab) => string | undefined;
  renderEmptyRegion: (type: PaneType) => ReactNode;
  onLayoutChange: (layout: LayoutUpdate) => void;
  onBoundsChange: (bounds: Rect) => void;
  newPane: Pick<PaneNode, "id" | "title">;
}

interface Point {
  x: number;
  y: number;
}

interface PointerDrag extends Point {
  origin: Rect;
  startX: number;
  startY: number;
}

type DragTarget =
  | { kind: "group"; region: PaneType; pane: PaneNode; tab?: Tab }
  | { kind: "region"; region: PaneType };
type Drag = PointerDrag & DragTarget;
type GroupDrag = Extract<Drag, { kind: "group" }>;
type ResizeTarget =
  | { kind: "regions" }
  | { kind: "groups"; region: PaneType; path: SplitPath };

interface Resize {
  target: ResizeTarget;
  axis: "horizontal" | "vertical";
  start: number;
  size: number;
  available: number;
  ratio: number;
}

interface WorkspaceDrop extends Omit<DropPreview, "layout"> {
  layout: RegionLayout;
  preview?: Rect;
}

// Ignore small pointer movements so clicking a title bar does not start a drag.
function moved(drag: PointerDrag) {
  return Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5;
}

// Identify a specific outer or internal divider for active resize styling.
function sameTarget(a: ResizeTarget, b: ResizeTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "regions") return true;
  if (b.kind === "regions") return false;
  return (
    a.region === b.region &&
    a.path.length === b.path.length &&
    a.path.every((branch, index) => branch === b.path[index])
  );
}

function measureSplit(
  divider: HTMLElement,
  axis: Resize["axis"],
  target: ResizeTarget,
) {
  const split = divider.parentElement!;
  const dimension = axis === "horizontal" ? "width" : "height";
  const gap = target.kind === "regions" ? regionGap : splitSeam;
  return {
    available: split.getBoundingClientRect()[dimension] - gap,
    size: split.firstElementChild!.getBoundingClientRect()[dimension],
  };
}

// Share pointer capture and cancellation across region swaps, group docking, and resizing.
export default function Workspace({
  layout,
  tabCloseReason,
  renderEmptyRegion,
  onLayoutChange,
  onBoundsChange,
  newPane,
}: WorkspaceProps) {
  const workspace = useRef<HTMLElement>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [separated, setSeparated] = useState(false);
  const activePointer = useRef<number | null>(null);
  const pendingMove = useRef<{ frame: number; point: Point } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const groupSurfaces = useRef<
    Partial<Record<PaneType, HTMLDivElement | null>>
  >({});
  const interacting = drag !== null || resize !== null;
  const draggedTabId = drag?.kind === "group" ? drag.tab?.id : undefined;
  const floating =
    drag && moved(drag)
      ? {
          left: drag.origin.x,
          top: drag.origin.y,
          width: drag.origin.width,
          height: drag.origin.height,
          translate: `${drag.x - drag.startX}px ${drag.y - drag.startY}px`,
        }
      : undefined;
  const wholePaneDrag = Boolean(
    floating &&
    drag?.kind === "group" &&
    (!drag.tab || drag.pane.tabs.length === 1),
  );
  const separatingDrag = Boolean(floating && drag?.kind === "group");
  const visibleLayout = resize
    ? resizedLayout(resize.target, resize.ratio, resize.available)
    : layout;

  const stopTracking = useCallback(() => {
    activePointer.current = null;
    if (pendingMove.current) cancelAnimationFrame(pendingMove.current.frame);
    pendingMove.current = null;
  }, []);

  // Clear the preview and invalidate queued input before releasing capture.
  const cancelInteraction = useCallback(() => {
    const pointer = activePointer.current;
    if (pointer === null) return;
    stopTracking();
    setDrag(null);
    setResize(null);
    if (workspace.current?.hasPointerCapture(pointer))
      workspace.current.releasePointerCapture(pointer);
  }, [stopTracking, workspace]);

  // A lost pointer or changing window bounds ends resizing at the last rendered size.
  function interruptInteraction() {
    if (
      activePointer.current !== null &&
      resize &&
      resize.ratio !== resize.size / resize.available
    ) {
      commitMeasuredLayout(visibleLayout);
    }
    cancelInteraction();
  }

  const interruptFromEffect = useEffectEvent(interruptInteraction);

  // Finish cleanup before paint so a preceding layout change cannot cancel the next drag.
  useLayoutEffect(cancelInteraction, [layout, cancelInteraction]);
  useEffect(() => stopTracking, [stopTracking]);

  // Wait one synchronous layout commit when expanding flush subpanes before measuring drop targets.
  useLayoutEffect(() => {
    setSeparated(separatingDrag);
  }, [separatingDrag]);

  // Report the outer usable area for group creation and native window minimums.
  useEffect(() => {
    const element = surface.current!;
    const initial = element.getBoundingClientRect();
    let width = initial.width;
    let height = initial.height;
    onBoundsChange({ x: 0, y: 0, width, height });

    const observer = new ResizeObserver(([entry]) => {
      const size = entry.contentRect;
      if (size.width === width && size.height === height) return;
      width = size.width;
      height = size.height;
      interruptFromEffect();
      onBoundsChange({ x: 0, y: 0, width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onBoundsChange]);

  // Escape and window blur invalidate an active pointer interaction.
  useEffect(() => {
    if (!interacting) return;
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || activePointer.current === null) return;
      cancelInteraction();
      if (draggedTabId)
        queueMicrotask(() => document.getElementById(draggedTabId)?.focus());
    };
    window.addEventListener("keydown", keyDown);
    const blur = () => interruptFromEffect();
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("blur", blur);
    };
  }, [interacting, cancelInteraction, draggedTabId]);

  // Resolve group drops against only the source region's tree and surface.
  // Tab bars insert first; lower pane bodies offer proportional split targets.
  function groupDropAt(
    drag: GroupDrag,
    groups: Layout,
    groupSurface: HTMLElement,
    bounds: DOMRect,
  ): DropPreview | null {
    const pane = document
      .elementFromPoint(drag.x, drag.y)
      ?.closest<HTMLElement>(".pane");
    if (!pane || !groupSurface.contains(pane)) return null;

    const header = pane
      .querySelector(".pane-titlebar")!
      .getBoundingClientRect();
    if (drag.tab && drag.y <= header.bottom + tabDropMargin) {
      return tabDropAt(
        groups,
        drag.pane.id,
        drag.tab.id,
        pane,
        header,
        bounds,
        drag.x,
      );
    }
    if (drag.y < header.bottom) return null;

    const rect = pane.getBoundingClientRect();
    const x = (drag.x - rect.left) / rect.width;
    const y = (drag.y - header.bottom) / (rect.bottom - header.bottom);
    const edge = drag.tab ? tabDockEdge(x, y) : groupDockEdge(x, y);
    if (!edge) return null;

    const target = { paneId: pane.dataset.paneId!, edge };
    const splitTab =
      drag.tab && drag.pane.tabs.length > 1 ? drag.tab : undefined;
    const next = splitTab
      ? dockTab(groups, drag.pane.id, splitTab.id, newPane, target)
      : dockPane(groups, drag.pane.id, target);
    if (next === groups || !layoutFits(next, bounds)) return null;
    return { layout: next, target };
  }

  // Translate local group previews into outer coordinates without crossing ownership boundaries.
  function dropAt(drag: Drag): WorkspaceDrop | null {
    if (drag.kind === "region") {
      const bounds = surface.current!.getBoundingClientRect();
      const drop = regionSwapAt(
        layout,
        drag.region,
        { x: 0, y: 0, width: bounds.width, height: bounds.height },
        drag.x - bounds.left,
        drag.y - bounds.top,
      );
      return drop;
    }
    const region = layout.regions.find(
      (region) => region.type === drag.region,
    )!;
    const groupSurface = groupSurfaces.current[drag.region]!;
    const groupBounds = groupSurface.getBoundingClientRect();
    const drop = groupDropAt(drag, region.layout!, groupSurface, groupBounds);
    if (!drop) return null;
    const bounds = surface.current!.getBoundingClientRect();
    const offset = {
      x: groupBounds.left - bounds.left,
      y: groupBounds.top - bounds.top,
    };
    const marker = drop.marker
      ? {
          ...drop.marker,
          x: drop.marker.x + offset.x,
          y: drop.marker.y + offset.y,
        }
      : undefined;
    return {
      ...drop,
      layout: updateRegion(layout, drag.region, drop.layout),
      marker,
    };
  }

  // Capture at the common workspace so all interactions continue across region boundaries.
  function startDrag(target: DragTarget, event: PointerEvent<HTMLElement>) {
    if (
      interacting ||
      activePointer.current !== null ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return;
    event.preventDefault();
    activePointer.current = event.pointerId;
    workspace.current!.setPointerCapture(event.pointerId);
    let selector = ".workspace-region";
    if (target.kind === "group") {
      selector =
        target.tab && target.pane.tabs.length > 1 ? ".pane-tab" : ".pane";
    }
    const bounds = event.currentTarget
      .closest(selector)!
      .getBoundingClientRect();
    const pointer: PointerDrag = {
      origin: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
    };
    setDrag({ ...pointer, ...target });
  }

  // Decide from the release position; cancellation and invalid drops preserve both trees.
  function finishDrag(drag: Drag, point: Point) {
    const final = { ...drag, ...point };
    if (moved(final)) {
      const destination =
        point.x === drag.x && point.y === drag.y ? drop : dropAt(final);
      // Commit and clear the live drag together so no snapshot outlives the pointer.
      if (destination) commitMeasuredLayout(destination.layout);
    } else if (draggedTabId && drag.kind === "group") {
      changePane(drag.region, drag.pane.id, (pane) =>
        selectTab(pane, draggedTabId),
      );
    }
    setDrag(null);
    if (draggedTabId)
      queueMicrotask(() => document.getElementById(draggedTabId)?.focus());
  }

  function commitMeasuredLayout(next: RegionLayout) {
    onLayoutChange((current) => (current === layout ? next : current));
  }

  // Outer resizing changes region proportions; inner resizing changes only one region's tree.
  function resizedLayout(
    target: ResizeTarget,
    ratio: number,
    available: number,
  ): RegionLayout {
    if (target.kind === "regions")
      return resizeRegions(layout, ratio, available);
    const region = layout.regions.find(
      (region) => region.type === target.region,
    )!;
    return updateRegion(
      layout,
      target.region,
      resizeSplit(region.layout!, target.path, ratio, available),
    );
  }

  // Measure the divider's own grid so nested resizing stays local to that split.
  function startResize(
    target: ResizeTarget,
    axis: Resize["axis"],
    event: PointerEvent<HTMLDivElement>,
  ) {
    if (
      interacting ||
      activePointer.current !== null ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return;
    event.preventDefault();
    const { available, size } = measureSplit(event.currentTarget, axis, target);
    activePointer.current = event.pointerId;
    workspace.current!.setPointerCapture(event.pointerId);
    setResize({
      target,
      axis,
      start: axis === "horizontal" ? event.clientX : event.clientY,
      size,
      available,
      ratio: size / available,
    });
  }

  // Preserve the grab offset; the corresponding layout owns minimum-size clamping.
  function resizeRatio(session: Resize, point: Point): number {
    const position = session.axis === "horizontal" ? point.x : point.y;
    return (session.size + position - session.start) / session.available;
  }

  // Apply the latest pointer sample before the frame paints.
  function movePointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerId !== activePointer.current) return;
    const point = { x: event.clientX, y: event.clientY };
    if (pendingMove.current) {
      pendingMove.current.point = point;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const { point } = pendingMove.current!;
      pendingMove.current = null;
      if (drag) {
        if (drag.x !== point.x || drag.y !== point.y) {
          flushSync(() => setDrag({ ...drag, ...point }));
        }
      } else if (resize) {
        const ratio = resizeRatio(resize, point);
        if (ratio !== resize.ratio)
          flushSync(() => setResize({ ...resize, ratio }));
      }
    });
    pendingMove.current = { frame, point };
  }

  function cancelPointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerId === activePointer.current) interruptInteraction();
  }

  function getDividerProps(
    target: ResizeTarget,
    axis: Resize["axis"],
  ): HTMLAttributes<HTMLDivElement> {
    const resizing = resize !== null && sameTarget(resize.target, target);
    return {
      className: `pane-divider${resizing ? " is-resizing" : ""}`,
      role: "separator",
      "aria-label":
        target.kind === "regions"
          ? "Resize regions"
          : `Resize ${paneTypes[target.region].label} groups`,
      "aria-orientation": axis === "horizontal" ? "vertical" : "horizontal",
      onPointerDown: (event) => startResize(target, axis, event),
    };
  }

  // Store tab state in its owning region so docking and remounts preserve it.
  function changePane(
    type: PaneType,
    id: string,
    update: (pane: PaneNode) => PaneNode | null,
  ) {
    cancelInteraction();
    onLayoutChange((current) => {
      const region = current.regions.find((item) => item.type === type);
      return region?.layout
        ? updateRegion(current, type, updatePane(region.layout, id, update))
        : current;
    });
  }

  function getPaneProps(region: PaneType, node: PaneNode): RegionPaneProps {
    const dragging = drag?.kind === "group" && drag.pane.id === node.id;
    return {
      tabCloseReason,
      dropEdge: drop?.target?.paneId === node.id ? drop.target.edge : undefined,
      floating: dragging && wholePaneDrag ? floating : undefined,
      draggedTabId:
        dragging && !wholePaneDrag && floating ? drag.tab?.id : undefined,
      onTabDragStart: (tab, event) =>
        startDrag({ kind: "group", region, pane: node, tab }, event),
      onDragStart: (event) =>
        startDrag({ kind: "group", region, pane: node }, event),
      onAddTab: (titlebar) =>
        runScopedTransition(titlebar, "tabs", () =>
          changePane(region, node.id, (pane) => addTab(pane, "agent")),
        ),
      onSelectTab: (id) =>
        changePane(region, node.id, (pane) => selectTab(pane, id)),
      onCloseTab: (id, titlebar) => {
        const closingFinal = node.tabs.length === 1 && node.tabs[0]?.id === id;
        runScopedTransition(
          closingFinal ? workspace.current : titlebar,
          closingFinal ? "groups" : "tabs",
          () => {
            changePane(region, node.id, (pane) => closeTab(pane, id));
          },
        );
      },
      onClose: () =>
        runScopedTransition(workspace.current, "groups", () => {
          cancelInteraction();
          onLayoutChange((current) => {
            const groups = current.regions.find(
              (item) => item.type === region,
            )?.layout;
            return groups
              ? updateRegion(current, region, removePane(groups, node.id))
              : current;
          });
        }),
    };
  }

  // Give region swapping a keyboard equivalent without changing internal group positions.
  function moveRegionWithKeyboard(
    type: PaneType,
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (
      interacting ||
      !["ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key)
    )
      return;
    event.preventDefault();
    if (event.key === "ArrowLeft" && layout.regions[0].type === type) return;
    if (event.key === "ArrowRight" && layout.regions[1].type === type) return;
    runScopedTransition(workspace.current, "regions", () =>
      onLayoutChange((current) => swapRegions(current)),
    );
  }

  const drop =
    floating && drag && (!separatingDrag || separated) ? dropAt(drag) : null;
  const [first, second] = visibleLayout.regions;
  const tracks = `minmax(${regionMinimum(first).width}px, ${visibleLayout.ratio * 100}fr) ${regionGap}px minmax(${regionMinimum(second).width}px, ${(1 - visibleLayout.ratio) * 100}fr)`;

  return (
    <main
      ref={workspace}
      className={`workspace${drag ? " is-dragging" : ""}${resize ? ` is-resizing-${resize.axis}` : ""}`}
      aria-label="Workspace"
      onPointerMove={movePointer}
      onPointerUp={(event) => {
        if (event.pointerId !== activePointer.current) return;
        stopTracking();
        const point = { x: event.clientX, y: event.clientY };
        if (resize) {
          commitMeasuredLayout(
            resizedLayout(
              resize.target,
              resizeRatio(resize, point),
              resize.available,
            ),
          );
          setResize(null);
        } else if (drag) {
          finishDrag(drag, point);
        }
      }}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={cancelPointer}
    >
      <div
        className="region-layout"
        ref={surface}
        style={{ gridTemplateColumns: tracks }}
      >
        {/* Regions */}
        {visibleLayout.regions.map((region, index) => {
          const type = region.type;
          const moving = drag?.kind === "region" && drag.region === type;
          const separating =
            separatingDrag && drag?.kind === "group" && drag.region === type;

          return (
            <Fragment key={type}>
              <WorkspaceRegion
                region={region}
                floating={moving ? floating : undefined}
                separating={separating}
                groupSurfaceRef={(element) => {
                  groupSurfaces.current[type] = element;
                }}
                onDragStart={(event) =>
                  startDrag({ kind: "region", region: type }, event)
                }
                onMoveKeyDown={(event) => moveRegionWithKeyboard(type, event)}
                getPaneProps={(pane) => getPaneProps(type, pane)}
                getDividerProps={(path, axis) =>
                  getDividerProps({ kind: "groups", region: type, path }, axis)
                }
                renderEmptyRegion={renderEmptyRegion}
              />

              {/* Dividor between 1st and 2nd region */}
              {index === 0 && (
                <div {...getDividerProps({ kind: "regions" }, "horizontal")} />
              )}
            </Fragment>
          );
        })}

        {/* Drag and drop visuals */}
        {drop?.preview && (
          <div
            className="pane-dock-preview"
            aria-hidden="true"
            style={{
              left: drop.preview.x,
              top: drop.preview.y,
              width: drop.preview.width,
              height: drop.preview.height,
            }}
          />
        )}
        {drop?.marker && (
          <div
            className="tab-drop-marker"
            aria-hidden="true"
            style={{
              left: drop.marker.x,
              top: drop.marker.y,
              width: drop.marker.width,
              height: drop.marker.height,
            }}
          />
        )}
        {floating && drag?.kind === "group" && drag.tab && !wholePaneDrag && (
          <div
            className="pane-tab tab-drag-preview"
            aria-hidden="true"
            style={floating}
          >
            {drag.tab.title}
          </div>
        )}
      </div>
    </main>
  );
}
