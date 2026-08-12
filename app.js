import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA29fT3VqGxdBWulCF7wNuNIu1goRlCsfA",
  authDomain: "portfolio-87ccf.firebaseapp.com",
  projectId: "portfolio-87ccf",
  storageBucket: "portfolio-87ccf.firebasestorage.app",
  messagingSenderId: "965398567245",
  appId: "1:965398567245:web:ad2a58bb178de82a423f04"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
var currentUser = null;
var authChecking = true;

var cards = [];
var memos = [];
var monthKey = currentMonthKey();
var monthData = {};
var modal = null;
var resetType = 'txOnly';
var quickAddDraft = {cardId: null, amount: '', memo: '', date: todayStr()};
var monthUnsubscribe = null;
var newMemoMonths = [];
var editingFixedId = null;
var editingMemoId = null;
var expandedCards = {};
var confirmState = null;
var monthDataReady = false;

function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function currentMonthKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function shiftMonth(key, delta) {
  var parts = key.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  m += delta;
  while(m > 12) { m -= 12; y += 1; }
  while(m < 1) { m += 12; y -= 1; }
  return y + '-' + String(m).padStart(2, '0');
}

function monthLabel(key) {
  var parts = key.split('-');
  return parts[0] + '년 ' + parseInt(parts[1], 10) + '월';
}

function showConfirm(message) {
  return new Promise(function(resolve) {
    confirmState = {message: message, resolve: resolve};
    modal = 'confirm';
    render();
  });
}

function won(n) { n = Math.round(n || 0); return n.toLocaleString('ko-KR') + '원'; }
function uid() { return Math.random().toString(36).slice(2, 9); }

function emptyMonthData() {
  var d = {_meta: {appliedRecurring: [], skipRecurring: false}};
  cards.forEach(function(c) { d[c.id] = {fixed: [], tx: []}; });
  return d;
}

async function persistMonth() {
  await setDoc(doc(db, "app_data", "month-" + monthKey), monthData);
}

async function persistCards() {
  await setDoc(doc(db, "app_data", "cards-config"), { data: cards });
}

async function persistMemos() {
  await setDoc(doc(db, "app_data", "memos"), { data: memos });
}

function applyRecurring() {
  var meta = monthData._meta || (monthData._meta = {appliedRecurring: [], skipRecurring: false});
  
  if (meta.skipRecurring) return false;

  var mm = parseInt(monthKey.split('-')[1], 10);
  var changed = false;

  memos.forEach(function(rec) {
    var cId = rec.cardId || rec.cardid;
    if (!cId || !rec.amount || !rec.months || rec.months.indexOf(mm) === -1) return;
    
    if (!monthData[cId]) monthData[cId] = {fixed: [], tx: []};
    
    var exists = monthData[cId].fixed.some(function(f) { return f.recurringId === rec.id; });
    var alreadyApplied = meta.appliedRecurring.indexOf(rec.id) !== -1;
    
    if (!exists && !alreadyApplied) {
      monthData[cId].fixed.push({id: uid(), label: rec.text, amount: Number(rec.amount) || 0, recurringId: rec.id});
      meta.appliedRecurring.push(rec.id);
      changed = true;
    }
  });
  return changed;
}

async function reloadMemosToMonth() {
  if (monthData._meta) {
    monthData._meta.skipRecurring = false;
  }
  
  var mm = parseInt(monthKey.split('-')[1], 10);
  var count = 0;

  memos.forEach(function(rec) {
    var cId = rec.cardId || rec.cardid;
    if (!cId || !rec.amount || !rec.months || rec.months.indexOf(mm) === -1) return;
    
    if (!monthData[cId]) monthData[cId] = {fixed: [], tx: []};
    
    var existingItem = monthData[cId].fixed.find(function(f) { return f.recurringId === rec.id; });
    
    if (existingItem) {
      existingItem.amount = Number(rec.amount) || 0;
      count++;
    } else {
      monthData[cId].fixed.push({id: uid(), label: rec.text, amount: Number(rec.amount) || 0, recurringId: rec.id});
      if (monthData._meta.appliedRecurring.indexOf(rec.id) === -1) {
        monthData._meta.appliedRecurring.push(rec.id);
      }
      count++;
    }
  });

  await persistMonth();
  render();
  if (count > 0) {
    showToast(count + '개의 정기 메모 실적을 원본 금액으로 복원했어요');
  } else {
    showToast('이번 달에 반영할 추가 정기 메모가 없어요');
  }
}

function subscribeMonth(key) {
  if (monthUnsubscribe) monthUnsubscribe();
  monthDataReady = false;
  monthUnsubscribe = onSnapshot(doc(db, "app_data", "month-" + key), async (docSnap) => {
    var base = emptyMonthData();
    if (docSnap.exists()) {
      var parsed = docSnap.data();
      cards.forEach(function(c) { if (parsed[c.id]) base[c.id] = parsed[c.id]; });
      if (parsed._meta) base._meta = parsed._meta;
    }
    monthData = base;
    monthDataReady = true;
    var changed = applyRecurring();
    if (changed) await persistMonth();
    render();
  });
}

function initRealtimeListeners() {
  onSnapshot(doc(db, "app_data", "cards-config"), (docSnap) => {
    if (docSnap.exists()) {
      cards = docSnap.data().data || [];
    }
    render();
  });

  onSnapshot(doc(db, "app_data", "memos"), async (docSnap) => {
    if (docSnap.exists()) {
      memos = docSnap.data().data || [];
    }
    if (!monthDataReady) { render(); return; }
    var changed = applyRecurring();
    if (changed) await persistMonth();
    render();
  });
}

function calc(card) {
  var d = monthData[card.id] || {fixed: [], tx: []};
  var fixedTotal = d.fixed.reduce(function(s, i) { return s + (Number(i.amount) || 0); }, 0);
  var txTotal = d.tx.reduce(function(s, i) { return s + (Number(i.amount) || 0); }, 0);
  var used = fixedTotal + txTotal;
  var remaining = card.threshold - used;
  var pct = card.threshold > 0 ? Math.min(100, Math.max(0, (used / card.threshold) * 100)) : 0;
  return {fixedTotal: fixedTotal, txTotal: txTotal, used: used, remaining: remaining, pct: pct, achieved: remaining <= 0};
}

