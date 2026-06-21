/* 북극성 자산운용 — 실행 모드 설정
 *
 * 기본값(빈 문자열) = 로컬 모드: 회원/계정이 브라우저 localStorage에 저장됩니다(단일 브라우저).
 *
 * 다중 사용자(여러 기기·사용자 공유)를 쓰려면:
 *   1) https://supabase.com 에서 프로젝트 생성
 *   2) SQL Editor 에 supabase/schema.sql 실행
 *   3) Auth → Providers → Email 에서 "Confirm email" 끄기(데모용 즉시 로그인)
 *   4) 아래 두 값을 프로젝트의 URL / anon public key 로 채우기
 *   5) index/dashboard/admin.html 의 core.js → core-supabase.js 로 교체
 *      (README의 한 줄 sed 명령 참고)
 *
 * ⚠️ anon key는 공개되어도 되는 키입니다(RLS로 보호). service_role 키는 절대 넣지 마세요.
 */
window.POLARIS_CONFIG = {
  supabaseUrl: "",      // 예: "https://abcdefgh.supabase.co"
  supabaseAnonKey: "",  // 예: "eyJhbGciOiJIUzI1NiIsInR5cCI6..."
};
