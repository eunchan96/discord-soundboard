import { Router } from "express";
import type { Category, CategoryListResponse } from "@soundboard/shared";
import { requireGuild, requireManage } from "../context.ts";
import { db, unwrap } from "../db.ts";
import { sendError } from "../http.ts";

export const categoriesRouter = Router({ mergeParams: true });
categoriesRouter.use(requireGuild);

function validCategoryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 20 ? name : null;
}

const UNIQUE_VIOLATION = "23505";

// GET /guilds/:guildId/categories
categoriesRouter.get("/categories", async (req, res) => {
  const { guildId, profileId } = req.ctx!;
  const categories = unwrap(
    await db.from("sound_categories").select("id, name").eq("guild_id", guildId).order("name"),
  ) as { id: string; name: string }[];

  // 요청자가 볼 수 있는 사운드만 셉니다
  const visible = unwrap(
    await db
      .from("sounds")
      .select("category_id")
      .eq("guild_id", guildId)
      .is("deleted_at", null)
      .or(`visibility.eq.guild,uploaded_by.eq.${profileId}`),
  ) as { category_id: string | null }[];
  const counts = new Map<string, number>();
  for (const s of visible) if (s.category_id) counts.set(s.category_id, (counts.get(s.category_id) ?? 0) + 1);

  const body: CategoryListResponse = {
    items: categories.map((c): Category => ({ id: c.id, name: c.name, soundCount: counts.get(c.id) ?? 0 })),
  };
  res.json(body);
});

// POST /guilds/:guildId/categories
categoriesRouter.post("/categories", requireManage, async (req, res) => {
  const { guildId, profileId } = req.ctx!;
  const name = validCategoryName(req.body?.name);
  if (!name) return sendError(res, "VALIDATION_ERROR", "카테고리 이름은 1~20자로 입력해 주세요.");

  const { data, error } = await db
    .from("sound_categories")
    .insert({ guild_id: guildId, name, created_by: profileId })
    .select("id, name")
    .single();
  if (error?.code === UNIQUE_VIOLATION) return sendError(res, "VALIDATION_ERROR", "이미 있는 카테고리예요.");
  if (error) throw error;
  res.status(201).json({ ...data, soundCount: 0 } satisfies Category);
});

// PATCH /guilds/:guildId/categories/:categoryId
categoriesRouter.patch("/categories/:categoryId", requireManage, async (req, res) => {
  const { guildId } = req.ctx!;
  const name = validCategoryName(req.body?.name);
  if (!name) return sendError(res, "VALIDATION_ERROR", "카테고리 이름은 1~20자로 입력해 주세요.");

  const { data, error } = await db
    .from("sound_categories")
    .update({ name })
    .eq("guild_id", guildId)
    .eq("id", String(req.params.categoryId))
    .select("id, name")
    .maybeSingle();
  if (error?.code === UNIQUE_VIOLATION) return sendError(res, "VALIDATION_ERROR", "이미 있는 카테고리예요.");
  if (error) throw error;
  if (!data) return sendError(res, "NOT_FOUND", "카테고리를 찾을 수 없어요.");
  res.json(data);
});

// DELETE /guilds/:guildId/categories/:categoryId  (소속 사운드는 FK ON DELETE SET NULL로 미분류가 됨)
categoriesRouter.delete("/categories/:categoryId", requireManage, async (req, res) => {
  const { guildId } = req.ctx!;
  unwrap(await db.from("sound_categories").delete().eq("guild_id", guildId).eq("id", String(req.params.categoryId)));
  res.status(204).end();
});
