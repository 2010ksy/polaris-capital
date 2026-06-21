/* 북극성 자산운용 — 클라이언트 코어 (Supabase 다중 사용자 · 다중 가입 버전)
 *
 * core.js 와 동일한 window.Polaris 인터페이스를 제공하되,
 * 회원/계정/상품/자산점검 저장과 인증을 Supabase(Auth + Postgres)로 처리한다.
 * 시세/환율/계정평가 로직은 동일.
 *
 * 사용: assets/config.js 에 supabaseUrl / supabaseAnonKey 를 채운 뒤,
 *       HTML에서 core.js 대신 이 파일을 로드.
 *
 * 참고: listProducts()/getProduct() 는 동기 인터페이스 유지를 위해
 *       커스텀 상품을 모듈 캐시(_customCache)에서 반환한다. 캐시는 me()/
 *       adminUsers()/refreshProducts() 호출 시 채워진다(최초 진입 직후 1회 갱신).
 */
(function () {
  "use strict";

  const COMPANY = { name: "북극성 자산운용", nameEn: "POLARIS CAPITAL", slogan: "데이터로 항해하는 자산관리", seed: 100000000, founded: 2026 };
  const PORTFOLIOS = [
    { id: "stable", name: "안정형", tag: "Conservative", risk: 2, target: "연 5~7%", mid: 0.06,
      desc: "변동성을 낮추고 자본을 지키는 데 초점. 우량 대형주와 지수 ETF, 넉넉한 현금성 자산.",
      holdings: [{ market: "KR", code: "005930", label: "삼성전자", weight: 12 }, { market: "KR", code: "105560", label: "KB금융", weight: 8 },
        { market: "US", code: "AAPL", label: "애플", weight: 10 }, { market: "US", code: "MSFT", label: "마이크로소프트", weight: 10 },
        { market: "US", code: "SPY", label: "S&P500 ETF", weight: 25 }, { market: "CASH", code: "CASH", label: "현금성 자산", weight: 35 }] },
    { id: "balanced", name: "균형형", tag: "Balanced", risk: 3, target: "연 8~12%", mid: 0.10,
      desc: "성장과 안정의 균형. 한·미 우량 성장주와 지수 ETF를 고르게 분산.",
      holdings: [{ market: "KR", code: "005930", label: "삼성전자", weight: 12 }, { market: "KR", code: "000660", label: "SK하이닉스", weight: 8 },
        { market: "KR", code: "035420", label: "NAVER", weight: 6 }, { market: "US", code: "AAPL", label: "애플", weight: 10 },
        { market: "US", code: "MSFT", label: "마이크로소프트", weight: 10 }, { market: "US", code: "GOOGL", label: "알파벳", weight: 8 },
        { market: "US", code: "NVDA", label: "엔비디아", weight: 6 }, { market: "US", code: "SPY", label: "S&P500 ETF", weight: 20 },
        { market: "US", code: "QQQ", label: "나스닥100 ETF", weight: 10 }, { market: "CASH", code: "CASH", label: "현금성 자산", weight: 10 }] },
    { id: "growth", name: "성장형", tag: "Growth", risk: 5, target: "연 13~20%", mid: 0.165,
      desc: "높은 변동성을 감수하고 장기 초과수익 추구. 기술 성장주와 2차전지 중심.",
      holdings: [{ market: "KR", code: "000660", label: "SK하이닉스", weight: 12 }, { market: "KR", code: "005930", label: "삼성전자", weight: 8 },
        { market: "KR", code: "373220", label: "LG에너지솔루션", weight: 8 }, { market: "KR", code: "035720", label: "카카오", weight: 6 },
        { market: "US", code: "NVDA", label: "엔비디아", weight: 14 }, { market: "US", code: "TSLA", label: "테슬라", weight: 10 },
        { market: "US", code: "AAPL", label: "애플", weight: 8 }, { market: "US", code: "META", label: "메타", weight: 8 },
        { market: "US", code: "AMZN", label: "아마존", weight: 8 }, { market: "US", code: "QQQ", label: "나스닥100 ETF", weight: 12 },
        { market: "CASH", code: "CASH", label: "현금성 자산", weight: 6 }] },
  ];
  const PMAP = Object.fromEntries(PORTFOLIOS.map((p) => [p.id, p]));
  const KR_TO_YAHOO = { "005930": "005930.KS", "000660": "000660.KS", "035420": "035420.KS", "105560": "105560.KS", "373220": "373220.KS", "035720": "035720.KS" };
  const API_BASE = "/api/market";

  // ── 시세 (core.js와 동일) ──
  async function jget(url) { const r = await fetch(url); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || "HTTP " + r.status); return j; }
  async function fetchUS(symbol) {
    const d = await jget(`${API_BASE}?provider=yahoo&symbol=${encodeURIComponent(symbol)}&interval=1d&range=1d`);
    const m = d.chart.result[0].meta, price = m.regularMarketPrice, prev = m.chartPreviousClose || m.previousClose;
    const change = (price != null && prev != null) ? price - prev : null;
    return { price, changePct: (change != null && prev) ? change / prev * 100 : null, name: m.shortName || symbol };
  }
  async function fetchKR(code, kind) {
    const d = await jget(`${API_BASE}?provider=naver&code=${encodeURIComponent(code)}&kind=${kind || "stock"}`);
    const x = (d.datas || [])[0], num = (k) => x[k] != null ? parseFloat(x[k]) : null;
    return { price: num("closePriceRaw"), changePct: num("fluctuationsRatioRaw"), name: x.stockName };
  }
  async function fetchFX() {
    const d = await jget(`${API_BASE}?provider=yahoo&symbol=${encodeURIComponent("USDKRW=X")}&interval=1d&range=1d`);
    return d.chart.result[0].meta.regularMarketPrice;
  }
  async function fetchMonthly(symbol) {
    const p1 = Math.floor(new Date("2015-01-01").getTime() / 1000);
    const d = await jget(`${API_BASE}?provider=yahoo&symbol=${encodeURIComponent(symbol)}&interval=1mo&period1=${p1}`);
    const r = d.chart.result[0], ts = r.timestamp, ind = r.indicators || {};
    const adj = ind.adjclose ? ind.adjclose[0].adjclose : ind.quote[0].close;
    const out = {}; ts.forEach((t, i) => { const dt = new Date(t * 1000), v = adj[i]; if (v != null) out[dt.getUTCFullYear() * 12 + dt.getUTCMonth()] = v; });
    return out;
  }
  function ymKey(s) { const [y, m] = s.split("-").map(Number); return y * 12 + (m - 1); }
  function nearest(map, target) {
    if (map[target] != null) return map[target];
    const ks = Object.keys(map).map(Number).filter((k) => k <= target);
    if (ks.length) return map[Math.max(...ks)];
    const all = Object.keys(map).map(Number); return all.length ? map[Math.min(...all)] : null;
  }
  function ySymbol(market, code) {
    return market === "US" ? code : (market === "KR" ? (KR_TO_YAHOO[code] || (/^\d{6}$/.test(code) ? code + ".KS" : null)) : null);
  }
  async function entryPricesKRW(holdings, startYm) {
    const fxm = await fetchMonthly("USDKRW=X"), fx = nearest(fxm, startYm);
    const entries = await Promise.all(holdings.map(async (h) => {
      if (h.market === "CASH") return [h.code, 0];
      const m = await fetchMonthly(ySymbol(h.market, h.code)), px = nearest(m, startYm);
      return [h.code, h.market === "US" ? px * fx : px];
    }));
    return Object.fromEntries(entries);
  }
  async function livePricesKRW(holdings, fx) {
    const out = {};
    await Promise.all(holdings.map(async (h) => {
      if (h.market === "CASH") { out[h.code] = { price: null, changePct: 0 }; return; }
      try { if (h.market === "US") { const d = await fetchUS(h.code); out[h.code] = { price: d.price * fx, changePct: d.changePct }; }
        else { const d = await fetchKR(h.code, "stock"); out[h.code] = { price: d.price, changePct: d.changePct }; } }
      catch (e) { out[h.code] = { price: null, changePct: 0, err: true }; }
    }));
    return out;
  }

  // ── 상품 메타 스냅샷 ──
  function productMeta(p) { return { name: p.name, target: p.target, mid: p.mid, risk: p.risk }; }
  function accMeta(acc) {
    if (acc.name != null) return { name: acc.name, target: acc.target, mid: acc.mid, risk: acc.risk };
    const p = getProduct(acc.productId || acc.portfolioId) || PMAP.balanced;
    return productMeta(p);
  }

  async function computeAccount(acc, fx) {
    const pid = acc.productId || acc.portfolioId || "balanced";
    const meta = accMeta(acc);
    if (fx == null) { try { fx = await fetchFX(); } catch (e) { fx = 1350; } }
    const quotes = await livePricesKRW(acc.holdings, fx);
    const sd = new Date(acc.startDate + "T00:00:00");
    const elapsedDays = Math.max(1, Math.round((Date.now() - sd.getTime()) / 86400000)), elapsedYears = elapsedDays / 365.25;
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
    const curRet = acc.seed ? totalNow / acc.seed - 1 : 0, mid = meta.mid || 0.10;
    const expValue = acc.seed * Math.pow(1 + mid, elapsedYears), expRet = expValue / acc.seed - 1;
    return { subId: acc.id, productId: pid, portfolioId: pid, productName: meta.name, portfolioName: meta.name, target: meta.target, risk: meta.risk,
      seed: acc.seed, startDate: acc.startDate, source: acc.source || "direct",
      elapsedYears: Math.round(elapsedYears * 100) / 100, fx, holdings: rows, totalCost, totalValue: totalNow,
      currentReturn: curRet, dayChange, expectedValue: expValue, expectedReturn: expRet, gap: totalNow - expValue,
      guide: buildGuidance(meta, curRet, expRet, rows) };
  }
  function buildGuidance(port, curRet, expRet, rows) {
    const g = [], diff = curRet - expRet;
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
  function todayStr() { return new Date().toISOString().slice(0, 10); }

  // ── Supabase 클라이언트 (지연 로드) ──
  let _sb = null;
  async function sb() {
    if (_sb) return _sb;
    const cfg = window.POLARIS_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("Supabase 설정이 없습니다. assets/config.js를 확인하세요.");
    const mod = await import("https://esm.sh/@supabase/supabase-js@2");
    _sb = mod.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return _sb;
  }

  // ── 상품(빌트인 + 커스텀 캐시) ──
  let _customCache = [];
  function listProducts() { return [...PORTFOLIOS, ..._customCache.map((p) => ({ ...p, custom: true }))]; }
  function getProduct(id) { return listProducts().find((p) => p.id === id) || null; }
  function mapProductRow(r) { return { id: r.id, name: r.name, tag: r.tag, target: r.target, mid: Number(r.mid), risk: r.risk, desc: r.descr, holdings: r.holdings || [] }; }
  async function refreshProducts() {
    try { const c = await sb(); const { data } = await c.from("products").select("*"); _customCache = (data || []).map(mapProductRow); }
    catch (e) { /* 미설정/오프라인이면 빌트인만 */ }
    return _customCache;
  }

  async function buildHoldings(productId, seed, startDate, customHoldings) {
    const base = getProduct(productId) || PMAP.balanced;
    const holds = (customHoldings || base.holdings).map((h) => ({ market: h.market, code: h.code, label: h.label, weight: Number(h.weight) }));
    const entry = await entryPricesKRW(holds, ymKey(startDate));
    return holds.map((h) => {
      const cost = seed * h.weight / 100, ep = entry[h.code] || 0;
      const units = (h.market === "CASH" || !ep) ? 0 : cost / ep;
      return { market: h.market, code: h.code, label: h.label, weight: h.weight, units, entry: ep };
    });
  }
  function checkWeights(holdings) {
    if (!holdings) return;
    const tot = holdings.reduce((a, h) => a + Number(h.weight || 0), 0);
    if (Math.abs(tot - 100) > 0.5) throw new Error(`비중 합계가 100%가 아닙니다(현재 ${tot.toFixed(1)}%).`);
  }
  function rowToAcc(a) { return { id: a.id, productId: a.product_id, name: a.name, target: a.target, mid: a.mid != null ? Number(a.mid) : null, risk: a.risk, seed: Number(a.seed), startDate: a.start_date, holdings: a.holdings, source: a.source }; }

  async function subscribeRow(uid, { productId, seed, startDate, customHoldings, source }) {
    const p = getProduct(productId);
    if (!p) throw new Error("존재하지 않는 상품입니다.");
    seed = Number(seed) || 100000000; startDate = startDate || todayStr();
    checkWeights(customHoldings);
    const holdings = await buildHoldings(productId, seed, startDate, customHoldings);
    const meta = productMeta(p);
    const c = await sb();
    const { data, error } = await c.from("accounts").insert({ user_id: uid, product_id: productId, name: meta.name, target: meta.target, mid: meta.mid, risk: meta.risk, seed, start_date: startDate, holdings, source: source || "direct" }).select("id").single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  const API = {
    listProducts() { return listProducts(); },
    refreshProducts,

    async signup({ name, email, password }) {
      email = (email || "").trim().toLowerCase();
      if (!email || !email.includes("@") || (password || "").length < 4) throw new Error("이메일과 4자 이상의 비밀번호가 필요합니다.");
      const c = await sb();
      const { data, error } = await c.auth.signUp({ email, password, options: { data: { name: (name || "").trim() || email.split("@")[0] } } });
      if (error) throw new Error(error.message);
      if (!data.session) throw new Error("이메일 인증이 필요한 설정입니다. Supabase Auth에서 'Confirm email'을 끄거나 메일을 확인하세요.");
      return { ok: true };
    },
    async login({ email, password }) {
      const c = await sb();
      const { error } = await c.auth.signInWithPassword({ email: (email || "").trim().toLowerCase(), password });
      if (error) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다.");
      return { ok: true };
    },
    async logout() { try { const c = await sb(); await c.auth.signOut(); } catch (e) {} return { ok: true }; },
    // Supabase 모드의 카카오 로그인은 Supabase Auth의 네이티브 Kakao 공급자를 사용한다.
    // (대시보드 → Authentication → Providers → Kakao 활성화 + Redirect URL 등록)
    // 프런트의 /api/kakao 흐름 대신 아래 리다이렉트 방식을 쓰므로, 호환을 위해 직접 시작한다.
    async socialLogin() {
      const c = await sb();
      const redirectTo = (window.POLARIS_CONFIG && window.POLARIS_CONFIG.kakaoRedirectUri) || (location.origin + "/dashboard.html");
      const { error } = await c.auth.signInWithOAuth({ provider: "kakao", options: { redirectTo } });
      if (error) throw new Error(error.message);
      return { ok: true };
    },

    async me() {
      const c = await sb();
      const { data: { user } } = await c.auth.getUser();
      if (!user) return { auth: false };
      await refreshProducts();
      const { data: prof } = await c.from("profiles").select("name,role").eq("id", user.id).single();
      const { data: accs } = await c.from("accounts").select("*").eq("user_id", user.id).order("id");
      const { data: snap } = await c.from("snapshots").select("assets,updated_at").eq("user_id", user.id).single();
      const out = { auth: true, user: { id: user.id, email: user.email, name: (prof && prof.name) || user.email, role: (prof && prof.role) || "customer" },
        accounts: [], snapshot: snap ? { assets: snap.assets || [], updated: snap.updated_at } : null };
      let fx; try { fx = await fetchFX(); } catch (e) { fx = 1350; }
      for (const a of (accs || [])) {
        try { out.accounts.push(await computeAccount(rowToAcc(a), fx)); }
        catch (e) { out.accounts.push({ subId: a.id, productId: a.product_id, portfolioName: a.name, error: String(e) }); }
      }
      return out;
    },

    async subscribe({ productId, seed, startDate, customHoldings }) {
      const c = await sb();
      const { data: { user } } = await c.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");
      await refreshProducts();
      const subId = await subscribeRow(user.id, { productId, seed, startDate, customHoldings, source: "direct" });
      return { ok: true, subId };
    },
    async updateAccount({ subId, productId, seed, holdings }) {
      const c = await sb();
      const { data: { user } } = await c.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");
      await refreshProducts();
      const p = getProduct(productId); if (!p) throw new Error("존재하지 않는 상품입니다.");
      checkWeights(holdings);
      const { data: cur } = await c.from("accounts").select("seed").eq("id", subId).single();
      seed = Number(seed) || (cur && Number(cur.seed)) || 100000000;
      const recs = await buildHoldings(productId, seed, todayStr(), holdings);
      const meta = productMeta(p);
      const { error } = await c.from("accounts").update({ product_id: productId, name: meta.name, target: meta.target, mid: meta.mid, risk: meta.risk, seed, start_date: todayStr(), holdings: recs }).eq("id", subId);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
    async unsubscribe({ subId }) {
      const c = await sb();
      const { error } = await c.from("accounts").delete().eq("id", subId);
      if (error) throw new Error(error.message);
      return { ok: true };
    },

    async getSnapshot() {
      const c = await sb();
      const { data: { user } } = await c.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");
      const { data } = await c.from("snapshots").select("assets,updated_at").eq("user_id", user.id).single();
      return data ? { assets: data.assets || [], updated: data.updated_at } : { assets: [], updated: null };
    },
    async saveSnapshot({ assets }) {
      const c = await sb();
      const { data: { user } } = await c.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");
      const clean = (assets || []).map((a) => ({ label: (a.label || "").trim() || "자산", market: a.market || "ETC", amount: Math.max(0, Number(a.amount) || 0), ret: Number(a.ret) || 0 })).filter((a) => a.amount > 0);
      const { error } = await c.from("snapshots").upsert({ user_id: user.id, assets: clean, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return { ok: true, snapshot: { assets: clean, updated: new Date().toISOString() } };
    },
    async convert({ productId, startDate }) {
      const c = await sb();
      const { data: { user } } = await c.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");
      const { data: snap } = await c.from("snapshots").select("assets").eq("user_id", user.id).single();
      const total = ((snap && snap.assets) || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
      if (total <= 0) throw new Error("먼저 '자산 점검'에서 보유 자산을 입력해 주세요.");
      await refreshProducts();
      const subId = await subscribeRow(user.id, { productId, seed: total, startDate, source: "converted" });
      return { ok: true, subId, seed: total };
    },

    async adminUsers() {
      const c = await sb();
      await refreshProducts();
      const { data: profs, error } = await c.from("profiles").select("id,name,email,role,created_at");
      if (error) throw new Error("관리자 권한이 필요합니다.");
      const { data: accs } = await c.from("accounts").select("*");
      const byUser = {}; (accs || []).forEach((a) => { (byUser[a.user_id] = byUser[a.user_id] || []).push(a); });
      let fx; try { fx = await fetchFX(); } catch (e) { fx = 1350; }
      const out = [];
      for (const p of profs) {
        const arr = byUser[p.id] || [];
        const row = { id: p.id, email: p.email || p.name, name: p.name, role: p.role, joined: p.created_at, count: arr.length, seed: 0, value: 0, ret: null, products: [] };
        let cost = 0;
        for (const a of arr) {
          try { const comp = await computeAccount(rowToAcc(a), fx); row.seed += comp.seed; row.value += comp.totalValue; cost += comp.totalCost; row.products.push(comp.portfolioName); }
          catch (e) {}
        }
        if (cost > 0) row.ret = row.value / cost - 1;
        if (!arr.length) { row.seed = null; row.value = null; }
        out.push(row);
      }
      return out;
    },
    async adminDelete(userId) {
      const c = await sb();
      // anon 키로는 auth 사용자 삭제 불가 → 프로필/계정/스냅샷 행만 삭제(RLS 관리자 정책).
      await c.from("accounts").delete().eq("user_id", userId);
      await c.from("snapshots").delete().eq("user_id", userId);
      const { error } = await c.from("profiles").delete().eq("id", userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    },

    async adminAddProduct({ id, name, tag, target, mid, risk, desc, holdings }) {
      name = (name || "").trim();
      if (!name) throw new Error("상품명을 입력하세요.");
      if (!holdings || !holdings.length) throw new Error("자산 구성을 1개 이상 추가하세요.");
      checkWeights(holdings);
      await refreshProducts();
      id = (id || "").trim() || ("custom-" + Date.now().toString(36));
      if (listProducts().some((p) => p.id === id)) throw new Error("이미 존재하는 상품 ID입니다.");
      const row = {
        id, name, tag: (tag || "").trim() || "Custom", target: (target || "").trim() || "연 -",
        mid: Number(mid) || 0.10, risk: Math.min(5, Math.max(1, Number(risk) || 3)),
        descr: (desc || "").trim() || "관리자가 구성한 커스텀 포트폴리오.",
        holdings: holdings.map((h) => ({ market: h.market || "ETC", code: h.code || h.label, label: (h.label || "").trim() || h.code, weight: Number(h.weight) || 0 })),
      };
      const c = await sb();
      const { error } = await c.from("products").insert(row);
      if (error) throw new Error(error.message);
      await refreshProducts();
      return { ok: true, product: mapProductRow(row) };
    },
    async adminDeleteProduct(id) {
      if (PMAP[id]) throw new Error("기본 상품은 삭제할 수 없습니다.");
      const c = await sb();
      const { error } = await c.from("products").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await refreshProducts();
      return { ok: true };
    },
  };

  // Supabase 모드에서는 데모 오너 자동시드 없음(가입 후 SQL로 admin 승격).
  async function seedOwner() { try { await refreshProducts(); } catch (e) {} return null; }

  const fmt = {
    won: (v) => v == null ? "-" : Math.round(v).toLocaleString("ko-KR") + "원",
    eok: (v) => v == null ? "-" : (v / 1e8).toFixed(2) + "억",
    pct: (v) => v == null ? "-" : (v > 0 ? "+" : "") + (v * 100).toFixed(2) + "%",
    cls: (v) => v > 0 ? "up" : v < 0 ? "down" : "flat",
  };

  window.Polaris = { COMPANY, PORTFOLIOS, PMAP, API, fmt, seedOwner, fetchFX, fetchUS, fetchKR, listProducts, getProduct, mode: "supabase" };
})();
