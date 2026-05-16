"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/db";
import { researchNotes, type ResearchNoteStatus } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { requireActiveProject, requireActiveTeam } from "@/lib/permissions";
import {
  indexResearchNote,
  unindexResearchNote,
} from "@/lib/rag/indexers/research-note";

/* ─── constraints ─────────────────────────────────── */

const MAX_TITLE = 200;
const MAX_BODY = 64 * 1024; // 64 KB cap — keeps notes a doc, not a wiki dump

const VALID_STATUSES: ResearchNoteStatus[] = ["draft", "reviewed", "archived"];

/* ─── shapes ──────────────────────────────────────── */

export interface ResearchNoteSummary {
  id: string;
  title: string;
  /** First non-empty line of the body, capped to ~140 chars. */
  preview: string;
  status: ResearchNoteStatus;
  authorId: string;
  authorName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResearchNoteDetail extends ResearchNoteSummary {
  body: string;
  threadId: string;
  /** Owning project, surfaced on the page so the agent route knows scope. */
  projectId: string;
  projectSlug: string;
  agentMeta: Record<string, unknown> | null;
}

/* ─── create ──────────────────────────────────────── */

export interface CreateResearchNoteInput {
  projectSlug: string;
  /** Optional initial title. Defaults to the schema's "Untitled research". */
  title?: string;
  /** Optional initial body markdown. */
  body?: string;
}

export async function createResearchNote(
  input: CreateResearchNoteInput,
): Promise<{ id: string }> {
  const { session, teamId, projectId, projectSlug } =
    await requireActiveProject(input.projectSlug);

  const trimmedTitle = input.title?.trim().slice(0, MAX_TITLE) ?? "";
  const trimmedBody = (input.body ?? "").slice(0, MAX_BODY);

  const [created] = await db
    .insert(researchNotes)
    .values({
      teamId,
      projectId,
      authorId: session.user.id,
      // Only override the schema default when the caller actually
      // supplied a title — keeps the "Untitled research" fallback in
      // one place (the schema) instead of duplicated here.
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
      ...(trimmedBody ? { body: trimmedBody } : {}),
    })
    .returning({ id: researchNotes.id });

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "created",
    subjectType: "research_note",
    subjectId: created.id,
    subjectName: trimmedTitle || "Untitled research",
  });

  // Brain indexing happens after the response. The create path is
  // usually a no-op (empty body), but if the caller supplied an
  // initial title/body it gets embedded for free — plus this
  // keeps create + update symmetric.
  after(() => indexResearchNote(created.id));

  revalidatePath(`/p/${projectSlug}/research`);
  return { id: created.id };
}

/* ─── update ──────────────────────────────────────── */

export interface UpdateResearchNoteInput {
  id: string;
  title?: string;
  body?: string;
  status?: ResearchNoteStatus;
}

export async function updateResearchNote(
  input: UpdateResearchNoteInput,
): Promise<void> {
  const { session, teamId } = await requireActiveTeam();

  const note = await db.query.researchNotes.findFirst({
    where: and(
      eq(researchNotes.id, input.id),
      eq(researchNotes.teamId, teamId),
    ),
    columns: { id: true, projectId: true, title: true },
    with: { project: { columns: { slug: true } } },
  });
  if (!note) throw new Error("Research note not found");

  const patch: Partial<typeof researchNotes.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (typeof input.title === "string") {
    patch.title =
      input.title.trim().slice(0, MAX_TITLE) || "Untitled research";
  }
  if (typeof input.body === "string") {
    patch.body = input.body.slice(0, MAX_BODY);
  }
  if (input.status && VALID_STATUSES.includes(input.status)) {
    patch.status = input.status;
  }

  await db
    .update(researchNotes)
    .set(patch)
    .where(eq(researchNotes.id, input.id));

  // Re-index the brain. Covers title, body, and status changes —
  // archiving pulls the chunks out via the indexer's archived
  // self-heal branch, so we always schedule on any update.
  after(() => indexResearchNote(input.id));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "updated",
    subjectType: "research_note",
    subjectId: input.id,
    subjectName: patch.title ?? note.title,
  });

  if (note.project?.slug) {
    revalidatePath(`/p/${note.project.slug}/research`);
    revalidatePath(`/p/${note.project.slug}/research/${input.id}`);
  }
}

/* ─── delete ──────────────────────────────────────── */

export async function deleteResearchNote(noteId: string): Promise<void> {
  const { session, teamId } = await requireActiveTeam();

  const note = await db.query.researchNotes.findFirst({
    where: and(
      eq(researchNotes.id, noteId),
      eq(researchNotes.teamId, teamId),
    ),
    columns: { id: true, title: true },
    with: { project: { columns: { slug: true } } },
  });
  if (!note) throw new Error("Research note not found");

  await db.delete(researchNotes).where(eq(researchNotes.id, noteId));

  // Drop every chunk for this note from the brain. Scheduled
  // after the response so the delete UX stays snappy.
  after(() => unindexResearchNote(noteId));

  await logActivity({
    teamId,
    actorId: session.user.id,
    verb: "deleted",
    subjectType: "research_note",
    subjectId: noteId,
    subjectName: note.title,
  });

  if (note.project?.slug) {
    revalidatePath(`/p/${note.project.slug}/research`);
  }
}

/* ─── reads ───────────────────────────────────────── */

/**
 * List every research note inside a project, newest-first. Used by the
 * `/p/<slug>/research` index. Returns a lightweight summary; full body
 * is loaded on the detail page.
 */
export async function listResearchNotesForProject(
  projectId: string,
): Promise<ResearchNoteSummary[]> {
  const rows = await db.query.researchNotes.findMany({
    where: eq(researchNotes.projectId, projectId),
    orderBy: [desc(researchNotes.updatedAt)],
    with: { author: { columns: { id: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    preview: extractPreview(r.body),
    status: r.status as ResearchNoteStatus,
    authorId: r.authorId,
    authorName: r.author?.name ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Load one note with full body + project slug. Throws if the note
 * isn't on the active team — the page-level redirect / 404 turns
 * that into a not-found surface.
 */
export async function getResearchNote(
  noteId: string,
): Promise<ResearchNoteDetail> {
  const { teamId } = await requireActiveTeam();

  const row = await db.query.researchNotes.findFirst({
    where: and(
      eq(researchNotes.id, noteId),
      eq(researchNotes.teamId, teamId),
    ),
    with: {
      author: { columns: { id: true, name: true } },
      project: { columns: { id: true, slug: true } },
    },
  });
  if (!row) throw new Error("Research note not found");

  return {
    id: row.id,
    title: row.title,
    preview: extractPreview(row.body),
    status: row.status as ResearchNoteStatus,
    authorId: row.authorId,
    authorName: row.author?.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    body: row.body,
    threadId: row.threadId,
    projectId: row.project?.id ?? "",
    projectSlug: row.project?.slug ?? "",
    agentMeta: row.agentMeta,
  };
}

/* ─── helpers ─────────────────────────────────────── */

function extractPreview(body: string): string {
  // First non-empty line, with markdown heading markers stripped so
  // a body that starts with "# Question" doesn't preview as "#
  // Question".
  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "";
  const cleaned = firstLine.replace(/^#+\s+/, "").trim();
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned;
}
