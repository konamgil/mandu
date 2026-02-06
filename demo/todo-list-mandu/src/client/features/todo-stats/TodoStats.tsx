/**
 * TodoStats Component
 *
 * Todo 통계 위젯
 */

import { Card } from "../../shared/ui/card";
import type { TodoStatsDTO } from "../../../shared/contracts/todo";

interface TodoStatsProps {
  stats: TodoStatsDTO;
}

export function TodoStats({ stats }: TodoStatsProps) {
  const completionRate = stats.total > 0
    ? Math.round((stats.completed / stats.total) * 100)
    : 0;

  return (
    <Card className="p-4">
      <h3 className="text-lg font-semibold mb-3">통계</h3>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold text-primary">{stats.total}</p>
          <p className="text-sm text-muted-foreground">전체</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
          <p className="text-sm text-muted-foreground">완료</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
          <p className="text-sm text-muted-foreground">진행 중</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-sm mb-1">
          <span>완료율</span>
          <span>{completionRate}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-300"
            style={{ width: `${completionRate}%` }}
          />
        </div>
      </div>
    </Card>
  );
}