async function changeMonth(delta) {
  monthKey = shiftMonth(monthKey, delta);
  subscribeMonth(monthKey);
}

async function copyPrevFixed(cardId) {
  var prevKey = shiftMonth(monthKey, -1);
  var prevSnap = await getDoc(doc(db, "app_data", "month-" + prevKey));
  if (!prevSnap.exists()) {
    showToast('지난달 데이터가 없어요');
    return;
  }
  try {
    var parsed = prevSnap.data();
    var prevFixed = (parsed[cardId] && parsed[cardId].fixed) || [];
    if (prevFixed.length === 0) {
      showToast('지난달 고정 결제 내역이 없어요');
      return;
    }
    var cur = monthData[cardId] || {fixed: [], tx: []};
    
    prevFixed.forEach(function(f) {
      var alreadyExists = cur.fixed.some(function(item) {
        return (f.recurringId && item.recurringId === f.recurringId) || item.label === f.label;
      });
      if (!alreadyExists) {
        cur.fixed.push({id: uid(), label: f.label, amount: f.amount, recurringId: f.recurringId || ''});
      }
    });

    monthData[cardId] = cur;
    await persistMonth();
    render();
    showToast('지난달 고정 결제를 불러왔어요');
  } catch(e) { console.error(e); }
}

async function addFixed(cardId, label, amount) {
  if (!label || !amount) return;
  var cur = monthData[cardId] || {fixed: [], tx: []};
  cur.fixed.push({id: uid(), label: label, amount: Number(amount)});
  monthData[cardId] = cur;
  await persistMonth();
  render();
}

async function removeFixed(cardId, itemId) {
  if (!(await showConfirm('해당 고정 결제 내역을 정말 삭제하시겠습니까?'))) return;
  var cur = monthData[cardId]; if (!cur) return;
  cur.fixed = cur.fixed.filter(function(i) { return i.id !== itemId; });
  await persistMonth();
  render();
  showToast('고정 결제 내역을 삭제했어요');
}

async function updateFixedAmount(cardId, itemId, newAmount) {
  var cur = monthData[cardId]; if (!cur) return;
  var target = cur.fixed.find(function(i) { return i.id === itemId; });
  if (target) {
    target.amount = Number(newAmount) || 0;
    await persistMonth();
    showToast('금액을 변경했어요');
  }
  editingFixedId = null;
  render();
}

async function addTxToMonth(key, cardId, amount, memo, date) {
  var docRef = doc(db, "app_data", "month-" + key);
  var docSnap = await getDoc(docRef);
  var base = {};
  if (docSnap.exists()) {
    base = docSnap.data();
  } else {
    base = emptyMonthData();
  }
  if (!base._meta) base._meta = {appliedRecurring: [], skipRecurring: false};
  if (!base[cardId]) base[cardId] = {fixed: [], tx: []};
  base[cardId].tx.push({id: uid(), amount: Number(amount), memo: memo, date: date || ''});
  await setDoc(docRef, base);
}

async function removeTx(cardId, itemId) {
  if (!(await showConfirm('해당 사용 내역을 정말 삭제하시겠습니까?'))) return;
  var cur = monthData[cardId]; if (!cur) return;
  cur.tx = cur.tx.filter(function(i) { return i.id !== itemId; });
  await persistMonth();
  render();
  showToast('사용 내역을 삭제했어요');
}

async function addMemoAdvanced(text, cardId, amount, months) {
  if (!text) return;
  memos.unshift({
    id: 'memo-' + uid(),
    text: text,
    cardId: cardId || null,
    amount: Number(amount) || 0,
    months: months || []
  });
  newMemoMonths = [];
  await persistMemos();
  showToast('메모를 등록했어요');
}

async function updateMemo(id, text, cardId, amount, months) {
  var m = memos.find(function(x) { return x.id === id; });
  if (!m) return;
  m.text = text;
  m.cardId = cardId || null;
  m.cardid = cardId || null;
  m.amount = Number(amount) || 0;
  m.months = months || [];
  await persistMemos();
  showToast('메모를 수정했어요');
}

async function removeMemo(id) {
  var targetMemo = memos.find(function(m) { return m.id === id; });
  if (!targetMemo) return;

  var cId = targetMemo.cardId || targetMemo.cardid;
  var isRecurring = cId && targetMemo.amount > 0;

  if (!(await showConfirm('해당 메모를 정말 삭제하시겠습니까?'))) return;

  if (isRecurring) {
    var deleteActualRecord = await showConfirm(
      '이 메모로 인해 이번 달 카드 실적(고정 결제)에 등록된 내역도 함께 지우시겠습니까?\n\n' +
      '[확인] 누름 -> 메모 삭제 및 이번 달 카드 실적 내역 제거\n' +
      '[취소] 누름 -> 메모만 삭제하고 카드 실적 내역은 유지'
    );

    if (deleteActualRecord && monthData[cId]) {
      monthData[cId].fixed = monthData[cId].fixed.filter(function(f) {
        return f.recurringId !== id;
      });
      if (monthData._meta && monthData._meta.appliedRecurring) {
        monthData._meta.appliedRecurring = monthData._meta.appliedRecurring.filter(function(rId) {
          return rId !== id;
        });
      }
      await persistMonth();
    }
  }

  memos = memos.filter(function(m) { return m.id !== id; });
  await persistMemos();
}

