/**
 * TodoForm Component
 *
 * 새 Todo 입력 폼
 */

import { useState } from "react";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import type { CategoryDTO } from "../../../shared/contracts/category";

interface TodoFormProps {
  categories: CategoryDTO[];
  onSubmit: (title: string, categoryId?: string) => void;
}

export function TodoForm({ categories, onSubmit }: TodoFormProps) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSubmit(title.trim(), categoryId || undefined);
    setTitle("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <Input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="새 할 일 입력..."
        className="flex-1"
      />

      <select
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        className="px-3 py-2 rounded-md border border-input bg-background text-sm"
      >
        <option value="">카테고리 선택</option>
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name}
          </option>
        ))}
      </select>

      <Button type="submit">추가</Button>
    </form>
  );
}
