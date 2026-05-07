export interface CommentAuthor {
  id: string;
  name: string;
  username: string | null;
}

export interface CommentItemData {
  id: string;
  body: string;
  /** Shape id (board) or DesignNode id (design); null = surface-level. */
  targetId: string | null;
  createdAt: Date;
  author: CommentAuthor;
  /** True if the current viewer authored this comment. */
  isYou: boolean;
}

export interface MentionTarget {
  userId: string;
  name: string;
  username: string | null;
}
