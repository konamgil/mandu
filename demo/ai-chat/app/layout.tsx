/**
 * Root Layout - AI Chat
 *
 * - html/head/body 태그는 Mandu SSR이 자동으로 생성합니다
 * - 여기서는 body 내부의 공통 래퍼만 정의합니다
 */

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {children}
    </div>
  );
}
