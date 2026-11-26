import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import EquipmentDialog from './EquipmentSettings'
import type { View } from './equipmentSettingsApi'
import SettingsPrompts from './SettingsPrompts'
import TransferMessage from './TransferMessage'

type Props = { terminalId: string; onClose: (changed: boolean) => void }

export default function PreloginGroupSettings({ terminalId, onClose }: Props) {
  const url = '/api/pop/prelogin-details/' + encodeURIComponent(terminalId) + '/group'
  const [view, setView] = useState<View>()
  const [error, setError] = useState('')
  const changed = useRef(false)
  const failed = useCallback(() => setError('그룹 설정을 불러오지 못했습니다.'), [])
  return createPortal(<SettingsPrompts>
    {error ? <div className="settings-message-scope"><TransferMessage message={{text:error}}
      close={() => onClose(changed.current)} /></div> :
      <EquipmentDialog page="groups" terminal={terminalId} url={url} view={view} onView={setView}
        onCommitted={() => { changed.current = true }} onExpired={failed} onClose={() => onClose(changed.current)} />}
  </SettingsPrompts>, document.body)
}
