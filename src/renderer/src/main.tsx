import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="mark">G</span> Granite</div>
        <span className="section-label">YOUR WORKSPACE</span>
        <div className="nav-item"><span>◈</span> Overview</div>
        <div className="sidebar-footer"><span className="status-dot" /> Running locally</div>
      </aside>
      <main>
        <header><span>Workspace overview</span><span className="badge">DESKTOP · 0.1.0</span></header>
        <section className="welcome">
          <div className="eyebrow">A PLACE TO BUILD</div>
          <h1>Your agents.<br />Your workspace.</h1>
          <p>A local home for ideas, projects, and the agents you work with.</p>
          <div className="ready-card">
            <div className="card-symbol">◈</div>
            <div><h2>Ready for the first conversation</h2><p>Granite is installed. Model connections and agent conversations are coming next.</p></div>
          </div>
          <div className="footnote">Built on your machine. Made to be yours.</div>
        </section>
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
