import { AppShell } from '@mantine/core'
import { AppFrame } from '@/components/AppFrame'
import { useCallback, useEffect, useState } from 'react'
import ConnectionsPage from '@/routes/connections'
import SchemaPage from '@/routes/schema'
import BrowsePage from '@/routes/browse'
import QueriesPage from '@/routes/queries'
import OpsPage from '@/routes/ops'
import AssistantPage from '@/routes/assistant'

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
  const handleNavigate = useCallback((value: string) => {
    window.location.hash = value
  }, [])
  const currentRoute = route || 'connections'
  return (
    <AppShell padding="md" header={{ height: 68 }}>
      <AppShell.Header>
        <AppFrame active={currentRoute} onNavigate={handleNavigate} />
      </AppShell.Header>
      <AppShell.Main>
        {currentRoute === 'assistant' ? <AssistantPage /> : null}
        {currentRoute === 'schema' ? <SchemaPage /> : null}
        {currentRoute === 'browse' ? <BrowsePage /> : null}
        {currentRoute === 'queries' ? <QueriesPage /> : null}
        {currentRoute === 'ops' ? <OpsPage /> : null}
        {currentRoute === 'connections' ? <ConnectionsPage /> : null}
      </AppShell.Main>
    </AppShell>
  )
}
