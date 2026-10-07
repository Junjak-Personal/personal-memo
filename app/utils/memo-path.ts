/** 메모 화면 주소. 경로 id(`p:업무/회의록.md`)의 슬래시까지 인코딩한다 */
export function memoPath(id: string) {
  return `/m/${encodeURIComponent(id)}`
}
