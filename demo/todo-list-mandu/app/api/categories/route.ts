/**
 * Categories API
 *
 * GET /api/categories - 모든 카테고리 조회
 * POST /api/categories - 새 카테고리 생성
 */

import { Mandu } from "@mandujs/core";
import { categoryService } from "../../../src/server/application/category.service";
import type { CategoryDTO, CreateCategoryDTO } from "../../../src/shared/contracts/category";

function toDTO(category: { id: string; name: string; color: string; createdAt: Date }): CategoryDTO {
  return {
    ...category,
    createdAt: category.createdAt.toISOString(),
  };
}

export default Mandu.filling()
  .get((ctx) => {
    const categories = categoryService.getAll();
    return ctx.ok({ categories: categories.map(toDTO) });
  })
  .post(async (ctx) => {
    const body = await ctx.body<CreateCategoryDTO>();

    if (!body.name?.trim()) {
      return ctx.error("Name is required");
    }

    const category = categoryService.create({
      name: body.name.trim(),
      color: body.color,
    });

    return ctx.created({ category: toDTO(category) });
  });
