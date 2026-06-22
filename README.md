# 북극성 자산운용 (POLARIS CAPITAL)

데이터 기반 자산운용 데모 웹앱. **Netlify 정적 호스팅 + 서버리스 함수 + Supabase(Auth/Postgres)** 구조.

- 🌐 **배포 주소**: https://polaris-capital-suyeon.netlify.app
- 📦 **저장소**: https://github.com/2010ksy/polaris-capital
- 현재 **Supabase 모드**(클라우드 DB)로 동작 → 여러 기기·사용자가 데이터 공유.

---

## 1. 구현된 기능 (대분류)

### ① 회원·인증
- 이메일/비밀번호 회원가입·로그인·로그아웃 (Supabase Auth)
- 카카오 로그인(OAuth) — *코드 완비, 키 설정 시 활성화* (→ TODO)
- 가입 시 **미가입 상태로 시작** → 이후 상품 선택/가입
- 권한 구분: 고객 / 관리자

### ② 상품(포트폴리오)
- 기본 모델 포트폴리오 3종: 안정형 · 균형형 · 성장형
- 관리자 **커스텀 상품 추가·삭제** (종목·비중·목표수익률·위험도 직접 구성)
- 고객의 **상품 선택 가입** (기본 + 커스텀 모두)

### ③ 다중 가입 & 대시보드
- **1인 다중 상품 가입** (기존 1인 1계정 → 다중 계정 구조로 전환)
- **통합 요약 대시보드**(총자산·총수익) + **상품별 탭 전환** 개별 대시보드
- 상품별 보유자산 평가 · 예상수익 비교 · 가입 해지

### ④ 자산 점검 & 전환
- 미가입 고객용 **현재 보유 자산 입력(점검)** → 평가액·수익률 합산
- 전환 전/후 구성 비교 후 **총평가액을 모델 비중으로 자동 배분(전환 가입)**

### ⑤ 분석·시각화
- **자산 추이 그래프** (가입~현재 월별 평가금액 곡선, 통합/상품별)
- **리밸런싱 도우미** (목표비중 대비 매수/매도 금액·예상수량)
- 향후 가이드 (규칙 기반 코멘트)

### ⑥ 실시간 시장 동향 (`market.html`)
- 미국·한국 **지수·VIX·환율 실시간 표시** (인트라데이 스파크라인)
- 관심종목 **상승/하락 상위 · 시장 폭(breadth)** 집계
- **규칙 기반 시황 분석** + **AI 자연어 분석**(Claude) — *AI는 키 설정 시 활성화* (→ TODO)
- 60초 자동 갱신

### ⑦ 리포트·공유
- 투자/시장 **리포트 PDF 저장·인쇄**
- **메일 공유** (mailto 방식 + 본문이 길면 클립보드 폴백)

### ⑧ 인프라·데이터
- **Supabase 실연동** (클라우드 DB, 다기기·다사용자·영속 저장, RLS 보안)
- Netlify Functions: 시세 프록시 · 카카오 OAuth 교환 · AI 분석
- 실시간 시세·환율: Yahoo Finance / 네이버 금융 (프록시 경유)

---

## 2. 파일 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 랜딩(회사소개·포트폴리오·백테스트·시장동향 링크·로그인/회원가입) |
| `dashboard.html` | 고객 대시보드(통합요약·상품별 탭·자산점검/전환·추이·리밸런싱·리포트) |
| `admin.html` | 관리자(회원 다중계정 집계·삭제, 커스텀 상품 추가/삭제) |
| `market.html` | 실시간 시장 동향 + 규칙기반/AI 시황 분석 |
| `assets/config.js` | 실행 모드 설정(Supabase URL/키, 카카오 키) |
| `assets/core-supabase.js` | **현재 사용 중인 코어** (Supabase 백엔드) |
| `assets/core.js` | localStorage 코어 (오프라인/데모용, 현재 미사용) |
| `netlify/functions/market.js` | 시세 프록시(Yahoo/Naver, CORS 우회) → `/api/market` |
| `netlify/functions/kakao-auth.js` | 카카오 OAuth 코드→토큰 교환 → `/api/kakao` |
| `netlify/functions/ai-analyze.js` | Claude 시황 분석 → `/api/ai` |
| `supabase/schema.sql` | DB 스키마(profiles·accounts·products·snapshots + RLS + 트리거) |
| `package.json` | 함수 의존성(`@anthropic-ai/sdk`) |
| `backtest_data.json` | 백테스트 결과(정적) |
| `netlify.toml`, `_redirects` | Netlify 설정/리다이렉트 |

> **코어 전환**: `assets/config.js`의 키를 비우고 4개 HTML의 `core-supabase.js`를 `core.js`로 바꾸면 localStorage(단일 브라우저) 모드로 되돌아갑니다.

