import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core'
import Providers from '../components/Providers'
import AppFrame from '../components/AppFrame'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <Providers>
          <AppFrame>{children}</AppFrame>
        </Providers>
      </body>
    </html>
  )
}
