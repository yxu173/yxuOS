"use server";

import { put } from "@vercel/blob";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { attachments } from "@/db/schema";
import { env } from "@/lib/env";
import { requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultProject } from "@/lib/projects";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — generous for paste-from-clipboard PNGs.
const ALLOWED_PREFIX = "image/";

function requireBlobToken(): string {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "Image uploads aren't configured. Set BLOB_READ_WRITE_TOKEN in .env.local — see .env.example.",
    );
  }
  return env.BLOB_READ_WRITE_TOKEN;
}

export interface UploadAttachmentResult {
  /** Public CDN URL — drop directly into a markdown `![](url)`. */
  url: string;
  /** Original file name, used as the markdown alt text. */
  name: string;
  /** Mime type — caller can use this to filter (only embed images). */
  mimeType: string;
}

/**
 * Uploads a single image to Vercel Blob and records it in the
 * `attachments` table for the active team.
 *
 * Generic — not tied to any specific subject (task, comment, etc.). The
 * caller embeds the returned URL into a markdown body. Future cleanup
 * sweeps can scan blob storage against this table to drop orphans.
 */
export async function uploadAttachment(
  formData: FormData,
): Promise<UploadAttachmentResult> {
  const { session, teamId } = await requireActiveTeam();
  const token = requireBlobToken();
  const project = await ensureDefaultProject(teamId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("No file provided");
  }
  if (!file.type.startsWith(ALLOWED_PREFIX)) {
    throw new Error(
      `Only images are supported (got ${file.type || "unknown"})`,
    );
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image too large (max 10 MB)");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "image";
  const pathname = `attachments/${teamId}/${nanoid(10)}-${safeName}`;

  const blob = await put(pathname, file, {
    access: "public",
    contentType: file.type,
    token,
  });

  await db.insert(attachments).values({
    teamId,
    projectId: project.id,
    uploaderId: session.user.id,
    name: file.name,
    pathname: blob.pathname,
    url: blob.url,
    mimeType: file.type,
    size: file.size,
  });

  return {
    url: blob.url,
    name: file.name,
    mimeType: file.type,
  };
}
