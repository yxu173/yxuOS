"use client";

import type { UIMessage } from "ai";
import { useEffect, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useDesignCanvas } from "./canvas-store";
import { DesignChat } from "./design-chat";
import { InspectorPanel } from "./inspector-panel";
import { LibraryPanel } from "./library-panel";

export interface DesignRightPanelProps {
  designId: string;
  initialMessages?: UIMessage[];
}

type RightTab = "chat" | "inspect" | "library";

/**
 * Right panel for the design canvas. Two tabs:
 *
 *  - "Chat" — converse with the design agent.
 *  - "Inspect" — edit the currently-selected DesignNode.
 *
 * Selecting an element on the canvas auto-switches to Inspect (only if
 * the user is currently on Chat — we don't yank the tab if they're
 * already on Inspect or actively typing in Chat). Manual tab clicking
 * always wins.
 */
export function DesignRightPanel({
  designId,
  initialMessages,
}: DesignRightPanelProps) {
  const [tab, setTab] = useState<RightTab>("chat");
  const selectedNodeId = useDesignCanvas((state) => state.selectedNodeId);

  useEffect(() => {
    if (selectedNodeId) {
      // Auto-switch to Inspect only if the user is currently on Chat —
      // never yank them off Inspect or Library if they put themselves there.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab((current) => (current === "chat" ? "inspect" : current));
    }
  }, [selectedNodeId]);

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col overflow-hidden border-l border-white/5 bg-zinc-950/40 backdrop-blur">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as RightTab)}
        className="flex h-full flex-col"
      >
        <TabsList className="m-2 grid w-auto grid-cols-3">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
        </TabsList>
        <TabsContent
          value="chat"
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <DesignChat designId={designId} initialMessages={initialMessages} />
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
      </Tabs>
    </aside>
  );
}
