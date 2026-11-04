import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

type TemplateRoot = NonNullable<NonNullable<ReturnType<typeof parse>['descriptor']['template']>['ast']>
type TemplateNode = TemplateRoot | TemplateRoot['children'][number]
function template(path: string) {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const { descriptor, errors } = parse(source)
  expect(errors).toEqual([])
  if (!descriptor.template?.ast) throw new Error(`Template missing: ${path}`)
  return descriptor.template.ast
}
function all(root: TemplateNode): TemplateNode[] {
  return [root, ...(root.type === 0 || root.type === 1 ? root.children.flatMap(all) : [])]
}
function attribute(node: TemplateNode, name: string) {
  if (!('props' in node)) return
  const prop = node.props.find(prop => prop.type === 6 && prop.name === name)
  return prop?.type === 6 ? prop.value?.content : undefined
}
function binding(node: TemplateNode, name: string) {
  if (!('props' in node)) return
  const prop = node.props.find(prop => prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.content === name)
  return prop?.type === 7 && prop.exp?.type === 4 ? prop.exp.content : undefined
}

describe('로딩 표시의 레이아웃 경계', () => {
  it('공개 폴더와 메모는 페이지 밖의 같은 Nuxt 레이아웃을 사용한다', () => {
    for (const path of ['../pages/ext/[id].vue', '../pages/ext/folder/[id].vue']) {
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
      const { descriptor } = parse(source)
      expect(descriptor.scriptSetup?.content).toMatch(/layout:\s*'ext'/)
      expect(all(template(path)).some(node => 'tag' in node && node.tag === 'ExtLayout')).toBe(false)
    }
  })
  it('공개·비공개 트리는 같은 트리와 행 컴포넌트를 사용한다', () => {
    for (const path of ['../components/AppSidebar.vue', '../layouts/ext.vue']) {
      const nodes = all(template(path))
      expect(nodes.some(node => 'tag' in node && node.tag === 'MemoTree')).toBe(true)
      expect(nodes.some(node => 'tag' in node && node.tag === 'MemoTreeRow')).toBe(true)
    }
  })
  it('빠른 열기의 목록·빈 결과·오류는 같은 viewport 안에 있어 footer와 입력의 위치를 바꾸지 않는다', () => {
    const root = template('../components/MemoQuickSwitch.vue')
    const viewport = all(root).find(node => attribute(node, 'data-testid') === 'memo-quick-viewport')!
    expect(viewport).toBeDefined()
    expect(attribute(viewport, 'class')).toContain('dvh')
    expect(binding(viewport, 'preserve-height')).toBe('false')
    const inside = all(viewport)
    expect(inside.some(node => attribute(node, 'role') === 'listbox')).toBe(true)
    expect(inside.some(node => attribute(node, 'data-testid') === 'memo-quick-empty')).toBe(true)
    expect(all(root).filter(node => 'tag' in node && node.tag === 'UAlert').every(node => inside.includes(node))).toBe(true)
    const input = all(root).find(node => attribute(node, 'data-testid') === 'memo-quick-search')!
    expect(binding(input, 'loading')).toContain('loading')
    // v-if loading의 별도 p가 입력과 목록 사이에 다시 삽입되는 회귀를 막는다.
    expect(all(root).filter(node => 'tag' in node && node.tag === 'p' && node.props.some(prop => prop.type === 7 && prop.name === 'if' && prop.exp?.type === 4 && prop.exp.content === 'loading'))).toEqual([])
  })
  it('공용 spinner는 흐름 밖·비차단이며 접근성 상태는 시각적 행을 만들지 않는다', () => {
    const root = template('../components/MemoLoadingRegion.vue')
    const overlay = all(root).find(node => attribute(node, 'data-testid') === 'memo-loading-overlay')!
    expect(attribute(overlay, 'class')).toContain('absolute')
    expect(attribute(overlay, 'class')).toContain('pointer-events-none')
    const status = all(root).find(node => attribute(node, 'role') === 'status')!
    expect(attribute(status, 'class')).toContain('sr-only')
    expect(all(root).some(node => binding(node, 'aria-busy') === 'loading')).toBe(true)
  })
  it('사이드바 검색도 기존 입력 아이콘에서만 로딩을 표시한다', () => {
    const root = template('../components/AppSidebar.vue')
    const input = all(root).find(node => attribute(node, 'data-testid') === 'sidebar-search-input')!
    expect(binding(input, 'loading')).toBe('searching')
    expect(binding(input, 'aria-busy')).toBe('searching')
    for (const status of all(root).filter(node => attribute(node, 'role') === 'status')) expect(attribute(status, 'class')).toContain('sr-only')
  })
})
