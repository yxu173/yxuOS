"use client";

import { Boxes, ImagePlus, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import {
  deleteDesignAsset,
  uploadDesignAsset,
} from "@/app/(app)/designs/asset-actions";
import {
  deleteDesignComponent,
  renameDesignComponent,
} from "@/app/(app)/designs/component-actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { useComponentLibrary } from "./component-library-context";

/**
 * Library tab in the right panel. Two sub-tabs:
 *
 * - Components: saved DesignNode trees the agent can reuse via
 *   `{ type: "component-ref", componentSlug }`.
 * - Assets: uploaded images. The agent picks them up via the
 *   `list_assets` tool and references their public URL inside `image`
 *   nodes.
 */
export function LibraryPanel() {
  const { components, assets } = useComponentLibrary();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <Tabs defaultValue="components" className="flex h-full flex-col">
        <TabsList className="m-2 grid w-auto grid-cols-2">
          <TabsTrigger value="components">
            Components ({components.length})
          </TabsTrigger>
          <TabsTrigger value="assets">Assets ({assets.length})</TabsTrigger>
        </TabsList>
        <TabsContent
          value="components"
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <ComponentsSection />
        </TabsContent>
        <TabsContent
          value="assets"
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <AssetsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Components sub-tab ────────────────────────────── */

function ComponentsSection() {
  const { components } = useComponentLibrary();
  return (
    <ScrollArea className="flex-1">
      {components.length === 0 ? (
        <ComponentsEmptyState />
      ) : (
        <ul className="flex flex-col gap-1 p-2">
          {components.map((component) => (
            <LibraryRow key={component.id} component={component} />
          ))}
        </ul>
      )}
    </ScrollArea>
  );
}

function ComponentsEmptyState() {
  return (
    <div className="grid h-full place-items-center px-6 py-16 text-center text-xs text-zinc-500">
      <div className="flex flex-col items-center gap-3">
        <Boxes className="size-8 text-zinc-600" />
        <div>
          <p className="text-zinc-300">No saved components yet.</p>
          <p className="mt-1.5 text-[11px] leading-relaxed">
            Click any element on a design and pick{" "}
            <span className="font-medium text-zinc-300">
              Save as component
            </span>{" "}
            in the inspector. Saved components are reusable across all your
            designs and the agent can drop them in by name.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Assets sub-tab ─────────────────────────────────── */

function AssetsSection() {
  const { assets, registerOptimisticAsset } = useComponentLibrary();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onPickFiles = () => fileInputRef.current?.click();

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    startTransition(async () => {
      for (const file of Array.from(files)) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          // Push the saved row into the optimistic overlay so the
          // asset shows up in the panel immediately (and any agent
          // call to `list_assets` on a parallel turn picks it up)
          // without waiting for revalidatePath('/designs') to flush.
          const saved = await uploadDesignAsset(formData);
          registerOptimisticAsset({
            id: saved.id,
            name: saved.name,
            url: saved.url,
            mimeType: saved.mimeType,
            size: saved.size,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed");
          break;
        }
      }
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="text-[11px] text-zinc-500">
          Upload images the agent can use in your designs.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onPickFiles}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" />
          )}
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            onFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {error ? (
        <p className="mx-3 mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300 [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}

      <ScrollArea className="flex-1">
        {assets.length === 0 ? (
          <AssetsEmptyState />
        ) : (
          <ul className="grid grid-cols-2 gap-2 p-2">
            {assets.map((asset) => (
              <AssetTile key={asset.id} asset={asset} />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

function AssetsEmptyState() {
  return (
    <div className="grid h-full place-items-center px-6 py-16 text-center text-xs text-zinc-500">
      <div className="flex flex-col items-center gap-3">
        <ImagePlus className="size-8 text-zinc-600" />
        <p className="text-zinc-300">No images uploaded yet.</p>
        <p className="text-[11px] leading-relaxed">
          Use the <span className="font-medium text-zinc-300">Upload</span>{" "}
          button to add images. The agent can then drop them into designs
          via{" "}
          <code className="rounded bg-white/10 px-1 font-mono">
            list_assets
          </code>
          .
        </p>
      </div>
    </div>
  );
}

function AssetTile({
  asset,
}: {
  asset: { id: string; name: string; url: string };
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const submitDelete = () => {
    startTransition(async () => {
      try {
        await deleteDesignAsset(asset.id);
      } finally {
        setConfirmOpen(false);
      }
    });
  };

  return (
    <li className="group relative flex flex-col gap-1 rounded-md border border-white/5 bg-white/[0.02] p-1.5">
      <div className="aspect-square w-full overflow-hidden rounded-sm bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.url}
          alt={asset.name}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex items-center justify-between gap-1">
        <span
          className="truncate text-[11px] text-zinc-300"
          title={asset.name}
        >
          {asset.name}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-red-300 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-200 group-hover:opacity-100"
          onClick={() => setConfirmOpen(true)}
          aria-label={`Delete ${asset.name}`}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this image?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-zinc-100">{asset.name}</span>{" "}
              will be removed from your library and from blob storage.
              Designs that reference its URL will show a broken image.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                submitDelete();
              }}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function LibraryRow({
  component,
}: {
  component: { id: string; name: string; slug: string };
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftName, setDraftName] = useState(component.name);
  const [pending, startTransition] = useTransition();

  const submitRename = () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === component.name) {
      setRenameOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        await renameDesignComponent(component.id, trimmed);
      } finally {
        setRenameOpen(false);
      }
    });
  };

  const submitDelete = () => {
    startTransition(async () => {
      try {
        await deleteDesignComponent(component.id);
      } finally {
        setDeleteOpen(false);
      }
    });
  };

  return (
    <li className="group flex items-center justify-between gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2 transition-colors hover:bg-white/[0.04]">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-zinc-100">{component.name}</span>
        <span className="truncate font-mono text-[10px] text-zinc-500">
          {component.slug}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${component.name}`}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setDraftName(component.name);
              setRenameOpen(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename component</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
            className="flex flex-col gap-3"
          >
            <div className="grid gap-2">
              <Label htmlFor={`rename-comp-${component.id}`}>Name</Label>
              <Input
                id={`rename-comp-${component.id}`}
                value={draftName}
                autoFocus
                onChange={(event) => setDraftName(event.target.value)}
                disabled={pending}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !draftName.trim()}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this component?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-zinc-100">
                {component.name}
              </span>{" "}
              will be removed from your library. Existing designs that
              reference it will show a missing-component placeholder until
              the references are removed or the agent regenerates them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                submitDelete();
              }}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
