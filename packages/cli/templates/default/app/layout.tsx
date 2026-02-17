/**
 * Root Layout
 *
 * 모든 페이지의 공통 레이아웃
 * - html/head/body 태그는 Mandu SSR이 자동으로 생성합니다
 * - 여기서는 body 내부의 공통 래퍼만 정의합니다
 * - CSS는 Mandu가 자동으로 주입합니다: /.mandu/client/globals.css
 */

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      {children}
    </div>
  );
}
