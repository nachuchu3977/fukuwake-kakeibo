import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";

/* =========================================================================
   袋分け家計簿 v1
   - すべてのデータは localStorage に保存 (キー: fukuwake_v1_state)
   - 財布(複数) > 袋(カテゴリ) > 取引(支出/収入/振替)
   - 締め日に応じた「期間(period)」単位で予算・履歴・カレンダーを扱う
   ========================================================================= */

/* ------------------------------ 定数 ------------------------------ */

const STORAGE_KEY = "fukuwake_v1_state";

const OTHER_POCKET_ID = "other"; // 「その他」は常に存在する特別な袋（予算0固定・非表示不可）

const ICON_CHOICES = [
  "💄", "🚃", "💅", "👗", "🧧", "🍽️", "❤️", "✂️", "🎁", "📱",
  "🏠", "🚗", "📚", "🎮", "☕", "💊", "🐾", "✈️", "🎓", "💡",
];

const COLOR_PALETTE = [
  "#F4A6A6", "#7C83FD", "#8FD6C2", "#FFC876", "#B7A6F4",
  "#F4C6D8", "#9AD0F5", "#C7E28E", "#F5B49A", "#A6C8F4",
];

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/* ------------------------------ ユーティリティ ------------------------------ */

const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const yen = (n) => {
  const v = Math.round(n);
  return `${v < 0 ? "-" : ""}¥${Math.abs(v).toLocaleString("ja-JP")}`;
};
const yenPlain = (n) => {
  const v = Math.round(n);
  return `${v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("ja-JP")}`;
};

function pad2(n) { return String(n).padStart(2, "0"); }
function dstr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseDstr(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }

// period key: "YYYY-MM" （その月の締め日で終わる期間を表す）
function periodKeyForDate(dateStr, closingDay) {
  const d = parseDstr(dateStr);
  const day = d.getDate();
  let y = d.getFullYear();
  let m = d.getMonth(); // 0-indexed
  if (closingDay >= 28) {
    // 月末締め = 通常の暦月
  } else if (day > closingDay) {
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return `${y}-${pad2(m + 1)}`;
}

function periodRange(periodKey, closingDay) {
  const [y, m] = periodKey.split("-").map(Number); // m: 1-indexed, this is the "ending" month
  if (closingDay >= 28) {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0); // last day of month
    return { start, end };
  }
  const end = new Date(y, m - 1, closingDay);
  const start = new Date(y, m - 2, closingDay + 1);
  return { start, end };
}

