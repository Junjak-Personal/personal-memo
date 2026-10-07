# ops/ — 메모 백업 (설계문서 §12)

nivoca `be/ops/` 와 같은 구조다. 메모는 DB 가 아니라 파일이라 `pg_dump` 대신 tar 로 뜬다.

| 파일 | 어디서 | 역할 |
|---|---|---|
| `memo-backup.sh` | N100 | `memos/` → tar.gz (assets/ 이미지 제외, `.trash` 포함) → 검증 → 14일 로테이션 |
| `memo-backup.service` | N100 | oneshot 유닛 (User=junja, 도커 불필요) |
| `memo-backup.timer` | N100 | 매일 19:30 UTC (= 04:30 KST), `Persistent=true` |
| `memo-offsite-pull.sh` | 맥 | 박스에 있고 맥에 없는 백업만 scp → `~/memo-backups/`, 60일 보관, 삭제 동기화 안 함 |
| `win.jun-devlog.memo.offsite-pull.plist` | 맥 | launchd, 매일 06:40 KST |

**이미지는 백업하지 않는다 (확정).** 디스크가 죽으면 본문은 되살아나지만 본문 속 이미지 링크는 깨진 채로 남는다.

검증: `gzip -t` + 아카이브 안 `.md` 개수 = 직전에 센 디스크 `.md` 개수. 다르면 한 번 다시 뜨고, 그래도 다르면 실패한다
(`.partial` 은 지우고 최종 이름을 주지 않는다 — 실패한 백업이 성공한 것처럼 남지 않는다).

## 설치 — 박스 (오너가 직접, 운영 박스 상태 변경)

```bash
# 1) 스크립트 배치
ssh junserver 'mkdir -p ~/ops'
scp ops/memo-backup.sh junserver:'~/ops/'
ssh junserver 'chmod +x ~/ops/memo-backup.sh'

# 2) 한 번 손으로 돌려서 실제로 되는지 본다 (타이머보다 먼저)
ssh junserver '~/ops/memo-backup.sh'
#    → "✔ /home/junja/backups/memo/memo-<stamp>.tar.gz (.md N개, …)" 이 나와야 한다

# 3) 통과했을 때만 타이머를 건다
scp ops/memo-backup.service ops/memo-backup.timer junserver:'~/'
ssh -t junserver 'sudo mv ~/memo-backup.{service,timer} /etc/systemd/system/ && \
  sudo systemctl daemon-reload && sudo systemctl enable --now memo-backup.timer'

# 4) 확인
ssh junserver 'systemctl list-timers memo-backup.timer --no-pager'
```

## 설치 — 맥

```bash
mkdir -p ~/memo-backups
cp ops/win.jun-devlog.memo.offsite-pull.plist ~/Library/LaunchAgents/
launchctl load  ~/Library/LaunchAgents/win.jun-devlog.memo.offsite-pull.plist
launchctl start win.jun-devlog.memo.offsite-pull     # 즉시 1회 실행해 검증 (박스에 백업이 하나는 있어야 한다)
cat ~/memo-backups/offsite-pull.log
```

⚠ plist 의 경로는 이 저장소의 체크아웃 위치(`~/develop/personal/personal-memo`)에 묶여 있다. 옮기면 같이 고친다.

## 복원 (오너가 직접)

**박스에서 푼다.** 맥의 tar 는 한글 파일 이름을 NFD 로 바꿔 넣거나 풀 수 있어(2026-10-07 실측: 맥에서 뜬 아카이브는
이름이 NFD), 맥에서 풀어 서버로 옮기면 같은 이름이 바이트로는 다른 파일이 된다.

```bash
# 1) 먼저 옆에 풀어 본다 — 지금 데이터를 바로 덮지 않는다
mkdir -p ~/memo-restore && tar -xzf ~/backups/memo/memo-<stamp>.tar.gz -C ~/memo-restore
find ~/memo-restore/memos -name '*.md' | wc -l

# 2) 바꿀 때: 컨테이너를 멈추고, 지금 memos/ 를 옆으로 치운 뒤 옮긴다 (assets/ 이미지는 백업에 없으니 옛 폴더에서 다시 가져온다)
docker stop personal-memo
mv ~/apps/personal-memo/data/memos ~/apps/personal-memo/data/memos.before-restore
mv ~/memo-restore/memos ~/apps/personal-memo/data/memos
docker start personal-memo
```

## 검증 [실측 2026-10-07, 맥에서 임시 폴더로]

- 한글·공백 이름, 휴지통(`.trash/업무/…`), 이미지·원본, 사용자가 `assets` 라는 폴더에 둔 `.md`, 빈 폴더, `.txt` 를 넣은 트리 →
  백업 → 복원 → 원본과 대조: 16개 항목(폴더·파일) 내용까지 같음(NFC 기준), 이미지 0개.
- 개수 불일치(심볼릭 링크 `.md` — find 는 안 세고 tar 는 넣는다) → 두 번 뜨고 실패, 찌꺼기 없음. 메모 폴더 없음 → 실패.
- 로테이션: 20일 된 백업 지움, 10일 된 것 남김, 이틀 된 `.partial` 지움.
- 오프사이트 pull (ssh/scp 를 로컬로 흉내): 신규 2 → 전부 건너뜀 → 깨진 전송본 버리고 실패 → 원격이 비면 실패.
- 박스(GNU tar 1.35)에서 `/tmp` 의 가짜 트리로 한 번 돌림(설치 없이 `ssh … bash -s < ops/memo-backup.sh`):
  `.md` 4개·휴지통·빈 폴더 들어감, 이미지·원본 빠짐, 복원본이 원본과 바이트까지 같음. 시험 폴더는 지웠다.
  실제 데이터로 도는 것은 설치 2) 단계가 처음이다.
