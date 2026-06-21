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

## 다중 사용자 모드 (Supabase) — 여러 기기·사용자 공유

기본은 localStorage(단일 브라우저)지만, **Supabase**(무료 Auth+Postgres)로 전환하면 모든 기기·사용자가
데이터를 공유하고 관리자가 전체 회원을 진짜로 관리할 수 있습니다. 코드는 이미 포함되어 있습니다
(`assets/core-supabase.js`, `assets/config.js`, `supabase/schema.sql`).

### 설정 절차
1. https://supabase.com 에서 무료 프로젝트 생성
2. **SQL Editor** → `supabase/schema.sql` 전체 붙여넣고 실행 (테이블·RLS·트리거 생성)
3. **Authentication → Providers → Email** → "Confirm email" **끄기** (데모용 즉시 로그인)
4. **Project Settings → API** 에서 `Project URL` 과 `anon public` 키 복사
5. `assets/config.js` 의 `supabaseUrl`, `supabaseAnonKey` 채우기
6. 3개 HTML의 코어 파일을 교체 (한 줄):
   ```sh
   cd netlify-site
   sed -i '' 's#assets/core.js#assets/core-supabase.js#' index.html dashboard.html admin.html
   ```
   (되돌리려면 반대로 `core-supabase.js` → `core.js`)
7. 배포 또는 `netlify dev` 로 확인. 첫 회원으로 가입한 뒤, 본인을 관리자로 승격:
   ```sql
   update public.profiles set role='admin'
   where id = (select id from auth.users where email='2010ksy@gmail.com');
   ```

### 참고/한계
- `anon` 키는 공개되어도 되는 키입니다(RLS로 행 단위 보호). **`service_role` 키는 절대 넣지 마세요.**
- 회원 삭제는 anon 권한으로 profiles/accounts 행만 지웁니다. **Auth 계정 자체 삭제**는
  Supabase 대시보드(또는 service_role)에서 해야 합니다.
- Supabase 모드에서는 데모 오너 자동생성이 없습니다(직접 가입 후 위 SQL로 admin 승격).
- 로컬/Supabase 어느 쪽이든 **시세는 동일하게 Netlify Function 프록시**를 사용합니다.
