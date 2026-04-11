interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <div className="bg-gray-950 text-gray-100 font-sans antialiased">
      {children}
    </div>
  );
}
