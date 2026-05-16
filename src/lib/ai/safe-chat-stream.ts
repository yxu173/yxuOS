import { createUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";

import { classifyChatError, toErrorText } from "./friendly-error";

/**
 * Wrap a `handleChatStream` result with friendly error handling.
 *
 * `handleChatStream` (from `@mastra/ai-sdk`) returns a raw
 * `ReadableStream<UIMessageChunk>` produced by `streamText`. When the
 * upstream provider (e.g. Azure Anthropic) rejects mid-stream — most
 * commonly with 429s during traffic bursts — the AI SDK pipes the
 * raw `AI_APICallError` JSON down to the client. That JSON ends up
 * in `useChat`'s `error.message`, where it's rendered as a wall of
 * implementation detail in the chat sidebar.
 *
 * This helper interposes a `createUIMessageStream` wrapper whose
 * `onError` hook routes every failure through `toErrorText` — a
 * one-line, plain-English message classified by `friendly-error.ts`.
 * The client only ever sees that string.
 *
 *   const upstream = await handleChatStream({...});
 *   const stream = safeChatStream(upstream);
 *   return createUIMessageStreamResponse({ stream });
 *
 * As a bonus, we log the *real* error to the server console so we
 * can still debug rate-limit / provider issues from the logs without
 * leaking them to the UI.
 */
export function safeChatStream(
  upstream: ReadableStream<UIMessageChunk>,
): ReadableStream<UIMessageChunk> {
  return createUIMessageStream<UIMessage>({
    // `writer.merge` forwards every chunk from the upstream
    // `streamText` output. Any rejection propagates into the
    // wrapping stream and is intercepted by `onError` below.
    execute: ({ writer }) => {
      writer.merge(upstream as ReadableStream<UIMessageChunk>);
    },
    onError: (error) => {
      // Log the full classification + raw error server-side. The
      // client only gets the friendly string returned below.
      const friendly = classifyChatError(error);
      console.warn(
        `[chat-stream] ${friendly.kind}: ${friendly.message}`,
        error,
      );
      return toErrorText(error);
    },
  });
}
