/* 북극성 자산운용 — 클라이언트 코어 (Netlify 정적 배포용)
 *
 * 서버(Python+SQLite) 없이 브라우저에서 동작:
 *  - 시세/환율/월별 데이터: Netlify Function(/api/market) 프록시 경유
 *  - 회원/계정 데이터: localStorage (비밀번호는 WebCrypto PBKDF2 해싱)
 *  - 포트폴리오 평가·예상수익·가이드 계산을 클라이언트에서 수행
 *
 * window.Polaris 로 노출.
 */
(function () {
  "use strict";

  const COMPANY = {
    name: "북극성 자산운용", nameEn: "POLARIS CAPITAL",
    slogan: "데이터로 항해하는 자산관리", seed: 100000000, founded: 2026,
  };

  const PORTFOLIOS = [
    { id: "stable", name: "안정형", tag: "Conservative", risk: 2, target: "연 5~7%", mid: 0.06,
      desc: "변동성을 낮추고 자본을 지키는 데 초점. 우량 대형주와 지수 ETF, 넉넉한 현금성 자산.",
      holdings: [
        { market: "KR", code: "005930", label: "삼성전자", weight: 12 },
        { market: "KR", code: "105560", label: "KB금융", weight: 8 },
        { market: "US", code: "AAPL", label: "애플", weight: 10 },
        { market: "US", code: "MSFT", label: "마이크로소프트", weight: 10 },
        { market: "US", code: "SPY", label: "S&P500 ETF", weight: 25 },
        { market: "CASH", code: "CASH", label: "현금성 자산", weight: 35 }] },
    { id: "balanced", name: "균형형", tag: "Balanced", risk: 3, target: "연 8~12%", mid: 0.10,
      desc: "성장과 안정의 균형. 한·미 우량 성장주와 지수 ETF를 고르게 분산.",
      holdings: [
        { market: "KR", code: "005930", label: "삼성전자", weight: 12 },
        { market: "KR", code: "000660", label: "SK하이닉스", weight: 8 },
        { market: "KR", code: "035420", label: "NAVER", weight: 6 },
        { market: "US", code: "AAPL", label: "애플", weight: 10 },
        { market: "US", code: "MSFT", label: "마이크로소프트", weight: 10 },
        { market: "US", code: "GOOGL", label: "알파벳", weight: 8 },
        { market: "US", code: "NVDA", label: "엔비디아", weight: 6 },
        { market: "US", code: "SPY", label: "S&P500 ETF", weight: 20 },
        { market: "US", code: "QQQ", label: "나스닥100 ETF", weight: 10 },
        { market: "CASH", code: "CASH", label: "현금성 자산", weight: 10 }] },
    { id: "growth", name: "성장형", tag: "Growth", risk: 5, target: "연 13~20%", mid: 0.165,
      desc: "높은 변동성을 감수하고 장기 초과수익 추구. 기술 성장주와 2차전지 중심.",
      holdings: [
        { market: "KR", code: "000660", label: "SK하이닉스", weight: 12 },
        { market: "KR", code: "005930", label: "삼성전자", weight: 8 },
        { market: "KR", code: "373220", label: "LG에너지솔루션", weight: 8 },
        { market: "KR", code: "035720", label: "카카오", weight: 6 },
        { market: "US", code: "NVDA", label: "엔비디아", weight: 14 },
        { market: "US", code: "TSLA", label: "테슬라", weight: 10 },
        { market: "US", code: "AAPL", label: "애플", weight: 8 },
        { market: "US", code: "META", label: "메타", weight: 8 },
        { market: "US", code: "AMZN", label: "아마존", weight: 8 },
        { market: "US", code: "QQQ", label: "나스닥100 ETF", weight: 12 },
        { market: "CASH", code: "CASH", label: "현금성 자산", weight: 6 }] },
  ];
  const PMAP = Object.fromEntries(PORTFOLIOS.map((p) => [p.id, p]));
  const KR_TO_YAHOO = {
    "005930": "005930.KS", "000660": "000660.KS", "035420": "035420.KS",
    "105560": "105560.KS", "373220": "373220.KS", "035720": "035720.KS",
  };
  const API_BASE = "/api/market";

  // ---------------- 시세 (함수 프록시 경유) ----------------
  async function jget(url) {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  async function fetchUS(symbol) {
    const d = await jget(`${API_BASE}?provider=yahoo&symbol=${encodeURIComponent(symbol)}&interval=1d&range=1d`);
    const m = d.chart.result[0].meta;
    const price = m.regularMarketPrice, prev = m.chartPreviousClose || m.previousClose;
    const change = (price != null && prev != null) ? price - prev : null;
    return { price, changePct: (change != null && prev) ? change / prev * 100 : null, name: m.shortName || symbol };
  }
  async function fetchKR(code, kind) {
    const d = await jget(`${API_BASE}?provider=naver&code=${encodeURIComponent(code)}&kind=${kind || "stock"}`);
    const x = (d.datas || [])[0];
    const num = (k) => x[k] != null ? parseFloat(x[k]) : null;
    return { price: num("closePriceRaw"), changePct: num("fluctuationsRatioRaw"), name: x.stockName };
  }
  async function fetchFX() {
    const d = await jget(`${API_BASE}?provider=yahoo&symbol=${encodeURIComponent("USDKRW=X")}&interval=1d&range=1d`);
    return d.chart.result[0].meta.regularMarketPrice;
  }
  async function fetchMonthly(symbol) {
    const p1 = Math.floor(new Date("2015-01-01").getTime() / 1000);
    const d = await jget(`${API_BASE}?provider=yahoo&symbol=${encodeURIComponent(symbol)}&interval=1mo&period1=${p1}`);
    const r = d.chart.result[0], ts = r.timestamp;
    const ind = r.indicators || {};
    const adj = ind.adjclose ? ind.adjclose[0].adjclose : ind.quote[0].close;
    const out = {}; // ym(number=year*12+month-1) -> value
    ts.forEach((t, i) => {
      const dt = new Date(t * 1000), v = adj[i];
      if (v != null) out[dt.getUTCFullYear() * 12 + dt.getUTCMonth()] = v;
    });
    return out;
  }
  function ymKey(dateStr) {
    const [y, m] = dateStr.split("-").map(Number);
    return y * 12 + (m - 1);
  }
  function nearest(map, target) {
    if (map[target] != null) return map[target];
    const keys = Object.keys(map).map(Number).filter((k) => k <= target);
    if (keys.length) return map[Math.max(...keys)];
    const all = Object.keys(map).map(Number);
    return all.length ? map[Math.min(...all)] : null;
  }
  function ySymbol(market, code) {
    return market === "US" ? code : (market === "KR" ? KR_TO_YAHOO[code] : null);
  }

  async function entryPricesKRW(holdings, startYm) {
    const fxm = await fetchMonthly("USDKRW=X");
    const fx = nearest(fxm, startYm);
    const entries = await Promise.all(holdings.map(async (h) => {
      if (h.market === "CASH") return [h.code, 0];
      const m = await fetchMonthly(ySymbol(h.market, h.code));
      const px = nearest(m, startYm);
      return [h.code, h.market === "US" ? px * fx : px];
    }));
    return Object.fromEntries(entries);
  }

  async function livePricesKRW(holdings, fx) {
    const out = {};
    await Promise.all(holdings.map(async (h) => {
      if (h.market === "CASH") { out[h.code] = { price: null, changePct: 0 }; return; }
      try {
        if (h.market === "US") { const d = await fetchUS(h.code); out[h.code] = { price: d.price * fx, changePct: d.changePct }; }
        else { const d = await fetchKR(h.code, "stock"); out[h.code] = { price: d.price, changePct: d.changePct }; }
      } catch (e) { out[h.code] = { price: null, changePct: 0, err: true }; }
    }));
    return out;
  }

  // ---------------- 계정 평가 ----------------
  async function computeAccount(acc, fx) {
    const port = PMAP[acc.portfolioId] || PMAP.balanced;
    if (fx == null) { try { fx = await fetchFX(); } catch (e) { fx = 1350; } }
    const quotes = await livePricesKRW(acc.holdings, fx);

    const sd = new Date(acc.startDate + "T00:00:00");
    const elapsedDays = Math.max(1, Math.round((Date.now() - sd.getTime()) / 86400000));
    const elapsedYears = elapsedDays / 365.25;
    const cashFactor = Math.pow(1.03, elapsedYears);

    let totalCost = 0, totalNow = 0, dayChange = 0;
    const rows = acc.holdings.map((h) => {
      const cost = acc.seed * h.weight / 100; totalCost += cost;
      let cur, price = null, chg = 0, ret;
      if (h.market === "CASH") { cur = cost * cashFactor; ret = cur / cost - 1; }
      else { const q = quotes[h.code] || {}; price = q.price; chg = q.changePct || 0; cur = price ? h.units * price : cost; ret = cost ? cur / cost - 1 : 0; }
      totalNow += cur; dayChange += (h.weight / 100) * chg;
      return { market: h.market, code: h.code, label: h.label, weight: h.weight, entry: h.entry, price, cost, value: cur, ret, dayChange: chg, curWeight: 0 };
    });
    rows.forEach((r) => { r.curWeight = totalNow ? r.value / totalNow * 100 : r.weight; });

    const curRet = acc.seed ? totalNow / acc.seed - 1 : 0;
    const mid = port.mid || 0.10;
    const expValue = acc.seed * Math.pow(1 + mid, elapsedYears);
    const expRet = expValue / acc.seed - 1;
    return {
      portfolioId: acc.portfolioId, portfolioName: port.name, target: port.target,
      seed: acc.seed, startDate: acc.startDate, elapsedYears: Math.round(elapsedYears * 100) / 100,
      fx, holdings: rows, totalCost, totalValue: totalNow, currentReturn: curRet, dayChange,
      expectedValue: expValue, expectedReturn: expRet, gap: totalNow - expValue,
      guide: buildGuidance(port, curRet, expRet, rows),
    };
  }

  function buildGuidance(port, curRet, expRet, rows) {
    const g = [];
    const diff = curRet - expRet;
    if (diff >= 0.02) g.push(["good", `현재 수익률이 기대치를 ${(diff * 100).toFixed(1)}%p 상회합니다. 일부 차익실현 후 비중을 목표로 되돌리는 리밸런싱을 고려하세요.`]);
    else if (diff <= -0.02) g.push(["warn", `현재 수익률이 기대치를 ${(Math.abs(diff) * 100).toFixed(1)}%p 하회합니다. 단기 변동일 수 있으니 장기 관점 유지를 권합니다. 손실 종목의 펀더멘털을 점검하세요.`]);
    else g.push(["ok", "현재 수익률이 기대 경로와 유사합니다. 계획대로 유지(Stay the course)하세요."]);
    const drift = rows.filter((r) => Math.abs(r.curWeight - r.weight) >= 5);
    if (drift.length) g.push(["warn", `목표 대비 비중 이탈이 큰 자산: ${drift.slice(0, 4).map((r) => `${r.label}(${(r.curWeight - r.weight >= 0 ? "+" : "") + (r.curWeight - r.weight).toFixed(1)}%p)`).join(", ")}. 정기 리밸런싱으로 위험을 관리하세요.`]);
    else g.push(["ok", "자산별 비중이 목표 범위 내에 있습니다. 추가 조치는 불필요합니다."]);
    if (port.risk >= 5) g.push(["ok", "성장형은 변동성이 큽니다. 단기 등락에 흔들리지 말고 분할매수·장기보유 원칙을 지키세요."]);
    else if (port.risk <= 2) g.push(["ok", "안정형은 방어적입니다. 여유 자금이 있다면 일부를 균형형으로 이전해 기대수익을 높이는 것도 방법입니다."]);
    else g.push(["ok", "균형형은 수익-위험의 중간 지대입니다. 분기 점검과 연 1회 리밸런싱을 권장합니다."]);
    return g.map(([level, text]) => ({ level, text }));
  }

  // ---------------- localStorage 저장소 ----------------
  const store = {
    users: () => JSON.parse(localStorage.getItem("polaris_users") || "[]"),
    setUsers: (v) => localStorage.setItem("polaris_users", JSON.stringify(v)),
    accounts: () => JSON.parse(localStorage.getItem("polaris_accounts") || "{}"),
    setAccounts: (v) => localStorage.setItem("polaris_accounts", JSON.stringify(v)),
    session: () => localStorage.getItem("polaris_session"),
    setSession: (id) => id ? localStorage.setItem("polaris_session", String(id)) : localStorage.removeItem("polaris_session"),
  };

  // ---------------- 비밀번호 해싱 (WebCrypto PBKDF2) ----------------
  function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
  function unhex(s) { const a = new Uint8Array(s.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(s.substr(i * 2, 2), 16); return a; }
  async function hashPw(pw, saltHex) {
    const enc = new TextEncoder();
    const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
    return { salt: hex(salt), hash: hex(bits) };
  }
  async function verifyPw(pw, saltHex, hashHex) {
    const { hash } = await hashPw(pw, saltHex);
    return hash === hashHex;
  }

  function nextId(users) { return users.reduce((m, u) => Math.max(m, u.id), 0) + 1; }

  async function openAccount(uid, portfolioId, seed, startDate, customHoldings) {
    const base = PMAP[portfolioId] || PMAP.balanced;
    const holds = (customHoldings || base.holdings).map((h) => ({ market: h.market, code: h.code, label: h.label, weight: Number(h.weight) }));
    const entry = await entryPricesKRW(holds, ymKey(startDate));
    const recs = holds.map((h) => {
      const cost = seed * h.weight / 100, ep = entry[h.code] || 0;
      const units = (h.market === "CASH" || !ep) ? 0 : cost / ep;
      return { market: h.market, code: h.code, label: h.label, weight: h.weight, units, entry: ep };
    });
    const accts = store.accounts();
    accts[uid] = { portfolioId, seed, startDate, holdings: recs, created: new Date().toISOString() };
    store.setAccounts(accts);
  }

  // ---------------- 인증 API (서버 엔드포인트 대체) ----------------
  const API = {
    async signup({ name, email, password, portfolioId, seed, startDate }) {
      email = (email || "").trim().toLowerCase();
      name = (name || "").trim() || email.split("@")[0];
      if (!email || !email.includes("@") || (password || "").length < 4) throw new Error("이메일과 4자 이상의 비밀번호가 필요합니다.");
      const users = store.users();
      if (users.some((u) => u.email === email)) throw new Error("이미 가입된 이메일입니다.");
      if (!PMAP[portfolioId]) portfolioId = "balanced";
      const { salt, hash } = await hashPw(password);
      const id = nextId(users);
      users.push({ id, email, name, salt, hash, role: "customer", created: new Date().toISOString() });
      store.setUsers(users);
      await openAccount(id, portfolioId, Number(seed) || 100000000, startDate || todayStr());
      store.setSession(id);
      return { ok: true };
    },
    async login({ email, password }) {
      email = (email || "").trim().toLowerCase();
      const u = store.users().find((x) => x.email === email);
      if (!u || !(await verifyPw(password, u.salt, u.hash))) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다.");
      store.setSession(u.id);
      return { ok: true, role: u.role };
    },
    logout() { store.setSession(null); return { ok: true }; },
    currentUser() {
      const sid = store.session(); if (!sid) return null;
      return store.users().find((u) => String(u.id) === String(sid)) || null;
    },
    async me() {
      const u = API.currentUser();
      if (!u) return { auth: false };
      const acc = store.accounts()[u.id];
      const out = { auth: true, user: { id: u.id, email: u.email, name: u.name, role: u.role }, account: null };
      if (acc) { try { out.account = await computeAccount(acc); } catch (e) { out.account_error = String(e); } }
      return out;
    },
    async updateAccount({ portfolioId, seed, holdings }) {
      const u = API.currentUser(); if (!u) throw new Error("로그인이 필요합니다.");
      if (!PMAP[portfolioId]) throw new Error("존재하지 않는 상품입니다.");
      if (holdings) {
        const tot = holdings.reduce((a, h) => a + Number(h.weight || 0), 0);
        if (Math.abs(tot - 100) > 0.5) throw new Error(`비중 합계가 100%가 아닙니다(현재 ${tot.toFixed(1)}%).`);
      }
      await openAccount(u.id, portfolioId, Number(seed) || 100000000, todayStr(), holdings);
      return { ok: true };
    },
    async adminUsers() {
      const me = API.currentUser();
      if (!me || me.role !== "admin") throw new Error("관리자 권한이 필요합니다.");
      let fx; try { fx = await fetchFX(); } catch (e) { fx = 1350; }
      const accts = store.accounts();
      const out = [];
      for (const u of store.users()) {
        const row = { id: u.id, email: u.email, name: u.name, role: u.role, joined: u.created, portfolio: null, seed: null, value: null, ret: null };
        const acc = accts[u.id];
        if (acc) { try { const c = await computeAccount(acc, fx); row.portfolio = c.portfolioName; row.seed = c.seed; row.value = c.totalValue; row.ret = c.currentReturn; } catch (e) {} }
        out.push(row);
      }
      return out;
    },
    adminDelete(userId) {
      const me = API.currentUser();
      if (!me || me.role !== "admin") throw new Error("관리자 권한이 필요합니다.");
      if (userId === me.id) throw new Error("본인 계정은 삭제할 수 없습니다.");
      store.setUsers(store.users().filter((u) => u.id !== userId));
      const accts = store.accounts(); delete accts[userId]; store.setAccounts(accts);
      return { ok: true };
    },
  };

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  // ---------------- 최초 1회: 데모 오너 시드 ----------------
  let seeding = null;
  async function seedOwner() {
    if (store.users().length > 0) return;
    if (seeding) return seeding;
    seeding = (async () => {
      const { salt, hash } = await hashPw("polaris1234");
      const users = store.users();
      const id = nextId(users);
      users.push({ id, email: "2010ksy@gmail.com", name: "수연 고객님", salt, hash, role: "admin", created: new Date().toISOString() });
      store.setUsers(users);
      const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      try { await openAccount(id, "balanced", 100000000, start); } catch (e) { console.warn("시드 계정 보류", e); }
    })();
    return seeding;
  }

  // ---------------- 공통 포맷 ----------------
  const fmt = {
    won: (v) => v == null ? "-" : Math.round(v).toLocaleString("ko-KR") + "원",
    eok: (v) => v == null ? "-" : (v / 1e8).toFixed(2) + "억",
    pct: (v) => v == null ? "-" : (v > 0 ? "+" : "") + (v * 100).toFixed(2) + "%",
    cls: (v) => v > 0 ? "up" : v < 0 ? "down" : "flat",
  };

  window.Polaris = { COMPANY, PORTFOLIOS, PMAP, API, fmt, seedOwner, fetchFX, fetchUS, fetchKR };
})();
