import type { Metadata } from '@mandujs/core';

export const metadata: Metadata = {
  title: 'Mandu AI Chat Demo',
  description: 'AI 채팅 데모 - Mandu Framework Islands & Streaming SSR',
  openGraph: {
    title: 'Mandu AI Chat',
    description: 'Experience real-time AI chat with streaming responses',
  },
};

// SSR에서는 placeholder만 렌더링, 클라이언트에서 하이드레이션
export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white">
      <header className="border-b border-gray-700 p-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
            <span className="text-xl">🥟</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">Mandu AI Chat</h1>
            <p className="text-sm text-gray-400">Islands + Streaming SSR Demo</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {/* Island placeholder - 클라이언트에서 하이드레이션됨 */}
        <div
          data-island="chat-box"
          data-props="{}"
          className="bg-gray-800 rounded-xl shadow-2xl overflow-hidden border border-gray-700"
        >
          {/* SSR fallback */}
          <div className="h-96 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <div className="animate-pulse text-4xl mb-4">🥟</div>
              <p>채팅 로딩 중...</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-700 p-4 mt-8">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          Built with Mandu Framework • Islands Architecture • Streaming SSR
        </div>
      </footer>

      {/* TechPanel Island - 기술 대시보드 */}
      <div
        data-island="tech-panel"
        data-props="{}"
      >
        {/* SSR fallback - 패널은 클라이언트에서만 표시 */}
      </div>
    </div>
  );
}
