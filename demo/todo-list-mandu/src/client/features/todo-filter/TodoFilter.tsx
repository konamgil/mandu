/**
 * TodoFilter Component
 *
 * Todo 필터링 UI
 */

import { cn } from "../../shared/lib/utils";
import { Button } from "../../shared/ui/button";

export type FilterType = "all" | "active" | "completed";

interface TodoFilterProps {
  currentFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  counts: { all: number; active: number; completed: number };
}

export function TodoFilter({ currentFilter, onFilterChange, counts }: TodoFilterProps) {
  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: `전체 (${counts.all})` },
    { key: "active", label: `진행 중 (${counts.active})` },
    { key: "completed", label: `완료 (${counts.completed})` },
  ];

  return (
    <div className="flex gap-2">
      {filters.map(({ key, label }) => (
        <Button
          key={key}
          variant={currentFilter === key ? "default" : "outline"}
          size="sm"
          onClick={() => onFilterChange(key)}
          className={cn(
            "transition-all",
            currentFilter === key && "shadow-sm"
          )}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