async function executeMonthReset() {
  var label = monthLabel(monthKey);

  if (resetType === 'restoreRecurring') {
    await reloadMemosToMonth();
    modal = null;
    render();
    return;
  }

  var confirmMsg = resetType === 'txOnly' 
    ? label + '의 [추가 사용 내역]을 정말 초기화하시겠습니까?' 
    : label + '의 [모든 실적 데이터(고정결제+사용내역)]를 정말 초기화하시겠습니까?';

  if (!(await showConfirm(confirmMsg))) return;

  cards.forEach(function(c) {
    if (monthData[c.id]) {
      monthData[c.id].tx = [];
      if (resetType === 'all') {
        monthData[c.id].fixed = [];
      }
    }
  });

  if (resetType === 'all') {
    monthData._meta = {
      appliedRecurring: [],
      skipRecurring: true
    };
  }

  await persistMonth();
  modal = null;
  render();
  showToast(label + ' 데이터가 초기화되었습니다');
}

function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2200);
}

async function submitQuickAdd() {
  var d = quickAddDraft;
  if (!d.cardId || !d.amount) { showToast('카드와 금액을 입력해주세요'); return; }
  var targetKey = (d.date || todayStr()).slice(0, 7);
  modal = null;
  render();
  await addTxToMonth(targetKey, d.cardId, d.amount, d.memo, d.date);
  var jumped = targetKey !== monthKey;
  if (jumped) { monthKey = targetKey; subscribeMonth(monthKey); }
  quickAddDraft = {cardId: cards[0] ? cards[0].id : null, amount: '', memo: '', date: todayStr()};
  showToast(jumped ? monthLabel(targetKey) + ' 내역으로 기록했어요' : '사용 내역을 기록했어요');
}

async function updateCardField(id, field, value) {
  var c = cards.find(function(x) { return x.id === id; });
  if (!c) return;
  if (field === 'threshold' || field === 'annualFee') c[field] = Number(value) || 0;
  else c[field] = value;
  await persistCards();
}

async function addCard() {
  cards.push({id: 'card-' + uid(), bank: '새 카드', product: '', usage: '', threshold: 0, annualFee: 0, note: ''});
  await persistCards();
}

async function deleteCard(id) {
  var targetCard = cards.find(function(c) { return c.id === id; });
  var cardName = targetCard ? targetCard.bank : '해당 카드';
  if (!(await showConfirm(cardName + '를 정말 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.'))) return;

  cards = cards.filter(function(c) { return c.id !== id; });
  memos.forEach(function(m) { if ((m.cardId || m.cardid) === id) { m.cardId = null; m.cardid = null; m.amount = 0; m.months = []; } });
  await persistCards(); await persistMemos();
}

async function updateMemoField(id, field, value) {
  var m = memos.find(function(x) { return x.id === id; });
  if (!m) return;
  if (field === 'amount') m.amount = Number(value) || 0;
  else if (field === 'cardId') { m.cardId = value || null; m.cardid = value || null; }
  else m[field] = value;
  await persistMemos();
}

async function toggleMemoMonth(id, mm) {
  var m = memos.find(function(x) { return x.id === id; });
  if (!m) return;

  if (mm === 'all') {
    if (m.months.length === 12) {
      m.months = [];
    } else {
      m.months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    }
  } else {
    var idx = m.months.indexOf(mm);
    if (idx === -1) m.months.push(mm); else m.months.splice(idx, 1);
    m.months.sort(function(a, b) { return a - b; });
  }
  await persistMemos();
}

async function addMemoDetailed() {
  memos.unshift({id: 'memo-' + uid(), text: '새 메모', cardId: null, amount: 0, months: []});
  await persistMemos();
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function(c) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
  });
}

function cardOptionsHtml(selectedId, includeNone) {
  var html = '';
  if (includeNone) html += '<option value=""' + (!selectedId ? ' selected' : '') + '>실적 반영 안 함 (텍스트 메모만)</option>';
  html += cards.map(function(c) {
    return '<option value="' + c.id + '"' + (c.id === selectedId ? ' selected' : '') + '>' + esc(c.bank) + (c.product ? ' ' + esc(c.product) : '') + '</option>';
  }).join('');
  return html;
}

