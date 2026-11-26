export const assets = import.meta.env.BASE_URL + 'employee-print/'
export type Report = { id: string; pages: number; printer: string; printKey: string; diagnostic: boolean }
export type Request = (path: string, method?: string, body?: unknown) => Promise<Response>
