import { Editor } from '@tiptap/core'
import type { AnyExtension } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { memoExtensions } from '../../app/utils/editor-extensions'
import { canonicalMarkdown } from '../../app/pages/m/_modules/useMemoAutosave'
import type { Memo } from '../../shared/types/memo'
import { MemoBlockSelection } from '../../app/utils/editor-interactions'
import { applyMemoPaste } from '../../app/utils/editor-paste'

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
function listCursor(editor: Editor, text: string, offset = 2) {
  let position = -1
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) position = pos + Math.min(offset, node.nodeSize) })
  assert(position >= 0, `목록 문장을 찾지 못함: ${text}`)
  editor.commands.setTextSelection(position)
}
function listTab(editor: Editor, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}
function listAncestors(editor: Editor) {
  const { $from } = editor.state.selection
  return Array.from({ length: $from.depth }, (_, index) => $from.node(index + 1).type.name)
}
function editorKey(editor: Editor, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}
function modKey(editor: Editor, key: string, options: KeyboardEventInit = {}) {
  return editorKey(editor, key, { ...options, ...(/Mac|iPhone|iPad/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }) })
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
  await check('빈 체크 항목 Enter는 목록에서 빠져나오고 앞 항목을 유지한다', () => {
    const editor = makeEditor('- [ ] 앞 항목\n- [ ] ')
    try {
      let position = -1
      editor.state.doc.descendants((node, pos) => { if (node.type.name === 'taskItem' && !node.textContent) position = pos + 2 })
      assert(position >= 0, '빈 체크 항목 파싱 실패')
      editor.commands.setTextSelection(position)
      assert(editorKey(editor, 'Enter'), '빈 항목 Enter 미처리')
      same(editor.view.dom.querySelectorAll('li[data-checked]').length, 1, '앞 항목까지 목록에서 빠짐')
      same(listAncestors(editor), ['paragraph'], '빈 항목이 본문으로 빠져나오지 않음')
      assert(editor.state.doc.textContent.includes('앞 항목'), '앞 항목 내용 손실')
    } finally { editor.destroy() }
  })
  await check('조합 중 Enter·Backspace·Tab은 블록 명령을 실행하지 않는다', () => {
    const editor = makeEditor('- [ ] 앞 항목\n- [x] 한글 조합')
    try {
      listCursor(editor, '한글 조합')
      const original = editor.getJSON()
      for (const key of ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape']) editorKey(editor, key, { isComposing: true })
      same(editor.getJSON(), original, '한글 조합에서 문서 구조가 바뀜')
    } finally { editor.destroy() }
  })
  await check('중첩 항목 맨 앞 Backspace는 본문과 손자 항목을 잃지 않는다', () => {
    const editor = makeEditor('- [ ] 부모\n  - [ ] 자식\n    - [x] 손자\n  - [ ] 다음')
    try {
      listCursor(editor, '자식', 0)
      const before = editor.state.doc.textContent
      assert(editorKey(editor, 'Backspace'), '블록 경계 Backspace 미처리')
      same(editor.state.doc.textContent, before, '블록 경계 Backspace에서 글자 손실')
      assert([...editor.view.dom.querySelectorAll('li[data-checked="true"]')].some(node => node.textContent?.includes('손자')), '손자 체크 상태 손실')
      editor.state.doc.check()
    } finally { editor.destroy() }
  })
  await check('문단 끝 Delete는 다음 목록 항목과 자식의 글자를 보존한다', () => {
    const editor = makeEditor('- [ ] 첫째\n- [x] 둘째\n  - [ ] 자식')
    try {
      listCursor(editor, '첫째', '첫째'.length)
      const before = editor.state.doc.textContent
      assert(editorKey(editor, 'Delete'), '블록 경계 Delete 미처리')
      same(editor.state.doc.textContent, before, '블록 경계 Delete에서 글자 손실')
      editor.state.doc.check()
    } finally { editor.destroy() }
  })
  await check('Esc 블록 선택·Shift+방향키·복제·삭제가 선택된 블록만 처리한다', () => {
    const editor = makeEditor('하나\n\n둘\n\n셋')
    try {
      listCursor(editor, '하나')
      assert(editorKey(editor, 'Escape'), 'Esc 블록 선택 미처리')
      assert(editor.state.selection instanceof MemoBlockSelection, '문자 선택과 블록 선택이 구분되지 않음')
      assert(editor.view.dom.querySelector('[data-memo-block-selected]'), '블록 선택 표시 없음')
      assert(editorKey(editor, 'ArrowDown', { shiftKey: true }), '블록 선택 확장 미처리')
      assert(modKey(editor, 'd'), '블록 묶음 복제 미처리')
      same(editor.state.doc.textContent, '하나둘하나둘셋', '선택하지 않은 블록까지 복제됨')
      assert(editorKey(editor, 'Backspace'), '선택된 블록 삭제 미처리')
      same(editor.state.doc.textContent, '하나둘셋', '선택하지 않은 블록이 삭제됨')
    } finally { editor.destroy() }
  })
  await check('목록 블록 이동에서 자식·체크 상태·실행 취소 선택을 유지한다', () => {
    const editor = makeEditor('- [ ] 앞 항목\n- [x] 이동 항목\n  - [ ] 원래 자식\n- [ ] 뒤 항목')
    try {
      listCursor(editor, '이동 항목')
      const before = editor.getJSON()
      assert(editorKey(editor, 'Escape'), '목록 블록 선택 미처리')
      assert(modKey(editor, 'ArrowUp', { shiftKey: true }), '목록 블록 위로 이동 미처리')
      const first = editor.state.doc.firstChild!.firstChild!
      assert(first.textContent.includes('이동 항목원래 자식') && first.attrs.checked === true, '이동에서 항목 속성/자식 손실')
      assert(editor.commands.undo(), '목록 이동 실행 취소 실패')
      same(editor.getJSON(), before, '목록 이동 실행 취소 문서')
    } finally { editor.destroy() }
  })
  await check('Ctrl/⌘+Enter는 현재 체크 항목만 완료 전환한다', () => {
    const editor = makeEditor('- [ ] 부모\n  - [ ] 자식')
    try {
      listCursor(editor, '부모')
      assert(modKey(editor, 'Enter'), '체크 완료 단축키 미처리')
      assert(editor.state.doc.firstChild!.firstChild!.attrs.checked === true, '현재 체크 항목 완료 미반영')
      assert(editor.state.doc.firstChild!.firstChild!.lastChild!.firstChild!.attrs.checked === false, '자식 체크 항목까지 변경됨')
    } finally { editor.destroy() }
  })
  await check('모바일 목록 명령의 can 검사는 변경 없이 실제 경계를 표시한다', () => {
    const editor = makeEditor('- [ ] 앞 항목\n- [ ] 다음 항목')
    try {
      listCursor(editor, '앞 항목')
      const original = editor.getJSON()
      assert(!editor.can().indentMemoList() && !editor.can().outdentMemoList(), '첫 항목/최상위 경계 검사 오류')
      same(editor.getJSON(), original, 'can 검사가 문서를 수정함')
      listCursor(editor, '다음 항목')
      assert(editor.can().indentMemoList(), '모바일 들여쓰기 가능 상태 누락')
      assert(editor.commands.indentMemoList(), '모바일 들여쓰기 명령 실패')
      assert(editor.can().outdentMemoList(), '모바일 내어쓰기 가능 상태 누락')
    } finally { editor.destroy() }
  })
  await check('붙여넣기 방식 선택은 Markdown과 평문을 구분한다', () => {
    const editor = makeEditor('')
    try {
      assert(applyMemoPaste(editor, '**글자**', '', 'plain'), '평문 붙여넣기 실패')
      assert(!editor.view.dom.querySelector('strong') && editor.state.doc.textContent === '**글자**', '평문이 서식으로 변환됨')
      editor.commands.setContent('', { contentType: 'markdown' })
      assert(applyMemoPaste(editor, '**글자**', '', 'markdown'), 'Markdown 붙여넣기 실패')
      assert(editor.view.dom.querySelector('strong'), 'Markdown 서식 누락')
      editor.commands.setContent('', { contentType: 'markdown' })
      assert(applyMemoPaste(editor, '글자', '<strong>글자</strong>', 'formatted'), '서식 유지 붙여넣기 실패')
      assert(editor.view.dom.querySelector('strong'), 'HTML 서식 누락')
    } finally { editor.destroy() }
  })
  await check('서식 없이 붙여넣기 단축키는 Markdown 자동 변환보다 먼저 처리한다', () => {
    const editor = makeEditor('')
    try {
      modKey(editor, 'v', { shiftKey: true })
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', '**평문**\n<script>문자</script>')
      const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
      editor.view.dom.dispatchEvent(event)
      assert(event.defaultPrevented, '평문 붙여넣기 미처리')
      assert(!editor.view.dom.querySelector('strong,script'), '평문에서 서식/HTML 노드 생성')
      assert(editor.state.doc.textContent.includes('**평문**') && editor.state.doc.textContent.includes('<script>문자</script>'), '평문 문자 손실')
    } finally { editor.destroy() }
  })
  for (const marker of ['- [x]', '-', '1.']) await check(`${marker}: Tab·Shift+Tab 왕복에서 항목·커서·자식 유지`, () => {
    const editor = makeEditor(`${marker} 부모\n${marker} 이동할 항목\n   ${marker} 자식`)
    try {
      listCursor(editor, '이동할 항목')
      const before = editor.getJSON()
      const offset = editor.state.selection.$from.parentOffset
      assert(listTab(editor), 'Tab을 처리하지 않음')
      assert(listAncestors(editor).filter(type => type === (marker.includes('[') ? 'taskItem' : 'listItem')).length === 2, '한 단계 하위로 이동하지 않음')
      assert(listTab(editor, true), 'Shift+Tab을 처리하지 않음')
      same(editor.getJSON(), before, '왕복 뒤 문서 구조')
      same(editor.state.selection.$from.parentOffset, offset, '왕복 뒤 커서')
    } finally { editor.destroy() }
  })
  for (const marker of ['- [ ]', '-', '1.']) await check(`${marker}: 첫 항목 Tab·최상위 Shift+Tab은 서식과 포커스 유지`, () => {
    const editor = makeEditor(`${marker} 첫 항목\n${marker} 다음 항목`)
    try {
      listCursor(editor, '첫 항목')
      const before = editor.getJSON()
      assert(listTab(editor), '첫 항목 Tab이 편집기 밖으로 빠짐')
      same(editor.getJSON(), before, '첫 항목 Tab이 문서를 바꿈')
      assert(listTab(editor, true), '최상위 Shift+Tab이 편집기 밖으로 빠짐')
      same(editor.getJSON(), before, '최상위 Shift+Tab이 목록 서식을 제거함')
    } finally { editor.destroy() }
  })
  await check('체크리스트 안의 글머리 Tab은 현재 글머리만 들여쓴다', () => {
    const editor = makeEditor('- [ ] 앞 할 일\n- [ ] 부모 할 일\n  - 첫 글머리\n  - 둘째 글머리')
    try {
      listCursor(editor, '둘째 글머리')
      assert(listTab(editor), '혼합 목록 Tab 미처리')
      same(listAncestors(editor), ['taskList', 'taskItem', 'bulletList', 'listItem', 'bulletList', 'listItem', 'paragraph'], '혼합 목록에서 상위 할 일이 움직임')
      assert(listTab(editor, true), '혼합 목록 Shift+Tab 미처리')
      same(listAncestors(editor), ['taskList', 'taskItem', 'bulletList', 'listItem', 'paragraph'], '혼합 목록 왕복')
    } finally { editor.destroy() }
  })
  await check('글머리 안의 첫 체크 항목 Tab이 상위 글머리를 움직이지 않는다', () => {
    const editor = makeEditor('- 앞 글머리\n- 부모 글머리\n  - [x] 첫 체크 항목')
    try {
      listCursor(editor, '첫 체크 항목')
      const before = editor.getJSON()
      assert(listTab(editor), '첫 체크 항목 Tab 미처리')
      same(editor.getJSON(), before, '상위 글머리가 들여써짐')
    } finally { editor.destroy() }
  })
  await check('목록 뒤 일반 문단은 커서 중간에서도 Tab으로 들어가고 Shift+Tab으로 복귀한다', () => {
    const editor = makeEditor('- [ ] 부모\n\n설명 문단')
    try {
      listCursor(editor, '설명 문단')
      const before = editor.getJSON()
      assert(listTab(editor), '문단 중간 Tab 미처리')
      same(listAncestors(editor), ['taskList', 'taskItem', 'paragraph'], '설명 문단이 부모 안으로 들어가지 않음')
      same(editor.state.selection.$from.parentOffset, 2, '들여쓰기에서 커서 위치 손실')
      assert(listTab(editor, true), '설명 문단 Shift+Tab 미처리')
      // 끝이 목록이 되는 동안 StarterKit이 끝의 빈 문단을 보충할 수 있다.
      same(editor.getJSON().content?.slice(0, 2), before.content, '설명 대신 부모 목록 전체가 움직임')
      same(listAncestors(editor), ['paragraph'], '설명 문단이 최상위로 복귀하지 않음')
      same(editor.state.selection.$from.parentOffset, 2, '내어쓰기에서 커서 위치 손실')
    } finally { editor.destroy() }
  })
  await check('서로 다른 목록 종류에서 내어써도 체크 상태와 항목 종류를 보존한다', () => {
    const editor = makeEditor('- 부모 글머리\n  - [x] 완료 항목\n  - [ ] 뒤 항목\n- 다음 글머리')
    try {
      listCursor(editor, '완료 항목')
      assert(listTab(editor, true), '혼합 목록 내어쓰기 미처리')
      same(listAncestors(editor), ['taskList', 'taskItem', 'paragraph'], '내어쓰기에서 체크 항목 유형 손실')
      assert(editor.state.selection.$from.node(-1).attrs.checked === true, '내어쓰기에서 완료 상태 손실')
      assert(editor.getMarkdown().includes('뒤 항목') && editor.getMarkdown().includes('다음 글머리'), '형제 내용 손실')
    } finally { editor.destroy() }
  })
  for (const [outer, inner] of [['-', '- [x]'], ['- [ ]', '-'], ['1.', '- [x]'], ['- [ ]', '1.'], ['-', '1.'], ['1.', '-']] as const) {
    await check(`${outer} 안의 ${inner}: 중간 항목 내어쓰기에서 앞·뒤 형제와 자식을 보존`, () => {
      const editor = makeEditor(`${outer} 앞 부모\n${outer} 현재 부모\n  ${inner} 앞 형제\n  ${inner} 이동 항목\n    ${inner} 원래 자식\n  ${inner} 뒤 형제\n${outer} 뒤 부모`)
      try {
        listCursor(editor, '이동 항목')
        const order = editor.state.doc.textContent
        const listType = editor.state.selection.$from.node(-2).type.name
        assert(listTab(editor, true), '혼합 중간 항목 내어쓰기 미처리')
        same(editor.state.doc.textContent, order, '혼합 내어쓰기의 읽기 순서/내용')
        same(editor.state.selection.$from.parentOffset, 2, '혼합 내어쓰기 커서 위치')
        assert(listAncestors(editor).length === 3, '한 단계 밖으로 나오지 않음')
        same(editor.state.selection.$from.node(-2).type.name, listType, '내어쓰기에서 글머리/번호 유형 손실')
        editor.state.doc.check()
        const markdown = editor.getMarkdown()
        const reopened = makeEditor(markdown)
        try { same(reopened.getJSON(), editor.getJSON(), '혼합 내어쓰기 저장 형식') }
        finally { reopened.destroy() }
      } finally { editor.destroy() }
    })
  }
  await check('여러 체크 항목을 함께 들여쓰고 내어써도 선택과 자식이 유지된다', () => {
    const editor = makeEditor('- [ ] 부모\n- [x] 첫 선택\n  - [ ] 원래 자식\n- [ ] 끝 선택')
    try {
      listCursor(editor, '첫 선택', 1)
      const from = editor.state.selection.from
      listCursor(editor, '끝 선택', 2)
      editor.commands.setTextSelection({ from, to: editor.state.selection.to })
      const before = editor.getJSON()
      const selected = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)
      assert(listTab(editor), '범위 Tab 미처리')
      assert(listTab(editor, true), '범위 Shift+Tab 미처리')
      same(editor.getJSON(), before, '범위 왕복 문서')
      same(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to), selected, '범위 왕복 선택')
    } finally { editor.destroy() }
  })
  for (const [outer, inner] of [['-', '- [x]'], ['- [ ]', '-'], ['-', '1.'], ['1.', '-']] as const) {
    await check(`${outer} 안의 ${inner}: 내어쓰기 후 Tab으로 원래 부모에 복귀`, () => {
      const editor = makeEditor(`${outer} 부모\n  ${inner} 이동 항목`)
      try {
        listCursor(editor, '이동 항목')
        const before = editor.getJSON()
        assert(listTab(editor, true), '혼합 내어쓰기 미처리')
        assert(listTab(editor), '인접한 다른 목록 아래로 Tab 미처리')
        same(editor.getJSON(), before, '다른 종류 목록의 왕복 구조')
        same(editor.state.selection.$from.parentOffset, 2, '다른 종류 목록의 왕복 커서')
      } finally { editor.destroy() }
    })
  }
  await check('목록 들여쓰기는 한 번씩 실행 취소·다시 실행하고 저장·재조회해도 유지된다', async () => {
    const editor = makeEditor('- [ ] 부모\n- [x] 완료 자식')
    try {
      listCursor(editor, '완료 자식')
      const before = editor.getJSON()
      assert(listTab(editor), 'Tab 미처리')
      const indented = editor.getJSON()
      assert(editor.commands.undo(), '실행 취소 실패')
      same(editor.getJSON(), before, '실행 취소 문서')
      assert(editor.commands.redo(), '다시 실행 실패')
      same(editor.getJSON(), indented, '다시 실행 문서')
      const memo = await api('create', { content: editor.getMarkdown() })
      const saved = await api('get', { id: memo.id })
      const reopened = makeEditor(saved.content)
      try { same(reopened.getJSON(), indented, '목록 저장·재조회 구조') }
      finally { reopened.destroy() }
    } finally { editor.destroy() }
  })
  await check('표 안의 Tab·Shift+Tab은 목록 이동 대신 다음·이전 셀로 이동한다', () => {
    const editor = makeEditor('<table><tr><td><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>셀 체크</p></li></ul></td><td>옆 셀</td></tr></table>')
    try {
      listCursor(editor, '셀 체크')
      const before = editor.getJSON()
      assert(listTab(editor), '표 Tab 미처리')
      same(editor.state.selection.$from.parent.textContent, '옆 셀', '표 Tab이 다음 셀로 이동하지 않음')
      assert(listTab(editor, true), '표 Shift+Tab 미처리')
      same(editor.state.selection.$from.parent.textContent, '셀 체크', '표 Shift+Tab이 이전 셀로 복귀하지 않음')
      same(editor.getJSON(), before, '표 이동이 목록 구조를 바꿈')
    } finally { editor.destroy() }
  })
  await check('목록 안의 코드 Tab·Shift+Tab은 코드만 들여쓰고 목록을 움직이지 않는다', () => {
    const editor = makeEditor('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>앞 항목</p></li><li data-type="taskItem" data-checked="false"><p>코드 부모</p><pre><code>const result = 1</code></pre></li></ul>')
    try {
      listCursor(editor, 'const result = 1', 0)
      const before = editor.getJSON()
      assert(listTab(editor), '코드 Tab 미처리')
      assert(/^ +const result/.test(editor.state.selection.$from.parent.textContent), '코드 대신 부모 목록이 움직임')
      assert(listTab(editor, true), '코드 Shift+Tab 미처리')
      same(editor.getJSON(), before, '코드 들여쓰기 왕복이 목록을 바꿈')
    } finally { editor.destroy() }
  })
  await check('Shift+Enter는 체크 항목 안의 줄바꿈, Enter는 다음 체크 항목을 만든다', () => {
    const editor = makeEditor('- [x] 입력 문장')
    try {
      listCursor(editor, '입력 문장', '입력 문장'.length)
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
      same(editor.view.dom.querySelectorAll('li[data-checked]').length, 1, 'Shift+Enter가 항목을 나눔')
      assert(editor.view.dom.querySelector('li[data-checked] p br'), 'Shift+Enter의 블록 내부 줄바꿈 없음')
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      same(editor.view.dom.querySelectorAll('li[data-checked]').length, 2, 'Enter가 다음 체크 항목을 만들지 않음')
    } finally { editor.destroy() }
  })
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
