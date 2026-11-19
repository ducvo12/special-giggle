import { createContext, useContext, type RefObject } from "react";
import type { Conversation } from "../../../../../../shared/agent";
import type { Result, SavedConnection } from "../../../../../../shared/chat";
import {
  emptyChatDraft,
  type useChatDrafts,
} from "../../../../app/useChatDrafts";
import {
  chatKey,
  type useWorkspaceChats,
} from "../../../../app/useWorkspaceChats";
import ChatView from "../../content/chat/ChatView";
import type { ReadingPosition } from "../../content/chat/transcript/Transcript";
import MarkdownView, {
  type FileDraft,
} from "../../content/markdown/MarkdownView";
import ExplorerTab, { type ExplorerTabProps } from "../../explorer/ExplorerTab";
import type { Tab } from "../../layout/tabs";

interface TabBodyState {
  explorerProps: ExplorerTabProps;
  fileDrafts: ReadonlyMap<string, FileDraft>;
  updateFileDraft: (id: string, draft?: FileDraft) => void;
  chatDrafts: Pick<
    ReturnType<typeof useChatDrafts>,
    "drafts" | "get" | "patch" | "checkpoint" | "clear"
  >;
  chatSession: Pick<
    ReturnType<typeof useWorkspaceChats>,
    "chats" | "load" | "submit" | "setError"
  >;
  connections?: Result<SavedConnection[]>;
  selectedConnection: string;
  selectConnection: (id: string) => void;
  openSettings: () => void;
  retryConnections: () => void;
  showSavedChat: (saved: Conversation) => void;
  positions: RefObject<Map<string, ReadingPosition>>;
}

export const TabBodyContext = createContext<TabBodyState | undefined>(
  undefined,
);

export default function TabBody({ tab }: { tab: Tab }) {
  const context = useContext(TabBodyContext);
  if (!context) throw new Error("TabBody requires a workspace tab context.");

  const {
    explorerProps,
    fileDrafts,
    updateFileDraft,
    chatDrafts,
    chatSession,
    connections,
    selectedConnection,
    selectConnection,
    openSettings,
    retryConnections,
    showSavedChat,
    positions,
  } = context;
  const { agents } = explorerProps;

  // The active tab's type selects exactly one view for the pane body.
  if (tab.type === "agent") {
    return (
      <ExplorerTab agentId={tab.agentId} tabId={tab.id} {...explorerProps} />
    );
    //
  } else if (tab.type === "file") {
    const file = tab.file;
    if (!file || !agents?.ok) return null;

    const agent = agents.value.find((item) => item.id === file.agentId);
    if (!agent) return null;

    return (
      <MarkdownView
        agent={agent}
        path={file.path}
        draft={fileDrafts.get(tab.id)}
        setDraft={(draft) => updateFileDraft(tab.id, draft)}
      />
    );
    //
  } else if (tab.type === "chat") {
    const conversation = tab.conversation;
    if (!conversation) return null;

    const id = conversation.id ?? conversation.draftId;
    const identity = { agentId: conversation.agentId, id };
    const key = chatKey(identity);
    const draft = chatDrafts.drafts.get(id) ?? emptyChatDraft;
    const chat = chatSession.chats.get(key);
    const agent = agents?.ok
      ? agents.value.find((item) => item.id === conversation.agentId)
      : undefined;
    return (
      <ChatView
        conversationId={conversation.id}
        agent={agent}
        path={conversation.path}
        chat={chat}
        connections={connections}
        selectedConnection={selectedConnection}
        draft={draft}
        draftId={id}
        onDraftChange={(change) => chatDrafts.patch(conversation, change)}
        onSelectConnection={selectConnection}
        onOpenSettings={openSettings}
        onRetryConnections={retryConnections}
        onSubmit={(connection, model, effort, text, intent, images) =>
          chatSession.submit(
            identity,
            connection,
            model,
            effort,
            text,
            intent,
            intent === "message"
              ? {
                  messageId: chatDrafts.get(id)?.pendingId,
                  location: conversation.location,
                  images,
                  started: (pendingId) => {
                    chatDrafts.patch(conversation, { pendingId });
                    chatDrafts.checkpoint();
                  },
                  accepted: (saved) => {
                    chatDrafts.clear(id);
                    showSavedChat(saved);
                  },
                }
              : undefined,
          )
        }
        onError={(error) => chatSession.setError(key, error)}
        onReload={() => {
          if (conversation.id !== undefined)
            chatSession.load(conversation, true);
        }}
        readPosition={() => positions.current.get(tab.id)}
        savePosition={(position) => positions.current.set(tab.id, position)}
      />
    );
  }
}
