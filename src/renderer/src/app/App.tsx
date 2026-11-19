import "../styles/shell.css";
import "../styles/panes.css";
import "../styles/saved-chats.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Agent, Conversation } from "../../../shared/agent";
import type { Result, SavedConnection } from "../../../shared/chat";
import type { Section, SectionMode } from "../../../shared/organization";
import Header from "../components/header/Header";
import Workspace, {
  type LayoutUpdate,
} from "../components/workspace/Workspace";
import {
  createPane,
  findPane,
  updatePane,
  type Rect,
} from "../components/workspace/layout/layout";
import {
  regionsMinimum,
  updateRegion,
  type RegionLayout,
} from "../components/workspace/layout/regions";
import type {
  DraftChatDestination,
  FileDestination,
  NewChatLocation,
  Tab,
} from "../components/workspace/layout/tabs";
import ExplorerTab, {
  type ExplorerTabProps,
} from "../components/workspace/explorer/ExplorerTab";
import WorkspaceCreationDialog from "../components/workspace/WorkspaceCreationDialog";
import type { ReadingPosition } from "../components/workspace/content/chat/transcript/Transcript";
import Settings from "../components/settings/Settings";
import type { FileDraft } from "../components/workspace/content/markdown/MarkdownView";
import { TabBodyContext } from "../components/workspace/region/pane/TabBody";
import {
  findTab,
  openDraftChat,
  openSavedChat,
  openWorkspaceFile,
  updateChatTab,
} from "./saved-chat-layout";
import { useChatDrafts } from "./useChatDrafts";
import { useSavedResource } from "./useSavedResource";
import { chatKey, useWorkspaceChats } from "./useWorkspaceChats";
import {
  filterWorkspaceTabs,
  findMissingWorkspaceTabs,
  loadWorkspaceLayout,
  saveWorkspaceLayout,
  workspacePanes,
  type SavedWorkspaceLayout,
} from "./workspace-layout-storage";

interface WorkspaceState extends SavedWorkspaceLayout {
  focus?: { tabId: string; composer?: boolean };
}

type Creation =
  | { kind: "agent"; pickerId?: string }
  | { kind: "section"; agentId: string }
  | { kind: "project"; section: Section };

function nextGroup({ nextPane }: WorkspaceState) {
  return { id: `pane-${nextPane}`, title: `Group ${nextPane}` };
}

function withLayout(current: WorkspaceState, layout: RegionLayout) {
  if (layout === current.layout) return current;
  const { id } = nextGroup(current);
  const created = layout.regions.some(
    (region) => region.layout && findPane(region.layout, id),
  );
  return { ...current, layout, nextPane: current.nextPane + Number(created) };
}

function loadAgents() {
  return window.granite.agents.list();
}

function loadConnections() {
  return window.granite.connections.list();
}

