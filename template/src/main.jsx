import React from 'react'
import { createRoot } from 'react-dom/client'

/**
 * The miniapp starter. Replace this component; keep using `fetch('/api/state')`
 * and `fetch('/api/sql', { method: 'POST', ... })` for persistence.
 */
function App() {
  const [count, setCount] = React.useState(0)
  const [saved, setSaved] = React.useState(null)

  React.useEffect(() => {
    fetch('/api/state?key=count')
      .then(r => r.json())
      .then(d => { if (typeof d.value === 'number') setCount(d.value) })
      .catch(() => {})
  }, [])

  async function bump() {
    const next = count + 1
    setCount(next)
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'count', value: next }),
    })
    setSaved('saved to sqlite')
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 640 }}>
      <h1>miniapp</h1>
      <p>React + Vite (HMR) on the Node backend. Edit <code>src/main.jsx</code>.</p>
      <button onClick={bump} style={{ padding: '8px 16px', fontSize: 16, cursor: 'pointer' }}>
        count: {count}
      </button>
      {saved && <p style={{ color: '#888' }}>{saved}</p>}
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