function shiftPeriodKey(periodKey, diff) {
  const [y, m] = periodKey.split("-").map(Number);
  const total = y * 12 + (m - 1) + diff;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${ny}-${pad2(nm + 1)}`;
}

function formatPeriodLabel(periodKey, closingDay) {
  const { start, end } = periodRange(periodKey, closingDay);
  const yy = String(start.getFullYear()).slice(2);
  return `${yy}/${pad2(start.getMonth() + 1)}/${pad2(start.getDate())} ~ ${pad2(end.getMonth() + 1)}/${pad2(end.getDate())}`;
}

function daysInPeriod(periodKey, closingDay) {
  const { start, end } = periodRange(periodKey, closingDay);
  return Math.round((end - start) / 86400000) + 1;
}

function daysRemaining(periodKey, closingDay, today = new Date()) {
  const { end } = periodRange(periodKey, closingDay);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((end - t) / 86400000);
  return Math.max(0, diff);
}

function currentPeriodKey(closingDay, today = new Date()) {
  return periodKeyForDate(dstr(today), closingDay);
}

/* ------------------------------ 初期サンプルデータ ------------------------------ */

function buildSampleState() {
  const walletId = "w_main";
  const closingDay = 31; // 月末締め
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-indexed
  const dateInMonth = (day) => `${y}-${pad2(m + 1)}-${pad2(Math.min(day, 28))}`;

  const pockets = [
    { id: "p_free", walletId, name: "自由費", icon: "💄", color: "#F4A6A6", basicBudget: 30000, order: 0, enabledDefault: true, carryOver: false },
    { id: "p_transit", walletId, name: "交通費", icon: "🚃", color: "#7C83FD", basicBudget: 5000, order: 1, enabledDefault: true, carryOver: false },
    { id: "p_nail", walletId, name: "ネイル", icon: "💅", color: "#F5B49A", basicBudget: 26000, order: 2, enabledDefault: true, carryOver: true },
    { id: "p_food", walletId, name: "仕事食費", icon: "🍽️", color: "#C7E28E", basicBudget: 13000, order: 3, enabledDefault: false, carryOver: false },
    { id: "p_cloth", walletId, name: "被服費", icon: "👗", color: "#B7A6F4", basicBudget: 5000, order: 4, enabledDefault: false, carryOver: false },
    { id: OTHER_POCKET_ID, walletId, name: "その他", icon: "🧾", color: "#C9C9C9", basicBudget: 0, order: 99, enabledDefault: true, carryOver: false, locked: true },
  ];

  const txs = [
    { id: uid("t"), walletId, date: dateInMonth(1), type: "expense", pocketId: "p_free", amount: 3300, method: "楽天カード", memo: "化粧水" },
    { id: uid("t"), walletId, date: dateInMonth(1), type: "expense", pocketId: "p_free", amount: 300, method: "現金", memo: "住民票" },
    { id: uid("t"), walletId, date: dateInMonth(2), type: "expense", pocketId: "p_free", amount: 11300, method: "楽天カード", memo: "mont-bell" },
    { id: uid("t"), walletId, date: dateInMonth(2), type: "expense", pocketId: "p_free", amount: 170, method: "PayPay", memo: "自販機" },
    { id: uid("t"), walletId, date: dateInMonth(5), type: "expense", pocketId: "p_free", amount: 1780, method: "楽天カード", memo: "Qoo10" },
    { id: uid("t"), walletId, date: dateInMonth(5), type: "expense", pocketId: "p_free", amount: 1333, method: "現金", memo: "衣類ブックオフ" },
    { id: uid("t"), walletId, date: dateInMonth(7), type: "expense", pocketId: "p_free", amount: 3560, method: "楽天カード", memo: "Qoo10" },
    { id: uid("t"), walletId, date: dateInMonth(8), type: "expense", pocketId: "p_free", amount: 980, method: "楽天カード", memo: "oggi" },
    { id: uid("t"), walletId, date: dateInMonth(8), type: "expense", pocketId: "p_free", amount: 2232, method: "三井住友カード", memo: "サンテラボ" },
    { id: uid("t"), walletId, date: dateInMonth(9), type: "expense", pocketId: "p_free", amount: 1129, method: "楽天カード", memo: "Qoo10" },
    { id: uid("t"), walletId, date: dateInMonth(10), type: "expense", pocketId: OTHER_POCKET_ID, amount: 34700, method: "三井住友カード", memo: "スーツ（有楽町マルイ）" },
    { id: uid("t"), walletId, date: dateInMonth(12), type: "expense", pocketId: "p_free", amount: 990, method: "その他", memo: "Apple One" },
    { id: uid("t"), walletId, date: dateInMonth(13), type: "expense", pocketId: "p_free", amount: 1000, method: "現金", memo: "" },
    { id: uid("t"), walletId, date: dateInMonth(13), type: "expense", pocketId: "p_transit", amount: 5000, method: "PayPay", memo: "" },
    { id: uid("t"), walletId, date: dateInMonth(1), type: "expense", pocketId: "p_nail", amount: 11000, method: "現金", memo: "サロン" },
  ];

  return {
    version: 1,
    wallets: [{ id: walletId, name: "自分用", closingDay }],
    currentWalletId: walletId,
    pockets,
    paymentMethods: ["現金", "三井住友カード", "楽天カード", "PayPay", "その他"],
    monthlyAdjust: {},   // [walletId][period][pocketId] = number (当月設定で直接入力した予算 - 基本予算)
    monthlyEnabled: {},  // [walletId][period][pocketId] = boolean (未設定なら enabledDefault を使う)
    transactions: txs,
    transfers: [],
    settings: { showAux: true },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.wallets && parsed.wallets.length) return parsed;
    }
  } catch (e) { /* ignore */ }
  const sample = buildSampleState();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sample)); } catch (e) {}
  return sample;
}

/* ------------------------------ 計算ロジック ------------------------------ */

function getWallet(state, walletId) {
  return state.wallets.find((w) => w.id === walletId) || state.wallets[0];
}

function pocketsForWallet(state, walletId) {
  return state.pockets.filter((p) => p.walletId === walletId).sort((a, b) => a.order - b.order);
}

function isPocketEnabled(state, walletId, period, pocketId) {
  const pocket = state.pockets.find((p) => p.id === pocketId);
  if (!pocket) return false;
  const override = state.monthlyEnabled?.[walletId]?.[period]?.[pocketId];
  if (override !== undefined) return override;
  return pocket.enabledDefault;
}

function baselineBudget(state, walletId, period, pocket) {
  const adjust = state.monthlyAdjust?.[walletId]?.[period]?.[pocket.id] || 0;
  return pocket.basicBudget + adjust;
}

function expenseSum(state, walletId, period, pocketId) {
  return state.transactions
    .filter((t) => t.walletId === walletId && t.type === "expense" && t.pocketId === pocketId && periodKeyForDate(t.date, getWallet(state, walletId).closingDay) === period)
    .reduce((s, t) => s + t.amount, 0);
}

function incomeSum(state, walletId, period, pocketId) {
  return state.transactions
    .filter((t) => t.walletId === walletId && t.type === "income" && t.pocketId === pocketId && periodKeyForDate(t.date, getWallet(state, walletId).closingDay) === period)
    .reduce((s, t) => s + t.amount, 0);
}

function transferInSum(state, walletId, period, pocketId) {
  return state.transfers
    .filter((tr) => tr.toWalletId === walletId && tr.toPocketId === pocketId && periodKeyForDate(tr.date, getWallet(state, walletId).closingDay) === period)
    .reduce((s, tr) => s + tr.amount, 0);
}
function transferOutSum(state, walletId, period, pocketId) {
  return state.transfers
    .filter((tr) => tr.fromWalletId === walletId && tr.fromPocketId === pocketId && periodKeyForDate(tr.date, getWallet(state, walletId).closingDay) === period)
    .reduce((s, tr) => s + tr.amount, 0);
}

// そのウォレットで最初に取引/振替が発生した期間（＝実際に使い始めた期間）。
// これより前には「使い残し」という概念が存在しないため、繰越計算の起点として使う。
function earliestActivityPeriod(state, walletId) {
  let min = null;
  const cd = getWallet(state, walletId).closingDay;
  state.transactions.forEach((t) => {
    if (t.walletId !== walletId) return;
    const pk = periodKeyForDate(t.date, cd);
    if (min === null || pk < min) min = pk;
  });
  state.transfers.forEach((tr) => {
    if (tr.fromWalletId === walletId) {
      const pk = periodKeyForDate(tr.date, getWallet(state, tr.fromWalletId).closingDay);
      if (min === null || pk < min) min = pk;
    }
    if (tr.toWalletId === walletId) {
      const pk = periodKeyForDate(tr.date, getWallet(state, tr.toWalletId).closingDay);
      if (min === null || pk < min) min = pk;
    }
  });
  return min; // データが一件も無ければ null
}

// 繰越込みの今月予算を再帰計算（深さ制限つき、メモ化）。
// 繰越は「実際に使い始めた期間」より前には遡らない（架空の過去期間からの繰越を防止）。
function computeMonthBudget(state, walletId, period, pocket, memo = {}, depth = 0, earliest) {
  const key = `${walletId}|${period}|${pocket.id}`;
  if (memo[key] !== undefined) return memo[key];
  if (earliest === undefined) earliest = earliestActivityPeriod(state, walletId);
  const base = baselineBudget(state, walletId, period, pocket);
  const income = incomeSum(state, walletId, period, pocket.id);
  const tIn = transferInSum(state, walletId, period, pocket.id);
  const tOut = transferOutSum(state, walletId, period, pocket.id);
  let carry = 0;
  if (pocket.carryOver && depth < 18) {
    const prevPeriod = shiftPeriodKey(period, -1);
    if (earliest === null || prevPeriod >= earliest) {
      const prevBudget = computeMonthBudget(state, walletId, prevPeriod, pocket, memo, depth + 1, earliest);
      const prevExpense = expenseSum(state, walletId, prevPeriod, pocket.id);
      carry = prevBudget - prevExpense;
    }
  }
  const total = base + carry + income + tIn - tOut;
  memo[key] = total;
  return total;
}


function pocketStats(state, walletId, period, pocket, memo) {
  const monthBudget = computeMonthBudget(state, walletId, period, pocket, memo);
  const expense = expenseSum(state, walletId, period, pocket.id);
  const remaining = monthBudget - expense;
  const base = baselineBudget(state, walletId, period, pocket);
  const carry = pocket.carryOver ? monthBudget - base - incomeSum(state, walletId, period, pocket.id) - transferInSum(state, walletId, period, pocket.id) + transferOutSum(state, walletId, period, pocket.id) : 0;
  return {
    pocket,
    basicBudget: pocket.basicBudget,
    baseline: base,
    monthBudget,
    expense,
    remaining,
    carry,
    income: incomeSum(state, walletId, period, pocket.id),
    transferIn: transferInSum(state, walletId, period, pocket.id),
    transferOut: transferOutSum(state, walletId, period, pocket.id),
    enabled: isPocketEnabled(state, walletId, period, pocket.id),
    usageRate: monthBudget > 0 ? Math.min(999, (expense / monthBudget) * 100) : (expense > 0 ? 999 : 0),
  };
}

function overallStats(state, walletId, period) {
  const memo = {};
  const pockets = pocketsForWallet(state, walletId);
  let budget = 0, expense = 0;
  const list = pockets.map((p) => {
    const st = pocketStats(state, walletId, period, p, memo);
    if (st.enabled) { budget += st.monthBudget; expense += st.expense; }
    return st;
  });
  return { budget, expense, remaining: budget - expense, list };
}

/* ------------------------------ ルート状態管理（Context 的に手動で） ------------------------------ */

function useStore() {
  const [state, setState] = useState(loadState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }, [state]);

  const update = useCallback((fn) => {
    setState((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      return { ...prev, ...next };
    });
  }, []);

  return [state, setState, update];
}

/* ------------------------------ 共通UIパーツ ------------------------------ */

function Header({ title, onBack, right }) {
  return (
    <div style={s.header}>
      <div style={s.headerSide}>
        {onBack && (
          <button onClick={onBack} style={s.iconBtn} aria-label="戻る">
            <span style={{ fontSize: 22 }}>‹</span>
          </button>
        )}
      </div>
      <div style={s.headerTitle}>{title}</div>
      <div style={{ ...s.headerSide, justifyContent: "flex-end" }}>{right}</div>
    </div>
  );
}

function Bar({ pct, color, warn }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={s.barTrack}>
      <div
        style={{
          ...s.barFill,
          width: `${clamped}%`,
          background: warn ? "#E8615A" : color,
        }}
      />
    </div>
  );
}

function PeriodNav({ periodKey, closingDay, onPrev, onNext }) {
  return (
    <div style={s.periodNav}>
      <button style={s.periodBtn} onClick={onPrev}>◀ 前の期間</button>
      <div style={s.periodLabel}>{formatPeriodLabel(periodKey, closingDay)}</div>
      <button style={s.periodBtn} onClick={onNext}>次の期間 ▶</button>
    </div>
  );
}

function Sheet({ title, onClose, children, footer }) {
  return (
    <div style={s.sheetOverlay} onClick={onClose}>
      <div style={s.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={s.sheetHandle} />
        {title && <div style={s.sheetTitle}>{title}</div>}
        <div style={s.sheetBody}>{children}</div>
        {footer && <div style={s.sheetFooter}>{footer}</div>}
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel = "実行する", danger, onConfirm, onCancel }) {
  return (
    <div style={s.sheetOverlay} onClick={onCancel}>
      <div style={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={s.dialogTitle}>{title}</div>
        <div style={s.dialogMsg}>{message}</div>
        <div style={s.dialogBtns}>
          <button style={s.dialogCancel} onClick={onCancel}>キャンセル</button>
          <button style={danger ? s.dialogDanger : s.dialogConfirm} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ ホーム ------------------------------ */

function HomeScreen({ state, update, walletId, period, setPeriod, closingDay, nav }) {
  const overall = useMemo(() => overallStats(state, walletId, period), [state, walletId, period]);
  const visible = overall.list.filter((st) => st.enabled);
  const remainDays = daysRemaining(period, closingDay);
  const totalDays = daysInPeriod(period, closingDay);
  const showAux = state.settings.showAux;

  const overallWarn = overall.remaining < 0;
  const overallPct = overall.budget > 0 ? (overall.expense / overall.budget) * 100 : 0;

  return (
    <div style={s.screen}>
      <Header
        title={getWallet(state, walletId).name}
        right={
          state.wallets.length > 1 ? (
            <select
              value={walletId}
              onChange={(e) => nav.setWallet(e.target.value)}
              style={s.walletSelect}
            >
              {state.wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          ) : null
        }
      />
      <div style={s.scroll}>
        <PeriodNav
          periodKey={period}
          closingDay={closingDay}
          onPrev={() => setPeriod(shiftPeriodKey(period, -1))}
          onNext={() => setPeriod(shiftPeriodKey(period, 1))}
        />

        <div style={{ ...s.overallCard, borderColor: overallWarn ? "#E8615A" : "#DCEBD9" }}>
          <div style={s.overallTop}>
            <span style={s.overallLabel}>全体</span>
            {showAux && (
              <span style={s.overallAux}>残り{remainDays}日 / {totalDays}日</span>
            )}
          </div>
          <div style={s.overallNumRow}>
            <span style={{ ...s.overallNum, color: overallWarn ? "#D9463F" : "#2F5D4F" }}>
              {yen(overall.remaining)}
            </span>
            <span style={s.overallOf}>/ {yenPlain(overall.budget)}円</span>
          </div>
          <Bar pct={overallPct} color="#5FA98A" warn={overallWarn} />
          {showAux && (
            <div style={s.overallSub}>使用率 {Math.min(999, Math.round(overallPct))}% ・ 使用額 {yenPlain(overall.expense)}円</div>
          )}
        </div>

        <div style={s.sectionLabel}>袋の残額</div>

        <div style={s.pocketList}>
          {visible.length === 0 && (
            <div style={s.emptyBox}>表示中の袋がありません。「標準設定」または「当月設定」で表示をONにしてください。</div>
          )}
          {visible.map((st) => {
            const warn = st.remaining < 0;
            const nearLimit = !warn && st.monthBudget > 0 && st.remaining <= st.monthBudget * 0.15;
            return (
              <button
                key={st.pocket.id}
                style={{ ...s.pocketCard, borderColor: warn ? "#F0B8B4" : "#EDEDED" }}
                onClick={() => nav.go("input", { pocketId: st.pocket.id })}
              >
                <div style={s.pocketCardTop}>
                  <div style={s.pocketIconWrap(st.pocket.color)}>
                    <span style={{ fontSize: 20 }}>{st.pocket.icon}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.pocketName}>{st.pocket.name}</div>
                    <div style={s.pocketNumRow}>
                      <span style={{ ...s.pocketRemain, color: warn ? "#D9463F" : nearLimit ? "#C97A2E" : "#2B2B2B" }}>
                        {yen(st.remaining)}
                      </span>
                      <span style={s.pocketOf}>/ {yenPlain(st.monthBudget)}円</span>
                    </div>
                  </div>
                  <span
                    style={s.detailLink}
                    onClick={(e) => { e.stopPropagation(); nav.go("pocketDetail", { pocketId: st.pocket.id }); }}
                  >詳細 ›</span>
                </div>
                <Bar pct={st.usageRate} color={st.pocket.color} warn={warn} />
                {showAux && (
                  <div style={s.pocketSub}>
                    使用率 {Math.min(999, Math.round(st.usageRate))}%{warn ? "・予算オーバー" : nearLimit ? "・残りわずか" : ""}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div style={s.homeActions}>
          <button style={s.primaryWideBtn} onClick={() => nav.go("input", {})}>＋ 支払いを記録する</button>
          <div style={s.homeActionsRow}>
            <button style={s.secondaryBtn} onClick={() => nav.go("monthlySettings", {})}>当月設定</button>
            <button style={s.secondaryBtn} onClick={() => nav.go("transfer", {})}>予算を振替</button>
          </div>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

/* ------------------------------ 支払入力（支出/収入/振替） ------------------------------ */

function InputScreen({ state, update, walletId, period, closingDay, initialPocketId, onDone, nav }) {
  const pockets = pocketsForWallet(state, walletId);
  const [type, setType] = useState("expense"); // expense | income
  const [date, setDate] = useState(dstr(new Date()));
  const [pocketId, setPocketId] = useState(initialPocketId || pockets.find((p) => isPocketEnabled(state, walletId, period, p.id))?.id || pockets[0]?.id);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(state.paymentMethods[0] || "現金");
  const [memo, setMemo] = useState("");
  const [editingId, setEditingId] = useState(null);

  const numAmount = Number(amount.replace(/[^\d]/g, "")) || 0;
  const canSave = numAmount > 0 && pocketId;

  const memo1 = {};
  const previewPocket = pockets.find((p) => p.id === pocketId);
  const previewStats = previewPocket ? pocketStats(state, walletId, period, previewPocket, memo1) : null;

  function reset() {
    setType("expense");
    setDate(dstr(new Date()));
    setPocketId(initialPocketId || pockets[0]?.id);
    setAmount("");
    setMethod(state.paymentMethods[0] || "現金");
    setMemo("");
    setEditingId(null);
  }

  function save() {
    if (!canSave) return;
    const tx = { id: editingId || uid("t"), walletId, date, type, pocketId, amount: numAmount, method: type === "expense" ? method : undefined, memo };
    update((prev) => {
      const list = prev.transactions.filter((t) => t.id !== tx.id);
      return { transactions: [...list, tx] };
    });
    reset();
    if (onDone) onDone();
  }

  return (
    <div style={s.screen}>
      <Header title="支払入力" onBack={nav.backToHome} />
      <div style={s.scroll}>
        <div style={s.typeTabs}>
          <button style={type === "expense" ? s.typeTabActive : s.typeTab} onClick={() => setType("expense")}>支出</button>
          <button style={type === "income" ? s.typeTabActive : s.typeTab} onClick={() => setType("income")}>収入</button>
        </div>

        <FieldLabel n={1} text="日付" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={s.input} />

        <FieldLabel n={2} text="袋" />
        <div style={s.pocketGrid}>
          {pockets.map((p) => (
            <button
              key={p.id}
              style={pocketId === p.id ? s.pocketChipActive(p.color) : s.pocketChip}
              onClick={() => setPocketId(p.id)}
            >
              <span style={{ marginRight: 6 }}>{p.icon}</span>{p.name}
            </button>
          ))}
        </div>

        <FieldLabel n={3} text="金額" />
        <div style={s.amountRow}>
          <span style={s.yenMark}>¥</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            style={s.amountInput}
          />
        </div>

        {type === "expense" && (
          <>
            <FieldLabel n={4} text="支払方法" />
            <div style={s.pocketGrid}>
              {state.paymentMethods.map((m) => (
                <button key={m} style={method === m ? s.methodChipActive : s.methodChip} onClick={() => setMethod(m)}>{m}</button>
              ))}
            </div>
          </>
        )}

        <FieldLabel n={type === "expense" ? 5 : 4} text="内容・メモ" />
        <input
          type="text"
          placeholder="例）カフェ、化粧水 など（任意）"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          style={s.input}
        />

        {previewStats && (
          <div style={s.budgetPreview} onClick={() => nav.go("pocketDetail", { pocketId })}>
            <div style={s.budgetPreviewRow}>
              <span>予算の内訳</span>
              <span style={{ color: "#8A8A8A" }}>詳細 ›</span>
            </div>
            <div style={s.budgetPreviewRow}>
              <span>{previewPocket.name} 今月予算</span>
              <span>{yenPlain(previewStats.monthBudget)}円</span>
            </div>
            <div style={s.budgetPreviewRow}>
              <span>この入力後の残額（目安）</span>
              <span style={{ color: previewStats.remaining - (type === "expense" ? numAmount : 0) < 0 ? "#D9463F" : "#2B2B2B", fontWeight: 700 }}>
                {yen(previewStats.remaining - (type === "expense" ? numAmount : 0) + (type === "income" ? numAmount : 0))}円
              </span>
            </div>
          </div>
        )}

        <button style={{ ...s.primaryWideBtn, marginTop: 20, opacity: canSave ? 1 : 0.4 }} disabled={!canSave} onClick={save}>
          保存する
        </button>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function FieldLabel({ n, text }) {
  return (
    <div style={s.fieldLabel}>
      <span style={s.fieldNum}>{n}</span>{text}
    </div>
  );
}

/* ------------------------------ 履歴 ------------------------------ */

function HistoryScreen({ state, update, walletId, period, closingDay, nav }) {
  const [mode, setMode] = useState("date"); // date | pocket
  const [selectedTx, setSelectedTx] = useState(null);
  const [selectedTransfer, setSelectedTransfer] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const pockets = pocketsForWallet(state, walletId);
  const pocketMap = Object.fromEntries(pockets.map((p) => [p.id, p]));

  const txInPeriod = state.transactions.filter(
    (t) => t.walletId === walletId && periodKeyForDate(t.date, closingDay) === period
  );
  const transfersInPeriod = state.transfers.filter(
    (tr) => (tr.fromWalletId === walletId && periodKeyForDate(tr.date, closingDay) === period) ||
            (tr.toWalletId === walletId && periodKeyForDate(tr.date, closingDay) === period)
  );

  function closeSheets() { setSelectedTx(null); setSelectedTransfer(null); }

  function removeTx(id) {
    update((prev) => ({ transactions: prev.transactions.filter((t) => t.id !== id) }));
    setDeleteTarget(null);
    closeSheets();
  }
  function removeTransfer(id) {
    update((prev) => ({ transfers: prev.transfers.filter((t) => t.id !== id) }));
    setDeleteTarget(null);
    closeSheets();
  }

  function openItem(it) {
    if (it.__transfer) setSelectedTransfer(it); else setSelectedTx(it);
  }

  let content;
  if (mode === "date") {
    const byDate = {};
    txInPeriod.forEach((t) => { (byDate[t.date] = byDate[t.date] || []).push(t); });
    transfersInPeriod.forEach((tr) => { (byDate[tr.date] = byDate[tr.date] || []).push({ ...tr, __transfer: true }); });
    const dates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));
    content = dates.length === 0 ? <div style={s.emptyBox}>この期間の履歴はまだありません</div> : dates.map((d) => {
      const items = byDate[d].sort((a, b) => (a.id < b.id ? 1 : -1));
      const dayTotal = items.filter((i) => !i.__transfer && i.type === "expense").reduce((s2, i) => s2 + i.amount, 0)
        - items.filter((i) => !i.__transfer && i.type === "income").reduce((s2, i) => s2 + i.amount, 0);
      return (
        <div key={d}>
          <div style={s.groupHeader}>
            <span>{parseDstr(d).getMonth() + 1}月{parseDstr(d).getDate()}日</span>
            <span>{yen(dayTotal)}</span>
          </div>
          <div style={s.groupBody}>
            {items.map((it) => (
              <CompactRow key={it.id + (it.__dir || "")} item={it} pocketMap={pocketMap} columnMode="pocket" onClick={() => openItem(it)} />
            ))}
          </div>
        </div>
      );
    });
  } else {
    content = pockets.map((p) => {
      const items = txInPeriod.filter((t) => t.pocketId === p.id).sort((a, b) => (a.date < b.date ? 1 : -1));
      const trIn = transfersInPeriod.filter((tr) => tr.toWalletId === walletId && tr.toPocketId === p.id);
      const trOut = transfersInPeriod.filter((tr) => tr.fromWalletId === walletId && tr.fromPocketId === p.id);
      const all = [...items, ...trIn.map((t) => ({ ...t, __transfer: true, __dir: "in" })), ...trOut.map((t) => ({ ...t, __transfer: true, __dir: "out" }))]
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      if (all.length === 0) return null;
      const total = items.filter((i) => i.type === "expense").reduce((s2, i) => s2 + i.amount, 0);
      return (
        <div key={p.id}>
          <div style={{ ...s.groupHeader, background: p.color + "22" }}>
            <span>{p.icon} {p.name}</span>
            <span>{yenPlain(total)}円</span>
          </div>
          <div style={s.groupBody}>
            {all.map((it) => (
              <CompactRow key={it.id + (it.__dir || "")} item={it} pocketMap={pocketMap} columnMode="date" onClick={() => openItem(it)} />
            ))}
          </div>
        </div>
      );
    });
  }

  return (
    <div style={s.screen}>
      <Header title="履歴" />
      <div style={s.scroll}>
        <PeriodNav periodKey={period} closingDay={closingDay} onPrev={() => {}} onNext={() => {}} />
        <div style={s.segTabs}>
          <button style={mode === "date" ? s.segTabActive : s.segTab} onClick={() => setMode("date")}>日別</button>
          <button style={mode === "pocket" ? s.segTabActive : s.segTab} onClick={() => setMode("pocket")}>袋別</button>
        </div>
        <div style={{ marginTop: 10 }}>{content}</div>
        <div style={{ height: 24 }} />
      </div>

      {selectedTx && (
        <Sheet title="取引の詳細" onClose={closeSheets}>
          <EditTxForm
            state={state}
            update={update}
            walletId={walletId}
            tx={selectedTx}
            onDone={closeSheets}
            onRequestDelete={() => setDeleteTarget(selectedTx)}
          />
        </Sheet>
      )}

      {selectedTransfer && (
        <Sheet title="振替の詳細" onClose={closeSheets}>
          <TransferDetailView
            transfer={selectedTransfer}
            state={state}
            onRequestDelete={() => setDeleteTarget(selectedTransfer)}
          />
        </Sheet>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.__transfer ? "振替履歴を削除しますか？" : "この履歴を削除しますか？"}
          message="削除すると、関連する袋の残額計算から取り消されます。この操作は元に戻せません。"
          confirmLabel="削除する"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteTarget.__transfer ? removeTransfer(deleteTarget.id) : removeTx(deleteTarget.id)}
        />
      )}
    </div>
  );
}

// 日別・袋別どちらでも使う1行コンパクト表示。
// columnMode="pocket" -> 左列に「袋名」（日別タブ用）／ columnMode="date" -> 左列に「日付」（袋別タブ用）
function CompactRow({ item, pocketMap, columnMode, onClick }) {
  if (item.__transfer) {
    const fromP = pocketMap[item.fromPocketId];
    const toP = pocketMap[item.toPocketId];
    const dateLabel = `${parseDstr(item.date).getMonth() + 1}/${parseDstr(item.date).getDate()}`;
    const badgeAndNames = (
      <span style={s.compactLeftInner}>
        <span style={s.transferBadgeSmall}>振替</span>
        <span style={s.compactTruncate}>{(fromP ? fromP.name : "他財布")}→{(toP ? toP.name : "他財布")}</span>
      </span>
    );
    return (
      <div style={s.compactRow} onClick={onClick}>
        <div style={s.compactLeft}>{columnMode === "date" ? <span style={s.compactTruncate}>{dateLabel}</span> : badgeAndNames}</div>
        <div style={s.compactAmount}>{yenPlain(item.amount)}</div>
        <div style={s.compactSub}>{columnMode === "date" ? badgeAndNames : (item.memo || "")}</div>
      </div>
    );
  }
  const p = pocketMap[item.pocketId];
  const isIncome = item.type === "income";
  const sub = item.memo && item.method ? `${item.memo}・${item.method}` : (item.memo || item.method || "");
  const dateLabel = `${parseDstr(item.date).getMonth() + 1}/${parseDstr(item.date).getDate()}`;

  return (
    <div style={s.compactRow} onClick={onClick}>
      <div style={s.compactLeft}>
        {columnMode === "pocket"
          ? <span style={s.compactTruncate}>{p ? p.icon + " " + p.name : "不明"}</span>
          : <span style={s.compactTruncate}>{dateLabel}</span>}
      </div>
      <div style={{ ...s.compactAmount, color: isIncome ? "#3D8F5F" : "#2B2B2B" }}>
        {isIncome ? "+" : ""}{yenPlain(item.amount)}
      </div>
      <div style={s.compactSub}>{sub}</div>
    </div>
  );
}

function TransferDetailView({ transfer, state, onRequestDelete }) {
  const fromWallet = state.wallets.find((w) => w.id === transfer.fromWalletId);
  const toWallet = state.wallets.find((w) => w.id === transfer.toWalletId);
  const fromP = state.pockets.find((p) => p.id === transfer.fromPocketId);
  const toP = state.pockets.find((p) => p.id === transfer.toPocketId);
  return (
    <div>
      <DetailRow label="日付" value={`${parseDstr(transfer.date).getMonth() + 1}月${parseDstr(transfer.date).getDate()}日`} />
      <DetailRow label="振替元" value={`${fromWallet ? fromWallet.name + " / " : ""}${fromP ? fromP.icon + " " + fromP.name : "不明"}`} />
      <DetailRow label="振替先" value={`${toWallet ? toWallet.name + " / " : ""}${toP ? toP.icon + " " + toP.name : "不明"}`} />
      <DetailRow label="金額" value={`${yenPlain(transfer.amount)}円`} bold />
      {transfer.memo && <DetailRow label="メモ" value={transfer.memo} />}
      <button style={{ ...s.deleteWideBtn, marginTop: 18 }} onClick={onRequestDelete}>この振替を削除</button>
    </div>
  );
}

function EditTxForm({ state, update, walletId, tx, onDone, onRequestDelete }) {
  const pockets = pocketsForWallet(state, walletId);
  const [date, setDate] = useState(tx.date);
  const [pocketId, setPocketId] = useState(tx.pocketId);
  const [amount, setAmount] = useState(String(tx.amount));
  const [method, setMethod] = useState(tx.method || state.paymentMethods[0]);
  const [memo, setMemo] = useState(tx.memo || "");

  function save() {
    const numAmount = Number(amount.replace(/[^\d]/g, "")) || 0;
    if (numAmount <= 0) return;
    update((prev) => ({
      transactions: prev.transactions.map((t) => t.id === tx.id ? { ...t, date, pocketId, amount: numAmount, method: tx.type === "expense" ? method : undefined, memo } : t)
    }));
    onDone();
  }

  return (
    <div>
      <FieldLabel n={1} text="日付" />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={s.input} />
      <FieldLabel n={2} text="袋" />
      <div style={s.pocketGrid}>
        {pockets.map((p) => (
          <button key={p.id} style={pocketId === p.id ? s.pocketChipActive(p.color) : s.pocketChip} onClick={() => setPocketId(p.id)}>
            {p.icon} {p.name}
          </button>
        ))}
      </div>
      <FieldLabel n={3} text="金額" />
      <div style={s.amountRow}>
        <span style={s.yenMark}>¥</span>
        <input type="text" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} style={s.amountInput} />
      </div>
      {tx.type === "expense" && (
        <>
          <FieldLabel n={4} text="支払方法" />
          <div style={s.pocketGrid}>
            {state.paymentMethods.map((m) => (
              <button key={m} style={method === m ? s.methodChipActive : s.methodChip} onClick={() => setMethod(m)}>{m}</button>
            ))}
          </div>
        </>
      )}
      <FieldLabel n={tx.type === "expense" ? 5 : 4} text="内容・メモ" />
      <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} style={s.input} />
      <button style={{ ...s.primaryWideBtn, marginTop: 16 }} onClick={save}>更新する</button>
      {onRequestDelete && (
        <button style={{ ...s.deleteWideBtn, marginTop: 10 }} onClick={onRequestDelete}>この履歴を削除</button>
      )}
    </div>
  );
}

/* ------------------------------ カレンダー ------------------------------ */

function CalendarScreen({ state, update, walletId, period, closingDay, nav }) {
  const [selectedDate, setSelectedDate] = useState(null);
  const { start, end } = periodRange(period, closingDay);

  const dayTotals = {};
  state.transactions.filter((t) => t.walletId === walletId).forEach((t) => {
    if (periodKeyForDate(t.date, closingDay) !== period) return;
    const cur = dayTotals[t.date] || { expense: 0, income: 0 };
    if (t.type === "expense") cur.expense += t.amount; else cur.income += t.amount;
    dayTotals[t.date] = cur;
  });

  // カレンダーは start〜end の月の並びで表示（複数月にまたがる締め日にも対応するためstartの月とendの月をそれぞれ描画）
  const months = [];
  {
    const seen = new Set();
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      if (!seen.has(key)) { months.push(new Date(cursor)); seen.add(key); }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  const pocketMap = Object.fromEntries(state.pockets.map((p) => [p.id, p]));
  const dayItems = selectedDate
    ? state.transactions.filter((t) => t.walletId === walletId && t.date === selectedDate)
    : [];

  return (
    <div style={s.screen}>
      <Header title="カレンダー" />
      <div style={s.scroll}>
        <PeriodNav periodKey={period} closingDay={closingDay} onPrev={() => {}} onNext={() => {}} />
        {months.map((monthDate) => (
          <MonthGrid
            key={`${monthDate.getFullYear()}-${monthDate.getMonth()}`}
            monthDate={monthDate}
            start={start}
            end={end}
            dayTotals={dayTotals}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
          />
        ))}

        {selectedDate && (
          <div style={s.dayDetailBox}>
            <div style={s.dayDetailTitle}>
              {parseDstr(selectedDate).getMonth() + 1}月{parseDstr(selectedDate).getDate()}日の内訳
            </div>
            {dayItems.length === 0 && <div style={s.emptyBox}>この日の取引はありません</div>}
            {dayItems.map((it) => {
              const p = pocketMap[it.pocketId];
              const isIncome = it.type === "income";
              return (
                <div key={it.id} style={s.historyRow}>
                  <div style={s.historyPocketDot(p ? p.color : "#ccc")} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.historyPocketName}>{p ? p.icon + " " + p.name : "不明"}</div>
                    {(it.memo || it.method) && <div style={s.historyMemo}>{it.memo}{it.method ? `　${it.method}` : ""}</div>}
                  </div>
                  <div style={{ ...s.historyAmount, color: isIncome ? "#3D8F5F" : "#2B2B2B" }}>
                    {isIncome ? "+" : "-"}{yenPlain(it.amount)}円
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function MonthGrid({ monthDate, start, end, dayTotals, selectedDate, onSelect }) {
  const y = monthDate.getFullYear(), m = monthDate.getMonth();
  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);
  const startWeekday = firstDay.getDay();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(y, m, d));

  const today = dstr(new Date());

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={s.calMonthTitle}>{y}年{m + 1}月</div>
      <div style={s.calWeekRow}>
        {WEEKDAYS.map((w, i) => (
          <div key={w} style={{ ...s.calWeekCell, color: i === 0 ? "#D9463F" : i === 6 ? "#3D6FD9" : "#8A8A8A" }}>{w}</div>
        ))}
      </div>
      <div style={s.calGrid}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} style={s.calCell} />;
          const inRange = d >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) && d <= end;
          const ds = dstr(d);
          const totals = dayTotals[ds];
          const isToday = ds === today;
          const isSelected = ds === selectedDate;
          return (
            <button
              key={i}
              style={{
                ...s.calCell,
                ...s.calCellBtn,
                opacity: inRange ? 1 : 0.3,
                background: isSelected ? "#F0F7F3" : "transparent",
                border: isToday ? "1.5px solid #5FA98A" : "1.5px solid transparent",
              }}
              onClick={() => inRange && onSelect(ds === selectedDate ? null : ds)}
              disabled={!inRange}
            >
              <span style={s.calDayNum}>{d.getDate()}</span>
              {totals?.expense > 0 && <span style={s.calDayExpense}>-{compactYen(totals.expense)}</span>}
              {totals?.income > 0 && <span style={s.calDayIncome}>+{compactYen(totals.income)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function compactYen(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(n % 10000 === 0 ? 0 : 1)}万`;
  return n.toLocaleString("ja-JP");
}

