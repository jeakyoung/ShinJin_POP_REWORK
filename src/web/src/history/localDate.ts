export function localDate(d: Date) {
  return [
    d.getFullYear().toString().padStart(4, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
