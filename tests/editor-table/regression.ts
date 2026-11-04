import { Editor } from '@tiptap/core'
import type { AnyExtension } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { memoExtensions } from '../../app/utils/editor-extensions'
import { canonicalMarkdown } from '../../app/pages/m/_modules/useMemoAutosave'
import type { Memo } from '../../shared/types/memo'

const run = document.querySelector<HTMLButtonElement>('#run')!
const status = document.querySelector<HTMLElement>('#status')!
const results = document.querySelector<HTMLOListElement>('#results')!
const working = document.querySelector<HTMLElement>('#working')!
const preview = document.querySelector<HTMLElement>('#preview')!
let previewEditor: Editor | null = null
let count = 0
let failed = 0

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
async function api(action: string, input: Record<string, string>): Promise<Memo> {
  const response = await fetch('/__memo-table-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...input }) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `저장소 HTTP ${response.status}`)
  return value as Memo
}
function makeEditor(content: string, options: { readonly?: boolean; baseline?: boolean; element?: HTMLElement; contentType?: 'html' | 'markdown' } = {}) {
  const element = options.element ?? document.createElement('div')
  if (!options.element) working.append(element)
  const configured = memoExtensions({
    toDisplay: src => src.startsWith('assets/') ? `/__synthetic-image/${src}` : src,
    toStored: src => src.startsWith('/__synthetic-image/') ? src.slice('/__synthetic-image/'.length) : src,
  })
  const extensions: AnyExtension[] = [
    StarterKit.configure({ underline: false, codeBlock: false }),
    Markdown,
    ...configured.map(extension => options.baseline && extension.name === 'tableKit' ? TableKit : extension),
  ]
  return new Editor({ element, content, contentType: options.contentType ?? 'markdown', editable: !options.readonly, extensions })
}
function tableFormat(editor: Editor) {
  return editor.getJSON().content?.find(node => node.type === 'table')?.attrs?.memoTableFormat
}
function spans(editor: Editor) {
  return [...editor.view.dom.querySelectorAll('td,th')].map(cell => [cell.tagName, cell.getAttribute('rowspan') ?? '1', cell.getAttribute('colspan') ?? '1'])
}
function same(actual: unknown, expected: unknown, message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`)
}
const layoutClasses = ['edge-s', 'edge-t', 'corner-tl', 'corner-tr', 'corner-bl', 'corner-br'].map(name => `memo-table-${name}`)
function cellLayout(editor: Editor, text: string, expected: string[]) {
  const cell = [...editor.view.dom.querySelectorAll('td,th')].find(node => node.textContent === text)
  assert(cell, `셀을 찾지 못함: ${text}`)
  const actual = [...cell.classList].filter(name => layoutClasses.includes(name)).sort()
  same(actual, expected.map(name => `memo-table-${name}`).sort(), `${text}의 논리적 외곽/모서리`)
}
function editCell(editor: Editor, text: string) {
  let position = -1
  editor.state.doc.descendants((node, pos) => { if (position < 0 && node.isText && node.text === text) position = pos + node.nodeSize })
  assert(position >= 0, `수정할 셀의 텍스트가 없음: ${text}`)
  assert(editor.commands.insertContentAt(position, { type: 'text', text: ' 수정' }), '셀 내용 수정 실패')
  // 표 앞 문단 삽입으로 모든 셀의 문서 위치도 바꾼다. decoration이 옛 위치에 남아서는 안 된다.
  assert(editor.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: '표 앞 합성 문단' }] }), '표 앞 문단 삽입 실패')
}
async function check(name: string, action: () => void | Promise<void>) {
  count++
  const item = document.createElement('li')
  results.append(item)
  try {
    await action()
    item.dataset.result = 'pass'
    item.textContent = `PASS · ${name}`
  } catch (error) {
    failed++
    item.dataset.result = 'fail'
    item.textContent = `FAIL · ${name} — ${error instanceof Error ? error.message : String(error)}`
  }
}

const examples = [
  ['세로 병합', '<table><tr><th>유형</th><th>오늘 요약</th></tr><tr><td rowspan="2">개발</td><td>표 병합</td></tr><tr><td>검증</td></tr></table>', [['TH', '1', '1'], ['TH', '1', '1'], ['TD', '2', '1'], ['TD', '1', '1'], ['TD', '1', '1']]],
  ['가로 병합', '<table><tr><th colspan="2">오늘 요약</th></tr><tr><td>개발</td><td>검증</td></tr></table>', [['TH', '1', '2'], ['TD', '1', '1'], ['TD', '1', '1']]],
  ['가로·세로 동시 병합', '<table><tr><th>유형</th><th>작업</th><th>결과</th></tr><tr><td rowspan="2" colspan="2">개발</td><td>구현</td></tr><tr><td>검증</td></tr></table>', [['TH', '1', '1'], ['TH', '1', '1'], ['TH', '1', '1'], ['TD', '2', '2'], ['TD', '1', '1'], ['TD', '1', '1']]],
  ['병합 없는 HTML 표', '<table><tr><th>유형</th><th>오늘 요약</th></tr><tr><td>개발</td><td>기존 내용</td></tr></table>', [['TH', '1', '1'], ['TH', '1', '1'], ['TD', '1', '1'], ['TD', '1', '1']]],
  ['헤더 세로 병합', '<table><tr><th rowspan="2">유형</th><th>오늘 요약</th></tr><tr><td>검증</td></tr></table>', [['TH', '2', '1'], ['TH', '1', '1'], ['TD', '1', '1']]],
] as const

async function roundTrip(html: string, expected: readonly (readonly string[])[]) {
  let memo = await api('create', { content: `${html}\n\n원래 문단` })
  memo = await api('get', { id: memo.id })
  assert(memo.content.includes(html), 'HTML 입력이 생성/재조회에서 바뀜')
  for (let pass = 0; pass < 3; pass++) {
    const editor = makeEditor(memo.content)
    try {
      same(spans(editor), expected, `읽기 ${pass + 1} 병합`)
      same(tableFormat(editor), 'html', `읽기 ${pass + 1} HTML 유형`)
      const normalized = editor.getMarkdown()
      assert(canonicalMarkdown(normalized) === canonicalMarkdown(memo.content), '최초 저장 형식 손실 검사에 걸림')
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: `일반 본문 수정 ${pass + 1}` }] })
      const content = editor.getMarkdown()
      assert(content.includes('<table data-memo-table="html"'), '편집 후 HTML 유형 손실')
      if (expected.some(cell => Number(cell[1]) > 1 || Number(cell[2]) > 1)) assert(content.includes('rowspan="2"') || content.includes('colspan="2"'), '편집 후 직렬화에서 병합 손실')
      memo = await api('update', { id: memo.id, baseVersion: memo.version, content })
      memo = await api('get', { id: memo.id })
    } finally { editor.destroy() }
  }
  previewEditor?.destroy()
  preview.replaceChildren()
  previewEditor = makeEditor(memo.content, { element: preview, readonly: true })
  same(spans(previewEditor), expected, '최종 읽기 전용 화면 병합')
  same(tableFormat(previewEditor), 'html', '최종 읽기 전용 HTML 유형')
  assert(!previewEditor.isEditable, '보기 화면이 편집 가능함')
}

run.addEventListener('click', async () => {
  run.disabled = true
  count = 0
  failed = 0
  results.replaceChildren()
  status.dataset.state = 'running'
  status.textContent = '실제 에디터·임시 저장소 검사 중'
  await check('기존 TableKit의 HTML→Markdown 병합 손실을 재현한다', () => {
    const editor = makeEditor(examples[0][1], { baseline: true })
    try {
      assert(editor.view.dom.querySelector('[rowspan="2"]'), '기본 HTML 파싱부터 실패')
      assert(!editor.getMarkdown().includes('rowspan'), '기존 TableKit 손실 조건이 달라짐')
    } finally { editor.destroy() }
  })
  for (const [name, html, expected] of examples) await check(`${name}: 생성→재조회→편집·저장 3회→보기`, () => roundTrip(html, expected))
  await check('HTML 표는 병합을 풀고 저장해도 HTML 유형을 유지한다', async () => {
    let memo = await api('create', { content: examples[2][1] })
    const editor = makeEditor(memo.content)
    try {
      let cellPosition = -1
      editor.state.doc.descendants((node, position) => {
        if (cellPosition < 0 && ['tableCell', 'tableHeader'].includes(node.type.name) && (node.attrs.rowspan > 1 || node.attrs.colspan > 1)) cellPosition = position
      })
      assert(cellPosition >= 0, '병합된 셀을 찾지 못함')
      editor.commands.setTextSelection(cellPosition + 2)
      assert(editor.commands.splitCell(), '기존 splitCell 명령 실패')
      same(tableFormat(editor), 'html', '병합 해제 직후 유형')
      assert(spans(editor).every(cell => cell[1] === '1' && cell[2] === '1'), '병합이 남음')
      const content = editor.getMarkdown()
      assert(content.includes('<table data-memo-table="html"'), '병합 해제 후 Markdown으로 변환됨')
      memo = await api('update', { id: memo.id, baseVersion: memo.version, content })
    } finally { editor.destroy() }
    memo = await api('get', { id: memo.id })
    const reopened = makeEditor(memo.content)
    try {
      same(tableFormat(reopened), 'html', '병합 해제 저장/재조회 유형')
      const content = reopened.getMarkdown()
      assert(content.includes('<table data-memo-table="html"'), '다시 저장할 때 HTML 유형 손실')
      assert(canonicalMarkdown(content) === canonicalMarkdown(memo.content), '병합 없는 HTML 최초 저장 비교 실패')
    } finally { reopened.destroy() }
  })
  await check('서식·안전한 링크·HTML처럼 생긴 글자·상대 이미지 경로를 반복 저장한다', async () => {
    const html = '<table><tr><td rowspan="2">유형</td><td><p><strong>굵게</strong> <em>기울임</em> <u>밑줄</u> <s>취소</s> <a href="https://example.com/?a=1&amp;b=2">링크</a> <code>&lt;script&gt;&amp; \"문자\"</code></p><p><img src="assets/synthetic/plot.png" alt="합성 그림"></p></td></tr><tr><td>둘째</td></tr></table>'
    let memo = await api('create', { content: html })
    for (let pass = 0; pass < 2; pass++) {
      memo = await api('get', { id: memo.id })
      const editor = makeEditor(memo.content)
      try {
        const dom = editor.view.dom
        for (const selector of ['strong', 'em', 'u', 's', 'a', 'code', 'img']) assert(dom.querySelector(selector), `서식 손실: ${selector}`)
        assert(dom.textContent?.includes('<script>& "문자"'), 'escaped 글자 손실')
        assert(dom.querySelector('img')?.getAttribute('src') === '/__synthetic-image/assets/synthetic/plot.png', '화면 주소 매핑 손실')
        editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: `일반 수정 ${pass}` }] })
        const content = editor.getMarkdown()
        assert(content.includes('src="assets/synthetic/plot.png"') && !content.includes('/__synthetic-image/'), '저장 원문에 화면 주소가 섞임')
        assert(editor.getHTML().includes('src="/__synthetic-image/assets/synthetic/plot.png"'), '저장 후 HTML/클립보드용 화면 주소 매핑이 변경됨')
        assert(!content.includes('<script>'), 'escaped 글자가 실행 태그로 변환됨')
        memo = await api('update', { id: memo.id, baseVersion: memo.version, content })
      } finally { editor.destroy() }
    }
  })
  await check('스크립트·스타일·이벤트·javascript 링크를 허용하지 않는다', () => {
    const sentinel = window as typeof window & { __memoTableScriptExecuted?: boolean }
    sentinel.__memoTableScriptExecuted = false
    const source = '<table onclick="window.__memoTableScriptExecuted=true"><tr><td rowspan="2" onclick="window.__memoTableScriptExecuted=true">정상<script>window.__memoTableScriptExecuted=true</script><style>body{display:none}</style><a href="javascript:alert(1)">위험 링크</a></td><td>하나</td></tr><tr><td>둘</td></tr></table>'
    const editor = makeEditor(source)
    try {
      const normalized = editor.getMarkdown()
      assert(!sentinel.__memoTableScriptExecuted, 'HTML 파싱에서 스크립트 실행')
      assert(!editor.view.dom.querySelector('script,style,[onclick],[onerror],a[href^="javascript:"]'), '위험 DOM 잔존')
      assert(!/onclick|<script|<style|javascript:/i.test(normalized), '위험 HTML이 저장 문자열에 잔존')
      assert(canonicalMarkdown(source) !== canonicalMarkdown(normalized), '위험 속성 제거를 형식 동등으로 잘못 인정함')
    } finally { editor.destroy() }
  })
  await check('유효하지 않은 병합 값은 1로 읽는다', () => {
    for (const span of ['0', '-2', '1.5', 'Infinity', '1000000000', '2x']) {
      const editor = makeEditor(`<table><tr><td rowspan="${span}" colspan="${span}">검사</td><td>옆</td></tr></table>`)
      try { same(spans(editor), [['TD', '1', '1'], ['TD', '1', '1']], `잘못된 span ${span}`) }
      finally { editor.destroy() }
    }
  })
  await check('일반 Markdown 표는 기존 GFM 형식을 유지한다', async () => {
    const source = '| 유형 | 오늘 요약 |\n| --- | --- |\n| 개발 | **표 검증** |'
    let memo = await api('create', { content: source })
    const editor = makeEditor(memo.content)
    try {
      same(tableFormat(editor), 'markdown', 'GFM 파싱 유형')
      const content = editor.getMarkdown()
      assert(content.includes('|') && !content.includes('<table'), '일반 표가 HTML로 변환됨')
      assert(canonicalMarkdown(content) === canonicalMarkdown(source), '기존 Markdown 형식 비교 변경')
      memo = await api('update', { id: memo.id, baseVersion: memo.version, content })
      const loaded = await api('get', { id: memo.id })
      assert(loaded.content.includes('**표 검증**'), '기존 셀 서식 손실')
    } finally { editor.destroy() }
  })
  await check('Markdown 표의 HTML 클립보드 표시를 읽어도 Markdown 유형을 유지한다', () => {
    const source = '| 유형 | 오늘 요약 |\n| --- | --- |\n| 개발 | 원래 내용 |'
    const editor = makeEditor(source)
    let html: string
    try {
      same(tableFormat(editor), 'markdown', '원본 GFM 유형')
      html = editor.getHTML()
      assert(html.includes('data-memo-table="markdown"'), '클립보드 유형 표시 누락')
    } finally { editor.destroy() }
    const pasted = makeEditor(html, { contentType: 'html' })
    try {
      same(tableFormat(pasted), 'markdown', 'HTML 클립보드 재파싱 유형')
      assert(!pasted.getMarkdown().includes('<table'), '앱 내부 복사 후 HTML 표로 변환됨')
      assert(canonicalMarkdown(pasted.getMarkdown()) === canonicalMarkdown(source), 'HTML 클립보드 내용 손실')
    } finally { pasted.destroy() }
    const merged = makeEditor(examples[0][1].replace('<table>', '<table data-memo-table="markdown">'))
    try {
      same(tableFormat(merged), 'html', '병합이 있는 Markdown 표시는 HTML로 승격해야 함')
      assert(merged.getMarkdown().includes('rowspan="2"'), '유형 표시 때문에 병합 손실')
    } finally { merged.destroy() }
  })
  await check('속성·span·내용 변경과 fenced HTML 코드의 형식 손실 검사는 유지한다', () => {
    const source = examples[0][1]
    const normalizedEditor = makeEditor(source)
    let normalized: string
    try { normalized = normalizedEditor.getMarkdown() }
    finally { normalizedEditor.destroy() }
    assert(canonicalMarkdown(source) === canonicalMarkdown(normalized), '지원한 표만 정규화해야 함')
    for (const changed of [source.replace('rowspan="2"', 'rowspan="2" data-extra="값"'), source.replace('rowspan="2"', 'rowspan="3"'), source.replace('표 병합', '내용 변경')]) {
      assert(canonicalMarkdown(changed) !== canonicalMarkdown(normalized), '의미/미지원 속성 차이를 잃음')
    }
    const plainHtml = examples[3][1]
    assert(canonicalMarkdown(plainHtml.replace('<table>', '<table data-memo-table="markdown">')) !== canonicalMarkdown(plainHtml.replace('<table>', '<table data-memo-table="html">')), 'HTML/Markdown 유형 차이를 지움')
    assert(canonicalMarkdown(plainHtml.replace('<table>', '<table data-memo-table="unknown">')) !== canonicalMarkdown(plainHtml.replace('<table>', '<table data-memo-table="html">')), '미지원 유형 표시를 무시함')
    const fence = '```html\n' + source + '\n```'
    assert(canonicalMarkdown(fence) === canonicalMarkdown(fence), '변경 없는 fence가 달라짐')
    assert(canonicalMarkdown(fence) !== canonicalMarkdown('```html\n' + normalized + '\n```'), 'fence 안 HTML까지 정규화함')
    const unsupported = '<div data-original="yes">그대로</div>\n\n' + source
    assert(canonicalMarkdown(unsupported) !== canonicalMarkdown('그대로\n\n' + normalized), '표 밖 HTML 손실 검사를 완화함')
  })
  await check('rowspan 외곽: 개발은 왼쪽 아래, 다음 행 첫 DOM 셀인 검증은 왼쪽 외곽이 아니다', () => {
    for (const readonly of [false, true]) {
      const editor = makeEditor(examples[0][1], { readonly })
      try {
        cellLayout(editor, '유형', ['edge-s', 'edge-t', 'corner-tl'])
        cellLayout(editor, '오늘 요약', ['edge-t', 'corner-tr'])
        cellLayout(editor, '개발', ['edge-s', 'corner-bl'])
        cellLayout(editor, '검증', ['corner-br'])
        assert(!editor.getMarkdown().includes('memo-table-corner'), '보기용 모서리 class가 저장됨')
        if (!readonly) {
          editCell(editor, '개발')
          cellLayout(editor, '개발 수정', ['edge-s', 'corner-bl'])
          cellLayout(editor, '검증', ['corner-br'])
          cellLayout(editor, '유형', ['edge-s', 'edge-t', 'corner-tl'])
        }
      } finally { editor.destroy() }
    }
  })
  await check('colspan 외곽: 가로 병합 헤더 하나가 위쪽 두 실제 모서리를 가진다', () => {
    const editor = makeEditor(examples[1][1])
    try {
      cellLayout(editor, '오늘 요약', ['edge-s', 'edge-t', 'corner-tl', 'corner-tr'])
      cellLayout(editor, '개발', ['edge-s', 'corner-bl'])
      cellLayout(editor, '검증', ['corner-br'])
      editCell(editor, '오늘 요약')
      cellLayout(editor, '오늘 요약 수정', ['edge-s', 'edge-t', 'corner-tl', 'corner-tr'])
      cellLayout(editor, '개발', ['edge-s', 'corner-bl'])
      cellLayout(editor, '검증', ['corner-br'])
    } finally { editor.destroy() }
  })
  await check('일반 GFM 외곽은 셀 편집과 표 앞 문단 삽입 뒤에도 정확히 갱신된다', () => {
    const editor = makeEditor('| 유형 | 요약 |\n| --- | --- |\n| 개발 | 구현 |\n| 검증 | 완료 |')
    try {
      cellLayout(editor, '유형', ['edge-s', 'edge-t', 'corner-tl'])
      cellLayout(editor, '요약', ['edge-t', 'corner-tr'])
      cellLayout(editor, '개발', ['edge-s'])
      cellLayout(editor, '구현', [])
      cellLayout(editor, '검증', ['edge-s', 'corner-bl'])
      cellLayout(editor, '완료', ['corner-br'])
      editCell(editor, '검증')
      cellLayout(editor, '유형', ['edge-s', 'edge-t', 'corner-tl'])
      cellLayout(editor, '요약', ['edge-t', 'corner-tr'])
      cellLayout(editor, '개발', ['edge-s'])
      cellLayout(editor, '구현', [])
      cellLayout(editor, '검증 수정', ['edge-s', 'corner-bl'])
      cellLayout(editor, '완료', ['corner-br'])
      same(tableFormat(editor), 'markdown', '레이아웃 갱신 후 GFM 유형')
      const content = editor.getMarkdown()
      assert(!content.includes('<table') && !content.includes('memo-table-corner'), '보기용 레이아웃이 GFM 저장 형식에 섞임')
    } finally { editor.destroy() }
  })
  for (const columns of [2, 3, 4] as const) {
    await check(`${columns}열: 삽입·저장·재조회 3회·읽기 전용에서 내용과 이미지 경로 유지`, async () => {
      const html = `<div data-memo-columns="${columns}">${Array.from({ length: columns }, (_, index) => `<div data-memo-column><h2>열 ${index + 1}</h2><p><strong>굵은 글씨</strong>와 <u>밑줄</u></p>${index === 0 ? '<p><img src="assets/example.png" alt="견본 사진"></p><ul><li><p>목록 항목</p></li></ul><pre><code class="language-js">const value = 1\n\nconsole.log(value)</code></pre><table><tr><th>항목</th><th>내용</th></tr><tr><td>예시</td><td>표 본문</td></tr></table>' : '<p>다른 열의 본문</p>'}</div>`).join('')}</div>`
      const first = makeEditor(html)
      let stored: string
      try {
        same(first.view.dom.querySelector('[data-memo-columns]')?.children.length, columns, '최초 열 수')
        stored = first.getMarkdown()
        assert(stored.includes('assets/example.png') && !stored.includes('/__synthetic-image/'), '이미지 저장 경로가 화면 주소로 바뀜')
      } finally { first.destroy() }
      let memo = await api('create', { content: stored })
      for (let pass = 0; pass < 3; pass++) {
        memo = await api('get', { id: memo.id })
        const editor = makeEditor(memo.content)
        try {
          const group = editor.view.dom.querySelector('[data-memo-columns]')
          same(group?.getAttribute('data-memo-columns'), String(columns), '다시 읽은 열 수')
          same(group?.children.length, columns, '열 자식 수')
          assert(group?.textContent?.includes('console.log(value)') && group.textContent.includes('표 본문'), '코드 블록·표 내용 손실')
          assert(group?.querySelector('strong') && group.querySelector('u') && group.querySelector('ul'), '서식·목록 손실')
          const normalized = editor.getMarkdown()
          assert(canonicalMarkdown(normalized) === canonicalMarkdown(memo.content), '다시 열기에서 형식 손실 경고가 생김')
          editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: `열 밖 수정 ${pass}` }] })
          const content = editor.getMarkdown()
          assert(!content.includes('/__synthetic-image/'), '반복 저장 중 이미지 경로 오염')
          memo = await api('update', { id: memo.id, baseVersion: memo.version, content })
        } finally { editor.destroy() }
      }
      const readonly = makeEditor(memo.content, { readonly: true })
      try {
        assert(!readonly.isEditable, '읽기 전용 컬럼이 편집 가능함')
        same(readonly.view.dom.querySelector('[data-memo-columns]')?.children.length, columns, '읽기 전용 열 수')
      } finally { readonly.destroy() }
    })
  }
  await check('열 수 변경·축소·해제·실행 취소에서 모든 본문을 보존한다', () => {
    const editor = makeEditor('<div data-memo-columns="4"><div data-memo-column><p>첫째</p></div><div data-memo-column><p>둘째</p></div><div data-memo-column><p>셋째</p></div><div data-memo-column><p>넷째</p></div></div>')
    try {
      const original = editor.state.doc.textContent
      editor.commands.setTextSelection(3)
      assert(editor.commands.setMemoColumns(2), '4→2열 변경 실패')
      same(editor.state.doc.textContent, original, '축소 시 내용 순서')
      same(editor.view.dom.querySelector('[data-memo-columns]')?.children.length, 2, '축소된 열 수')
      assert(editor.commands.setMemoColumns(3), '2→3열 변경 실패')
      same(editor.state.doc.textContent, original, '확대 시 내용 순서')
      assert(editor.commands.unsetMemoColumns(), '열 해제 실패')
      assert(!editor.view.dom.querySelector('[data-memo-columns]'), '해제 후 열이 남음')
      same(editor.state.doc.textContent, original, '해제 시 내용 순서')
      assert(editor.commands.undo(), '열 해제 실행 취소 실패')
      same(editor.view.dom.querySelector('[data-memo-columns]')?.children.length, 3, '실행 취소 후 열 수')
    } finally { editor.destroy() }
  })
  await check('일반 문단을 열로 감싸고 해제해도 기존 문단이 남는다', () => {
    const editor = makeEditor('기존 문단')
    try {
      editor.commands.setTextSelection(2)
      assert(editor.commands.setMemoColumns(2), '문단을 2열로 바꾸지 못함')
      same(editor.state.doc.textContent, '기존 문단', '삽입 전 내용 보존')
      assert(editor.commands.unsetMemoColumns(), '열 해제 실패')
      assert(editor.getMarkdown().includes('기존 문단'), '해제 후 기존 문단 손실')
    } finally { editor.destroy() }
  })
  status.dataset.state = failed ? 'failed' : 'passed'
  status.textContent = failed ? `FAIL · ${count}개 중 ${failed}개 실패` : `PASS · ${count}개 회귀 검사 통과`
  run.disabled = false
})
