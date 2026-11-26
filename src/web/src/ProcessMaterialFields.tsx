export type SettingRow = { code: string; name: string; idx?: number }

export function ProcessSlots({ group, slots, pressed, locked, choose }: {
  group: boolean; slots: Record<number,string>; pressed: number; locked: boolean; choose: (slot: number) => void
}) {
  return <nav className="settings-process-slots" aria-label="작업 유형">
    {['원판절단','평단','평면','측면','길이절단','포장'].map((name,i) => {
      const slot = i + 1
      const unavailable = group && slot < 6
      const assigned = slot in slots && !unavailable
      return <button key={slot} type="button" disabled={locked || unavailable} data-slot={slot}
        data-unavailable={unavailable} data-assigned={assigned} aria-pressed={pressed === slot}
        onClick={() => choose(slot)}><img alt="" src={`${import.meta.env.BASE_URL}menu-icons/Process${slot}_${assigned ? 'On' : 'Off'}_Icon.png`} /><span>{name}</span></button>
    })}
  </nav>
}

export function ProcessRows({ rows, selected, choose }: {
  rows: SettingRow[]; selected?: string; choose: (code: string) => void
}) {
  return <table aria-label="공정 목록"><thead><tr><th>순번</th><th>공정코드</th><th>공정명</th></tr></thead>
    <tbody>{rows.map(({code,name,idx},i) => <tr key={code} data-code={code} aria-current={selected === code} onClick={()=>choose(code)}>
      <td>{idx ?? i+1}</td><td><button type="button">{code}</button></td><td>{name}</td></tr>)}</tbody></table>
}

export function MaterialRows({ rows, selected, focus, onFocus, onChange }: {
  rows: SettingRow[]; selected: string[]; focus: string; onFocus: (code: string) => void; onChange: (codes: string[]) => void
}) {
  return <table><thead><tr><th><button type="button" onClick={() =>
    onChange(rows.every(row => selected.includes(row.code)) ? [] : rows.map(row => row.code))}>사용</button></th>
    <th>순번</th><th>재질코드</th><th>재질명</th></tr></thead>
    <tbody>{rows.map(({code,name,idx},i) => <tr key={code} aria-current={focus === code} onClick={()=>onFocus(code)}>
      <td><label><input type="checkbox" aria-label={name} checked={selected.includes(code)}
        onChange={e=>onChange(e.target.checked ? [...selected,code] : selected.filter(c=>c!==code))}/></label></td>
      <td>{idx ?? i+1}</td><td>{code}</td><td>{name}</td></tr>)}</tbody></table>
}
