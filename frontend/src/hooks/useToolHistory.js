import { useEffect, useRef, useState } from 'react'
import { toolHistoryRequest } from '../lib/toolHistoryApi'

const emptyState = scope => ({ scope, items: [], selected: null, session: 0, error: '' })
const byRecent = (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)

export function useToolHistory(userId, accountId) {
  const scope = `${userId || ''}:${accountId || ''}`
  const latest = useRef(scope)
  latest.current = scope
  const touched = useRef(new Set())
  const [state, setState] = useState(() => emptyState(scope))
  const current = state.scope === scope ? state : emptyState(scope)

  useEffect(() => {
    let canceled = false
    touched.current = new Set()
    setState(emptyState(scope))
    if (userId && accountId) {
      toolHistoryRequest(accountId).then(({ items }) => {
        if (!canceled) setState(s => ({
          ...s,
          items: [...s.items, ...items.filter(item => !touched.current.has(item.id))].sort(byRecent),
        }))
      }).catch(() => {
        if (!canceled) setState(s => ({ ...s, error: '도구 내역을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.' }))
      })
    }
    return () => { canceled = true }
  }, [scope, userId, accountId])

  const merge = item => {
    if (latest.current !== scope) return
    touched.current.add(item.id)
    setState(s => {
      const existing = s.items.find(x => x.id === item.id)
      if (existing && existing.version > item.version) return s
      return { ...s, items: [item, ...s.items.filter(x => x.id !== item.id)].sort(byRecent) }
    })
  }

  return {
    items: current.items,
    selected: current.selected,
    session: current.session,
    error: current.error,
    select: id => setState(s => ({ ...s, selected: id, session: s.session + 1 })),
    async save(snapshot) {
      const { item } = await toolHistoryRequest(accountId, '', { method: 'POST', body: snapshot })
      merge(item)
      return item
    },
    async update(id, patch) {
      const row = current.items.find(x => x.id === id)
      if (!row) throw new Error('내역을 다시 열어주세요.')
      const { item } = await toolHistoryRequest(accountId, `/${id}`, {
        method: 'PATCH', body: { ...patch, version: patch.version ?? row.version },
      })
      merge(item)
      return item
    },
    async remove(id) {
      await toolHistoryRequest(accountId, `/${id}`, { method: 'DELETE' })
      if (latest.current !== scope) return
      touched.current.add(id)
      setState(s => ({ ...s, items: s.items.filter(x => x.id !== id), selected: s.selected === id ? null : s.selected }))
    },
  }
}
