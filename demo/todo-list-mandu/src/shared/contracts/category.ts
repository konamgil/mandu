/**
 * Category API Contract
 *
 * 클라이언트-서버 간 공유되는 Category 관련 타입 정의
 */

export interface CategoryDTO {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface CreateCategoryDTO {
  name: string;
  color?: string;
}

export interface CategoryListResponse {
  categories: CategoryDTO[];
}

export interface CategoryResponse {
  category: CategoryDTO;
}
