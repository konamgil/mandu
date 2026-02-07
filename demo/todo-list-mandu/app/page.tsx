/**
 * Home Page
 *
 * Todo 앱 랜딩 페이지
 */

import { Button } from "../src/client/shared/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../src/client/shared/ui/card";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 p-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-4xl">📝 Todo Mandu</CardTitle>
          <CardDescription>
            Mandu 프레임워크로 만든 할 일 관리 앱
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-center text-muted-foreground">
            간단하고 효율적인 할 일 관리를 시작하세요.
          </p>
          <div className="flex justify-center gap-2">
            <Button asChild variant="default">
              <a href="/todos">시작하기 →</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/api/health">API 상태</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
