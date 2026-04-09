interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      {children}
    </div>
  );
}
