// Copy beside src/web/src ONLY in an isolated test build.
import { createRoot } from 'react-dom/client'
import MachineCalls from './src/machine/MachineCalls'
import './src/index.css'
const expired = () => { location.href = '/' }
createRoot(document.getElementById('root')!).render(<div style={{ position: 'fixed', inset: 0, overflow: 'auto' }}><MachineCalls onSessionExpired={expired} /></div>)