function render() {
  var app = document.getElementById('app');
  var monthTotalNeeded = 0, monthTotalUsed = 0;
  cards.forEach(function(c) {
    var r = calc(c);
    monthTotalNeeded += c.threshold;
    monthTotalUsed += Math.min(r.used, c.threshold);
  });

  var html = '';
  html += '<div class="header-container">';
  html += '  <div class="top-bar">';
  html += '    <div class="app-title">카드 실적 수첩</div>';
  html += '    <div class="header-tools">';
  html += '      <button class="tool-btn" id="openCardSettings">카드 설정</button>';
  html += '      <button class="tool-btn" id="openMemos">메모 설정</button>';
  html += '      <button class="tool-btn" id="logoutBtn">로그아웃</button>';
  html += '    </div>';
  html += '  </div>';

  html += '  <div class="month-nav">';
  html += '    <button id="prevBtn">‹</button>';
  html += '    <div class="month-label-wrapper" id="openMonthPicker" title="터치하여 월 선택">';
  html += '      <div class="month-label">' + monthLabel(monthKey) + '</div>';
  html += '    </div>';
  html += '    <button id="nextBtn">›</button>';
  html += '  </div>';

  html += '  <div class="summary-card">';
  html += '    <div class="summary-row">';
  html += '      <div class="summary-label">이번 달 실적 채운 금액</div>';
  html += '      <div class="summary-value">' + won(monthTotalUsed) + ' <span>/ ' + won(monthTotalNeeded) + '</span></div>';
  html += '    </div>';
  html += '  </div>';
  html += '</div>';

  html += '<div class="page">';
  html += '  <div class="section-title">';
  html += '    <span>카드별 실적 현황</span>';
  html += '    <button class="tool-btn danger" id="openResetModal">당월 초기화</button>';
  html += '  </div>';

  cards.forEach(function(card) {
    var r = calc(card);
    var d = monthData[card.id] || {fixed: [], tx: []};
    var isExpanded = !!expandedCards[card.id];

    html += '<div class="card">';
    html += '  <div class="card-top">';
    html += '    <div><span class="card-name"><span class="bank">' + esc(card.bank) + '</span>' + (card.product ? esc(card.product) : '') + '</span></div>';
    html += '    <div class="stamp' + (r.achieved ? ' show' : '') + '">' + (r.achieved ? '목표 달성' : '진행 중') + '</div>';
    html += '  </div>';
    if (card.note) html += '  <div class="card-note">' + esc(card.note) + '</div>';

    html += '  <div class="bar-track"><div class="bar-fill' + (r.achieved ? ' ok' : '') + '" style="width: ' + r.pct.toFixed(1) + '%"></div></div>';
    html += '  <div class="amounts"><span class="used">' + won(r.used) + '</span><span class="goal">목표 ' + won(card.threshold) + '</span></div>';
    html += '  <div class="remain-row"><span class="rlabel">남은 필요 실적</span><span class="rvalue ' + (r.achieved ? 'ok' : 'pending') + '">' + (r.achieved ? '0원 (달성완료)' : won(r.remaining)) + '</span></div>';

    html += '  <button class="more-toggle-btn" data-act="toggleCardDetail" data-card="' + card.id + '">';
    html += '    ' + (isExpanded ? '내역 접기 ∧' : '내역 자세히 보기 ∨');
    html += '  </button>';

    html += '  <div class="detail-body' + (isExpanded ? ' show' : '') + '">';
    html += '    <div class="subtitle-mini">고정 결제 (' + won(r.fixedTotal) + ')</div>';
    if (d.fixed.length === 0) { html += '    <div class="empty-hint">등록된 고정 결제가 없습니다</div>'; }
    d.fixed.forEach(function(f) {
      var isEditing = editingFixedId === f.id;
      var amtHtml = '';
      if (isEditing) {
        amtHtml = '<input type="number" class="editable-amt-input" id="editAmtInput-' + f.id + '" value="' + f.amount + '" data-card="' + card.id + '" data-item="' + f.id + '">';
      } else {
        amtHtml = '<span class="editable-amt" data-act="startEditFixed" data-id="' + f.id + '" title="터치하여 금액 수정">' + won(f.amount) + '</span>';
      }

      html += '    <div class="row-line"><span class="rl-label">' + (f.recurringId ? '<span class="tag-recurring">정기</span>' : '') + esc(f.label) + '</span><span class="rl-amt">' + amtHtml + '<button class="rl-del" data-act="delfixed" data-card="' + card.id + '" data-item="' + f.id + '">✕</button></span></div>';
    });

    html += '    <div class="add-form">';
    html += '      <input type="text" class="memo" placeholder="항목명" id="fl-' + card.id + '">';
    html += '      <input type="number" class="amt" placeholder="금액" id="fa-' + card.id + '">';
    html += '      <button data-act="addfixed" data-card="' + card.id + '">추가</button>';
    html += '    </div>';
    html += '    <button class="copy-btn" data-act="copyprev" data-card="' + card.id + '">지난달 고정 결제 불러오기</button>';

    html += '    <div class="subtitle-mini" style="margin-top: 16px;">추가 사용 내역 (' + won(r.txTotal) + ')</div>';
    if (d.tx.length === 0) { html += '    <div class="empty-hint">기록된 사용 내역이 없습니다</div>'; }
    d.tx.slice().sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); }).forEach(function(t) {
      var lbl = (t.date ? t.date + ' ' : '') + (t.memo || '사용 내역');
      html += '    <div class="row-line"><span class="rl-label">' + esc(lbl) + '</span><span class="rl-amt">' + won(t.amount) + '<button class="rl-del" data-act="deltx" data-card="' + card.id + '" data-item="' + t.id + '">✕</button></span></div>';
    });

    html += '  </div>';
    html += '</div>';
  });

  html += '  <div class="section-title">';
  html += '    <span>참고 메모</span>';
  html += '    <button class="tool-btn primary" id="reloadMemosBtn">정기 메모 불러오기</button>';
  html += '  </div>';

  html += '  <div class="notes-card">';
  
  var monthNames = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  var isAllSelectedTop = newMemoMonths.length === 12;

  html += '    <div class="note-add-top">';
  html += '      <div class="note-add-input-row">';
  html += '        <input type="text" id="topNoteText" placeholder="메모 추가...">';
  html += '        <button class="opt-toggle-btn" id="toggleNoteOptBtn">옵션 ∨</button>';
  html += '        <button class="add-submit-btn" id="submitTopNoteBtn">등록</button>';
  html += '      </div>';
  html += '      <div class="note-opt-panel" id="topNoteOptPanel">';
  html += '        <div class="field"><label>실적 반영 카드</label><select id="topNoteCard">' + cardOptionsHtml('', true) + '</select></div>';
  html += '        <div class="field"><label>금액 (원)</label><input type="number" id="topNoteAmount" placeholder="예: 50000"></div>';
  html += '        <div class="field"><label>적용 월 선택</label>';
  html += '          <div class="month-chips">';
  html += '            <div class="chip chip-all' + (isAllSelectedTop ? ' active' : '') + '" data-act="toggleTopAllM">전체</div>';
  monthNames.forEach(function(mn, i) {
    var mm = i + 1;
    html += '            <div class="chip' + (newMemoMonths.indexOf(mm) !== -1 ? ' active' : '') + '" data-act="toggleneowmemoM" data-m="' + mm + '">' + mn + '</div>';
  });
  html += '          </div>';
  html += '        </div>';
  html += '      </div>';
  html += '    </div>';

  if (memos.length === 0) { html += '    <div class="empty-hint">등록된 메모가 없습니다</div>'; }
  memos.forEach(function(m) {
    var badge = '';
    var cId = m.cardId || m.cardid;
    if (cId && m.amount > 0 && m.months.length > 0) {
      var mc = cards.find(function(c) { return c.id === cId; });
      badge = '<span class="tag-recurring">실적 반영</span> ' + (mc ? esc(mc.bank) + ' ' : '') + (m.months.length === 12 ? '매월' : m.months.join(',') + '월') + ' ' + won(m.amount);
    }
    html += '    <div class="note-item-box" data-act="openEditMemo" data-id="' + m.id + '">';
    html += '      <div><mark>•</mark><span>' + esc(m.text) + (badge ? '<br><span style="font-size: 11px; opacity:0.8;">' + badge + '</span>' : '') + '</span></div>';
    html += '      <button class="rl-del" data-act="delmemo" data-id="' + m.id + '">✕</button>';
    html += '    </div>';
  });

  html += '  </div>';

  html += '  <div class="footer-note">뱅크샐러드 라이크 다크 테마 적용됨 • 실시간 클라우드 동기화 중</div>';
  html += '</div>';

  html += '<button class="fab" id="fabAdd">+</button>';

  if (modal === 'quickadd') html += renderQuickAddModal();
  if (modal === 'cards') html += renderCardSettingsModal();
  if (modal === 'memos') html += renderMemoModal();
  if (modal === 'reset') html += renderResetModal();
  if (modal === 'editmemo') html += renderEditMemoModal();
  if (modal === 'monthpicker') html += renderMonthPickerModal();
  if (modal === 'confirm') html += renderConfirmModal();

  app.innerHTML = html;
  bindEvents();

  if (editingFixedId) {
    var editInp = document.getElementById('editAmtInput-' + editingFixedId);
    if (editInp) { editInp.focus(); editInp.select(); }
  }
}

