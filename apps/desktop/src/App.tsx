import { AppShell } from '@mantine/core'
import { AppFrame } from '@/components/AppFrame'
import { useEffect, useState } from 'react'
import ConnectionsPage from '@/routes/connections'
import SchemaPage from '@/routes/schema'
import BrowsePage from '@/routes/browse'
import QueriesPage from '@/routes/queries'
import OpsPage from '@/routes/ops'

function useHashRoute() {
  const [hash, setHash] = useState<string>(() => (typeof location !== 'undefined' ? location.hash : ''))
  useEffect(() => {
    const fn = () => setHash(location.hash)
    window.addEventListener('hashchange', fn)
    return () => window.removeEventListener('hashchange', fn)
  }, [])
  return hash.replace(/^#/, '')
}

export default function App() {
  const route = useHashRoute()
  return (
    <AppShell padding="md" header={{ height: 56 }}>
      <AppShell.Header>
        <AppFrame />
      </AppShell.Header>
      <AppShell.Main>
        {route === 'schema' ? <SchemaPage /> : null}
        {route === 'browse' ? <BrowsePage /> : null}
        {route === 'queries' ? <QueriesPage /> : null}
        {route === 'ops' ? <OpsPage /> : null}
        {route === 'connections' || !route ? <ConnectionsPage /> : null}
      </AppShell.Main>
    </AppShell>
  )
}
