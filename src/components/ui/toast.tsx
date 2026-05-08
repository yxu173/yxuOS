"use client";

import {
  AlertCircle,
  CheckCircle2,
  Info,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Tiny in-app toast system.
 *
 * Designed as a one-file primitive so we don't pull in `sonner` or
 * `react-hot-toast` for what is, in this app, a handful of "saved /
 * deleted / created N tasks" messages. Three flavours (`success`,
 * `error`, `info`), an auto-dismiss timer, and a manual close affordance.
 *
 * Usage:
 *
 *   1. Wrap the app shell (or just the page) in `<Toaster />`.
 *   2. Anywhere below it, call `useToast()` and trigger:
 *        const toast = useToast();
 *        toast.success("Created 7 tasks");
 *        toast.error("Couldn't remove row.");
 *
 * The hook is null-safe outside the provider — calls become no-ops.
 * That keeps callers from having to special-case server-rendered
 * tests or stories where `<Toaster />` isn't mounted.
 */

export type ToastKind = "success" | "error" | "info";

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  /** Milliseconds before auto-dismiss. 0 = sticky. */
  duration: number;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 4000;

/**
 * Provider + visual root for toasts. Mount once near the app root.
 *
 * Toasts stack bottom-right; oldest at the bottom. We cap the visible
 * list at 4 (older toasts get popped) so a runaway action loop can't
 * wallpaper the screen.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<ToastContextValue["push"]>(
    (kind, message, duration = DEFAULT_DURATION) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((prev) => {
        const next = [...prev, { id, kind, message, duration }];
        return next.length > 4 ? next.slice(next.length - 4) : next;
      });
      if (duration > 0) {
        // Schedule via setTimeout instead of an effect so each toast
        // owns its own clock — pushing a new toast doesn't reset the
        // timers of in-flight ones.
        window.setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  // The provider value is referentially stable so consumers don't
  // re-render whenever a new toast pushes.
  const value = useMemo<ToastContextValue>(() => ({ push }), [push]);

  // Install a global hook so non-React utilities (e.g. action
  // result helpers) can fire toasts without threading the
  // dispatcher through props. Cleared on unmount.
  useEffect(() => {
    globalToast = { push };
    return () => {
      globalToast = null;
    };
  }, [push]);

  return (
    <ToastContext.Provider value={value}>
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col-reverse gap-2"
      >
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const KIND_META: Record<
  ToastKind,
  { icon: LucideIcon; iconClass: string; ring: string }
> = {
  success: {
    icon: CheckCircle2,
    iconClass: "text-emerald-400",
    ring: "border-emerald-500/30",
  },
  error: {
    icon: AlertCircle,
    iconClass: "text-red-400",
    ring: "border-red-500/30",
  },
  info: {
    icon: Info,
    iconClass: "text-zinc-300",
    ring: "border-white/10",
  },
};

function ToastView({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: (id: number) => void;
}) {
  const meta = KIND_META[toast.kind];
  const Icon = meta.icon;
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-md border bg-zinc-950/95 px-3 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur",
        meta.ring,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", meta.iconClass)} />
      <p className="flex-1 leading-snug">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 rounded p-0.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** Internal global ref so non-hook callers can still fire toasts. */
let globalToast: ToastContextValue | null = null;

/**
 * Hook into the toast system. Returns a stable object with helpers
 * for each flavour. Outside a `<Toaster />` (e.g. tests, stories),
 * the helpers no-op so callers don't have to gate on existence.
 */
export function useToast(): {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
} {
  const ctx = useContext(ToastContext);
  return useMemo(() => {
    const fire = (kind: ToastKind) => (message: string, duration?: number) => {
      const target = ctx ?? globalToast;
      if (!target) return; // No provider mounted — silent no-op.
      target.push(kind, message, duration);
    };
    return {
      success: fire("success"),
      error: fire("error"),
      info: fire("info"),
    };
  }, [ctx]);
}
