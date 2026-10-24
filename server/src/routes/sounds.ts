import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  type SoundListResponse,
  type SoundPatch,
  type Visibility,
} from "@soundboard/shared";
import { AudioError, probeDuration, transcodeToOggOpus } from "../audio.ts";
import { requireGuild } from "../context.ts";
import { BUCKET, db, unwrap } from "../db.ts";
import { ensureGuildSettings } from "../guilds.ts";
import { sendError } from "../http.ts";
import { forgetSound, localFile, removeSoundFromPlayback } from "../player.ts";
import { getSound, listSounds, toSound, type SoundRow, type SoundSort } from "../sounds.ts";

export const soundsRouter = Router({ mergeParams: true });
soundsRouter.use(requireGuild);

const UPLOAD_DIR = join(tmpdir(), "soundboard-uploads");
const HARD_LIMIT_BYTES = 10 * 1024 * 1024; // 서버 설정과 무관한 절대 상한

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await mkdir(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: HARD_LIMIT_BYTES, files: 1 },
});

function receiveFile(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return sendError(res, "FILE_TOO_LARGE", "파일이 너무 커요.");
    }
    if (err) return next(err);
    next();
  });
}

function validName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 50 ? name : null;
}

async function categoryBelongsToGuild(guildId: string, categoryId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(categoryId)) return false;
  const row = unwrap(
    await db.from("sound_categories").select("id").eq("guild_id", guildId).eq("id", categoryId).maybeSingle(),
  );
  return row !== null;
}

// GET /guilds/:guildId/sounds?q=&categoryId=&sort=recent|popular|name
soundsRouter.get("/sounds", async (req, res) => {
  const { guildId, profileId, access } = req.ctx!;
  const sort = (["recent", "popular", "name"] as const).includes(req.query.sort as SoundSort)
    ? (req.query.sort as SoundSort)
    : "recent";
  const rows = await listSounds(guildId, profileId, {
    q: typeof req.query.q === "string" ? req.query.q.trim().slice(0, 50) : undefined,
    categoryId: typeof req.query.categoryId === "string" ? req.query.categoryId : undefined,
    sort,
  });
  const body: SoundListResponse = { items: rows.map((r) => toSound(r, profileId, access.canManage)) };
  res.json(body);
});

// GET /guilds/:guildId/sounds/:soundId
soundsRouter.get("/sounds/:soundId", async (req, res) => {
  const { guildId, profileId, access } = req.ctx!;
  const row = await getSound(guildId, String(req.params.soundId), profileId);
  if (!row) return sendError(res, "NOT_FOUND", "사운드를 찾을 수 없어요.");
  res.json(toSound(row, profileId, access.canManage));
});

// GET /guilds/:guildId/sounds/:soundId/audio — 미리듣기. Activity CSP 때문에 Storage URL 대신 서버가 직접 스트리밍
soundsRouter.get("/sounds/:soundId/audio", async (req, res) => {
  const { guildId, profileId } = req.ctx!;
  const row = await getSound(guildId, String(req.params.soundId), profileId);
  if (!row) return sendError(res, "NOT_FOUND", "사운드를 찾을 수 없어요.");
  const path = await localFile({ id: row.id, storagePath: row.storage_path });
  res.setHeader("Content-Type", "audio/ogg");
  res.setHeader("Cache-Control", "private, max-age=3600");
  createReadStream(path).pipe(res);
});

