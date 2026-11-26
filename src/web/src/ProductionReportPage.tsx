import FinalProductionReport from './FinalProductionReport'

type SaveDialog = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
  Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }>

export default function ProductionReportPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  return <FinalProductionReport onSessionExpired={onSessionExpired} onExport={async (bytes, name) => {
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const blob = new Blob([new Uint8Array(bytes)], { type: mime })
    const picker = (window as Window & { showSaveFilePicker?: SaveDialog }).showSaveFilePicker
    if (picker) {
      const handle = await picker.call(window, { suggestedName: name, types: [{ description: 'Excel Files', accept: { [mime]: ['.xlsx'] } }] })
      const stream = await handle.createWritable()
      try {
        await stream.write(blob)
        await stream.close()
      } catch (error) {
        await stream.abort().catch(() => undefined)
        throw error
      }
      return 'saved'
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return 'download'
  }} />
}