export default function WorkspaceApp() {
  const chatDrafts = useChatDrafts();
  const [restored] = useState(() => {
    const saved = loadWorkspaceLayout();
    return {
      ...saved,
      layout: filterWorkspaceTabs(
        saved.layout,
        (tab) =>
          tab.type !== "chat" ||
          !tab.conversation?.draftId ||
          chatDrafts.drafts.has(tab.conversation.draftId),
      ),
    };
  });
  const [state, setState] = useState<WorkspaceState>(restored);
  const checkedRestoredTabs = useRef(false);
  const [bounds, setBounds] = useState<Rect>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [windowError, setWindowError] = useState("");
  const positions = useRef(new Map<string, ReadingPosition>());
  const [fileDrafts, setFileDrafts] = useState(new Map<string, FileDraft>());
  const focusedChat = useRef<string | undefined>(undefined);
  const reconciledDrafts = useRef(false);
  const [explorerRevisions, setExplorerRevisions] = useState(
    new Map<string, number>(),
  );
  const [creation, setCreation] = useState<Creation>();
  const [selectedConnection, setSelectedConnection] = useState(
    () => localStorage.getItem("granite.connection") ?? "",
  );
  const [editedConnections, setEditedConnections] =
    useState<SavedConnection[]>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useRef<HTMLDialogElement>(null);
  const chatSession = useWorkspaceChats();
  const {
    result: agents,
    retry: retryAgents,
    update: updateAgents,
  } = useSavedResource(loadAgents, "Could not load your agents.");
  const { result: savedConnections, retry: retryConnections } =
    useSavedResource(loadConnections, "Could not load your connections.");
  const connections = editedConnections
    ? { ok: true as const, value: editedConnections }
    : savedConnections;
  const defaultConnection = connections?.ok
    ? ((
        connections.value.find((item) => item.id === selectedConnection) ??
        connections.value[0]
      )?.id ?? "")
    : "";
  const { layout, nextPane, focus } = state;
  const panes = workspacePanes(layout);
  const tabSelection = JSON.stringify(
    panes.map((pane) => [pane.activeTabId, pane.tabs.map((tab) => tab.id)]),
  );
  const measured = bounds.width > 0 && bounds.height > 0;
  const minimum = regionsMinimum(layout);
  const minWidth = Math.ceil(minimum.width + window.innerWidth - bounds.width);
  const minHeight = Math.ceil(
    minimum.height + window.innerHeight - bounds.height,
  );

  useEffect(() => {
    if (!measured) return;
    void window.granite.window
      .setMinimumSize(minWidth, minHeight)
      .then((result) => {
        setWindowError(result.ok ? "" : result.error);
      })
      .catch(() => setWindowError("Could not update the window minimum size."));
  }, [minWidth, minHeight, measured]);

  useLayoutEffect(() => {
    if (!focus) return;
    const tab = document.getElementById(focus.tabId);
    if (!tab) return;
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    const input = focus.composer
      ? document
          .getElementById(tab.getAttribute("aria-controls")!)
          ?.querySelector("textarea")
      : undefined;
    const target = input && !input.disabled ? input : tab;
    target.focus({ preventScroll: true });
  }, [focus]);

  useLayoutEffect(() => {
    if (settingsOpen) settings.current?.showModal();
  }, [settingsOpen]);

  useLayoutEffect(() => {
    chatDrafts.checkpoint();
  }, [tabSelection]);

  useLayoutEffect(() => {
    let pending = true;
    const save = () => {
      pending = false;
      saveWorkspaceLayout({ layout, nextPane }, chatDrafts.savedIds());
    };
    const timer = window.setTimeout(save, 120);
    const saveBeforeClose = () => {
      if (chatDrafts.checkpoint() || pending) save();
    };
    window.addEventListener("beforeunload", saveBeforeClose);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeunload", saveBeforeClose);
    };
  }, [layout, nextPane]);

  useEffect(
    () =>
      window.granite.conversations.onDeleted((agentId, id) => {
        chatDrafts.clear(id);
        setState((current) =>
          withLayout(
            current,
            filterWorkspaceTabs(
              current.layout,
              (tab) =>
                tab.type !== "chat" ||
                tab.conversation?.id !== id ||
                tab.conversation.agentId !== agentId,
            ),
          ),
        );
        refreshExplorer(agentId);
      }),
    [],
  );

  useEffect(() => {
    if (!agents?.ok || reconciledDrafts.current) return;
    let current = true;
    void chatDrafts
      .reconcile(agents.value, () => current, showSavedChat)
      .then(() => {
        if (current) reconciledDrafts.current = true;
      });
    return () => {
      current = false;
    };
  }, [agents]);

  useEffect(() => {
    if (!agents?.ok || checkedRestoredTabs.current) return;
    let current = true;
    void findMissingWorkspaceTabs(
      restored.layout,
      agents.value,
      window.granite,
    ).then((missing) => {
      if (!current) return;
      checkedRestoredTabs.current = true;
      if (missing.size)
        setState((current) =>
          withLayout(
            current,
            filterWorkspaceTabs(current.layout, (tab) => !missing.has(tab.id)),
          ),
        );
    });
    return () => {
      current = false;
    };
  }, [agents, restored]);

  useEffect(() => {
    for (const pane of workspacePanes(layout)) {
      const active = pane.tabs.find((tab) => tab.id === pane.activeTabId);
      if (active?.type === "chat" && active.conversation?.id !== undefined)
        chatSession.load(active.conversation);
    }
  }, [layout]);

  useEffect(() => {
    const content = layout.regions.find(
      (region) => region.type === "content",
    )!.layout;
    for (const viewId of positions.current.keys()) {
      if (!findTab(content, (tab) => tab.id === viewId))
        positions.current.delete(viewId);
    }
    setFileDrafts((current) => {
      const open = [...current].filter(([viewId]) =>
        findTab(content, (tab) => tab.id === viewId),
      );
      return open.length === current.size ? current : new Map(open);
    });
  }, [layout]);

  useEffect(() => {
    const content = layout.regions.find(
      (region) => region.type === "content",
    )!.layout;
    chatSession.prune((key) =>
      Boolean(
        findTab(
          content,
          (tab) =>
            tab.type === "chat" &&
            tab.conversation !== undefined &&
            chatKey({
              agentId: tab.conversation.agentId,
              id: tab.conversation.id ?? tab.conversation.draftId,
            }) === key,
        ),
      ),
    );
  }, [layout, chatSession.chats]);

  function selectConnection(id: string) {
    setSelectedConnection(id);
    localStorage.setItem("granite.connection", id);
  }

  function refreshExplorer(agentId: string) {
    setExplorerRevisions((current) =>
      new Map(current).set(agentId, (current.get(agentId) ?? 0) + 1),
    );
  }

  function changeLayout(update: LayoutUpdate) {
    setState((current) =>
      withLayout(current, update(current.layout)),
    );
  }

  function openChat(chat: Conversation, path: string[]) {
    setState((current) => {
      const opened = openSavedChat(
        current.layout,
        nextGroup(current),
        chat,
        path,
      );
      return {
        ...withLayout(current, opened.layout),
        focus: { tabId: opened.tabId },
      };
    });
  }

  function openFile(file: FileDestination) {
    setState((current) => {
      const opened = openWorkspaceFile(
        current.layout,
        nextGroup(current),
        file,
      );
      return {
        ...withLayout(current, opened.layout),
        focus: { tabId: opened.tabId },
      };
    });
  }

  function updateFileDraft(id: string, draft?: FileDraft) {
    setFileDrafts((current) => {
      const next = new Map(current);
      if (draft) next.set(id, draft);
      else next.delete(id);
      return next;
    });
  }

  function fileCloseReason(tab: Tab) {
    const draft = fileDrafts.get(tab.id);
    if (draft?.saving) return "Wait for the file to finish saving";
    if (draft && draft.text !== draft.original)
      return "Save or cancel your file edits before closing";
  }

  function openDraft(destination: DraftChatDestination) {
    setState((current) => {
      const opened = openDraftChat(
        current.layout,
        nextGroup(current),
        destination,
      );
      return {
        ...withLayout(current, opened.layout),
        focus: { tabId: opened.tabId, composer: true },
      };
    });
  }

  function newChat(destination: NewChatLocation) {
    openDraft({ ...destination, draftId: crypto.randomUUID() });
  }

  function showSavedChat(saved: Conversation) {
    setState((current) =>
      withLayout(
        current,
        updateChatTab(
          current.layout,
          (tab) =>
            (tab.conversation?.id ?? tab.conversation?.draftId) === saved.id,
          (tab) => ({
            ...tab,
            title: saved.title,
            conversation: {
              agentId: saved.agentId,
              id: saved.id,
              path: tab.conversation!.path,
            },
          }),
        ),
      ),
    );
    refreshExplorer(saved.agentId);
  }

  function chooseAgent(agent: Agent, pickerId?: string) {
    setState((current) => {
      const explorer = current.layout.regions.find(
        (region) => region.type === "explorer",
      )!.layout;
      const entry = {
        type: "agent" as const,
        agentId: agent.id,
        title: agent.name,
      };
      if (!explorer) {
        const { id, title } = nextGroup(current);
        const pane = createPane(id, title, "explorer", entry);
        const layout = updateRegion(current.layout, "explorer", pane);
        return {
          ...withLayout(current, layout),
          focus: { tabId: pane.activeTabId },
        };
      }

      const picker = findTab(explorer, (tab) => tab.id === pickerId);
      if (!picker) return current;
      const groups = updatePane(explorer, picker.pane.id, (pane) => ({
        ...pane,
        tabs: pane.tabs.map((tab) =>
          tab.id === picker.tab.id ? { ...entry, id: tab.id } : tab,
        ),
      }));
      const layout = updateRegion(current.layout, "explorer", groups);
      return {
        ...withLayout(current, layout),
        focus: { tabId: picker.tab.id },
      };
    });
  }

  async function createEntry(
    action: Creation,
    name: string,
    mode: SectionMode,
  ): Promise<Result<unknown>> {
    if (action.kind === "agent") {
      const result = await window.granite.agents.create(name);
      if (result.ok) {
        updateAgents((current) => [...current, result.value]);
        chooseAgent(result.value, action.pickerId);
      }
      return result;
    }

    const api = window.granite.organization;
    const result =
      action.kind === "section"
        ? await api.createSection(action.agentId, name, mode)
        : await api.createProject(
            action.section.agentId,
            action.section.id,
            name,
          );
    if (result.ok) refreshExplorer(result.value.agentId);
    return result;
  }

  const explorerProps: ExplorerTabProps = {
    agents,
    drafts: chatDrafts.drafts,
    revisions: explorerRevisions,
    onRetryAgents: retryAgents,
    onChooseAgent: chooseAgent,
    onNewAgent: (pickerId) => setCreation({ kind: "agent", pickerId }),
    onOpenDraft: openDraft,
    onOpenFile: openFile,
    onOpenChat: openChat,
    onNewChat: newChat,
    onNewSection: (agentId) => setCreation({ kind: "section", agentId }),
    onNewProject: (section) => setCreation({ kind: "project", section }),
  };

  const tabBodyState = {
    explorerProps,
    fileDrafts,
    updateFileDraft,
    chatDrafts,
    chatSession,
    connections,
    selectedConnection: defaultConnection,
    selectConnection,
    openSettings: () => setSettingsOpen(true),
    retryConnections,
    showSavedChat,
    positions,
  };

  return (
    <div
      className="app workspace-app"
      onFocusCapture={(event) => {
        const element = event.target.closest<HTMLElement>(
          "[data-chat-draft-id]",
        );
        const id = element?.dataset.chatDraftId;
        if (id && id !== focusedChat.current) {
          if (chatDrafts.checkpoint())
            saveWorkspaceLayout({ layout, nextPane }, chatDrafts.savedIds());
          focusedChat.current = id;
        }
      }}
    >
      {/* Header */}
      <Header onOpenSettings={() => setSettingsOpen(true)} />

      {/* Errors */}
      {windowError && <p role="alert">{windowError}</p>}
      {chatDrafts.error && <p role="alert">{chatDrafts.error}</p>}

      {/* Workspace */}
      <TabBodyContext value={tabBodyState}>
        <Workspace
          layout={layout}
          renderEmptyRegion={(type) =>
            type === "explorer" ? (
              <ExplorerTab {...explorerProps} />
            ) : (
              <p>Open a file or chat from Explorer.</p>
            )
          }
          tabCloseReason={fileCloseReason}
          onLayoutChange={changeLayout}
          onBoundsChange={setBounds}
          newPane={nextGroup(state)}
        />
      </TabBodyContext>

      {/* Creation menu */}
      {creation && (
        <WorkspaceCreationDialog
          kind={creation.kind}
          sectionName={
            creation.kind === "project" ? creation.section.name : undefined
          }
          onCreate={(name, mode) => createEntry(creation, name, mode)}
          onClose={() => setCreation(undefined)}
        />
      )}

      {/* Settings menu */}
      {settingsOpen && (
        <dialog
          className="workspace-connections"
          aria-label="Connections"
          ref={settings}
          onClose={() => setSettingsOpen(false)}
        >
          <button
            type="button"
            className="quiet-button"
            onClick={() => settings.current?.close()}
          >
            Close settings
          </button>

          {connections?.ok ? (
            <Settings
              connections={connections.value}
              onChange={setEditedConnections}
            />
          ) : connections ? (
            <div>
              <p role="alert">{connections.error}</p>

              <button type="button" onClick={() => retryConnections()}>
                Retry
              </button>
            </div>
          ) : (
            <p>Loading connections…</p>
          )}
        </dialog>
      )}
    </div>
  );
}
