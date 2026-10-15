import { describe, expect, it } from 'vitest'
import { isOurResource, tokenClientId } from './oauth'

const urls = { issuer: 'https://memo.example.com', resource: 'https://memo.example.com/mcp' }

describe('resource — 이 서버인가', () => {
  it('MCP 주소 또는 서버 주소 (ChatGPT 는 서버 주소만 보낼 수 있다)', () => {
    expect(isOurResource('https://memo.example.com/mcp', urls)).toBe(true)
    expect(isOurResource('https://memo.example.com/mcp/', urls)).toBe(true)
    expect(isOurResource('https://MEMO.example.com', urls)).toBe(true)
    expect(isOurResource('https://memo.example.com/', urls)).toBe(true)
  })

  it('다른 서버·다른 경로는 아니다', () => {
    expect(isOurResource('https://evil.example.com/mcp', urls)).toBe(false)
    expect(isOurResource('https://memo.example.com/api', urls)).toBe(false)
    expect(isOurResource('http://memo.example.com/mcp', urls)).toBe(false)
  })
})

describe('tokenClientId — 토큰 요청의 클라이언트', () => {
  const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

  it('client_id 가 먼저, 없으면 client_assertion 의 sub', () => {
    expect(tokenClientId({ client_id: 'https://claude.ai/x', client_assertion: jwt({ sub: 'other' }) })).toBe('https://claude.ai/x')
    expect(tokenClientId({ client_assertion: jwt({ sub: 'https://chatgpt.com/oauth/client.json' }) })).toBe('https://chatgpt.com/oauth/client.json')
  })

  it('읽을 수 없으면 빈 값', () => {
    expect(tokenClientId({})).toBe('')
    expect(tokenClientId({ client_assertion: 'garbage' })).toBe('')
    expect(tokenClientId({ client_assertion: jwt({ iss: 'x' }) })).toBe('')
  })
})