---

## 3. 배포 / 로컬 실행

```sh
# 배포 (Netlify CLI)
cd netlify-site
netlify deploy --prod

# 로컬 (함수 포함)
netlify dev        # http://localhost:8888
```
※ `index.html`을 파일로 직접 열면 함수(`/api/*`)가 동작하지 않습니다. `netlify dev` 또는 배포 후 확인하세요.

### Supabase 설정 (이미 적용됨 — 참고용)
1. https://supabase.com 프로젝트 생성
2. SQL Editor에 `supabase/schema.sql` 실행 (테이블·RLS·트리거)
3. Authentication → Providers → Email → **"Confirm email" 끄기** (데모 즉시 로그인)
4. Project Settings → API → `Project URL` + `anon public` 키 → `assets/config.js`에 입력
5. 첫 회원 가입 후 본인을 관리자로 승격 (아래 TODO 참고)

> ⚠️ `anon` 키는 공개돼도 되는 키(RLS로 보호). **`service_role` 키는 절대 클라이언트/저장소에 넣지 마세요.**

---

## 4. 추가로 작업할 사항 (TODO / 미완료)

> 나중에 놓치지 않도록 정리. ☐ = 미완료, ▶ = 키/외부 설정 필요.

### A. 활성화만 하면 되는 것 (코드는 완성됨)
- ☐ ▶ **AI 시황 분석 켜기** — Netlify 환경변수 `ANTHROPIC_API_KEY` 설정 후 재배포.
  - 키 발급: https://console.anthropic.com · 모델은 `claude-opus-4-8` 사용(사용량 과금).
  - 미설정 시 버튼 누르면 "서버에 키가 설정되지 않았습니다" 안내(안전).
- ☐ ▶ **카카오 로그인 켜기** — 카카오 개발자 앱 생성 후:
  - `assets/config.js`의 `kakaoRestKey` + Netlify 환경변수 `KAKAO_REST_KEY`(같은 값, 선택적으로 `KAKAO_CLIENT_SECRET`)
  - 카카오 콘솔: 카카오 로그인 활성화, Redirect URI = `https://polaris-capital-suyeon.netlify.app/`, Web 플랫폼 도메인 등록, 본인 카카오계정을 팀원(테스터)으로 추가
  - 개인앱이어도 본인·팀원은 로그인 가능. 일반 공개·이메일 수집은 비즈니스 앱 전환 필요(개인 무료 신청 가능).
- ☐ **관리자 승격** — 앱에서 회원가입 후 Supabase SQL Editor에서 1회 실행:
  ```sql
  update public.profiles set role='admin'
  where email = '가입한_이메일주소';
  ```

### B. 선택적 개선 (원하면 진행)
- ☐ ▶ **실제 서버 메일 발송** — 현재는 `mailto`(메일 앱 초안 열기)+클립보드 폴백.
  버튼 클릭 시 자동 발송하려면 Resend/SendGrid 등 + Netlify 함수 + API 키 연동 필요.
- ☐ **거래·입출금 내역(트랜잭션)** — 추가 납입/일부 인출/가입·해지 이력 타임라인.
- ☐ **정기 리포트 자동 메일** — Netlify 스케줄 함수로 월간/주간 리포트 발송.
- ☐ **종목 검색 자동완성** — 커스텀 상품/자산점검에서 코드 수기입력 → 이름 검색 UI.
- ☐ **모바일 반응형·로딩 UX 점검** — 좁은 화면 표/탭, 스켈레톤 로딩.
- ☐ **시장동향 고도화** — 섹터/업종, 금리·유가 등 거시지표 추가.

### C. 운영·보안 점검 (실서비스 전)
- ☐ **이메일 인증 재검토** — 데모용으로 "Confirm email"을 꺼둠. 실서비스 전 재활성 검토.
- ☐ **회원 완전 삭제 한계** — anon 권한으론 `profiles/accounts/snapshots` 행만 삭제됨.
  **Auth 계정 자체 삭제**는 Supabase 대시보드 또는 service_role 필요.
- ☐ **service_role 키 관리** — 절대 클라이언트/저장소에 두지 말 것.
- ☐ **데이터 정확도 고지** — 시세는 무료 비공식 데이터(지연·오류 가능),
  자산추이는 보유수량×과거 월별시세 재구성(근사치), 예상수익은 단순 복리 추정. 투자자문 아님.

---

## 5. 참고
- 기존 localStorage 데모 계정(`2010ksy@gmail.com` / `polaris1234`)은 **Supabase 모드에선 사용 불가** → 새로 가입 필요.
- 시세/환율은 외부 무료 데이터를 사용하며 지연·오류가 있을 수 있습니다.
- 본 사이트는 **데모/프로토타입**이며 실제 투자 자문·운용·권유가 아닙니다.
