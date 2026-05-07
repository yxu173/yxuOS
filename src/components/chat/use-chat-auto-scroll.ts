"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from "react";

/**
 * Distance from the bottom (in pixels) within which we consider the user
 * to be "at the bottom" of the conversation. Messages auto-scroll only
 * while the user is parked here; once they scroll up to read history we
 * stop yanking the viewport on every new chunk.
 */
const STICK_THRESHOLD = 96;

export interface ChatAutoScrollAPI {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** True when the user is parked at (or very close to) the bottom. */
  isAtBottom: boolean;
  /** Wire onto the scroll container so we know when to detach. */
  onScroll: React.UIEventHandler<HTMLDivElement>;
  /** Imperatively jump to the bottom (smooth). */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

/**
 * Smart chat auto-scroll.
 *
 * - Pins the viewport to the bottom while new messages stream in IF the
 *   user is already there (within `STICK_THRESHOLD`). Otherwise it leaves
 *   the user where they are so they can read history without their place
 *   being stolen.
 * - Returns an `isAtBottom` flag callers can use to decide whether to
 *   surface a "scroll to latest" pill.
 *
 * @param deps - Whatever changes when new messages or streaming chunks
 *   arrive (typically `[messages, streamingState]`). Each change retriggers
 *   the auto-scroll attempt.
 */
export function useChatAutoScroll(deps: DependencyList): ChatAutoScrollAPI {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= STICK_THRESHOLD;
  }, []);

  const onScroll = useCallback<React.UIEventHandler<HTMLDivElement>>(() => {
    const next = measure();
    if (isAtBottomRef.current !== next) {
      isAtBottomRef.current = next;
      setIsAtBottom(next);
    }
  }, [measure]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  // Pin to bottom whenever the dependency list changes — but only if the
  // user was already there. We deliberately avoid `behavior: "smooth"`
  // during streaming so each token bump doesn't queue up an animation.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, deps);
  /* eslint-enable react-hooks/exhaustive-deps */

  return { containerRef, isAtBottom, onScroll, scrollToBottom };
}
