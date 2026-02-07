/**
 * TechPanel - 기술 대시보드 패널 + 에러 오버레이
 * Next.js 스타일 개발자 도구
 */
import { useState, useEffect, useCallback } from 'react';

interface TechStatus {
  ssr: { done: boolean; time?: number };
  hydration: { done: boolean; time?: number; strategy: string };
  streaming: { active: boolean; chunks: number; totalBytes: number };
  api: { calls: number; lastResponseTime?: number };
}

interface ErrorInfo {
  id: string;
  type: 'runtime' | 'unhandled' | 'network' | 'hmr' | 'react';
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  timestamp: number;
}

// 전역 상태 (Islands 간 공유)
declare global {
  interface Window {
    __MANDU_TECH_STATUS__: TechStatus;
    __MANDU_UPDATE_TECH__: (update: Partial<TechStatus>) => void;
    __MANDU_REPORT_ERROR__: (error: Omit<ErrorInfo, 'id' | 'timestamp'>) => void;
  }
}

export default function TechPanel() {
  const [status, setStatus] = useState<TechStatus>({
    ssr: { done: true, time: performance.now() },
    hydration: { done: false, strategy: 'visible' },
    streaming: { active: false, chunks: 0, totalBytes: 0 },
    api: { calls: 0 },
  });
  const [isExpanded, setIsExpanded] = useState(true);
  const [hydrationTime, setHydrationTime] = useState<number | null>(null);

  // 에러 상태
  const [errors, setErrors] = useState<ErrorInfo[]>([]);
  const [showOverlay, setShowOverlay] = useState(false);
  const [selectedError, setSelectedError] = useState<ErrorInfo | null>(null);

  // 에러 추가 함수
  const addError = useCallback((error: Omit<ErrorInfo, 'id' | 'timestamp'>) => {
    const newError: ErrorInfo = {
      ...error,
      id: Math.random().toString(36).slice(2),
      timestamp: Date.now(),
    };
    setErrors(prev => [newError, ...prev].slice(0, 10)); // 최대 10개
    setShowOverlay(true);
    setSelectedError(newError);

    console.log('%c[Mandu] ❌ 에러 감지:', 'color: #ef4444; font-weight: bold;', error.message);
  }, []);

  // 에러 클리어
  const clearErrors = useCallback(() => {
    setErrors([]);
    setShowOverlay(false);
    setSelectedError(null);
  }, []);

  // 전역 에러 핸들러 설정
  useEffect(() => {
    // 전역 에러 리포팅 함수
    window.__MANDU_REPORT_ERROR__ = addError;

    // Runtime 에러 핸들러
    const handleError = (event: ErrorEvent) => {
      addError({
        type: 'runtime',
        message: event.message,
        stack: event.error?.stack,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };

    // Unhandled Promise 에러
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      addError({
        type: 'unhandled',
        message: error?.message || String(error),
        stack: error?.stack,
      });
    };

    // React 에러 바운더리 시뮬레이션 (console.error 후킹)
    const originalConsoleError = console.error;
    console.error = (...args) => {
      originalConsoleError.apply(console, args);

      const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');

      // React 관련 에러 감지
      if (message.includes('React') || message.includes('hook') || message.includes('component')) {
        addError({
          type: 'react',
          message: message.slice(0, 500),
        });
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      console.error = originalConsoleError;
      delete (window as any).__MANDU_REPORT_ERROR__;
    };
  }, [addError]);

  // HMR 에러 수신 (WebSocket)
  useEffect(() => {
    // HMR WebSocket 연결 감지
    const checkHMR = () => {
      const ws = (window as any).__MANDU_HMR_WS__;
      if (ws) {
        const originalOnMessage = ws.onmessage;
        ws.onmessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'error' || data.type === 'guard-violation') {
              addError({
                type: 'hmr',
                message: data.data?.message || 'HMR Error',
                source: data.data?.file,
              });
            }
          } catch {}
          originalOnMessage?.call(ws, event);
        };
      }
    };

    // 잠시 후 체크 (HMR 연결 대기)
    const timer = setTimeout(checkHMR, 1000);
    return () => clearTimeout(timer);
  }, [addError]);

  useEffect(() => {
    // 하이드레이션 완료 시점 기록
    const startTime = performance.now();
    setHydrationTime(startTime);

    setStatus(prev => ({
      ...prev,
      hydration: { ...prev.hydration, done: true, time: startTime },
    }));

    // 전역 상태 설정
    window.__MANDU_TECH_STATUS__ = status;
    window.__MANDU_UPDATE_TECH__ = (update) => {
      setStatus(prev => ({ ...prev, ...update }));
    };

    console.log('%c[Mandu] 🏝️ TechPanel Island 하이드레이션 완료', 'color: #10b981; font-weight: bold;');
    console.log('%c[Mandu] 하이드레이션 전략: visible (IntersectionObserver)', 'color: #6b7280;');

    return () => {
      delete (window as any).__MANDU_TECH_STATUS__;
      delete (window as any).__MANDU_UPDATE_TECH__;
    };
  }, []);

  // 스트리밍 상태 모니터링
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

      // 네트워크 에러 감지
      if (!response.ok && response.status >= 400) {
        addError({
          type: 'network',
          message: `HTTP ${response.status}: ${response.statusText}`,
          source: url,
        });
      }

      if (url?.includes('/api/chat')) {
        const startTime = performance.now();
        setStatus(prev => ({
          ...prev,
          api: { ...prev.api, calls: prev.api.calls + 1 },
          streaming: { ...prev.streaming, active: true, chunks: 0, totalBytes: 0 },
        }));

        console.log('%c[Mandu] 📡 API 호출 시작: /api/chat', 'color: #3b82f6; font-weight: bold;');

        // 스트리밍 모니터링을 위해 response를 래핑
        const reader = response.body?.getReader();
        if (reader) {
          const stream = new ReadableStream({
            async start(controller) {
              let chunks = 0;
              let totalBytes = 0;

              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  const endTime = performance.now();
                  setStatus(prev => ({
                    ...prev,
                    streaming: { ...prev.streaming, active: false },
                    api: { ...prev.api, lastResponseTime: endTime - startTime },
                  }));
                  console.log(`%c[Mandu] ✅ 스트리밍 완료: ${chunks}개 청크, ${totalBytes} bytes`, 'color: #10b981;');
                  controller.close();
                  break;
                }

                chunks++;
                totalBytes += value?.length || 0;
                setStatus(prev => ({
                  ...prev,
                  streaming: { ...prev.streaming, chunks, totalBytes },
                }));

                controller.enqueue(value);
              }
            },
          });

          return new Response(stream, {
            headers: response.headers,
            status: response.status,
          });
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [addError]);

  // 에러 타입별 색상
  const getErrorColor = (type: ErrorInfo['type']) => {
    switch (type) {
      case 'runtime': return 'text-red-400';
      case 'unhandled': return 'text-orange-400';
      case 'network': return 'text-yellow-400';
      case 'hmr': return 'text-purple-400';
      case 'react': return 'text-pink-400';
      default: return 'text-red-400';
    }
  };

  const getErrorBadge = (type: ErrorInfo['type']) => {
    switch (type) {
      case 'runtime': return 'Runtime';
      case 'unhandled': return 'Promise';
      case 'network': return 'Network';
      case 'hmr': return 'HMR';
      case 'react': return 'React';
      default: return 'Error';
    }
  };

  return (
    <>
      {/* 에러 오버레이 */}
      {showOverlay && selectedError && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border-2 border-red-500 rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 bg-red-900/50 border-b border-red-500">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚨</span>
                <div>
                  <h2 className="text-red-400 font-bold">Mandu Error Overlay</h2>
                  <p className="text-red-300 text-xs">개발 모드에서만 표시됩니다</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={clearErrors}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
                >
                  모두 지우기
                </button>
                <button
                  onClick={() => setShowOverlay(false)}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm text-white"
                >
                  닫기 (ESC)
                </button>
              </div>
            </div>

            {/* 에러 목록 탭 */}
            {errors.length > 1 && (
              <div className="flex gap-1 px-4 py-2 bg-gray-800 border-b border-gray-700 overflow-x-auto">
                {errors.map((err, idx) => (
                  <button
                    key={err.id}
                    onClick={() => setSelectedError(err)}
                    className={`px-3 py-1 rounded text-xs whitespace-nowrap ${
                      selectedError?.id === err.id
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {idx + 1}. {getErrorBadge(err.type)}
                  </button>
                ))}
              </div>
            )}

            {/* 에러 상세 */}
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {/* 에러 타입 배지 */}
              <div className="flex items-center gap-2 mb-3">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  selectedError.type === 'runtime' ? 'bg-red-900 text-red-300' :
                  selectedError.type === 'network' ? 'bg-yellow-900 text-yellow-300' :
                  selectedError.type === 'react' ? 'bg-pink-900 text-pink-300' :
                  'bg-orange-900 text-orange-300'
                }`}>
                  {getErrorBadge(selectedError.type)}
                </span>
                <span className="text-gray-500 text-xs">
                  {new Date(selectedError.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* 에러 메시지 */}
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <p className={`font-mono text-sm ${getErrorColor(selectedError.type)}`}>
                  {selectedError.message}
                </p>
              </div>

              {/* 소스 위치 */}
              {selectedError.source && (
                <div className="mb-4">
                  <h3 className="text-gray-400 text-xs mb-1">Source</h3>
                  <div className="bg-gray-800 rounded p-2 font-mono text-xs text-blue-400">
                    {selectedError.source}
                    {selectedError.line && `:${selectedError.line}`}
                    {selectedError.column && `:${selectedError.column}`}
                  </div>
                </div>
              )}

              {/* 스택 트레이스 */}
              {selectedError.stack && (
                <div>
                  <h3 className="text-gray-400 text-xs mb-1">Stack Trace</h3>
                  <pre className="bg-gray-800 rounded p-3 font-mono text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
                    {selectedError.stack}
                  </pre>
                </div>
              )}
            </div>

            {/* 푸터 */}
            <div className="px-4 py-2 bg-gray-800 border-t border-gray-700 text-xs text-gray-500">
              💡 Tip: window.__MANDU_REPORT_ERROR__() 로 커스텀 에러를 보고할 수 있습니다
            </div>
          </div>
        </div>
      )}

      {/* 메인 패널 */}
      <div className="fixed bottom-4 right-4 z-50">
        {/* 에러 카운터 배지 */}
        {errors.length > 0 && (
          <button
            onClick={() => setShowOverlay(true)}
            className="absolute -top-2 -left-2 w-6 h-6 bg-red-500 hover:bg-red-600 rounded-full text-white text-xs font-bold shadow-lg animate-pulse"
          >
            {errors.length}
          </button>
        )}

        {/* 토글 버튼 */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="absolute -top-2 -right-2 w-8 h-8 bg-purple-600 hover:bg-purple-700 rounded-full text-white text-sm font-bold shadow-lg transition-transform hover:scale-110"
        >
          {isExpanded ? '−' : '+'}
        </button>

        {isExpanded && (
          <div className="bg-gray-900 border border-purple-500 rounded-lg shadow-2xl p-4 w-80 text-sm font-mono">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-700">
              <span className="text-lg">🔬</span>
              <span className="text-purple-400 font-bold">Mandu Tech Panel</span>
              {errors.length > 0 && (
                <span className="ml-auto px-2 py-0.5 bg-red-900 text-red-400 rounded text-xs">
                  {errors.length} 에러
                </span>
              )}
            </div>

            {/* SSR 상태 */}
            <div className="flex items-center justify-between py-1">
              <span className="text-gray-400">SSR:</span>
              <span className="text-green-400">
                ✅ 서버 렌더링 완료
              </span>
            </div>

            {/* 하이드레이션 상태 */}
            <div className="flex items-center justify-between py-1">
              <span className="text-gray-400">Hydration:</span>
              <span className={status.hydration.done ? 'text-green-400' : 'text-yellow-400'}>
                {status.hydration.done ? '✅' : '⏳'} {status.hydration.strategy}
                {hydrationTime && <span className="text-xs ml-1">({hydrationTime.toFixed(0)}ms)</span>}
              </span>
            </div>

            {/* 스트리밍 상태 */}
            <div className="flex items-center justify-between py-1">
              <span className="text-gray-400">Streaming:</span>
              <span className={status.streaming.active ? 'text-blue-400' : 'text-gray-500'}>
                {status.streaming.active ? (
                  <>🔄 {status.streaming.chunks}개 청크</>
                ) : status.streaming.chunks > 0 ? (
                  <>✅ {status.streaming.chunks}개 완료</>
                ) : (
                  '대기 중'
                )}
              </span>
            </div>

            {/* API 상태 */}
            <div className="flex items-center justify-between py-1">
              <span className="text-gray-400">API 호출:</span>
              <span className="text-cyan-400">
                {status.api.calls}회
                {status.api.lastResponseTime && (
                  <span className="text-xs ml-1">({status.api.lastResponseTime.toFixed(0)}ms)</span>
                )}
              </span>
            </div>

            {/* 에러 상태 */}
            <div className="flex items-center justify-between py-1">
              <span className="text-gray-400">Errors:</span>
              <span className={errors.length > 0 ? 'text-red-400' : 'text-green-400'}>
                {errors.length > 0 ? (
                  <button onClick={() => setShowOverlay(true)} className="hover:underline">
                    ❌ {errors.length}개 클릭하여 보기
                  </button>
                ) : (
                  '✅ 없음'
                )}
              </span>
            </div>

            {/* 기술 스택 */}
            <div className="mt-3 pt-2 border-t border-gray-700">
              <div className="text-gray-500 text-xs mb-2">사용된 기술:</div>
              <div className="flex flex-wrap gap-1">
                {['Islands', 'SSR', 'SSE', 'Bun', 'React'].map(tech => (
                  <span key={tech} className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300">
                    {tech}
                  </span>
                ))}
              </div>
            </div>

            {/* 콘솔 안내 */}
            <div className="mt-3 pt-2 border-t border-gray-700 text-xs text-gray-500">
              💡 F12 → Console에서 상세 로그 확인
            </div>
          </div>
        )}
      </div>
    </>
  );
}
