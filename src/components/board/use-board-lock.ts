"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  claimBoardLock,
  heartbeatBoardLock,
  releaseBoardLock,
  takeoverBoardLock,
} from "@/app/(app)/boards/actions";

interface LockInfo {
  userId: string;
  name: string;
  username: string | null;
}

const HEARTBEAT_MS = 10_000;
const CLAIM_RETRY_MS = 3_000;

export function useBoardLock(boardId: string) {
  const [lockedByOther, setLockedByOther] = useState<LockInfo | null>(null);
  const [ownLock, setOwnLock] = useState(false);
  const [loading, setLoading] = useState(true);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const claimRef = useRef<(() => Promise<boolean>) | null>(null);

  const claim = useCallback(async () => {
    try {
      const result = await claimBoardLock(boardId);
      if (result.ok) {
        setOwnLock(true);
        setLockedByOther(null);
        return true;
      }
      if (result.lockedBy) {
        setLockedByOther({
          userId: "",
          name: result.lockedBy.name,
          username: result.lockedBy.username,
        });
        setOwnLock(false);
        retryRef.current = setTimeout(
          () => claimRef.current?.(),
          CLAIM_RETRY_MS,
        );
      }
      return false;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    claimRef.current = claim;
  });

  const release = useCallback(() => {
    void releaseBoardLock(boardId).catch(() => {});
    setOwnLock(false);
  }, [boardId]);

  const takeOver = useCallback(async () => {
    try {
      await takeoverBoardLock(boardId);
      setOwnLock(true);
      setLockedByOther(null);
    } catch {
      // ignore
    }
  }, [boardId]);

  // Claim on mount, release on unmount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void claim();
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
      void releaseBoardLock(boardId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // Heartbeat while we hold the lock
  useEffect(() => {
    if (!ownLock) return;
    heartbeatRef.current = setInterval(() => {
      void heartbeatBoardLock(boardId).catch(() => {});
    }, HEARTBEAT_MS);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [ownLock, boardId]);

  return { loading, ownLock, lockedByOther, takeOver, release };
}
