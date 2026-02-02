/**
 * Home Page
 *
 * Edit this file and see changes at http://localhost:3000
 */

export default function HomePage() {
  return (
    <html lang="ko">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Mandu App</title>
        <style>{`
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 2rem;
          }
          h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
          }
          p {
            font-size: 1.2rem;
            opacity: 0.9;
          }
          code {
            background: rgba(255,255,255,0.2);
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
          }
          a {
            color: white;
            text-decoration: underline;
          }
        `}</style>
      </head>
      <body>
        <div className="container">
          <h1>🥟 Mandu</h1>
          <p>Welcome to your new Mandu project!</p>
          <p>Edit <code>app/page.tsx</code> to get started.</p>
          <p>
            <a href="/api/health">Check API Health →</a>
          </p>
        </div>
      </body>
    </html>
  );
}
