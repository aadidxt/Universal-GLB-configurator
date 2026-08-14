import { useContext } from 'react'
import { EngineContext, type EngineApi } from './engineApi'

export function useEngine(): EngineApi {
  const api = useContext(EngineContext)
  if (!api) throw new Error('useEngine must be used inside <EngineProvider>')
  return api
}
