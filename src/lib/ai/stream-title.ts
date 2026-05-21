import { createUIMessageStream, type UIMessageChunk } from "ai";

/**
 * Wrap a UI message stream so that the first chunk is a transient
 * data part carrying the auto-generated title. The client reads this
 * via `useChat({ onData })` and updates the page header in real time
 * without waiting for a full reload.
 *
 * The data part is marked `transient: true` so it doesn't pollute the
 * persisted message history — it's purely a server-to-client signal.
 *
 * @param upstream — the raw stream from `handleChatStream`.
 * @param title — the AI-generated title to surface.
 */
export function wrapStreamWithTitle(
  upstream: ReadableStream<UIMessageChunk>,
  title: string,
): ReadableStream<UIMessageChunk> {
  return createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({
        type: "data-titleUpdate",
        data: { title },
        transient: true,
      } as unknown as UIMessageChunk);
      writer.merge(upstream);
    },
  });
}
