import { createContext, useContext } from 'react'

export const SettingsPromptContext = createContext<((text: string, confirm?: boolean) => Promise<boolean>) | null>(null)
export function useSettingsPrompt() {
  const prompt = useContext(SettingsPromptContext)
  if (!prompt) throw new Error('Missing settings prompt provider')
  return prompt
}
