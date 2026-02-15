/**
 * Home Page
 *
 * Edit this file and see changes at http://localhost:3000
 */

import { Button } from "@/client/shared/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/client/shared/ui/card";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 p-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-4xl">🥟 Mandu</CardTitle>
          <CardDescription>
            Welcome to your new Mandu project!
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-center text-muted-foreground">
            Edit <code className="rounded bg-muted px-1.5 py-0.5 text-sm">app/page.tsx</code> to get started.
          </p>
          <div className="flex justify-center gap-2">
            <Button asChild variant="default">
              <a href="/api/health">API Health →</a>
            </Button>
            <Button asChild variant="outline">
              <a href="https://mandujs.dev/docs" target="_blank" rel="noopener noreferrer">
                Documentation
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
