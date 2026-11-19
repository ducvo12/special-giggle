import { acceptsTab, type PaneType } from "./pane-types.ts";
import { closeTab, initialTabs, type NewTab, type PaneTabs } from "./tabs.ts";

export type Edge = "left" | "right" | "top" | "bottom";

export interface PaneNode extends PaneTabs {
  kind: "pane";
  id: string;
  title: string;
}
export interface SplitNode {
  kind: "split";
  axis: "horizontal" | "vertical";
  ratio: number;
  first: Layout;
  second: Layout;
}

export type Layout = PaneNode | SplitNode;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DockTarget {
  paneId: string;
  edge: Edge;
}

// Reserve room for the expanded split during docking, even when the groups sit flush.
export const splitDragGap = 12;
export const splitSeam = 1;
export const minimumPaneSize = { width: 200, height: 140 };

// Initialize a pane with one selected placeholder tab.
export function createPane(
  id: string,
  title: string,
  paneType: PaneType = "content",
  entry?: NewTab,
): PaneNode {
  return { kind: "pane", id, title, ...initialTabs(id, paneType, entry) };
}

// Find a pane in either branch without depending on its position in the layout.
export function findPane(layout: Layout, id: string): PaneNode | undefined {
  if (layout.kind === "pane") return layout.id === id ? layout : undefined;
  return findPane(layout.first, id) ?? findPane(layout.second, id);
}

// Update a pane without losing its tabs when it moves between split branches.
// Returning null removes the pane and collapses its split in the same operation.
export function updatePane(
  layout: Layout,
  id: string,
  update: (pane: PaneNode) => PaneNode | null,
): Layout | null {
  if (layout.kind === "pane") return layout.id === id ? update(layout) : layout;
  const first = updatePane(layout.first, id, update);
  const second = updatePane(layout.second, id, update);
  if (!first) return second;
  if (!second) return first;
  return { ...layout, first, second };
}

// Closing a whole pane uses the same split-collapse rules as closing its final tab.
export function removePane(layout: Layout, id: string): Layout | null {
  return updatePane(layout, id, () => null);
}

// Transfer the existing tab object, preserving its identity and content kind.
// Source selection and empty-pane cleanup use the same rules as ordinary closing.
export function moveTab(
  layout: Layout,
  sourceId: string,
  tabId: string,
  targetId: string,
  index?: number,
): Layout {
  const source = findPane(layout, sourceId);
  const target = findPane(layout, targetId);
  const tab = source?.tabs.find((tab) => tab.id === tabId);
  if (!source || !target || !tab || !acceptsTab(target.paneType, tab.type))
    return layout;
  const insertion = Math.max(
    0,
    Math.min(index ?? target.tabs.length, target.tabs.length),
  );
  if (sourceId === targetId) {
    const oldIndex = source.tabs.indexOf(tab);
    const position = insertion > oldIndex ? insertion - 1 : insertion;
    if (position === oldIndex) return layout;
    const tabs = source.tabs.filter((item) => item.id !== tabId);
    tabs.splice(position, 0, tab);
    return updatePane(layout, sourceId, (pane) => ({
      ...pane,
      tabs,
      activeTabId: tabId,
    }))!;
  }
  const remaining = updatePane(layout, sourceId, (pane) =>
    closeTab(pane, tabId),
  )!;
  return updatePane(remaining, targetId, (pane) => ({
    ...pane,
    tabs: [
      ...pane.tabs.slice(0, insertion),
      tab,
      ...pane.tabs.slice(insertion),
    ],
    activeTabId: tabId,
  }))!;
}

// Insert beside the pane under the pointer.
function insertPane(
  layout: Layout,
  pane: PaneNode,
  target: DockTarget,
): Layout {
  if (layout.kind === "pane" && layout.id === target.paneId) {
    const before = target.edge === "left" || target.edge === "top";
    return {
      kind: "split",
      ratio: 0.5,
      axis:
        target.edge === "left" || target.edge === "right"
          ? "horizontal"
          : "vertical",
      first: before ? pane : layout,
      second: before ? layout : pane,
    };
  }
  if (layout.kind === "pane") return layout;
  return {
    ...layout,
    first: insertPane(layout.first, pane, target),
    second: insertPane(layout.second, pane, target),
  };
}

// Move an existing pane without changing its identity or duplicating it.
export function dockPane(
  layout: Layout,
  id: string,
  target: DockTarget,
): Layout {
  const pane = findPane(layout, id);
  if (!pane || target.paneId === id) return layout;
  if (!findPane(layout, target.paneId)) return layout;
  const remaining = removePane(layout, id);
  return remaining ? insertPane(remaining, pane, target) : layout;
}

