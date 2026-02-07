/**
 * TodoItem Component
 *
 * 개별 Todo 아이템 표시
 */

import { cn } from "../../shared/lib/utils";
import { Button } from "../../shared/ui/button";
import type { TodoDTO } from "../../../shared/contracts/todo";
import type { CategoryDTO } from "../../../shared/contracts/category";

interface TodoItemProps {
  todo: TodoDTO;
  categories: CategoryDTO[];
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
}

export function TodoItem({ todo, categories, onToggle, onDelete }: TodoItemProps) {
  const category = categories.find((c) => c.id === todo.categoryId);

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-4 rounded-lg border bg-card transition-colors",
        todo.completed && "opacity-60"
      )}
    >
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => onToggle(todo.id, !todo.completed)}
        className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
      />

      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium truncate",
            todo.completed && "line-through text-muted-foreground"
          )}
        >
          {todo.title}
        </p>
        {category && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mt-1"
            style={{ backgroundColor: category.color + "20", color: category.color }}
          >
            {category.name}
          </span>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete(todo.id)}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        삭제
      </Button>
    </div>
  );
}
