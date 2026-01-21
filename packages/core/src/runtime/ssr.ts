import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";

export interface SSROptions {
  title?: string;
  lang?: string;
}

export function renderToHTML(element: ReactElement, options: SSROptions = {}): string {
  const { title = "Mandu App", lang = "ko" } = options;
  const content = renderToString(element);

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body>
  <div id="root">${content}</div>
</body>
</html>`;
}

export function createHTMLResponse(html: string, status: number = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export function renderSSR(element: ReactElement, options: SSROptions = {}): Response {
  const html = renderToHTML(element, options);
  return createHTMLResponse(html);
}
