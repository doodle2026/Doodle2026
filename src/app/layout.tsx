// Pages live under app/[locale]/ (whose layout renders <html lang>). This root layout only passes through.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