function renderConfirmModal() {
  if (!confirmState) return '';
  var h = '<div class="confirm-overlay" id="ovConfirm"><div class="confirm-box">';
  h += '  <div class="confirm-msg">' + esc(confirmState.message) + '</div>';
  h += '  <div class="confirm-btns">';
  h += '    <button class="confirm-btn-cancel" id="confirmNoBtn">취소</button>';
  h += '    <button class="confirm-btn-ok" id="confirmYesBtn">삭제</button>';
  h += '  </div>';
  h += '</div></div>';
  return h;
}

function renderMonthPickerModal() {
  var parts = monthKey.split('-');
  var curYear = parseInt(parts[0], 10);
  var curMonth = parseInt(parts[1], 10);

  var h = '<div class="overlay" id="ovMonthPicker"><div class="sheet">';
  h += '  <div class="sheet-title">조회할 연도 및 월 선택<button class="close" data-act="closeModal">✕</button></div>';
  
  h += '  <div class="row2" style="display:flex; gap:12px; margin-bottom:12px;">';
  h += '    <div class="field" style="flex:1;"><label>연도 (2000~2099)</label><select id="pickerYear">';
  for (var y = 2000; y <= 2099; y++) {
    h += '      <option value="' + y + '"' + (y === curYear ? ' selected' : '') + '>' + y + '년</option>';
  }
  h += '    </select></div>';

  h += '    <div class="field" style="flex:1;"><label>월</label><select id="pickerMonth">';
  for (var m = 1; m <= 12; m++) {
    h += '      <option value="' + m + '"' + (m === curMonth ? ' selected' : '') + '>' + m + '월</option>';
  }
  h += '    </select></div>';
  h += '  </div>';

  h += '  <button class="secondary-btn" id="pickerCurrentMonth">이번 달 선택</button>';
  h += '  <button class="primary-btn" id="pickerSubmit">이동하기</button>';
  h += '</div></div>';
  return h;
}

function renderEditMemoModal() {
  var m = memos.find(function(x) { return x.id === editingMemoId; });
  if (!m) return '';
  var monthNames = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  var selectedCard = m.cardId || m.cardid;
  var isAllSelected = m.months && m.months.length === 12;

  var h = '<div class="overlay" id="ovEditMemo"><div class="sheet">';
  h += '  <div class="sheet-title">참고 메모 수정<button class="close" data-act="closeModal">✕</button></div>';
  h += '  <div class="field"><label>메모 내용</label><input type="text" id="emText" value="' + esc(m.text) + '"></div>';
  h += '  <div class="field"><label>실적 반영 카드</label><select id="emCard">' + cardOptionsHtml(selectedCard, true) + '</select></div>';
  h += '  <div class="field"><label>금액 (원)</label><input type="number" id="emAmount" value="' + m.amount + '"></div>';
  h += '  <div class="field"><label>적용 월 선택</label>';
  h += '    <div class="month-chips">';
  h += '      <div class="chip chip-all' + (isAllSelected ? ' active' : '') + '" data-act="toggleEditAllM">전체</div>';
  monthNames.forEach(function(mn, i) {
    var mm = i + 1;
    h += '      <div class="chip' + (m.months.indexOf(mm) !== -1 ? ' active' : '') + '" data-act="toggleEditMonth" data-m="' + mm + '">' + mn + '</div>';
  });
  h += '    </div>';
  h += '  </div>';
  h += '  <button class="primary-btn" id="emSubmit">수정 완료</button>';
  h += '</div></div>';
  return h;
}

function renderQuickAddModal() {
  var d = quickAddDraft;
  if (!d.cardId && cards[0]) d.cardId = cards[0].id;
  var h = '<div class="overlay" id="ovQuick"><div class="sheet">';
  h += '  <div class="sheet-title">소비 기록하기<button class="close" data-act="closeModal">✕</button></div>';
  h += '  <div class="field"><label>카드 선택</label><select id="qaCard">' + cardOptionsHtml(d.cardId) + '</select></div>';
  h += '  <div class="field"><label>금액 (원)</label><input type="number" id="qaAmount" placeholder="예: 25000" value="' + esc(d.amount) + '"></div>';
  h += '  <div class="field"><label>메모</label><input type="text" id="qaMemo" placeholder="예: 마트 장보기" value="' + esc(d.memo) + '"></div>';
  h += '  <div class="field"><label>날짜</label><input type="date" id="qaDate" value="' + esc(d.date) + '"></div>';
  h += '  <button class="primary-btn" id="qaSubmit">기록하기</button>';
  h += '</div></div>';
  return h;
}

