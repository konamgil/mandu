/**
 * ChatBox Island - 선언적 Islands Architecture 데모
 * 하이드레이션 시각화 포함
 */
import { useState, useRef, useEffect } from 'react';
import { toUserFeedback, type ChatErrorFeedback } from './chatError';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  streamingChunks?: number;
}

function ChatBoxComponent() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '안녕하세요! 저는 Mandu AI 어시스턴트입니다. 🥟\n\n이 데모는 Islands Architecture와 Streaming SSR을 보여줍니다. 무엇이든 물어보세요!',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [hydrationTime, setHydrationTime] = useState<number | null>(null);
  const [errorFeedback, setErrorFeedback] = useState<ChatErrorFeedback | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 하이드레이션 애니메이션
  useEffect(() => {
    const startTime = performance.now();

    // 하이드레이션 완료 표시
    setTimeout(() => {
      setIsHydrated(true);
      setHydrationTime(performance.now() - startTime);

      console.log('%c[Mandu] 🏝️ ChatBox Island 하이드레이션 완료!', 'color: #10b981; font-weight: bold; font-size: 14px;');
      console.log('%c[Mandu] 하이드레이션 전략: visible', 'color: #6b7280;');
      console.log('%c[Mandu] React useState, useEffect 등 훅 활성화됨', 'color: #6b7280;');
    }, 100);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    };

    const assistantMessageId = (Date.now() + 1).toString();

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setErrorFeedback(null);

    console.log('%c[Mandu] 📤 메시지 전송:', 'color: #3b82f6; font-weight: bold;', userMessage.content);

    setMessages(prev => [
      ...prev,
      { id: assistantMessageId, role: 'assistant', content: '', isStreaming: true, streamingChunks: 0 },
    ]);

    try {
      const startTime = performance.now();
      console.log('%c[Mandu] 📡 SSE 스트리밍 시작...', 'color: #8b5cf6;');

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errorBody = await response.json();
          detail = errorBody?.error || errorBody?.message || '';
        } catch {
          // ignore parse failure
        }
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('스트림을 읽을 수 없습니다');

      let fullContent = '';
      let chunkCount = 0;
      let gotDoneSignal = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done) {
                gotDoneSignal = true;
                const endTime = performance.now();
                console.log(`%c[Mandu] ✅ 스트리밍 완료! ${chunkCount}개 청크, ${(endTime - startTime).toFixed(0)}ms`, 'color: #10b981; font-weight: bold;');

                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMessageId
                      ? { ...m, isStreaming: false }
                      : m
                  )
                );
              } else if (data.content) {
                chunkCount++;
                fullContent += data.content;
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMessageId
                      ? { ...m, content: fullContent, streamingChunks: chunkCount }
                      : m
                  )
                );
              }
            } catch {
              // JSON 파싱 실패 무시
            }
          }
        }
      }

      if (!gotDoneSignal || fullContent.trim().length === 0) {
        throw new Error('스트림 응답이 비정상적으로 종료되었습니다');
      }
    } catch (error) {
      console.error('%c[Mandu] ❌ 에러:', 'color: #ef4444;', error);
      const feedback = toUserFeedback(error);
      setErrorFeedback(feedback);
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMessageId
            ? { ...m, content: `⚠️ ${feedback.message}`, isStreaming: false }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className={`bg-gray-800 rounded-xl shadow-2xl overflow-hidden border transition-all duration-500 ${
      isHydrated ? 'border-green-500' : 'border-yellow-500'
    }`}>
      {/* 하이드레이션 상태 배너 */}
      <div className={`px-4 py-2 text-xs font-mono transition-all duration-500 ${
        isHydrated
          ? 'bg-green-900/50 text-green-400'
          : 'bg-yellow-900/50 text-yellow-400'
      }`}>
        {isHydrated ? (
          <span>✅ Island 하이드레이션 완료 ({hydrationTime?.toFixed(0)}ms) - React 인터랙션 활성화됨</span>
        ) : (
          <span>⏳ SSR 렌더링됨 - 하이드레이션 대기 중...</span>
        )}
      </div>

      {/* 채팅 메시지 영역 */}
      <div className="h-80 overflow-y-auto p-4 space-y-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs md:max-w-md lg:max-w-lg rounded-2xl px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-gray-700 text-gray-100 rounded-bl-md'
              }`}
            >
              <div className="whitespace-pre-wrap text-sm">
                {message.content}
                {message.isStreaming && (
                  <span className="inline-block w-2 h-4 ml-1 bg-blue-400 animate-pulse" />
                )}
              </div>
              {/* 스트리밍 청크 카운터 */}
              {message.isStreaming && message.streamingChunks !== undefined && message.streamingChunks > 0 && (
                <div className="text-xs text-gray-400 mt-1">
                  🔄 {message.streamingChunks}개 청크 수신 중...
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div className="border-t border-gray-700 p-4 bg-gray-850">
        {errorFeedback && (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-900/30 p-3 text-sm text-red-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <strong className="block text-red-100">⚠️ {errorFeedback.title}</strong>
                <span>{errorFeedback.message}</span>
              </div>
              <button
                onClick={() => setErrorFeedback(null)}
                className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-100 hover:bg-red-500/30"
              >
                닫기
              </button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={isHydrated ? "메시지를 입력하세요..." : "하이드레이션 대기 중..."}
            disabled={isLoading || !isHydrated}
            className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 placeholder-gray-400"
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim() || !isHydrated}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            {isLoading ? '...' : '전송'}
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-500 text-center">
          💡 "mandu", "island", "intent", "프레임워크" 입력해보세요
        </div>
      </div>
    </div>
  );
}

export default ChatBoxComponent;
