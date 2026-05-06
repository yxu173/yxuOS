"use client";

import { Check, Copy, Globe, Link2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import {
  disableDesignShare,
  enableDesignShare,
} from "@/app/(app)/designs/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface DesignShareDialogProps {
  designId: string;
  initialShareToken: string | null;
}

export function DesignShareDialog({
  designId,
  initialShareToken,
}: DesignShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(initialShareToken);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );

  const shareUrl = token && origin ? `${origin}/share/design/${token}` : "";

  const enable = () => {
    startTransition(async () => {
      const newToken = await enableDesignShare(designId);
      setToken(newToken);
    });
  };

  const disable = () => {
    startTransition(async () => {
      await disableDesignShare(designId);
      setToken(null);
    });
  };

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Share design">
          <Link2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-4" />
            Share this design
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can view the design, read-only. Chat
            history stays private.
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <>
            <div className="flex gap-2">
              <Input
                readOnly
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={copy}
                title="Copy link"
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={disable}
                disabled={pending}
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Disable link
              </Button>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <DialogFooter>
            <Button type="button" onClick={enable} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create share link
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
