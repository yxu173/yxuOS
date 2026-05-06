"use client";

import { ChevronLeft, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { useDesignCanvas } from "./canvas-store";
import type { DesignNode } from "./design-node";
import { findNodeInTree } from "./node-utils";

export interface InspectorPanelProps {
  /** Called when the user clicks "Back to chat" so the parent can flip the tab. */
  onBack: () => void;
}

/**
 * Right-pane inspector for the currently selected DesignNode.
 *
 * v1 exposes the highest-frequency edits per node type plus a small set
 * of common style props (color, background, font size, padding, radius).
 * Everything dispatches via `updateNodeInArtboard` so the change is
 * immediately reflected on the canvas and persisted by the snapshot
 * debounce.
 */
export function InspectorPanel({ onBack }: InspectorPanelProps) {
  const selectedNodeId = useDesignCanvas((state) => state.selectedNodeId);
  const artboards = useDesignCanvas((state) => state.artboards);
  const updateNode = useDesignCanvas((state) => state.updateNodeInArtboard);
  const deleteNode = useDesignCanvas((state) => state.deleteNodeInArtboard);
  const selectNode = useDesignCanvas((state) => state.selectNode);

  // Find the selected node + its containing artboard.
  let selectedNode: DesignNode | null = null;
  let containingArtboardId: string | null = null;
  if (selectedNodeId) {
    for (const artboard of artboards) {
      if (!artboard.design) continue;
      const found = findNodeInTree(artboard.design, selectedNodeId);
      if (found) {
        selectedNode = found;
        containingArtboardId = artboard.id;
        break;
      }
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onBack}
          title="Back to chat"
          aria-label="Back to chat"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        {selectedNode ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              if (containingArtboardId && selectedNode?.id) {
                deleteNode(containingArtboardId, selectedNode.id);
              }
            }}
            title="Delete element"
            aria-label="Delete element"
            className="text-red-300 hover:bg-red-500/10 hover:text-red-200"
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <ScrollArea className="flex-1">
        {selectedNode && containingArtboardId ? (
          <NodeInspector
            node={selectedNode}
            artboardId={containingArtboardId}
            onPatch={(patch) => updateNode(containingArtboardId!, selectedNode!.id!, patch)}
            onDeselect={() => selectNode(null)}
          />
        ) : (
          <EmptyState />
        )}
      </ScrollArea>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid h-full place-items-center px-6 py-16 text-center text-xs text-zinc-500">
      <div>
        <p className="text-zinc-300">Click an element on the canvas</p>
        <p className="mt-1.5">to see its properties here.</p>
      </div>
    </div>
  );
}

interface NodeInspectorProps {
  node: DesignNode;
  artboardId: string;
  onPatch: (patch: Partial<DesignNode>) => void;
  onDeselect: () => void;
}

