/**
 * Type definitions shared across the custom design canvas.
 *
 * The full `DesignNode` discriminated union lives in `design-node.ts`;
 * this file re-exports it as `DesignNodeRoot` for the artboard so the
 * existing imports keep working.
 */

import type { DesignNode } from "./design-node";

export type DevicePreset =
  | "desktop"
  | "laptop"
  | "macbook-16"
  | "ultrawide"
  | "tablet"
  | "ipad-pro"
  | "mobile"
  | "mobile-landscape"
  | "watch"
  | "custom";

export const DEVICE_DIMENSIONS: Record<
  Exclude<DevicePreset, "custom">,
  { w: number; h: number; label: string }
> = {
  desktop: { w: 1440, h: 900, label: "Desktop · 1440×900" },
  laptop: { w: 1280, h: 800, label: "Laptop · 1280×800" },
  "macbook-16": { w: 1728, h: 1117, label: "MacBook 16\" · 1728×1117" },
  ultrawide: { w: 2560, h: 1080, label: "Ultrawide · 2560×1080" },
  tablet: { w: 768, h: 1024, label: "Tablet · 768×1024" },
  "ipad-pro": { w: 1024, h: 1366, label: "iPad Pro · 1024×1366" },
  mobile: { w: 393, h: 852, label: "Mobile · 393×852" },
  "mobile-landscape": { w: 852, h: 393, label: "Mobile landscape · 852×393" },
  watch: { w: 198, h: 242, label: "Watch · 198×242" },
};

/**
 * One frame on the design canvas.
 *
 * Position is in *world* coordinates (page space), independent of the
 * camera. Width / height are the artboard's intrinsic dimensions — what
 * the user is "designing for" (e.g. 1440×900 desktop).
 */
export interface Artboard {
  id: string;
  name: string;
  device: DevicePreset;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The mockup itself. Typed as `unknown` until commit 4 lands the
   * DesignNode tree definition.
   */
  design: DesignNodeRoot | null;
  background?: string;
  /**
   * Layout grid overlay (columns / gutters / margins). Stored so the
   * renderer can draw faint guide lines behind the design nodes.
   */
  grid?: {
    columns: number;
    gutter: number;
    margin: number;
    color: string;
  };
  /**
   * When true, the canvas refuses to drag/resize/delete this artboard
   * via direct manipulation — only explicit tool calls (`update_artboard`,
   * `delete_artboard`) can mutate it. Useful for "approved" designs the
   * user wants to protect while iterating on neighbours.
   */
  locked?: boolean;
}

/** Root of an artboard's design tree — any single `DesignNode`. */
export type DesignNodeRoot = DesignNode;

/**
 * Camera (viewport) — controls the visible region of world space.
 * `zoom = 1` is 1 world px per CSS px; `zoom < 1` zooms out.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
