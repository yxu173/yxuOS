/**
 * Type definitions shared across the custom design canvas.
 *
 * The DesignNode tree (the agent's actual artistic output) lands in
 * commit 4 — for now an artboard's `design` is just an opaque container
 * we render as a placeholder.
 */

import type { CSSProperties } from "react";

export type DevicePreset =
  | "desktop"
  | "laptop"
  | "tablet"
  | "mobile"
  | "custom";

export const DEVICE_DIMENSIONS: Record<
  Exclude<DevicePreset, "custom">,
  { w: number; h: number; label: string }
> = {
  desktop: { w: 1440, h: 900, label: "Desktop · 1440×900" },
  laptop: { w: 1280, h: 800, label: "Laptop · 1280×800" },
  tablet: { w: 768, h: 1024, label: "Tablet · 768×1024" },
  mobile: { w: 393, h: 852, label: "Mobile · 393×852" },
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
}

/**
 * Root of an artboard's design tree. For now keep this loose; we narrow
 * to a strict `DesignNode` discriminated union in commit 4.
 */
export interface DesignNodeRoot {
  type: string;
  style?: CSSProperties;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: any[];
  // Allow arbitrary extra props per type at this stage.
  [key: string]: unknown;
}

/**
 * Camera (viewport) — controls the visible region of world space.
 * `zoom = 1` is 1 world px per CSS px; `zoom < 1` zooms out.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