// POST /guilds/:guildId/sounds  (multipart: file, name, categoryId?, visibility?)
soundsRouter.post("/sounds", receiveFile, async (req, res) => {
  const { guildId, profileId, access } = req.ctx!;
  const file = req.file;
  const converted = file ? `${file.path}.ogg` : null;

  try {
    if (!access.canUpload) return sendError(res, "FORBIDDEN", "이 서버에서는 관리자만 업로드할 수 있어요.");
    if (!file) return sendError(res, "VALIDATION_ERROR", "파일을 선택해 주세요.");

    const settings = await ensureGuildSettings(guildId);
    const mb = (settings.maxFileSizeBytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "");
    if (file.size > settings.maxFileSizeBytes) {
      return sendError(res, "FILE_TOO_LARGE", `파일은 ${mb}MB까지 올릴 수 있어요.`);
    }

    // multer는 원래 파일명을 latin1로 넘겨주므로 한글 파일명을 복원
    const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
    const ext = extname(originalName).slice(1).toLowerCase();
    if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
      return sendError(res, "UNSUPPORTED_FORMAT", `${ALLOWED_UPLOAD_EXTENSIONS.join(", ").toUpperCase()} 파일만 올릴 수 있어요.`);
    }

    const name = validName(req.body.name) ?? validName(originalName.replace(/\.[^.]+$/, ""));
    if (!name) return sendError(res, "VALIDATION_ERROR", "이름은 1~50자로 입력해 주세요.");

    const categoryId = typeof req.body.categoryId === "string" && req.body.categoryId ? req.body.categoryId : null;
    if (categoryId && !(await categoryBelongsToGuild(guildId, categoryId))) {
      return sendError(res, "VALIDATION_ERROR", "없는 카테고리예요.");
    }
    const visibility: Visibility = req.body.visibility === "private" ? "private" : "guild";

    let duration: number;
    try {
      duration = await probeDuration(file.path);
    } catch (e) {
      if (e instanceof AudioError) return sendError(res, "UNSUPPORTED_FORMAT", e.message);
      throw e;
    }
    if (duration > settings.maxDurationSeconds + 0.05) {
      return sendError(
        res,
        "FILE_TOO_LARGE",
        `${settings.maxDurationSeconds}초까지 올릴 수 있어요. (이 파일: ${duration.toFixed(1)}초)`,
      );
    }

    try {
      await transcodeToOggOpus(file.path, converted!);
    } catch (e) {
      if (e instanceof AudioError) return sendError(res, "UNSUPPORTED_FORMAT", e.message);
      throw e;
    }

    const id = randomUUID();
    const storagePath = `${guildId}/${id}.ogg`;
    const [bytes, info] = await Promise.all([readFile(converted!), stat(converted!)]);

    const uploaded = await db.storage.from(BUCKET).upload(storagePath, bytes, { contentType: "audio/ogg", upsert: false });
    if (uploaded.error) throw new Error(`Storage 업로드 실패: ${uploaded.error.message}`);

    // DB 등록이 실패하면 방금 올린 파일을 지워 고아 파일을 남기지 않음
    const inserted = await db
      .from("sounds")
      .insert({
        id,
        guild_id: guildId,
        category_id: categoryId,
        name,
        storage_path: storagePath,
        mime_type: "audio/ogg",
        duration_seconds: Math.round(duration * 100) / 100,
        file_size_bytes: info.size,
        visibility,
        uploaded_by: profileId,
      })
      .select("id")
      .single();
    if (inserted.error) {
      await db.storage.from(BUCKET).remove([storagePath]);
      throw new Error(`사운드 등록 실패: ${inserted.error.message}`);
    }

    const row = (await getSound(guildId, id, profileId)) as SoundRow;
    res.status(201).json(toSound(row, profileId, access.canManage));
  } finally {
    if (file) await rm(file.path, { force: true });
    if (converted) await rm(converted, { force: true });
  }
});

// PATCH /guilds/:guildId/sounds/:soundId
soundsRouter.patch("/sounds/:soundId", async (req, res) => {
  const { guildId, profileId, access } = req.ctx!;
  const row = await getSound(guildId, String(req.params.soundId), profileId);
  if (!row) return sendError(res, "NOT_FOUND", "사운드를 찾을 수 없어요.");
  if (!toSound(row, profileId, access.canManage).canEdit) {
    return sendError(res, "FORBIDDEN", "올린 사람이나 관리자만 수정할 수 있어요.");
  }

  const body = (req.body ?? {}) as SoundPatch;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = validName(body.name);
    if (!name) return sendError(res, "VALIDATION_ERROR", "이름은 1~50자로 입력해 주세요.");
    patch.name = name;
  }
  if (body.categoryId !== undefined) {
    if (body.categoryId !== null && !(await categoryBelongsToGuild(guildId, body.categoryId))) {
      return sendError(res, "VALIDATION_ERROR", "없는 카테고리예요.");
    }
    patch.category_id = body.categoryId;
  }
  if (body.visibility !== undefined) {
    if (body.visibility !== "private" && body.visibility !== "guild") {
      return sendError(res, "VALIDATION_ERROR", "공개 범위가 올바르지 않아요.");
    }
    patch.visibility = body.visibility;
  }

  unwrap(await db.from("sounds").update(patch).eq("id", row.id).eq("guild_id", guildId));
  const updated = (await getSound(guildId, row.id, profileId)) as SoundRow;
  res.json(toSound(updated, profileId, access.canManage));
});

// DELETE /guilds/:guildId/sounds/:soundId
soundsRouter.delete("/sounds/:soundId", async (req, res) => {
  const { guildId, profileId, access } = req.ctx!;
  const row = await getSound(guildId, String(req.params.soundId), profileId);
  if (!row) return sendError(res, "NOT_FOUND", "사운드를 찾을 수 없어요.");
  if (!toSound(row, profileId, access.canManage).canEdit) {
    return sendError(res, "FORBIDDEN", "올린 사람이나 관리자만 삭제할 수 있어요.");
  }

  // 순서: 목록에서 숨김 → 재생 중이면 빼기 → 파일 삭제 (파일 삭제가 실패해도 사용자에게는 이미 사라진 상태)
  unwrap(
    await db.from("sounds").update({ deleted_at: new Date().toISOString() }).eq("id", row.id).eq("guild_id", guildId),
  );
  removeSoundFromPlayback(guildId, row.id);
  const removed = await db.storage.from(BUCKET).remove([row.storage_path]);
  if (removed.error) console.error("[sounds] Storage 파일 삭제 실패 (재시도 필요)", row.storage_path, removed.error.message);
  await forgetSound(row.id);
  res.status(204).end();
});
