"use server";

import { del, put } from "@vercel/blob";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { designAssets } from "@/db/schema";
import { env } from "@/lib/env";
import { requireActiveTeam } from "@/lib/permissions";
import { ensureDefaultProject } from "@/lib/projects";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_PREFIX = "image/";

function requireBlobToken(): string {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "Asset uploads aren't configured. Set BLOB_READ_WRITE_TOKEN in .env.local — see .env.example.",
    );
  }
  return env.BLOB_READ_WRITE_TOKEN;
}

export interface SavedDesignAsset {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Shared write path: validate, upload to Blob, insert into design_assets.
 * Used by both `uploadDesignAsset` (FormData entry point — library
 * panel manual upload) and `saveDesignAssetFromBytes` (data-URL entry
 * point — `save_attachment_as_asset` tool).
 *
 * Accepts a raw Buffer + metadata so the data-URL path doesn't need to
 * round-trip through `File`. Vercel Blob's `put` accepts Buffer | Blob
 * | string — Buffer is the most direct.
 */
async function persistDesignAsset(input: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
}): Promise<SavedDesignAsset> {
  const { session, teamId } = await requireActiveTeam();
  const token = requireBlobToken();
  const project = await ensureDefaultProject(teamId);

  if (input.bytes.length === 0) {
    throw new Error("No file provided");
  }
  if (!input.mimeType.startsWith(ALLOWED_MIME_PREFIX)) {
    throw new Error(`Only images are allowed (got ${input.mimeType || "unknown"})`);
  }
  if (input.bytes.length > MAX_BYTES) {
    throw new Error("Image too large (max 5 MB)");
  }

  const safeName =
    input.filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "asset";
  // Keep the per-team prefix so blobs are easy to reason about in the
  // dashboard, even though the user uploading is the creator.
  const pathname = `designs/${teamId}/${nanoid(10)}-${safeName}`;

  const blob = await put(pathname, input.bytes, {
    access: "public",
    contentType: input.mimeType,
    token,
  });

  const [row] = await db
    .insert(designAssets)
    .values({
      ownerId: session.user.id,
      teamId,
      projectId: project.id,
      name: input.filename,
      pathname: blob.pathname,
      url: blob.url,
      mimeType: input.mimeType,
      size: input.bytes.length,
    })
    .returning({
      id: designAssets.id,
      url: designAssets.url,
      name: designAssets.name,
      mimeType: designAssets.mimeType,
      size: designAssets.size,
    });

  revalidatePath("/designs");
  return row;
}

/**
 * Uploads a single image file to Vercel Blob and records it in the
 * `design_assets` table scoped to the active team. Used by the library
 * panel's manual upload (paperclip in the inspector).
 */
export async function uploadDesignAsset(
  formData: FormData,
): Promise<SavedDesignAsset> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("No file provided");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return persistDesignAsset({
    bytes: buffer,
    filename: file.name,
    mimeType: file.type,
  });
}

/**
 * Persist an image the user attached in chat (or any other source that
 * already has the bytes as a data URL) into the team's asset library.
 * The agent's `save_attachment_as_asset` tool calls this — sending raw
 * bytes saves the model from echoing the entire base64 payload back as
 * a tool argument.
 *
 * The data URL is parsed server-side; clients hand us the matching
 * FileUIPart's `url` field unmodified.
 */
export async function saveDesignAssetFromDataUrl(input: {
  dataUrl: string;
  filename: string;
}): Promise<SavedDesignAsset> {
  // data:[<mediaType>][;base64],<data>
  // Split on the first comma instead of one regex with a wildcard tail
  // so we don't depend on the /s (dotAll) flag.
  const commaIdx = input.dataUrl.indexOf(",");
  if (!input.dataUrl.startsWith("data:") || commaIdx < 0) {
    throw new Error("Invalid data URL");
  }
  const header = input.dataUrl.slice(5, commaIdx); // between "data:" and ","
  const payload = input.dataUrl.slice(commaIdx + 1);
  const isBase64 = header.endsWith(";base64");
  const mimeType = (isBase64 ? header.slice(0, -7) : header) ||
    "application/octet-stream";

  const bytes = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf-8");

  return persistDesignAsset({
    bytes,
    filename: input.filename,
    mimeType,
  });
}

export async function deleteDesignAsset(assetId: string) {
  const { teamId } = await requireActiveTeam();
  const token = requireBlobToken();

  const asset = await db.query.designAssets.findFirst({
    where: and(
      eq(designAssets.id, assetId),
      eq(designAssets.teamId, teamId),
    ),
    columns: { url: true },
  });
  if (!asset) {
    throw new Error("Asset not found");
  }

  // Delete from Blob first; if that fails, leave the DB row intact so
  // the user can retry rather than losing the metadata.
  await del(asset.url, { token });

  await db
    .delete(designAssets)
    .where(
      and(
        eq(designAssets.id, assetId),
        eq(designAssets.teamId, teamId),
      ),
    );

  revalidatePath("/designs");
}

export async function listDesignAssetsForTeam(
  teamId: string,
  projectId?: string,
) {
  return db.query.designAssets.findMany({
    where: projectId
      ? and(
          eq(designAssets.teamId, teamId),
          eq(designAssets.projectId, projectId),
        )
      : eq(designAssets.teamId, teamId),
    orderBy: asc(designAssets.name),
    columns: {
      id: true,
      name: true,
      url: true,
      mimeType: true,
      size: true,
      updatedAt: true,
    },
  });
}
