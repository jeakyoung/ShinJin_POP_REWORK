import FinalProductionReport from './FinalProductionReport'

export default function ProductionReportPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  return <FinalProductionReport onSessionExpired={onSessionExpired} onExport={(bytes, name) => {
    const blob = new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }} />
}
