# 북극성 자산운용 (POLARIS CAPITAL) — Netlify 배포판

Python 서버 버전(`app.py`)과 **동일한 기능**을 Netlify 정적 호스팅 + 서버리스 함수 구조로 재구성한 사이트입니다.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 랜딩(회사소개·포트폴리오·실시간배분·백테스트·로그인/회원가입) |
| `dashboard.html` | 고객 대시보드(평가·수익률·예상비교·포트폴리오수정·가이드·PDF·메일) |
| `admin.html` | 관리자(전체 회원·AUM·수익률·삭제) |
| `assets/core.js` | 클라이언트 코어(포트폴리오·시세계산·인증·계정) |
| `netlify/functions/market.js` | 시세 프록시(Yahoo/Naver, CORS 우회) |
| `backtest_data.json` | 백테스트 결과(정적) |
| `netlify.toml`, `_redirects` | Netlify 설정 |

## 서버 버전과 달라진 점 (중요)

- **회원/계정 저장 = 브라우저 localStorage** (서버 DB 대신). 즉 **데이터가 브라우저별로 분리**됩니다.
  관리자 페이지의 "전체 회원"도 **해당 브라우저에 가입한 회원**만 보입니다.
  → 진짜 다중 사용자(여러 기기 공유)가 필요하면 외부 DB(Supabase/Firebase 등) 연동이 필요합니다(아래 참고).
- 시세/환율은 **Netlify Function 프록시**를 통해 가져옵니다(브라우저 직접호출은 CORS로 차단되므로).
- 비밀번호는 WebCrypto PBKDF2로 해싱해 localStorage에 저장합니다.

## 데모 계정

최초 접속 시 자동 생성됩니다.
- 이메일: `2010ksy@gmail.com`
- 비밀번호: `polaris1234` (관리자 겸 고객, 균형형·1년 전 시작)

---

## 배포 방법 (택1)

### A. 드래그&드롭 (가장 쉬움)
1. https://app.netlify.com 로그인 → **Add new site → Deploy manually**
2. 이 `netlify-site` 폴더를 통째로 드래그&드롭
3. 함수(`netlify/functions/market.js`)도 함께 업로드되어 자동 인식됩니다.

### B. Netlify CLI
```sh
npm install -g netlify-cli
cd netlify-site
netlify deploy --prod        # 안내에 따라 사이트 생성/배포
```

### C. Git 연동
1. 이 폴더를 GitHub 저장소로 push
2. Netlify에서 **Import from Git** → 저장소 선택
3. Build command: 비움 / Publish directory: `netlify-site`(또는 루트) / Functions: 자동

## 로컬 테스트
```sh
npm install -g netlify-cli
cd netlify-site
netlify dev                  # http://localhost:8888 (함수 포함 로컬 구동)
```
※ `index.html`을 파일로 직접 열면 시세 함수(`/api/market`)가 동작하지 않습니다. 반드시 `netlify dev` 또는 배포 후 확인하세요.

---

## (선택) 진짜 다중 사용자로 확장
localStorage 대신 외부 DB를 쓰면 기기·사용자 간 공유가 됩니다.
- 가장 쉬운 길: **Supabase**(무료) — Auth + Postgres. `core.js`의 `store`/`API`를 Supabase 호출로 교체.
- 또는 Netlify Functions + 외부 DB(FaunaDB/Supabase)로 서버 로직 이전.
필요하면 연동 코드를 추가해 드릴 수 있습니다.
