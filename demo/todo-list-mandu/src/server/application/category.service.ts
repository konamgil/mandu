/**
 * Category Application Service
 *
 * 카테고리 관련 비즈니스 로직을 처리하는 서비스
 */

import { categoryStore } from "../infra/store";
import {
  createCategory,
  type Category,
  type CreateCategoryInput,
} from "../domain/category";

export const categoryService = {
  /**
   * 모든 카테고리 조회
   */
  getAll(): Category[] {
    return categoryStore.getAll();
  },

  /**
   * ID로 카테고리 조회
   */
  getById(id: string): Category | undefined {
    return categoryStore.getById(id);
  },

  /**
   * 새 카테고리 생성
   */
  create(input: CreateCategoryInput): Category {
    const category = createCategory(input);
    return categoryStore.create(category);
  },

  /**
   * 카테고리 삭제
   */
  delete(id: string): boolean {
    return categoryStore.delete(id);
  },
};
