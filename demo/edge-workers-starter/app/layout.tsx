interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "32px",
        background: "#0f172a",
        color: "#f8fafc",
        fontFamily:
          "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, monospace",
      }}
    >
      {children}
    </div>
  );
}
