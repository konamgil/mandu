import type { Metadata } from '@mandujs/core';

export const metadata: Metadata = {
  title: {
    default: 'Mandu AI Chat',
    template: '%s | Mandu AI Chat',
  },
  description: 'AI 채팅 데모 애플리케이션',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css"
          rel="stylesheet"
        />
        <style>{`
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
        `}</style>
      </head>
      <body>
        {children}
        {/* Client Islands 번들 */}
        <script type="module" src="/.mandu/client/entry.js"></script>
      </body>
    </html>
  );
}
