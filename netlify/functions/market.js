// 북극성 자산운용 — 시세 프록시 (Netlify Function)
// Yahoo Finance / Naver 금융은 브라우저에서 직접 호출 시 CORS로 차단되므로
// 이 서버리스 함수가 대신 요청해 CORS 헤더를 붙여 돌려준다.
//
// 호출 예:
//   /api/market?provider=yahoo&symbol=AAPL&interval=1d&range=1d
//   /api/market?provider=yahoo&symbol=AAPL&interval=1mo&period1=1420070400
//   /api/market?provider=naver&code=000660&kind=stock
//   /api/market?provider=naver&code=KOSPI&kind=index

const UA = { 'User-Agent': 'Mozilla/5.0' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  const q = event.queryStringParameters || {};
  try {
    let url;
    if (q.provider === 'naver') {
      const kind = q.kind === 'index' ? 'index' : 'stock';
      if (!q.code) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'code 필요' }) };
      url = `https://polling.finance.naver.com/api/realtime/domestic/${kind}/${encodeURIComponent(q.code)}`;
    } else {
      // yahoo (기본)
      if (!q.symbol) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'symbol 필요' }) };
      const interval = q.interval || '1d';
      let qs = `interval=${encodeURIComponent(interval)}`;
      if (q.range) qs += `&range=${encodeURIComponent(q.range)}`;
      if (q.period1) {
        const p2 = q.period2 || Math.floor(Date.now() / 1000);
        qs += `&period1=${encodeURIComponent(q.period1)}&period2=${encodeURIComponent(p2)}`;
      }
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(q.symbol)}?${qs}`;
    }
    const r = await fetch(url, { headers: UA });
    const text = await r.text();
    return { statusCode: r.status, headers: CORS, body: text };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: String(e) }) };
  }
};
