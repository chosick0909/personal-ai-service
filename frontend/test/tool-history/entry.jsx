import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppStateProvider } from '../../src/store/AppState'
import { MainPanel } from '../../src/App'
import Sidebar from '../../src/components/Sidebar'
import '../../src/index.css'
createRoot(document.getElementById('root')).render(<AppStateProvider><div style={{display:'flex',height:'100vh'}}><div style={{width:300,flexShrink:0}}><Sidebar /></div><main style={{flex:1}}><MainPanel /></main></div></AppStateProvider>)
