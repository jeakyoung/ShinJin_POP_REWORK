import type { CSSProperties } from 'react'
import design from './design.json'

type Entry = [number, number, number, number, string]
const controls = design as unknown as Record<string, Record<string, Entry>>
export const main = 'frmWorkPrint'
export function box(form: string, name: string, dy = 0): CSSProperties {
  const [left, top, width, height] = controls[form][name]
  return { position: 'absolute', left, top: top + dy, width, height }
}
export function caption(form: string, name: string) { return controls[form][name][4] }
export type Choice = [string,string]
export type GridRow = { key: string, fields: Record<string,string> }
export const accounts: Choice[] = [['001','제품'],['002','상품'],['003','교환'],['004','자재']]
export const complete: Choice[] = [['000','전체'],['001','완료'],['002','미완료']]
export const printed: Choice[] = ['전체','POP & ERP','POP','ERP','미출력'].map((name,i)=>['00'+i,name])
export const buttons: Record<string,string> = { Single:'singlePrintBtn',Multiple:'multiPrintBtn',Multiple1:'cPrintBtn',Multiple2:'cPrintBtn2',Multiple3:'cPrintBtn3' }