// Detach one existing view into another group of the same family.
export function dockTab(
  layout: Layout,
  sourceId: string,
  tabId: string,
  identity: Pick<PaneNode, "id" | "title">,
  target: DockTarget,
): Layout {
  const source = findPane(layout, sourceId);
  const tab = source?.tabs.find((tab) => tab.id === tabId);
  if (!source || !tab || source.tabs.length < 2) return layout;
  if (findPane(layout, identity.id) || !findPane(layout, target.paneId))
    return layout;
  const pane: PaneNode = {
    kind: "pane",
    ...identity,
    paneType: source.paneType,
    tabs: [tab],
    activeTabId: tab.id,
    nextTab: 1,
  };
  const remaining = updatePane(layout, sourceId, (pane) =>
    closeTab(pane, tabId),
  )!;
  return insertPane(remaining, pane, target);
}

// Region boundaries accept only groups belonging to their family.
export function isPaneType(layout: Layout, type: PaneType): boolean {
  if (layout.kind === "pane") return layout.paneType === type;
  return isPaneType(layout.first, type) && isPaneType(layout.second, type);
}

export type SplitPath = ("first" | "second")[];
type Split = Extract<Layout, { kind: "split" }>;

// Include every descendant's minimum so resizing a parent cannot squeeze a nested pane.
export function minimumSize(layout: Layout): { width: number; height: number } {
  if (layout.kind === "pane") return minimumPaneSize;
  const first = minimumSize(layout.first);
  const second = minimumSize(layout.second);
  if (layout.axis === "horizontal") {
    return {
      width: first.width + splitDragGap + second.width,
      height: Math.max(first.height, second.height),
    };
  }
  return {
    width: Math.max(first.width, second.width),
    height: first.height + splitDragGap + second.height,
  };
}

// Clamp the rendered size without changing the preferred ratio, so growing the
// window restores the user's proportions after a minimum-size constraint.
function firstSize(split: Split, available: number): number {
  const dimension = split.axis === "horizontal" ? "width" : "height";
  return Math.max(
    minimumSize(split.first)[dimension],
    Math.min(
      available * split.ratio,
      available - minimumSize(split.second)[dimension],
    ),
  );
}

// Update only the split at this path; ratios are measured against space excluding the divider.
export function resizeSplit(
  layout: Layout,
  path: SplitPath,
  ratio: number,
  available: number,
): Layout {
  if (layout.kind === "pane") return layout;
  const [branch, ...rest] = path;
  if (branch)
    return {
      ...layout,
      [branch]: resizeSplit(layout[branch], rest, ratio, available),
    };
  return {
    ...layout,
    ratio: firstSize({ ...layout, ratio }, available) / available,
  };
}

// Model the rendered split geometry, including minimum-size clamping.
export function paneRects(layout: Layout, bounds: Rect): Map<string, Rect> {
  const result = new Map<string, Rect>();
  // Divide each split's rectangle until every pane has its own bounds.
  function visit(node: Layout, rect: Rect) {
    if (node.kind === "pane") {
      result.set(node.id, rect);
      return;
    }
    if (node.axis === "horizontal") {
      const available = rect.width - splitDragGap;
      const width = firstSize(node, available);
      visit(node.first, { ...rect, width });
      visit(node.second, {
        ...rect,
        x: rect.x + width + splitDragGap,
        width: available - width,
      });
    } else {
      const available = rect.height - splitDragGap;
      const height = firstSize(node, available);
      visit(node.first, { ...rect, height });
      visit(node.second, {
        ...rect,
        y: rect.y + height + splitDragGap,
        height: available - height,
      });
    }
  }
  visit(layout, bounds);
  return result;
}

// Whole-group drops use VS Code's default side-by-side bias and a neutral center.
export function groupDockEdge(x: number, y: number): Edge | null {
  if (x > 0.3 && x < 0.7 && y > 0.1 && y < 0.9) return null;
  if (x < 1 / 3) return "left";
  if (x > 2 / 3) return "right";
  return y < 0.5 ? "top" : "bottom";
}

// Outside the tab insertion band, a tab can split along any side of the pane.
export function tabDockEdge(x: number, y: number): Edge {
  const edges: [Edge, number][] = [
    ["left", x],
    ["right", 1 - x],
    ["top", y],
    ["bottom", 1 - y],
  ];
  return edges.reduce((nearest, edge) =>
    edge[1] < nearest[1] ? edge : nearest,
  )[0];
}

// Reject docking when the resulting panes cannot all fit.
export function layoutFits(
  layout: Layout,
  bounds: Pick<Rect, "width" | "height">,
): boolean {
  const minimum = minimumSize(layout);
  return bounds.width >= minimum.width && bounds.height >= minimum.height;
}
