import React, { createContext, useContext, useState } from 'react'
import { useToolHistory } from '../hooks/useToolHistory'
const Context = createContext(null)
export const useAppState = () => useContext(Context)
export function AppStateProvider({ children }) {
  const [account, setAccount] = useState('a')
  const [activeToolPage, setActiveToolPage] = useState('caption')
  const toolHistory = useToolHistory('test-user', account)
  const currentAccount = { id: account, name: `검증 계정 ${account}` }
  // Deliberately set browser selection separately from the captured request account.
  localStorage.setItem('studio:selected-account-id', account)
  const value = { currentUser: { id: 'test-user', email: 'test@example.invalid' }, currentAccount, currentProjectId: null,
    toolHistory, activeToolPage, setActiveToolPage, isCurrentAccountConfigured: true,
    referenceHistory: [], referenceData: null, projects: [], accounts: [currentAccount], currentStep: 'upload',
    entitlementStatus: {}, copilotRemaining: {}, copilotLimits: {}, copilotUsage: {}, isAccountConfigured: () => true,
  }
  return <Context.Provider value={value}><button onClick={() => setAccount(a => a === 'a' ? 'b' : 'a')}>검증 계정 전환</button>{children}</Context.Provider>
}
