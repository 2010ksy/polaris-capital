// 북극성 자산운용 — 카카오 로그인 OAuth 교환 (Netlify Function)
//
// 카카오 로그인은 [인가코드 → 토큰 → 사용자정보] 단계가 필요하다.
// 토큰 교환(/oauth/token)은 client_secret을 쓰며 브라우저에서 직접 호출 시
// CORS로 막히고 비밀키가 노출되므로, 이 서버리스 함수가 대신 처리한다.
//
// 필요 환경변수(Netlify → Site settings → Environment variables):
//   KAKAO_REST_KEY        : 카카오 앱의 REST API 키 (필수)
//   KAKAO_CLIENT_SECRET   : 카카오 로그인 > 보안 > Client Secret (사용 설정 시)
//
// 호출: POST /api/kakao  { code, redirectUri }
//   → { id, email, nickname }  (실패 시 { error })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const json = (status, obj) => ({ statusCode: status, headers: CORS, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST 메서드만 허용됩니다.' });

  const restKey = process.env.KAKAO_REST_KEY;
  if (!restKey) return json(500, { error: '서버에 KAKAO_REST_KEY가 설정되지 않았습니다.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: '잘못된 요청 본문' }); }
  const { code, redirectUri } = body;
  if (!code || !redirectUri) return json(400, { error: 'code와 redirectUri가 필요합니다.' });

  try {
    // 1) 인가코드 → 액세스 토큰
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: restKey,
      redirect_uri: redirectUri,
      code,
    });
    if (process.env.KAKAO_CLIENT_SECRET) form.set('client_secret', process.env.KAKAO_CLIENT_SECRET);
    const tr = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: form.toString(),
    });
    const tj = await tr.json();
    if (!tr.ok || !tj.access_token) {
      return json(401, { error: tj.error_description || tj.error || '카카오 토큰 발급에 실패했습니다.' });
    }

    // 2) 토큰 → 사용자 정보
    const ur = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: 'Bearer ' + tj.access_token, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    });
    const uj = await ur.json();
    if (!ur.ok || uj.id == null) return json(401, { error: uj.msg || '카카오 사용자 정보 조회에 실패했습니다.' });

    const acc = uj.kakao_account || {};
    const prof = acc.profile || uj.properties || {};
    const id = String(uj.id);
    return json(200, {
      id,
      email: acc.email || null,                    // 이메일 동의 미수집 시 null
      nickname: prof.nickname || ('카카오회원' + id.slice(-4)),
    });
  } catch (e) {
    return json(502, { error: String(e) });
  }
};