function NodeInspector({ node, onPatch }: NodeInspectorProps) {
  return (
    <div className="flex flex-col gap-5 px-3 py-4">
      {/* Type / id header */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          Element
        </span>
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">
            {node.type}
          </span>
          {node.id ? (
            <span className="truncate font-mono text-[10px] text-zinc-500">
              {node.id}
            </span>
          ) : null}
        </div>
      </div>

      <ContentFields node={node} onPatch={onPatch} />
      <StyleFields node={node} onPatch={onPatch} />
    </div>
  );
}

/* ─── Content fields per type ─── */

function ContentFields({
  node,
  onPatch,
}: {
  node: DesignNode;
  onPatch: (patch: Partial<DesignNode>) => void;
}) {
  switch (node.type) {
    case "text":
      return (
        <Section title="Content">
          <Field label="Text">
            <Textarea
              value={node.text}
              rows={3}
              onChange={(event) =>
                onPatch({ text: event.target.value } as Partial<DesignNode>)
              }
              className="resize-none text-sm"
            />
          </Field>
          <Field label="Tag">
            <Select
              value={node.tag ?? "span"}
              onValueChange={(value) =>
                onPatch({
                  tag: value as
                    | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
                    | "p"
                    | "span"
                    | "label",
                } as Partial<DesignNode>)
              }
            >
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "h1",
                    "h2",
                    "h3",
                    "h4",
                    "h5",
                    "h6",
                    "p",
                    "span",
                    "label",
                  ] as const
                ).map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>
      );
    case "button":
      return (
        <Section title="Content">
          <Field label="Label">
            <Input
              value={node.label}
              onChange={(event) =>
                onPatch({
                  label: event.target.value,
                } as Partial<DesignNode>)
              }
            />
          </Field>
          <Field label="Variant">
            <Select
              value={node.variant ?? "primary"}
              onValueChange={(value) =>
                onPatch({
                  variant: value as
                    | "primary"
                    | "secondary"
                    | "ghost"
                    | "outline",
                } as Partial<DesignNode>)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["primary", "secondary", "ghost", "outline"] as const
                ).map((variant) => (
                  <SelectItem key={variant} value={variant}>
                    {variant}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Size">
            <Select
              value={node.size ?? "md"}
              onValueChange={(value) =>
                onPatch({
                  size: value as "sm" | "md" | "lg",
                } as Partial<DesignNode>)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["sm", "md", "lg"] as const).map((size) => (
                  <SelectItem key={size} value={size}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>
      );
    case "link":
      return (
        <Section title="Content">
          <Field label="Label">
            <Input
              value={node.label}
              onChange={(event) =>
                onPatch({
                  label: event.target.value,
                } as Partial<DesignNode>)
              }
            />
          </Field>
          <Field label="Href">
            <Input
              value={node.href ?? ""}
              onChange={(event) =>
                onPatch({
                  href: event.target.value,
                } as Partial<DesignNode>)
              }
            />
          </Field>
        </Section>
      );
    case "image":
      return (
        <Section title="Content">
          <Field label="Source URL">
            <Input
              value={node.src ?? ""}
              placeholder="(empty = placeholder)"
              onChange={(event) =>
                onPatch({
                  src: event.target.value || undefined,
                } as Partial<DesignNode>)
              }
            />
          </Field>
          <Field label="Alt text">
            <Input
              value={node.alt ?? ""}
              onChange={(event) =>
                onPatch({
                  alt: event.target.value,
                } as Partial<DesignNode>)
              }
            />
          </Field>
          <Field label="Placeholder colour">
            <ColourInput
              value={node.placeholderColor ?? "#e4e4e7"}
              onChange={(value) =>
                onPatch({
                  placeholderColor: value,
                } as Partial<DesignNode>)
              }
            />
          </Field>
          <Field label="Placeholder icon (lucide)">
            <Input
              value={node.placeholderIcon ?? ""}
              placeholder="image"
              onChange={(event) =>
                onPatch({
                  placeholderIcon: event.target.value || undefined,
                } as Partial<DesignNode>)
              }
            />
          </Field>
        </Section>
      );
    case "input":
      return (
        <Section title="Content">
          <Field label="Placeholder">
            <Input
              value={node.placeholder ?? ""}
              onChange={(event) =>
                onPatch({
                  placeholder: event.target.value,
                } as Partial<DesignNode>)
              }
            />
          </Field>
          <Field label="Label">
            <Input
              value={node.label ?? ""}
              onChange={(event) =>
                onPatch({
                  label: event.target.value,
                } as Partial<DesignNode>)
              }
            />
          </Field>
          <Field label="Type">
            <Select
              value={node.inputType ?? "text"}
              onValueChange={(value) =>
                onPatch({
                  inputType: value as
                    | "text"
                    | "email"
                    | "password"
                    | "search"
                    | "number"
                    | "tel",
                } as Partial<DesignNode>)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "text",
                    "email",
                    "password",
                    "search",
                    "number",
                    "tel",
                  ] as const
                ).map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>
      );
    case "icon":
      return (
        <Section title="Content">
          <Field label="Name (lucide)">
            <Input
              value={node.name}
              onChange={(event) =>
                onPatch({
                  name: event.target.value,
                } as Partial<DesignNode>)
              }
            />
          </Field>
          <Field label="Size">
            <NumberInput
              value={node.size ?? 18}
              onChange={(value) =>
                onPatch({ size: value } as Partial<DesignNode>)
              }
            />
          </Field>
          <Field label="Colour">
            <ColourInput
              value={node.color ?? "#000000"}
              onChange={(value) =>
                onPatch({ color: value } as Partial<DesignNode>)
              }
            />
          </Field>
        </Section>
      );
    default:
      return null;
  }
}

/* ─── Style fields (common across types) ─── */

function StyleFields({
  node,
  onPatch,
}: {
  node: DesignNode;
  onPatch: (patch: Partial<DesignNode>) => void;
}) {
  const style = (node.style ?? {}) as CSSProperties;

  const patchStyle = (next: CSSProperties) =>
    onPatch({ style: { ...style, ...next } } as Partial<DesignNode>);

  return (
    <Section title="Style">
      <Field label="Color">
        <ColourInput
          value={readColor(style.color) ?? "#000000"}
          onChange={(value) => patchStyle({ color: value })}
          allowReset
          onReset={() => patchStyle({ color: undefined })}
        />
      </Field>
      <Field label="Background">
        <ColourInput
          value={readColor(style.background ?? style.backgroundColor) ?? "#ffffff"}
          onChange={(value) => patchStyle({ background: value, backgroundColor: undefined })}
          allowReset
          onReset={() => patchStyle({ background: undefined, backgroundColor: undefined })}
        />
      </Field>
      <Field label="Font size (px)">
        <NumberInput
          value={readNumber(style.fontSize)}
          placeholder="auto"
          onChange={(value) =>
            patchStyle({ fontSize: value === undefined ? undefined : value })
          }
        />
      </Field>
      <Field label="Padding">
        <Input
          value={
            style.padding === undefined ? "" : String(style.padding)
          }
          placeholder="e.g. 16px or 12px 24px"
          onChange={(event) =>
            patchStyle({
              padding: event.target.value || undefined,
            })
          }
        />
      </Field>
      <Field label="Border radius (px)">
        <NumberInput
          value={readNumber(style.borderRadius)}
          placeholder="auto"
          onChange={(value) =>
            patchStyle({
              borderRadius: value === undefined ? undefined : value,
            })
          }
        />
      </Field>
    </Section>
  );
}

function readColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Basic colour validation — only return valid hex / rgb-like strings.
  const trimmed = value.trim();
  if (
    /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ||
    /^rgb/.test(trimmed) ||
    /^hsl/.test(trimmed)
  ) {
    return trimmed;
  }
  // Bare CSS keyword colors render fine but the colour picker can't show them;
  // fall back so the picker doesn't crash.
  return null;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const match = value.match(/^(-?\d+(?:\.\d+)?)/);
    if (match && match[1]) return Number(match[1]);
  }
  return undefined;
}

/* ─── Tiny field primitives ─── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </span>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-zinc-400">{label}</Label>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <Input
      type="number"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const num = Number(raw);
        if (!Number.isNaN(num)) onChange(num);
      }}
    />
  );
}

function ColourInput({
  value,
  onChange,
  allowReset,
  onReset,
}: {
  value: string;
  onChange: (next: string) => void;
  allowReset?: boolean;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="size-9 cursor-pointer rounded-md border border-input bg-transparent p-0"
        aria-label="Pick colour"
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="flex-1 font-mono text-xs"
      />
      {allowReset && onReset ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-zinc-400"
          onClick={onReset}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}
