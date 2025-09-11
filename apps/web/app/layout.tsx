
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {/* 顶部导航 */}
        {typeof window === 'undefined' ? null : null}
        {/* 客户端导航条 */}
        <div suppressHydrationWarning>
          { /* 在服务端先占位，客户端再挂载 NavBar */ }
        </div>
        {children}
      </body>
    </html>
  )
}
