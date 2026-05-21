"use client";

import type { UIMessage } from "ai";
import { useEffect, useState } from "react";

import { CommentsPanel } from "@/components/comments/comments-panel";
import type {
  CommentItemData,
  MentionTarget,
} from "@/components/comments/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { useDesignCanvas } from "./canvas-store";
import { DesignChat } from "./design-chat";
import { InspectorPanel } from "./inspector-panel";
import { LibraryPanel } from "./library-panel";

export interface DesignRightPanelProps {
  designId: string;
  initialMessages?: UIMessage[];
  initialComments: CommentItemData[];
  members: MentionTarget[];
  // When false, the panel is hidden via CSS instead of unmounted so the
  // DesignChat's in-memory message history survives collapse/expand cycles.
  hidden?: boolean;
  /** Fired when the server stream emits an auto-generated title update. */
  onTitleUpdate?: (title: string) => void;
}

type RightTab = "chat" | "inspect" | "library" | "comments";

/**
 * Right panel for the design canvas. Four tabs:
 *
 *  - "Chat" — converse with the design agent.
 *  - "Inspect" — edit the currently-selected DesignNode.
 *  - "Library" — saved components and uploaded assets.
 *  - "Comments" — team conversation pinned to the design or to a node.
 *
 * Selecting an element on the canvas auto-switches to Inspect (only if
 * the user is currently on Chat — we don't yank the tab if they're
 * already on Inspect, Library, or Comments). Manual tab clicking always
 * wins.
 */
export function DesignRightPanel({
  designId,
  initialMessages,
  initialComments,
  members,
  hidden = false,
  onTitleUpdate,
}: DesignRightPanelProps) {
  const [tab, setTab] = useState<RightTab>("chat");
  const selectedNodeId = useDesignCanvas((state) => state.selectedNodeId);
  const selectNode = useDesignCanvas((state) => state.selectNode);

  useEffect(() => {
    if (selectedNodeId) {
      // Auto-switch to Inspect only if the user is currently on Chat —
      // never yank them off Inspect, Library, or Comments if they put
      // themselves there.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab((current) => (current === "chat" ? "inspect" : current));
    }
  }, [selectedNodeId]);

  return (
    <aside
      className={cn(
        "flex h-full w-96 shrink-0 flex-col overflow-hidden border-l border-white/5 bg-zinc-950/40 backdrop-blur",
        hidden && "hidden",
      )}
      aria-hidden={hidden}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as RightTab)}
        className="flex h-full flex-col"
      >
        <TabsList className="m-2 grid w-auto grid-cols-4">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="comments">
            Comments
            {initialComments.length > 0 ? (
              <span className="ml-1 rounded-full bg-white/10 px-1 py-px text-[10px] tabular-nums text-zinc-300">
                {initialComments.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="chat"
          forceMount
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <DesignChat
            designId={designId}
            initialMessages={initialMessages}
            onTitleUpdate={onTitleUpdate}
          />
        </TabsContent>
        <TabsContent
          value="inspect"
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <InspectorPanel onBack={() => setTab("chat")} />
        </TabsContent>
        <TabsContent
          value="library"
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <LibraryPanel />
        </TabsContent>
        <TabsContent
          value="comments"
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <CommentsPanel
            subjectType="design"
            subjectId={designId}
            initialComments={initialComments}
            members={members}
            pinnedTargetId={selectedNodeId}
            pinnedTargetLabel={
              selectedNodeId ? "selected element" : null
            }
            onClearPinnedTarget={() => selectNode(null)}
            onTargetClick={(nodeId) => selectNode(nodeId)}
            resolveTargetLabel={() => "element"}
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
