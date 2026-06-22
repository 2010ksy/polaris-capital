// 북극성 자산운용 — AI 시황 분석 (Netlify Function)
//
// 시장 동향 화면이 수집한 지수·환율·종목 데이터를 받아 Claude로 자연어 시황
// 해설을 생성한다. 비밀키 보호를 위해 호출은 서버(함수)에서만 이뤄진다.
//
// 필요 환경변수: ANTHROPIC_API_KEY  (https://console.anthropic.com 에서 발급)
// 호출: POST /api/ai  { snapshot }   → { text }

const Anthropic = require('@anthropic-ai/sdk');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const json = (status, obj) => ({ statusCode: status, headers: CORS, body: JSON.stringify(obj) });

const SYSTEM = `당신은 한국의 자산운용사 '북극성 자산운용'의 시장 전략가입니다.
입력으로 주어지는 실시간 시장 데이터(미국·한국 지수, 변동성지수(VIX), 원/달러 환율, 주요 종목 등락)를 바탕으로
한국어로 간결하고 전문적인 시황 해설을 작성하세요.

작성 규칙:
- 분량은 한국어 400~600자 내외. 군더더기 없이 핵심만.
- 다음 순서의 짧은 단락/불릿으로 구성: ① 한 줄 총평 ② 미국·한국 증시 해석 ③ 변동성·환율 코멘트 ④ 오늘의 관전 포인트 ⑤ 고객 대응 제언(분할매수·리밸런싱·관망 등 일반론).
- 제공된 수치 범위를 벗어나는 단정·예측은 피하고, 데이터에 근거해 설명하세요.
- 특정 종목 매수/매도 추천이나 수익 보장 표현은 사용하지 마세요(투자 자문이 아닌 참고용 해설).
- 인사말·서론·메타발언 없이 본문만 출력하세요.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST 메서드만 허용됩니다.' });
  if (!process.env.ANTHROPIC_API_KEY) return json(500, { error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: '잘못된 요청 본문' }); }
  const snapshot = body.snapshot;
  if (!snapshot) return json(400, { error: 'snapshot이 필요합니다.' });

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: '다음은 현재 시점의 시장 데이터(JSON)입니다. 이 데이터에 근거해 시황 해설을 작성해 주세요.\n\n'
          + '```json\n' + JSON.stringify(snapshot, null, 2) + '\n```',
      }],
    });
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return json(200, { text, model: msg.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json(429, { error: '요청이 많아 잠시 후 다시 시도해 주세요.' });
    if (e instanceof Anthropic.AuthenticationError) return json(401, { error: 'AI 분석 인증에 실패했습니다(API 키 확인 필요).' });
    const status = (e && e.status) || 502;
    return json(status >= 400 && status < 600 ? status : 502, { error: 'AI 분석 생성 중 오류: ' + (e && e.message ? e.message : String(e)) });
  }
};