/* ------------------------------ 袋詳細 ------------------------------ */

function PocketDetailScreen({ state, update, walletId, period, closingDay, pocketId, nav }) {
  const pocket = state.pockets.find((p) => p.id === pocketId);
  const memo = {};
  const stats = pocketStats(state, walletId, period, pocket, memo);
  const [showTransferHistory, setShowTransferHistory] = useState(true);

  const relatedTransfers = state.transfers.filter(
    (tr) => (tr.fromWalletId === walletId && tr.fromPocketId === pocketId) || (tr.toWalletId === walletId && tr.toPocketId === pocketId)
  ).filter((tr) => periodKeyForDate(tr.date, closingDay) === period);

  if (!pocket) return null;

  return (
    <div style={s.screen}>
      <Header title="袋の詳細" onBack={nav.back} />
      <div style={s.scroll}>
        <div style={s.detailHeaderCard}>
          <div style={s.pocketIconWrap(pocket.color)}><span style={{ fontSize: 26 }}>{pocket.icon}</span></div>
          <div style={s.detailHeaderName}>{pocket.name}</div>
          {!pocket.locked && (
            <div style={s.detailHeaderCarry}>
              自動繰越：{pocket.carryOver ? "ON" : "OFF"}
            </div>
          )}
        </div>

        <div style={{ ...s.overallCard, borderColor: stats.remaining < 0 ? "#E8615A" : "#DCEBD9" }}>
          <div style={s.overallNumRow}>
            <span style={{ ...s.overallNum, color: stats.remaining < 0 ? "#D9463F" : "#2F5D4F" }}>{yen(stats.remaining)}</span>
            <span style={s.overallOf}>/ {yenPlain(stats.monthBudget)}円</span>
          </div>
          <Bar pct={stats.usageRate} color={pocket.color} warn={stats.remaining < 0} />
        </div>

        <DetailRow label="基本予算" value={`${yenPlain(stats.basicBudget)}円`} />
        <DetailRow label="当月設定による調整" value={`${stats.baseline - stats.basicBudget >= 0 ? "+" : ""}${yenPlain(stats.baseline - stats.basicBudget)}円`} />
        {pocket.carryOver && <DetailRow label="前月からの繰越" value={`${stats.carry >= 0 ? "+" : ""}${yenPlain(stats.carry)}円`} />}
        <DetailRow label="収入" value={`+${yenPlain(stats.income)}円`} />
        <DetailRow label="振替 入" value={`+${yenPlain(stats.transferIn)}円`} />
        <DetailRow label="振替 出" value={`-${yenPlain(stats.transferOut)}円`} />
        <DetailRow label="今月予算（合計）" value={`${yenPlain(stats.monthBudget)}円`} bold />
        <DetailRow label="使用額" value={`${yenPlain(stats.expense)}円`} />
        <DetailRow label="残額" value={`${yen(stats.remaining)}円`} bold accent={stats.remaining < 0} />

        <div style={s.detailActions}>
          <button style={s.secondaryBtn} onClick={() => nav.go("input", { pocketId })}>この袋に支払いを記録</button>
          <button style={s.secondaryBtn} onClick={() => nav.go("transfer", { fromPocketId: pocketId })}>この袋から振替する</button>
        </div>

        {relatedTransfers.length > 0 && (
          <>
            <div style={s.sectionLabel}>今期間の振替履歴</div>
            {relatedTransfers.map((tr) => (
              <div key={tr.id} style={s.historyRow}>
                <div style={s.transferBadge}>振替</div>
                <div style={{ flex: 1 }}>
                  <div style={s.historyMemo}>
                    {tr.fromWalletId === walletId && tr.fromPocketId === pocketId ? "この袋から出金" : "この袋へ入金"}
                    {tr.memo ? `　${tr.memo}` : ""}
                  </div>
                </div>
                <div style={s.historyAmount}>{yenPlain(tr.amount)}円</div>
              </div>
            ))}
          </>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function DetailRow({ label, value, bold, accent }) {
  return (
    <div style={s.detailRow}>
      <span style={s.detailRowLabel}>{label}</span>
      <span style={{ ...s.detailRowValue, fontWeight: bold ? 800 : 500, color: accent ? "#D9463F" : "#2B2B2B" }}>{value}</span>
    </div>
  );
}

/* ------------------------------ 振替 ------------------------------ */

function TransferScreen({ state, update, walletId, initialFromPocketId, nav }) {
  const [fromWalletId, setFromWalletId] = useState(walletId);
  const [toWalletId, setToWalletId] = useState(walletId);
  const fromPockets = pocketsForWallet(state, fromWalletId).filter((p) => !p.locked);
  const toPockets = pocketsForWallet(state, toWalletId).filter((p) => !p.locked);
  const [fromPocketId, setFromPocketId] = useState(initialFromPocketId || fromPockets[0]?.id);
  const [toPocketId, setToPocketId] = useState(toPockets.find((p) => p.id !== fromPocketId)?.id || toPockets[0]?.id);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(dstr(new Date()));

  const numAmount = Number(amount.replace(/[^\d]/g, "")) || 0;
  const canSave = numAmount > 0 && fromPocketId && toPocketId && !(fromWalletId === toWalletId && fromPocketId === toPocketId);

  function save() {
    if (!canSave) return;
    const tr = { id: uid("tr"), date, fromWalletId, fromPocketId, toWalletId, toPocketId, amount: numAmount, memo };
    update((prev) => ({ transfers: [...prev.transfers, tr] }));
    nav.backToHome();
  }

  return (
    <div style={s.screen}>
      <Header title="袋の予算を振替" onBack={nav.back} />
      <div style={s.scroll}>
        <div style={s.helpText}>基本予算は変わりません。今月の予算だけを袋の間で移動します。財布をまたいだ振替もできます。</div>

        <FieldLabel n={1} text="日付" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={s.input} />

        <FieldLabel n={2} text="振替元の袋" />
        {state.wallets.length > 1 && (
          <select value={fromWalletId} onChange={(e) => { setFromWalletId(e.target.value); setFromPocketId(pocketsForWallet(state, e.target.value).filter(p=>!p.locked)[0]?.id); }} style={s.input}>
            {state.wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
        <div style={s.pocketGrid}>
          {fromPockets.map((p) => (
            <button key={p.id} style={fromPocketId === p.id ? s.pocketChipActive(p.color) : s.pocketChip} onClick={() => setFromPocketId(p.id)}>
              {p.icon} {p.name}
            </button>
          ))}
        </div>

        <div style={s.transferArrow}>↓</div>

        <FieldLabel n={3} text="振替先の袋" />
        {state.wallets.length > 1 && (
          <select value={toWalletId} onChange={(e) => { setToWalletId(e.target.value); setToPocketId(pocketsForWallet(state, e.target.value).filter(p=>!p.locked)[0]?.id); }} style={s.input}>
            {state.wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
        <div style={s.pocketGrid}>
          {toPockets.map((p) => (
            <button key={p.id} style={toPocketId === p.id ? s.pocketChipActive(p.color) : s.pocketChip} onClick={() => setToPocketId(p.id)}>
              {p.icon} {p.name}
            </button>
          ))}
        </div>

        <FieldLabel n={4} text="金額" />
        <div style={s.amountRow}>
          <span style={s.yenMark}>¥</span>
          <input type="text" inputMode="numeric" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} style={s.amountInput} />
        </div>

        <FieldLabel n={5} text="メモ" />
        <input type="text" placeholder="任意" value={memo} onChange={(e) => setMemo(e.target.value)} style={s.input} />

        <button style={{ ...s.primaryWideBtn, marginTop: 20, opacity: canSave ? 1 : 0.4 }} disabled={!canSave} onClick={save}>
          振替を実行
        </button>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

/* ------------------------------ 当月設定 ------------------------------ */

function MonthlySettingsScreen({ state, update, walletId, period, closingDay, nav }) {
  const pockets = pocketsForWallet(state, walletId).filter((p) => !p.locked);
  const [confirmReset, setConfirmReset] = useState(false);
  const memo = {};

  function getEnabled(pocketId) {
    return isPocketEnabled(state, walletId, period, pocketId);
  }
  function getBaseline(pocket) {
    return baselineBudget(state, walletId, period, pocket);
  }

  function toggleEnabled(pocketId) {
    update((prev) => {
      const cur = { ...(prev.monthlyEnabled || {}) };
      cur[walletId] = { ...(cur[walletId] || {}) };
      cur[walletId][period] = { ...(cur[walletId][period] || {}) };
      const curVal = cur[walletId][period][pocketId] !== undefined ? cur[walletId][period][pocketId] : pockets.find(p=>p.id===pocketId).enabledDefault;
      cur[walletId][period][pocketId] = !curVal;
      return { monthlyEnabled: cur };
    });
  }

  function setBaseline(pocket, value) {
    const n = Number(String(value).replace(/[^\d]/g, "")) || 0;
    update((prev) => {
      const cur = { ...(prev.monthlyAdjust || {}) };
      cur[walletId] = { ...(cur[walletId] || {}) };
      cur[walletId][period] = { ...(cur[walletId][period] || {}) };
      cur[walletId][period][pocket.id] = n - pocket.basicBudget;
      return { monthlyAdjust: cur };
    });
  }

  const overallBaseline = pockets.filter((p) => getEnabled(p.id)).reduce((sum, p) => sum + getBaseline(p), 0);

  function doReset() {
    update((prev) => {
      const adj = { ...(prev.monthlyAdjust || {}) };
      if (adj[walletId]) { adj[walletId] = { ...adj[walletId] }; delete adj[walletId][period]; }
      const en = { ...(prev.monthlyEnabled || {}) };
      if (en[walletId]) { en[walletId] = { ...en[walletId] }; delete en[walletId][period]; }
      return { monthlyAdjust: adj, monthlyEnabled: en };
    });
    setConfirmReset(false);
  }

  return (
    <div style={s.screen}>
      <Header title="当月設定" onBack={nav.back} />
      <div style={s.scroll}>
        <div style={s.helpText}>{formatPeriodLabel(period, closingDay)} だけに適用される設定です。標準設定（翌月以降）には影響しません。</div>

        <div style={s.settingsOverallRow}>
          <span>全体（表示中の袋の合計）</span>
          <span style={{ fontWeight: 800 }}>{yenPlain(overallBaseline)}円</span>
        </div>

        <div style={s.sectionLabel}>袋分け種類</div>
        {pockets.map((p) => {
          const enabled = getEnabled(p.id);
          const baseline = getBaseline(p);
          return (
            <div key={p.id} style={s.monthlyRow}>
              <Toggle checked={enabled} onChange={() => toggleEnabled(p.id)} />
              <div style={s.pocketIconWrap(p.color)}><span>{p.icon}</span></div>
              <span style={s.monthlyRowName}>{p.name}</span>
              <input
                type="text"
                inputMode="numeric"
                value={baseline.toLocaleString("ja-JP")}
                onChange={(e) => setBaseline(p, e.target.value)}
                style={s.monthlyRowInput}
                disabled={!enabled}
              />
            </div>
          );
        })}

        <button style={s.resetBtn} onClick={() => setConfirmReset(true)}>標準設定に戻す</button>
        <div style={{ height: 24 }} />
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="この期間の当月設定を標準設定に戻しますか？"
          message={`戻るもの：この期間だけ変更した「今月予算」と「表示ON/OFF」\n戻らないもの：支出・収入・振替の履歴、繰越済みの金額`}
          confirmLabel="標準設定に戻す"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={doReset}
        />
      )}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      style={{
        width: 44, height: 26, borderRadius: 13, border: "none", flexShrink: 0,
        background: checked ? "#5FA98A" : "#DADADA", position: "relative", cursor: "pointer", padding: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 20 : 2, width: 22, height: 22, borderRadius: 11,
        background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left 0.15s",
      }} />
    </button>
  );
}

/* ------------------------------ 標準設定 ------------------------------ */

function StandardSettingsScreen({ state, update, walletId, nav }) {
  const pockets = pocketsForWallet(state, walletId);
  const editable = pockets; // ホームに存在するすべての袋（「その他」を含む）を一覧に表示する
  const [deleteTarget, setDeleteTarget] = useState(null);

  function patchPocket(id, patch) {
    update((prev) => ({ pockets: prev.pockets.map((p) => p.id === id ? { ...p, ...patch } : p) }));
  }

  function addPocket() {
    const maxOrder = Math.max(0, ...editable.map((p) => p.order));
    const newP = {
      id: uid("p"), walletId, name: "新しい袋", icon: "🎁",
      color: COLOR_PALETTE[editable.length % COLOR_PALETTE.length],
      basicBudget: 0, order: maxOrder + 1, enabledDefault: true, carryOver: false,
    };
    update((prev) => ({ pockets: [...prev.pockets, newP] }));
  }

  function move(id, dir) {
    const sorted = [...editable].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((p) => p.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[swapIdx];
    update((prev) => ({
      pockets: prev.pockets.map((p) => {
        if (p.id === a.id) return { ...p, order: b.order };
        if (p.id === b.id) return { ...p, order: a.order };
        return p;
      }),
    }));
  }

  function hasHistory(id) {
    return state.transactions.some((t) => t.pocketId === id) || state.transfers.some((tr) => tr.fromPocketId === id || tr.toPocketId === id);
  }

  function doDelete(id) {
    update((prev) => ({ pockets: prev.pockets.filter((p) => p.id !== id) }));
    setDeleteTarget(null);
  }

  const total = editable.filter((p) => p.enabledDefault).reduce((s2, p) => s2 + p.basicBudget, 0);

  return (
    <div style={s.screen}>
      <Header title="袋分け標準設定" onBack={nav.back} />
      <div style={s.scroll}>
        <div style={s.helpText}>ここでの変更は翌月以降に反映されます。過去の月の基本予算は変わりません。</div>

        <div style={s.settingsOverallRow}>
          <span>全体（表示ONの袋の合計）</span>
          <span style={{ fontWeight: 800 }}>{yenPlain(total)}円</span>
        </div>

        <div style={s.sectionLabelRow}>
          <span>袋分け種類</span>
          <button style={s.addBtn} onClick={addPocket}>＋ 袋を追加</button>
        </div>

        {editable.sort((a, b) => a.order - b.order).map((p, idx) => (
          <div key={p.id} style={s.standardRow}>
            <div style={s.standardRowTop}>
              <Toggle checked={p.enabledDefault} onChange={() => patchPocket(p.id, { enabledDefault: !p.enabledDefault })} />
              <IconPicker value={p.icon} color={p.color} onChangeIcon={(icon) => patchPocket(p.id, { icon })} onChangeColor={(color) => patchPocket(p.id, { color })} />
              <input
                type="text"
                value={p.name}
                onChange={(e) => patchPocket(p.id, { name: e.target.value })}
                style={s.standardNameInput}
              />
              <div style={s.orderBtns}>
                <button style={s.orderBtn} onClick={() => move(p.id, -1)} disabled={idx === 0}>▲</button>
                <button style={s.orderBtn} onClick={() => move(p.id, 1)} disabled={idx === editable.length - 1}>▼</button>
              </div>
            </div>
            <div style={s.standardRowBottom}>
              <label style={s.standardBudgetLabel}>基本予算</label>
              <div style={s.amountRowSmall}>
                <span style={s.yenMark}>¥</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={p.basicBudget.toLocaleString("ja-JP")}
                  onChange={(e) => patchPocket(p.id, { basicBudget: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
                  style={s.amountInputSmall}
                />
              </div>
              <label style={s.carryLabel}>
                <Toggle checked={p.carryOver} onChange={() => patchPocket(p.id, { carryOver: !p.carryOver })} />
                <span style={{ marginLeft: 8 }}>自動繰越</span>
              </label>
              <button style={s.deleteLink} onClick={() => setDeleteTarget(p)}>削除</button>
            </div>
          </div>
        ))}
        <div style={{ height: 24 }} />
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={`「${deleteTarget.name}」を削除しますか？`}
          message={hasHistory(deleteTarget.id)
            ? "この袋には支出・収入・振替の履歴があります。削除すると、それらの履歴は袋の紐付けを失い、集計から除外されます。本当によろしいですか？"
            : "この袋にはまだ履歴がありません。削除してもデータへの影響はありません。"}
          confirmLabel="削除する"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => doDelete(deleteTarget.id)}
        />
      )}
    </div>
  );
}

function IconPicker({ value, color, onChangeIcon, onChangeColor }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button style={{ ...s.pocketIconWrap(color), border: "none", cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <span style={{ fontSize: 18 }}>{value}</span>
      </button>
      {open && (
        <div style={s.iconPopover}>
          <div style={s.iconGrid}>
            {ICON_CHOICES.map((ic) => (
              <button key={ic} style={s.iconOption} onClick={() => { onChangeIcon(ic); }}>{ic}</button>
            ))}
          </div>
          <div style={s.colorGrid}>
            {COLOR_PALETTE.map((c) => (
              <button key={c} style={{ ...s.colorOption, background: c, outline: c === color ? "2px solid #333" : "none" }} onClick={() => onChangeColor(c)} />
            ))}
          </div>
          <button style={s.iconPopoverClose} onClick={() => setOpen(false)}>閉じる</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ 設定 ------------------------------ */

function SettingsScreen({ state, update, walletId, nav }) {
  const wallet = getWallet(state, walletId);
  const [newMethod, setNewMethod] = useState("");
  const [newWalletName, setNewWalletName] = useState("");
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef(null);

  function addMethod() {
    const v = newMethod.trim();
    if (!v || state.paymentMethods.includes(v)) return;
    update((prev) => ({ paymentMethods: [...prev.paymentMethods, v] }));
    setNewMethod("");
  }
  function removeMethod(m) {
    update((prev) => ({ paymentMethods: prev.paymentMethods.filter((x) => x !== m) }));
  }
  function setClosingDay(day) {
    update((prev) => ({ wallets: prev.wallets.map((w) => w.id === walletId ? { ...w, closingDay: day } : w) }));
  }
  function addWallet() {
    const name = newWalletName.trim();
    if (!name) return;
    const newId = uid("w");
    update((prev) => ({
      wallets: [...prev.wallets, { id: newId, name, closingDay: 31 }],
      pockets: [...prev.pockets, { id: uid("p"), walletId: newId, name: "自由費", icon: "💰", color: COLOR_PALETTE[0], basicBudget: 10000, order: 0, enabledDefault: true, carryOver: false },
        { id: uid("p"), walletId: newId, name: "その他", icon: "🧾", color: "#C9C9C9", basicBudget: 0, order: 99, enabledDefault: true, carryOver: false, locked: true }],
    }));
    setNewWalletName("");
  }
  function toggleAux() {
    update((prev) => ({ settings: { ...prev.settings, showAux: !prev.settings.showAux } }));
  }
  function resetAll() {
    const sample = buildSampleState();
    update(() => sample);
    setConfirmResetAll(false);
  }

  function exportBackup() {
    try {
      const dataStr = JSON.stringify(state, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `fukuwake-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setImportError("バックアップの書き出しに失敗しました。");
    }
  }

  function onFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || !Array.isArray(parsed.wallets) || !Array.isArray(parsed.pockets) || !Array.isArray(parsed.transactions)) {
          setImportError("このファイルは袋分け家計簿のバックアップ形式ではないようです。");
          return;
        }
        setImportError("");
        setImportPreview(parsed);
      } catch (err) {
        setImportError("ファイルの読み込みに失敗しました。書き出したバックアップ（.json）ファイルを選択してください。");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function doImport() {
    update(() => importPreview);
    setImportPreview(null);
  }

  return (
    <div style={s.screen}>
      <Header title="設定" />
      <div style={s.scroll}>
        <div style={s.sectionLabel}>予算・表示</div>
        <SettingsLink label="当月設定" onClick={() => nav.go("monthlySettings", {})} />
        <SettingsLink label="袋分け標準設定" onClick={() => nav.go("standardSettings", {})} />
        <SettingsRowToggle label="補助情報（使用率・残り日数）を表示" checked={state.settings.showAux} onChange={toggleAux} />

        <div style={s.sectionLabel}>財布</div>
        {state.wallets.map((w) => (
          <div key={w.id} style={s.walletRow}>
            <span style={{ fontWeight: w.id === walletId ? 800 : 500 }}>{w.name}{w.id === walletId ? "（表示中）" : ""}</span>
            <button style={s.smallLink} onClick={() => nav.setWallet(w.id)}>切替</button>
          </div>
        ))}
        <div style={s.addRow}>
          <input placeholder="新しい財布名（例：共用）" value={newWalletName} onChange={(e) => setNewWalletName(e.target.value)} style={s.input} />
          <button style={s.smallAddBtn} onClick={addWallet}>追加</button>
        </div>

        <div style={s.sectionLabel}>締め日（{wallet.name}）</div>
        <div style={s.helpText}>「31」を選ぶと月末締めになります。例：25日締めの場合、9月分は8月26日〜9月25日です。</div>
        <select value={wallet.closingDay} onChange={(e) => setClosingDay(Number(e.target.value))} style={s.input}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{d === 31 ? "月末（31日）" : `${d}日`}</option>
          ))}
        </select>

        <div style={s.sectionLabel}>支払方法</div>
        {state.paymentMethods.map((m) => (
          <div key={m} style={s.walletRow}>
            <span>{m}</span>
            <button style={s.smallLink} onClick={() => removeMethod(m)}>削除</button>
          </div>
        ))}
        <div style={s.addRow}>
          <input placeholder="新しい支払方法" value={newMethod} onChange={(e) => setNewMethod(e.target.value)} style={s.input} />
          <button style={s.smallAddBtn} onClick={addMethod}>追加</button>
        </div>

        <div style={s.sectionLabel}>バックアップ／復元</div>
        <div style={s.helpText}>
          データはこの端末のブラウザ内だけに保存されています。機種変更やSafariのデータ削除に備えて、時々「バックアップを書き出す」でファイルを保存しておくことをおすすめします。
        </div>
        <SettingsLink label="データをバックアップ（書き出す）" onClick={exportBackup} />
        <SettingsLink label="バックアップから復元（読み込む）" onClick={() => fileInputRef.current && fileInputRef.current.click()} />
        <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onFileSelected} />
        {importError && (
          <div style={{ ...s.helpText, color: "#D9463F", background: "#FBEAE9" }}>{importError}</div>
        )}

        <div style={s.sectionLabel}>データ</div>
        <SettingsLink label="サンプルデータにリセット" onClick={() => setConfirmResetAll(true)} danger />

        <div style={{ height: 24 }} />
      </div>

      {confirmResetAll && (
        <ConfirmDialog
          title="すべてのデータをサンプルにリセットしますか？"
          message="現在の財布・袋・履歴・振替はすべて削除され、初期サンプルデータに置き換わります。この操作は元に戻せません。"
          confirmLabel="リセットする"
          danger
          onCancel={() => setConfirmResetAll(false)}
          onConfirm={resetAll}
        />
      )}

      {importPreview && (
        <ConfirmDialog
          title="バックアップから復元しますか？"
          message="この端末の現在のデータ（財布・袋・履歴・振替・設定）はすべて、選択したバックアップファイルの内容で上書きされます。この操作は元に戻せません。"
          confirmLabel="復元する"
          danger
          onCancel={() => setImportPreview(null)}
          onConfirm={doImport}
        />
      )}
    </div>
  );
}

function SettingsLink({ label, onClick, danger }) {
  return (
    <button style={s.settingsLink} onClick={onClick}>
      <span style={{ color: danger ? "#D9463F" : "#2B2B2B" }}>{label}</span>
      <span style={{ color: "#B8B8B8" }}>›</span>
    </button>
  );
}
function SettingsRowToggle({ label, checked, onChange }) {
  return (
    <div style={s.settingsToggleRow}>
      <span>{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

/* ------------------------------ ボトムナビ ------------------------------ */

function BottomNav({ current, onNavigate }) {
  const items = [
    { key: "home", label: "ホーム", icon: "🏠" },
    { key: "history", label: "履歴", icon: "📋" },
    { key: "calendar", label: "カレンダー", icon: "📅" },
    { key: "settings", label: "設定", icon: "⚙️" },
  ];
  return (
    <div style={s.bottomNav}>
      {items.map((it) => (
        <button key={it.key} style={s.navItem} onClick={() => onNavigate(it.key)}>
          <span style={{ fontSize: 20, opacity: current === it.key ? 1 : 0.55 }}>{it.icon}</span>
          <span style={{ ...s.navLabel, color: current === it.key ? "#2F5D4F" : "#9A9A9A", fontWeight: current === it.key ? 700 : 500 }}>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ App ルート ------------------------------ */

export default function App() {
  const [state, setState, update] = useStore();
  const [screen, setScreen] = useState("home");
  const [params, setParams] = useState({});
  const [prevScreen, setPrevScreen] = useState("home");

  const walletId = state.currentWalletId;
  const wallet = getWallet(state, walletId);
  const closingDay = wallet.closingDay;
  const [period, setPeriod] = useState(() => currentPeriodKey(closingDay));

  // 財布切替時、期間を現在に合わせ直す
  const setWallet = useCallback((id) => {
    update(() => ({ currentWalletId: id }));
    const w = state.wallets.find((x) => x.id === id);
    setPeriod(currentPeriodKey(w ? w.closingDay : 31));
  }, [state.wallets, update]);

  const nav = {
    go: (scr, p) => { setPrevScreen(screen); setScreen(scr); setParams(p || {}); },
    back: () => { setScreen(prevScreen); setParams({}); },
    backToHome: () => { setScreen("home"); setParams({}); },
    setWallet,
  };

  let body;
  if (screen === "home") {
    body = <HomeScreen state={state} update={update} walletId={walletId} period={period} setPeriod={setPeriod} closingDay={closingDay} nav={nav} />;
  } else if (screen === "input") {
    body = <InputScreen state={state} update={update} walletId={walletId} period={period} closingDay={closingDay} initialPocketId={params.pocketId} onDone={nav.backToHome} nav={nav} />;
  } else if (screen === "history") {
    body = <HistoryScreen state={state} update={update} walletId={walletId} period={period} closingDay={closingDay} nav={nav} />;
  } else if (screen === "calendar") {
    body = <CalendarScreen state={state} update={update} walletId={walletId} period={period} closingDay={closingDay} nav={nav} />;
  } else if (screen === "settings") {
    body = <SettingsScreen state={state} update={update} walletId={walletId} nav={nav} />;
  } else if (screen === "pocketDetail") {
    body = <PocketDetailScreen state={state} update={update} walletId={walletId} period={period} closingDay={closingDay} pocketId={params.pocketId} nav={nav} />;
  } else if (screen === "monthlySettings") {
    body = <MonthlySettingsScreen state={state} update={update} walletId={walletId} period={period} closingDay={closingDay} nav={nav} />;
  } else if (screen === "standardSettings") {
    body = <StandardSettingsScreen state={state} update={update} walletId={walletId} nav={nav} />;
  } else if (screen === "transfer") {
    body = <TransferScreen state={state} update={update} walletId={walletId} initialFromPocketId={params.fromPocketId} nav={nav} />;
  }

  const bottomScreens = ["home", "input", "history", "calendar", "settings"];
  const showBottomNav = bottomScreens.includes(screen);

  return (
    <div style={s.appRoot}>
      <style>{globalCss}</style>
      <div style={s.phoneFrame}>
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {body}
        </div>
        {showBottomNav && <BottomNav current={screen} onNavigate={(k) => nav.go(k, {})} />}
      </div>
    </div>
  );
}

/* ------------------------------ スタイル ------------------------------ */

const globalCss = `
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; }
  input, select { font-family: inherit; }
  input:focus, select:focus { outline: 2px solid #9AD0B8; outline-offset: 1px; }
  button:focus-visible { outline: 2px solid #9AD0B8; outline-offset: 2px; }
  ::-webkit-scrollbar { width: 0; height: 0; }
`;

const FONT = `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, -apple-system, sans-serif`;

const s = {
  appRoot: {
    minHeight: "100vh", background: "#EFEFEA", display: "flex", justifyContent: "center",
    fontFamily: FONT, color: "#2B2B2B",
  },
  phoneFrame: {
    width: "100%", maxWidth: 480, minHeight: "100vh", background: "#FBFAF7",
    display: "flex", flexDirection: "column", position: "relative",
    boxShadow: "0 0 40px rgba(0,0,0,0.06)",
  },
  header: {
    display: "flex", alignItems: "center",
    padding: "calc(env(safe-area-inset-top) + 14px) 8px 14px",
    borderBottom: "1px solid #F0EEE7",
    background: "#FBFAF7", position: "sticky", top: 0, zIndex: 5,
  },
  headerSide: { width: 64, display: "flex", alignItems: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: 700, letterSpacing: 0.3 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", padding: 4, color: "#2B2B2B" },
  scroll: { flex: 1, overflowY: "auto", padding: "14px 16px 0" },

  periodNav: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  periodBtn: { background: "#F0F5F1", border: "none", borderRadius: 20, padding: "7px 12px", fontSize: 12, color: "#4E7C68", cursor: "pointer", fontWeight: 600 },
  periodLabel: { fontSize: 13, color: "#8A8A8A", fontWeight: 600 },

  overallCard: {
    background: "#F4FAF6", border: "1.5px solid #DCEBD9", borderRadius: 18, padding: "18px 18px 16px", marginBottom: 18,
  },
  overallTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  overallLabel: { fontSize: 13, fontWeight: 700, color: "#4E7C68" },
  overallAux: { fontSize: 12, color: "#7A9C8C" },
  overallNumRow: { display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 },
  overallNum: { fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 },
  overallOf: { fontSize: 14, color: "#7A9C8C", fontWeight: 600 },
  overallSub: { marginTop: 8, fontSize: 12, color: "#7A9C8C" },

  barTrack: { height: 8, background: "#E7E2D8", borderRadius: 5, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 5, transition: "width 0.25s ease" },

  sectionLabel: { fontSize: 13, fontWeight: 700, color: "#8A8A8A", margin: "6px 2px 10px" },
  sectionLabelRow: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 2px 10px" },

  pocketList: { display: "flex", flexDirection: "column", gap: 10 },
  emptyBox: { padding: "18px 14px", background: "#F5F4EF", borderRadius: 12, fontSize: 13, color: "#9A9A9A", textAlign: "center" },

  pocketCard: {
    background: "#fff", border: "1.5px solid #EDEDED", borderRadius: 16, padding: "14px 14px 12px",
    textAlign: "left", cursor: "pointer", width: "100%", display: "block",
  },
  pocketCardTop: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 },
  pocketIconWrap: (color) => ({
    width: 40, height: 40, borderRadius: 12, background: color + "33",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  }),
  pocketName: { fontSize: 14, fontWeight: 700, marginBottom: 3 },
  pocketNumRow: { display: "flex", alignItems: "baseline", gap: 5 },
  pocketRemain: { fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  pocketOf: { fontSize: 12, color: "#9A9A9A", fontWeight: 600 },
  pocketSub: { marginTop: 6, fontSize: 11, color: "#9A9A9A" },
  detailLink: { fontSize: 12, color: "#9A9A9A", flexShrink: 0, whiteSpace: "nowrap" },

  homeActions: { marginTop: 22 },
  homeActionsRow: { display: "flex", gap: 10, marginTop: 10 },
  primaryWideBtn: {
    width: "100%", background: "#3D8F5F", color: "#fff", border: "none", borderRadius: 14,
    padding: "15px 0", fontSize: 15, fontWeight: 700, cursor: "pointer",
  },
  secondaryBtn: {
    flex: 1, background: "#F5F4EF", color: "#4A4A4A", border: "1px solid #E7E4DA", borderRadius: 12,
    padding: "12px 0", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },

  walletSelect: { border: "1px solid #E7E4DA", borderRadius: 8, padding: "4px 6px", fontSize: 12, background: "#fff" },

  typeTabs: { display: "flex", gap: 8, marginBottom: 18, background: "#F0EEE7", borderRadius: 12, padding: 4 },
  typeTab: { flex: 1, padding: "9px 0", border: "none", background: "transparent", borderRadius: 9, fontSize: 13, fontWeight: 600, color: "#8A8A8A", cursor: "pointer" },
  typeTabActive: { flex: 1, padding: "9px 0", border: "none", background: "#fff", borderRadius: 9, fontSize: 13, fontWeight: 700, color: "#2B2B2B", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },

  fieldLabel: { fontSize: 12, fontWeight: 700, color: "#7A7A7A", margin: "16px 2px 8px", display: "flex", alignItems: "center", gap: 6 },
  fieldNum: {
    width: 16, height: 16, borderRadius: 8, background: "#DCEBD9", color: "#4E7C68", fontSize: 10, fontWeight: 800,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  },

  input: {
    width: "100%", border: "1px solid #E7E4DA", borderRadius: 12, padding: "12px 14px", fontSize: 14,
    background: "#fff", color: "#2B2B2B",
  },

  pocketGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  pocketChip: { border: "1px solid #E7E4DA", background: "#fff", borderRadius: 20, padding: "9px 14px", fontSize: 13, color: "#4A4A4A", cursor: "pointer" },
  pocketChipActive: (color) => ({ border: `1.5px solid ${color}`, background: color + "26", borderRadius: 20, padding: "9px 14px", fontSize: 13, color: "#2B2B2B", fontWeight: 700, cursor: "pointer" }),
  methodChip: { border: "1px solid #E7E4DA", background: "#fff", borderRadius: 20, padding: "9px 14px", fontSize: 13, color: "#4A4A4A", cursor: "pointer" },
  methodChipActive: { border: "1.5px solid #3D8F5F", background: "#E9F5EE", borderRadius: 20, padding: "9px 14px", fontSize: 13, color: "#2F5D4F", fontWeight: 700, cursor: "pointer" },

  amountRow: { display: "flex", alignItems: "center", border: "1px solid #E7E4DA", borderRadius: 12, padding: "10px 14px", background: "#fff" },
  yenMark: { fontSize: 18, fontWeight: 700, color: "#9A9A9A", marginRight: 6 },
  amountInput: { flex: 1, border: "none", outline: "none", fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  amountRowSmall: { display: "flex", alignItems: "center", border: "1px solid #E7E4DA", borderRadius: 10, padding: "6px 10px", background: "#fff" },
  amountInputSmall: { flex: 1, border: "none", outline: "none", fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums", width: 80 },

  budgetPreview: { marginTop: 20, background: "#F5F4EF", borderRadius: 14, padding: "12px 14px", cursor: "pointer" },
  budgetPreviewRow: { display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0", color: "#5A5A5A" },

  segTabs: { display: "flex", gap: 8, background: "#F0EEE7", borderRadius: 12, padding: 4 },
  segTab: { flex: 1, padding: "9px 0", border: "none", background: "transparent", borderRadius: 9, fontSize: 13, fontWeight: 600, color: "#8A8A8A", cursor: "pointer" },
  segTabActive: { flex: 1, padding: "9px 0", border: "none", background: "#fff", borderRadius: 9, fontSize: 13, fontWeight: 700, color: "#2B2B2B", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },

  dateGroupHeader: { display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#6A6A6A", padding: "14px 4px 6px" },
  historyRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderBottom: "1px solid #F2F0E9", cursor: "pointer" },
  historyPocketDot: (c) => ({ width: 8, height: 8, borderRadius: 4, background: c, flexShrink: 0 }),
  historyPocketName: { fontSize: 13.5, fontWeight: 600, marginBottom: 2 },
  historyMemo: { fontSize: 12, color: "#9A9A9A" },
  historyAmount: { fontSize: 14.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  transferBadge: { fontSize: 10, fontWeight: 700, color: "#8A6FD1", background: "#EEE9FA", borderRadius: 6, padding: "3px 6px", flexShrink: 0 },
  rowDeleteBtn: { marginTop: 3, border: "none", background: "none", color: "#C7A9A9", fontSize: 10.5, cursor: "pointer", padding: 0 },

  groupHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    background: "#F5F4EF", borderRadius: 8, padding: "6px 10px", marginTop: 10, marginBottom: 2,
    fontSize: 12.5, fontWeight: 700, color: "#6A6A6A",
  },
  groupBody: { padding: "0 2px" },
  compactRow: {
    display: "grid", gridTemplateColumns: "36fr 26fr 38fr", columnGap: 6,
    alignItems: "center", padding: "6px 8px", borderBottom: "1px solid #F2F0E9", cursor: "pointer",
  },
  compactLeft: { fontSize: 13, fontWeight: 600, color: "#3A3A3A", minWidth: 0 },
  compactTruncate: { display: "block", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  compactLeftInner: { display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" },
  compactAmount: { textAlign: "right", fontWeight: 700, fontSize: 13.5, fontVariantNumeric: "tabular-nums", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  compactSub: { fontSize: 11.5, color: "#9A9A9A", paddingLeft: 4, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", textAlign: "left", minWidth: 0 },
  transferBadgeSmall: { fontSize: 9, fontWeight: 700, color: "#8A6FD1", background: "#EEE9FA", borderRadius: 5, padding: "1px 5px", flexShrink: 0 },
  deleteWideBtn: { width: "100%", border: "1px solid #F0C9C6", background: "#FBEAE9", color: "#D9463F", borderRadius: 12, padding: "12px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer" },

  calMonthTitle: { fontSize: 13, fontWeight: 700, color: "#6A6A6A", margin: "6px 2px 8px" },
  calWeekRow: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 },
  calWeekCell: { textAlign: "center", fontSize: 11, fontWeight: 700 },
  calGrid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 },
  calCell: { aspectRatio: "1", minHeight: 50 },
  calCellBtn: {
    border: "none", borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", cursor: "pointer", padding: 2, width: "100%", height: "100%",
  },
  calDayNum: { fontSize: 12, fontWeight: 600, color: "#3A3A3A" },
  calDayExpense: { fontSize: 9.5, color: "#D9463F", fontWeight: 700, marginTop: 1 },
  calDayIncome: { fontSize: 9.5, color: "#3D8F5F", fontWeight: 700, marginTop: 1 },

  dayDetailBox: { marginTop: 16, background: "#F5F4EF", borderRadius: 14, padding: "12px 12px 4px" },
  dayDetailTitle: { fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#4A4A4A" },

  detailHeaderCard: { display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0 18px" },
  detailHeaderName: { fontSize: 18, fontWeight: 800, marginTop: 10 },
  detailHeaderCarry: { fontSize: 11.5, color: "#9A9A9A", marginTop: 4 },

  detailRow: { display: "flex", justifyContent: "space-between", padding: "10px 2px", borderBottom: "1px solid #F2F0E9", fontSize: 13.5 },
  detailRowLabel: { color: "#7A7A7A" },
  detailRowValue: { fontVariantNumeric: "tabular-nums" },
  detailActions: { display: "flex", gap: 10, marginTop: 18, marginBottom: 6 },

  helpText: { fontSize: 12, color: "#9A9A9A", background: "#F5F4EF", padding: "10px 12px", borderRadius: 10, marginBottom: 16, lineHeight: 1.6, whiteSpace: "pre-line" },

  settingsOverallRow: { display: "flex", justifyContent: "space-between", background: "#F4FAF6", border: "1px solid #DCEBD9", borderRadius: 12, padding: "12px 14px", fontSize: 13.5, marginBottom: 18, color: "#2F5D4F" },

  monthlyRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 2px", borderBottom: "1px solid #F2F0E9" },
  monthlyRowName: { flex: 1, fontSize: 13.5, fontWeight: 600 },
  monthlyRowInput: { width: 90, border: "1px solid #E7E4DA", borderRadius: 8, padding: "7px 8px", fontSize: 13, textAlign: "right", fontVariantNumeric: "tabular-nums" },

  resetBtn: { width: "100%", marginTop: 20, background: "#FBEAE9", color: "#D9463F", border: "1px solid #F0C9C6", borderRadius: 12, padding: "13px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer" },

  standardRow: { border: "1px solid #F0EEE7", borderRadius: 14, padding: 12, marginBottom: 10 },
  standardRowTop: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  standardNameInput: { flex: 1, border: "1px solid #E7E4DA", borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontWeight: 600 },
  orderBtns: { display: "flex", flexDirection: "column", gap: 2 },
  orderBtn: { border: "1px solid #E7E4DA", background: "#fff", borderRadius: 5, fontSize: 9, padding: "1px 5px", cursor: "pointer", color: "#8A8A8A" },
  standardRowBottom: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingLeft: 52 },
  standardBudgetLabel: { fontSize: 11.5, color: "#9A9A9A" },
  carryLabel: { display: "flex", alignItems: "center", fontSize: 11.5, color: "#7A7A7A", marginLeft: "auto" },
  deleteLink: { border: "none", background: "none", color: "#D9463F", fontSize: 11.5, cursor: "pointer", padding: 0 },

  addBtn: { border: "none", background: "#EAF3EE", color: "#3D8F5F", borderRadius: 10, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" },

  iconPopover: { position: "absolute", top: 46, left: 0, background: "#fff", border: "1px solid #E7E4DA", borderRadius: 12, padding: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", zIndex: 20, width: 220 },
  iconGrid: { display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, marginBottom: 8 },
  iconOption: { border: "none", background: "#F5F4EF", borderRadius: 8, fontSize: 16, padding: "6px 0", cursor: "pointer" },
  colorGrid: { display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, marginBottom: 8 },
  colorOption: { width: 24, height: 24, borderRadius: 12, border: "none", cursor: "pointer" },
  iconPopoverClose: { width: "100%", border: "none", background: "#F0EEE7", borderRadius: 8, padding: "6px 0", fontSize: 12, cursor: "pointer" },

  settingsLink: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", borderBottom: "1px solid #F2F0E9", padding: "13px 2px", fontSize: 14, cursor: "pointer" },
  settingsToggleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 2px", fontSize: 13.5, borderBottom: "1px solid #F2F0E9" },
  walletRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 2px", fontSize: 13.5, borderBottom: "1px solid #F2F0E9" },
  smallLink: { border: "none", background: "none", color: "#8A8A8A", fontSize: 12, cursor: "pointer" },
  addRow: { display: "flex", gap: 8, marginTop: 10, marginBottom: 6 },
  smallAddBtn: { border: "none", background: "#3D8F5F", color: "#fff", borderRadius: 10, padding: "0 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },

  transferArrow: { textAlign: "center", fontSize: 20, color: "#C7C4B8", margin: "6px 0" },

  bottomNav: {
    display: "flex", borderTop: "1px solid #F0EEE7", background: "#FBFAF7", padding: "8px 0 max(8px, env(safe-area-inset-bottom))",
    position: "sticky", bottom: 0,
  },
  navItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, border: "none", background: "none", cursor: "pointer", padding: "4px 0" },
  navLabel: { fontSize: 10 },

  sheetOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 },
  sheet: { width: "100%", maxWidth: 480, background: "#FBFAF7", borderRadius: "20px 20px 0 0", padding: "10px 16px 20px", maxHeight: "85vh", display: "flex", flexDirection: "column" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, background: "#E0DDD3", margin: "4px auto 10px" },
  sheetTitle: { fontSize: 15, fontWeight: 700, textAlign: "center", marginBottom: 10 },
  sheetBody: { overflowY: "auto" },
  sheetFooter: { marginTop: 10 },

  dialog: { width: "88%", maxWidth: 380, background: "#fff", borderRadius: 16, padding: 20 },
  dialogTitle: { fontSize: 15, fontWeight: 800, marginBottom: 10 },
  dialogMsg: { fontSize: 12.5, color: "#6A6A6A", lineHeight: 1.7, whiteSpace: "pre-line", marginBottom: 18 },
  dialogBtns: { display: "flex", gap: 10 },
  dialogCancel: { flex: 1, border: "1px solid #E7E4DA", background: "#fff", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  dialogConfirm: { flex: 1, border: "none", background: "#3D8F5F", color: "#fff", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  dialogDanger: { flex: 1, border: "none", background: "#D9463F", color: "#fff", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" },
};
