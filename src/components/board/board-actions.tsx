"use client";

import {
  Ellipsis,
  Image,
  Presentation,
  ScanText,
} from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { CanvasEditorHandle } from "./editor-context";
import { downloadBoardAsPng, downloadBoardAsSvg } from "./export-utils";
import { PresentationDialog } from "./presentation-mode";

interface BoardActionsProps {
  /** Callback to get the live API — avoids accessing refs during render. */
  getHandle: () => CanvasEditorHandle | null;
}

export function BoardActions({ getHandle }: BoardActionsProps) {
  const [presenting, setPresenting] = useState(false);

  const exportPng = useCallback(() => {
    const handle = getHandle();
    if (handle) downloadBoardAsPng(handle.api);
  }, [getHandle]);

  const exportSvg = useCallback(() => {
    const handle = getHandle();
    if (handle) downloadBoardAsSvg(handle.api);
  }, [getHandle]);

  const startPresenting = useCallback(() => {
    setPresenting(true);
  }, []);

  const handle = presenting ? getHandle() : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Board actions">
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={startPresenting}>
              <Presentation className="mr-2 size-4" />
              <span>Presentation mode</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={exportPng}>
              <Image className="mr-2 size-4" />
              <span>Export as PNG</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportSvg}>
              <ScanText className="mr-2 size-4" />
              <span>Export as SVG</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {presenting && handle ? (
        <PresentationDialog
          api={handle.api}
          onClose={() => setPresenting(false)}
        />
      ) : null}
    </>
  );
}