function renderResetModal() {
  var h = '<div class="overlay" id="ovReset"><div class="sheet">';
  h += '  <div class="sheet-title">' + monthLabel(monthKey) + ' 데이터 관리<button class="close" data-act="closeModal">✕</button></div>';
  
  h += '  <div class="reset-opt-box' + (resetType === 'txOnly' ? ' selected' : '') + '" data-act="selectResetType" data-type="txOnly">';
  h += '    <div class="reset-opt-title">1. 추가 사용 내역만 초기화 (추천)</div>';
  h += '    <div class="reset-opt-desc">고정 결제 항목은 그대로 두고, 이번 달에 추가 기록한 소비 내역만 지웁니다.</div>';
  h += '  </div>';

  h += '  <div class="reset-opt-box' + (resetType === 'all' ? ' selected' : '') + '" data-act="selectResetType" data-type="all">';
  h += '    <div class="reset-opt-title">2. 해당 월 전체 초기화</div>';
  h += '    <div class="reset-opt-desc">이번 달의 고정 결제 항목과 추가 소비 내역을 모두 지우고 완전히 비웁니다.</div>';
  h += '  </div>';

  h += '  <div class="reset-opt-box' + (resetType === 'restoreRecurring' ? ' selected' : '') + '" data-act="selectResetType" data-type="restoreRecurring">';
  h += '    <div class="reset-opt-title">3. 고정 결제 금액 복원 (정기 메모 재적용)</div>';
  h += '    <div class="reset-opt-desc">초기화되었거나 수정된 정기 메모 실적 항목들을 메모 원본 금액으로 복원합니다.</div>';
  h += '  </div>';

  var btnText = resetType === 'restoreRecurring' ? '고정 결제 금액 복원 실행' : '초기화 실행하기';
  var btnClass = resetType === 'restoreRecurring' ? 'primary-btn' : 'danger-btn';

  h += '  <button class="' + btnClass + '" id="execResetBtn">' + btnText + '</button>';
  h += '</div></div>';
  return h;
}

function renderCardSettingsModal() {
  var h = '<div class="overlay" id="ovCards"><div class="sheet">';
  h += '  <div class="sheet-title">카드 설정<button class="close" data-act="closeModal">✕</button></div>';
  cards.forEach(function(c) {
    h += '  <div class="setting-card">';
    h += '    <div class="row2"><div class="field"><label>카드사</label><input type="text" data-cf="bank" data-id="' + c.id + '" value="' + esc(c.bank) + '"></div>';
    h += '    <div class="field"><label>상품명</label><input type="text" data-cf="product" data-id="' + c.id + '" value="' + esc(c.product) + '"></div></div>';
    h += '    <div class="field"><label>사용처/혜택 조건</label><input type="text" data-cf="usage" data-id="' + c.id + '" value="' + esc(c.usage) + '"></div>';
    h += '    <div class="row2"><div class="field"><label>실적 목표 금액</label><input type="number" data-cf="threshold" data-id="' + c.id + '" value="' + c.threshold + '"></div>';
    h += '    <div class="field"><label>연회비</label><input type="number" data-cf="annualFee" data-id="' + c.id + '" value="' + c.annualFee + '"></div></div>';
    h += '    <div class="field"><label>혜택 메모</label><input type="text" data-cf="note" data-id="' + c.id + '" value="' + esc(c.note) + '"></div>';
    h += '    <button class="setting-del" data-act="delcard" data-id="' + c.id + '">이 카드 삭제</button>';
    h += '  </div>';
  });
  h += '  <button class="add-outline-btn" id="addCardBtn">+ 새 카드 추가</button>';
  h += '</div></div>';
  return h;
}

function renderMemoModal() {
  var monthNames = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  var h = '<div class="overlay" id="ovMemos"><div class="sheet">';
  h += '  <div class="sheet-title">메모 설정<button class="close" data-act="closeModal">✕</button></div>';
  
  h += '  <button class="add-outline-btn" id="addMemoBtn">+ 새 메모 추가</button>';
  
  if (memos.length === 0) h += '  <div class="empty-hint">등록된 메모가 없습니다</div>';
  memos.forEach(function(m) {
    var selectedCard = m.cardId || m.cardid;
    var isAllSelected = m.months && m.months.length === 12;

    h += '  <div class="setting-card">';
    h += '    <div class="field"><label>메모 내용</label><input type="text" data-mf="text" data-id="' + m.id + '" value="' + esc(m.text) + '"></div>';
    h += '    <div class="field"><label>연결 카드 (실적 자동 반영)</label><select data-mf="cardId" data-id="' + m.id + '">' + cardOptionsHtml(selectedCard, true) + '</select></div>';
    h += '    <div class="field"><label>금액</label><input type="number" data-mf="amount" data-id="' + m.id + '" value="' + m.amount + '"></div>';
    h += '    <label style="display:block; font-size:12px; color:var(--text-soft); margin-top:8px; font-weight:700;">적용 월 선택</label>';
    h += '    <div class="month-chips">';
    h += '      <div class="chip chip-all' + (isAllSelected ? ' active' : '') + '" data-act="togglemonth" data-id="' + m.id + '" data-m="all">전체</div>';
    monthNames.forEach(function(mn, i) {
      var mm = i + 1;
      h += '      <div class="chip' + (m.months.indexOf(mm) !== -1 ? ' active' : '') + '" data-act="togglemonth" data-id="' + m.id + '" data-m="' + mm + '">' + mn + '</div>';
    });
    h += '    </div>';
    h += '    <button class="setting-del" data-act="delmemosetting" data-id="' + m.id + '">삭제</button>';
    h += '  </div>';
  });
  
  h += '</div></div>';
  return h;
}

