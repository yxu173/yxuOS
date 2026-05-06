import { Whiteboard } from "@/components/board/whiteboard";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;

  return <Whiteboard boardId={boardId} />;
}
