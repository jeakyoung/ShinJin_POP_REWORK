type Text = { x: number; y: number; size: number; color: string; text: string }
type Block = { x: number; y: number; width: number; height: number; color: string }
export type PreviewPage = { width: number; height: number; texts: Text[]; blocks: Block[] }
export type Contract = {
  status: string; documentRef: string | null; device: string | null; pages: number; preview: PreviewPage[]
}

const messages: Record<string, string> = {
  STATEMENT_DATA_UNAVAILABLE: '거래명세서 조회 자료를 확인할 수 없습니다.',
  EMPTY_SELECTION: '출력할 행을 선택하세요.',
  UNKNOWN_FORM: '지원하지 않는 출력 양식입니다.',
  INVALID_INPUT: '필수 출력 정보가 누락됐거나 올바르지 않습니다.',
  RENDER_FAILED: '미리보기와 PDF를 생성하지 못했습니다.',
  FONT_NOT_CONFIGURED: '한글 출력 글꼴이 설정되지 않았습니다. 로컬 글꼴 설정을 확인하세요.',
  FONT_UNAVAILABLE: '설정된 한글 출력 글꼴 파일을 열 수 없습니다. 로컬 경로를 확인하세요.',
}

export const outputMessage = (status: string) => messages[status] ?? '출력 결과를 확인하세요.'

export function savePdf(file: Blob, name: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