function bindEvents() {
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  if (prevBtn) prevBtn.onclick = function() { changeMonth(-1); };
  if (nextBtn) nextBtn.onclick = function() { changeMonth(1); };

  var openMonthPicker = document.getElementById('openMonthPicker');
  if (openMonthPicker) {
    openMonthPicker.onclick = function() {
      modal = 'monthpicker';
      render();
    };
  }

  var pickerSubmit = document.getElementById('pickerSubmit');
  if (pickerSubmit) {
    pickerSubmit.onclick = function() {
      var y = document.getElementById('pickerYear').value;
      var m = document.getElementById('pickerMonth').value;
      monthKey = y + '-' + String(m).padStart(2, '0');
      modal = null;
      subscribeMonth(monthKey);
    };
  }

  var pickerCurrentMonth = document.getElementById('pickerCurrentMonth');
  if (pickerCurrentMonth) {
    pickerCurrentMonth.onclick = function() {
      monthKey = currentMonthKey();
      modal = null;
      subscribeMonth(monthKey);
    };
  }

  var fab = document.getElementById('fabAdd');
  if (fab) fab.onclick = function() { modal = 'quickadd'; render(); };

  var ocs = document.getElementById('openCardSettings');
  if (ocs) ocs.onclick = function() { modal = 'cards'; render(); };

  var omm = document.getElementById('openMemos');
  if (omm) omm.onclick = function() { modal = 'memos'; render(); };

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = async function() {
    if (!(await showConfirm('로그아웃 하시겠습니까?'))) return;
    if (monthUnsubscribe) monthUnsubscribe();
    await signOut(auth);
  };

  var openResetModalBtn = document.getElementById('openResetModal');
  if (openResetModalBtn) openResetModalBtn.onclick = function() { modal = 'reset'; render(); };

  var reloadMemosBtn = document.getElementById('reloadMemosBtn');
  if (reloadMemosBtn) reloadMemosBtn.onclick = reloadMemosToMonth;

  document.querySelectorAll('[data-act="closeModal"]').forEach(function(b) {
    b.onclick = function() { modal = null; render(); };
  });

  var confirmYesBtn = document.getElementById('confirmYesBtn');
  if (confirmYesBtn) {
    confirmYesBtn.onclick = function() {
      var cs = confirmState;
      modal = null; confirmState = null;
      render();
      if (cs && cs.resolve) cs.resolve(true);
    };
  }
  var confirmNoBtn = document.getElementById('confirmNoBtn');
  if (confirmNoBtn) {
    confirmNoBtn.onclick = function() {
      var cs = confirmState;
      modal = null; confirmState = null;
      render();
      if (cs && cs.resolve) cs.resolve(false);
    };
  }

  ['ovQuick', 'ovCards', 'ovMemos', 'ovReset', 'ovEditMemo', 'ovMonthPicker'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', function(e) { if (e.target === el) { modal = null; render(); } });
  });

  document.querySelectorAll('[data-act="selectResetType"]').forEach(function(box) {
    box.onclick = function() {
      resetType = box.getAttribute('data-type');
      render();
    };
  });

  var execResetBtn = document.getElementById('execResetBtn');
  if (execResetBtn) execResetBtn.onclick = executeMonthReset;

  var toggleNoteOptBtn = document.getElementById('toggleNoteOptBtn');
  if (toggleNoteOptBtn) {
    toggleNoteOptBtn.onclick = function() {
      var panel = document.getElementById('topNoteOptPanel');
      if (panel) panel.classList.toggle('show');
    };
  }

  var submitTopNoteBtn = document.getElementById('submitTopNoteBtn');
  if (submitTopNoteBtn) {
    submitTopNoteBtn.onclick = function() {
      var text = document.getElementById('topNoteText').value.trim();
      var cardId = document.getElementById('topNoteCard').value;
      var amount = document.getElementById('topNoteAmount').value;
      if (!text) { showToast('메모 내용을 입력해주세요'); return; }
      addMemoAdvanced(text, cardId, amount, newMemoMonths);
    };
  }

  var toggleTopAllMBtn = document.querySelector('[data-act="toggleTopAllM"]');
  if (toggleTopAllMBtn) {
    toggleTopAllMBtn.onclick = function() {
      if (newMemoMonths.length === 12) {
        newMemoMonths = [];
      } else {
        newMemoMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      }
      render();
      var panel = document.getElementById('topNoteOptPanel');
      if (panel) panel.classList.add('show');
    };
  }

  document.querySelectorAll('[data-act="toggleneowmemoM"]').forEach(function(chip) {
    chip.onclick = function() {
      var mm = parseInt(chip.getAttribute('data-m'), 10);
      var idx = newMemoMonths.indexOf(mm);
      if (idx === -1) newMemoMonths.push(mm); else newMemoMonths.splice(idx, 1);
      newMemoMonths.sort(function(a, b) { return a - b; });
      render();
      var panel = document.getElementById('topNoteOptPanel');
      if (panel) panel.classList.add('show');
    };
  });

  document.querySelectorAll('[data-act="openEditMemo"]').forEach(function(box) {
    box.onclick = function(e) {
      if (e.target.closest('button')) return;
      editingMemoId = box.getAttribute('data-id');
      modal = 'editmemo';
      render();
    };
  });

  var emSubmit = document.getElementById('emSubmit');
  if (emSubmit) {
    emSubmit.onclick = function() {
      var text = document.getElementById('emText').value.trim();
      var cardId = document.getElementById('emCard').value;
      var amount = document.getElementById('emAmount').value;
      var mObj = memos.find(function(x) { return x.id === editingMemoId; });
      if (!text || !mObj) return;
      updateMemo(editingMemoId, text, cardId, amount, mObj.months);
      modal = null;
      render();
    };
  }

  document.querySelectorAll('[data-act="toggleEditAllM"]').forEach(function(chip) {
    chip.onclick = function() {
      var mObj = memos.find(function(x) { return x.id === editingMemoId; });
      if (!mObj) return;
      if (mObj.months.length === 12) {
        mObj.months = [];
      } else {
        mObj.months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      }
      render();
      modal = 'editmemo';
    };
  });

  document.querySelectorAll('[data-act="toggleEditMonth"]').forEach(function(chip) {
    chip.onclick = function() {
      var mm = parseInt(chip.getAttribute('data-m'), 10);
      var mObj = memos.find(function(x) { return x.id === editingMemoId; });
      if (!mObj) return;
      var idx = mObj.months.indexOf(mm);
      if (idx === -1) mObj.months.push(mm); else mObj.months.splice(idx, 1);
      mObj.months.sort(function(a, b) { return a - b; });
      render();
      modal = 'editmemo';
    };
  });

  document.querySelectorAll('[data-act="toggleCardDetail"]').forEach(function(btn) {
    btn.onclick = function() {
      var cId = btn.getAttribute('data-card');
      expandedCards[cId] = !expandedCards[cId];
      render();
    };
  });

  document.querySelectorAll('[data-act="startEditFixed"]').forEach(function(el) {
    var handler = function(e) {
      editingFixedId = el.getAttribute('data-id');
      render();
    };
    el.onclick = handler;
    el.ontouchstart = function(e) {
      handler(e);
    };
  });

  document.querySelectorAll('.editable-amt-input').forEach(function(inp) {
    inp.onblur = function() {
      updateFixedAmount(inp.getAttribute('data-card'), inp.getAttribute('data-item'), inp.value);
    };
    inp.onkeydown = function(e) {
      if (e.key === 'Enter') {
        inp.blur();
      }
    };
  });

  document.querySelectorAll('[data-act="addfixed"]').forEach(function(btn) {
    btn.onclick = function() {
      var cardId = btn.getAttribute('data-card');
      var label = document.getElementById('fl-' + cardId).value.trim();
      var amount = document.getElementById('fa-' + cardId).value;
      addFixed(cardId, label, amount);
    };
  });

  /* [수정 완료] 고정 결제 삭제 버튼 클릭 이벤트 연결 */
  document.querySelectorAll('[data-act="delfixed"]').forEach(function(btn) {
    btn.onclick = function() {
      removeFixed(btn.getAttribute('data-card'), btn.getAttribute('data-item'));
    };
  });

  /* [수정 완료] 사용 내역 삭제 버튼 클릭 이벤트 연결 */
  document.querySelectorAll('[data-act="deltx"]').forEach(function(btn) {
    btn.onclick = function() {
      removeTx(btn.getAttribute('data-card'), btn.getAttribute('data-item'));
    };
  });

  /* [수정 완료] 지난달 고정 결제 불러오기 버튼 이벤트 연결 */
  document.querySelectorAll('[data-act="copyprev"]').forEach(function(btn) {
    btn.onclick = function() {
      copyPrevFixed(btn.getAttribute('data-card'));
    };
  });

  document.querySelectorAll('[data-act="delmemo"]').forEach(function(btn) {
    btn.onclick = function() { removeMemo(btn.getAttribute('data-id')); };
  });

  var qaSubmit = document.getElementById('qaSubmit');
  if (qaSubmit) {
    qaSubmit.onclick = function() {
      quickAddDraft.cardId = document.getElementById('qaCard').value;
      quickAddDraft.amount = document.getElementById('qaAmount').value;
      quickAddDraft.memo = document.getElementById('qaMemo').value.trim();
      quickAddDraft.date = document.getElementById('qaDate').value || todayStr();
      submitQuickAdd();
    };
  }

  document.querySelectorAll('[data-cf]').forEach(function(inp) {
    inp.onchange = function() { updateCardField(inp.getAttribute('data-id'), inp.getAttribute('data-cf'), inp.value); };
  });

  var addCardBtn = document.getElementById('addCardBtn');
  if (addCardBtn) addCardBtn.onclick = addCard;

  document.querySelectorAll('[data-act="delcard"]').forEach(function(btn) {
    btn.onclick = function() { deleteCard(btn.getAttribute('data-id')); };
  });

  document.querySelectorAll('[data-mf]').forEach(function(inp) {
    inp.onchange = function() { updateMemoField(inp.getAttribute('data-id'), inp.getAttribute('data-mf'), inp.value); };
  });

  var addMemoBtn = document.getElementById('addMemoBtn');
  if (addMemoBtn) addMemoBtn.onclick = addMemoDetailed;

  document.querySelectorAll('[data-act="delmemosetting"]').forEach(function(btn) {
    btn.onclick = function() { removeMemo(btn.getAttribute('data-id')); };
  });

  document.querySelectorAll('[data-act="togglemonth"]').forEach(function(chip) {
    chip.onclick = function() {
      var val = chip.getAttribute('data-m');
      var mm = val === 'all' ? 'all' : parseInt(val, 10);
      toggleMemoMonth(chip.getAttribute('data-id'), mm);
    };
  });
}

