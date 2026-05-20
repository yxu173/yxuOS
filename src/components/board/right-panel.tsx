"use client";

import type { UIMessage } from "ai";

import { CommentsPanel } from "@/components/comments/comments-panel";
import type {
  CommentItemData,
  MentionTarget,
} from "@/components/comments/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { Chat } from "./chat";

export interface BoardRightPanelProps {
  boardId: string;
  initialMessages: UIMessage[];
  initialComments: CommentItemData[];
  members: MentionTarget[];
  /**
   * Excalidraw element currently selected by the user, if exactly one is
   * selected. Used to pin new comments to that shape.
   */
  selectedShapeId: string | null;
  onClearSelection: () => void;
  onFocusShape: (shapeId: string) => void;
  resolveTargetLabel: (shapeId: string) => string | null;
  selectedShapeLabel: string | null;
  // When false, the panel is hidden via CSS instead of unmounted so the
  // Chat's in-memory message history survives collapse/expand cycles.
  hidden?: boolean;
}

export function BoardRightPanel({
  boardId,
  initialMessages,
  initialComments,
  members,
  selectedShapeId,
  onClearSelection,
  onFocusShape,
  resolveTargetLabel,
  selectedShapeLabel,
  hidden = false,
}: BoardRightPanelProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-96 min-w-0 shrink-0 flex-col overflow-hidden border-l border-white/5 bg-zinc-950/40 backdrop-blur",
        hidden && "hidden",
      )}
      aria-hidden={hidden}
    >
      <Tabs defaultValue="chat" className="flex h-full flex-col">
        <TabsList className="m-2 grid w-auto grid-cols-2">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="comments">
            Comments
            {initialComments.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-px text-[10px] tabular-nums text-zinc-300">
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
          <Chat boardId={boardId} initialMessages={initialMessages} />
        </TabsContent>
        <TabsContent
          value="comments"
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <CommentsPanel
            subjectType="board"
            subjectId={boardId}
            initialComments={initialComments}
            members={members}
            pinnedTargetId={selectedShapeId}
            pinnedTargetLabel={selectedShapeLabel}
            onClearPinnedTarget={onClearSelection}
            onTargetClick={onFocusShape}
            resolveTargetLabel={resolveTargetLabel}
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
