"use server";

import { del, put } from "@vercel/blob";
import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { designAssets } from "@/db/schema";
import { env } from "@/lib/env";
import { requireActiveTeam } from "@/lib/permissions";

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

/**
 * Uploads a single image file to Vercel Blob and records it in the
 * `design_assets` table scoped to the active team.
 */
export async function uploadDesignAsset(
  formData: FormData,
): Promise<{
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
}> {
  const { session, teamId } = await requireActiveTeam();
  const token = requireBlobToken();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("No file provided");
  }
  if (!file.type.startsWith(ALLOWED_MIME_PREFIX)) {
    throw new Error(`Only images are allowed (got ${file.type || "unknown"})`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image too large (max 5 MB)");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "asset";
  // Keep the per-team prefix so blobs are easy to reason about in the
  // dashboard, even though the user uploading is the creator.
  const pathname = `designs/${teamId}/${nanoid(10)}-${safeName}`;

  const blob = await put(pathname, file, {
    access: "public",
    contentType: file.type,
    token,
  });

  const [row] = await db
    .insert(designAssets)
    .values({
      ownerId: session.user.id,
      teamId,
      name: file.name,
      pathname: blob.pathname,
      url: blob.url,
      mimeType: file.type,
      size: file.size,
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

export async function listDesignAssetsForTeam(teamId: string) {
  return db.query.designAssets.findMany({
    where: eq(designAssets.teamId, teamId),
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
