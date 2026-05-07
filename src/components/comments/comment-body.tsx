import { RichTextRender } from "@/components/markdown/rich-text-render";

export interface CommentBodyProps {
  body: string;
}

/**
 * Renders a comment body. Hands off to {@link RichTextRender} which
 * detects HTML (the new TipTap-backed comment composer outputs HTML)
 * vs plain markdown (legacy comments stored before the WYSIWYG switch)
 * and renders accordingly.
 */
export function CommentBody({ body }: CommentBodyProps) {
  return <RichTextRender body={body} />;
}