/* ---------- 로그인 화면 ---------- */
function renderLoginScreen() {
  var app = document.getElementById('app');
  var html = '';
  html += '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;text-align:center;">';
  html += '  <div style="font-size:22px;font-weight:800;margin-bottom:10px;">카드 실적 수첩</div>';
  html += '  <div style="font-size:13px;color:var(--text-soft);margin-bottom:28px;line-height:1.5;">본인 확인을 위해 구글 계정으로<br>로그인이 필요해요</div>';
  html += '  <button id="googleLoginBtn" class="primary-btn" style="max-width:280px;">Google로 로그인</button>';
  html += '</div>';
  app.innerHTML = html;
  var btn = document.getElementById('googleLoginBtn');
  if (btn) btn.onclick = function() {
    signInWithPopup(auth, new GoogleAuthProvider())
      .then((result) => {
        currentUser = result.user;
        startApp();
      })
      .catch((error) => {
        console.error("로그인 오류:", error);
        showToast("로그인에 실패했습니다: " + error.message);
      });
  };
}

function startApp() {
  subscribeMonth(monthKey);
  initRealtimeListeners();
}

onAuthStateChanged(auth, function(user) {
  authChecking = false;
  if (user) {
    currentUser = user;
    startApp();
  } else {
    currentUser = null;
    renderLoginScreen();
  }
});