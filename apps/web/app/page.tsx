export default function HomePage() {
  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>reiDbView</h1>
      <p>读优先的 DB 浏览器（PG-only / Web-only）。</p>
      <ul>
        <li>JSON/JSONB 友好展示</li>
        <li>Lookup 列（LATERAL）与 Join Builder</li>
        <li>Keyset 分页（默认）</li>
      </ul>
      <p>当前为最小脚手架，API 与 UI 正在搭建中。</p>
    </main>
  )
}

