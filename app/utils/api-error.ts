/**
 * $fetch 가 던지는 오류에서 서버가 보낸 값을 꺼낸다 (server/utils/memo.ts 의 data 모양).
 * 오류 객체는 우리 손 밖의 모양이라 여기서 바로 좁힌다.
 */
interface ApiErrorData {
  message?: string
  code?: string
  version?: string
}

interface FetchErrorLike {
  statusCode?: number
  data?: { data?: ApiErrorData }
}

function isFetchError(error: unknown): error is FetchErrorLike {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}

/** 서버가 data.message 에 실어 보낸 한국어 문구. 없으면 fallback */
export function apiMessage(error: unknown, fallback: string) {
  const message = isFetchError(error) ? error.data?.data?.message : undefined
  return typeof message === 'string' ? message : fallback
}

export function apiStatus(error: unknown) {
  return isFetchError(error) ? (error.statusCode ?? null) : null
}

export function apiData(error: unknown): ApiErrorData {
  return (isFetchError(error) && error.data?.data) || {}
}
