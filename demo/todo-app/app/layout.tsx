interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <a href="/" className="text-xl font-bold text-gray-900">Mandu Todo</a>
          <nav className="flex gap-3 text-sm text-gray-500">
            <a href="/" className="hover:text-gray-900">Home</a>
            <a href="/todos" className="hover:text-gray-900">Todos</a>
          </nav>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
