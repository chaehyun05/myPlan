// ===== 기본 설정 =====
const DAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const SHORT = ['일', '월', '화', '수', '목', '금', '토'];
const STORAGE_KEY = 'myplan-data-v2';
const OLD_STORAGE_KEY = 'myplan-data-v1'; // 예전 버전(월요일 시작) 데이터
const DAY_MIN = 1440;                      // 하루 = 1440분
const WEEK_MIN = DAY_MIN * 7;
const COLORS = [                           // 할 일마다 자동으로 정해지는 블록 색 [배경, 글자] (32가지)
  ['#2340E8', '#ffffff'], // 코발트
  ['#FF6B1A', '#ffffff'], // 주황
  ['#F0458A', '#ffffff'], // 핑크
  ['#0E9F82', '#ffffff'], // 초록
  ['#F5B800', '#111433'], // 노랑
  ['#7B4DFF', '#ffffff'], // 보라
  ['#111433', '#ffffff'], // 남색
  ['#00A3D9', '#ffffff'], // 하늘
  ['#C62828', '#ffffff'], // 빨강
  ['#8BC34A', '#111433'], // 연두
  ['#3F51B5', '#ffffff'], // 인디고
  ['#FF9800', '#111433'], // 귤색
  ['#AD1457', '#ffffff'], // 라즈베리
  ['#26A69A', '#111433'], // 민트
  ['#6D4C41', '#ffffff'], // 갈색
  ['#FFD54F', '#111433'], // 레몬
  ['#1565C0', '#ffffff'], // 파랑
  ['#E57373', '#111433'], // 연어
  ['#2E7D32', '#ffffff'], // 숲
  ['#BA68C8', '#111433'], // 라벤더
  ['#37474F', '#ffffff'], // 회청
  ['#4DD0E1', '#111433'], // 청록
  ['#BF360C', '#ffffff'], // 벽돌
  ['#9FA8DA', '#111433'], // 연보라
  ['#00695C', '#ffffff'], // 진청록
  ['#F48FB1', '#111433'], // 연분홍
  ['#5E35B1', '#ffffff'], // 진보라
  ['#AED581', '#111433'], // 연초록
  ['#880E4F', '#ffffff'], // 와인
  ['#FFAB91', '#111433'], // 살구
  ['#0277BD', '#ffffff'], // 바다
  ['#C0CA33', '#111433'], // 올리브
];

const $ = (id) => document.getElementById(id);
const form = $('plan-form');
const slotsBox = $('slots');
const taskIn = $('task');
const preview = $('preview');
const monthIn = $('month');

// 일정 하나: { id, groupId, day(0=일~6=토), start(분), end(분), task }
// 자정을 넘기는 일정은 end가 1440보다 커요. (예: 23:00~01:00 → start 1380, end 1500)
// 한 번에 같이 추가한 일정들은 같은 groupId를 가져요.

// ===== 유틸 =====
const pad = (n) => String(n).padStart(2, '0');
const toHM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const timeValue = (min) => (min === DAY_MIN ? '24:00' : toHM(min % DAY_MIN));
const endLabel = (end) => (end > DAY_MIN ? '다음날 ' + toHM(end - DAY_MIN) : timeValue(end));
const rangeText = (p) => `${toHM(p.start)}–${endLabel(p.end)}`;
const shortRange = (p) => `${toHM(p.start)}–${timeValue(p.end > DAY_MIN ? p.end - DAY_MIN : p.end)}`;
const durText = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? `${h}시간` : '', m ? `${m}분` : ''].filter(Boolean).join(' ') || '0분';
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const getMode = () => form.querySelector('input[name="mode"]:checked').value;
const mod = (n, m) => ((n % m) + m) % m;

// 일주일을 한 줄로 펼쳐서(일요일 00:00 = 0분) 겹치는 시간을 계산. 토요일 밤 → 일요일 새벽도 이어서 계산됨
const absRange = (p) => [p.day * DAY_MIN + p.start, p.day * DAY_MIN + p.end];
function overlapMin(a, b) {
  const [as, ae] = absRange(a);
  const [bs, be] = absRange(b);
  let best = 0;
  for (const k of [-WEEK_MIN, 0, WEEK_MIN]) {
    best = Math.max(best, Math.min(ae, be + k) - Math.max(as, bs + k));
  }
  return best;
}

function daysText(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const key = sorted.join(',');
  if (key === '0,1,2,3,4,5,6') return '매일';
  if (key === '1,2,3,4,5') return '평일(월~금)';
  if (key === '0,6') return '주말(토·일)';
  if (sorted.length === 1) return DAYS[sorted[0]];
  return sorted.map((d) => SHORT[d]).join('·');
}

// 일정 여러 개를 "월·수 10:00–11:30, 금 13:00–14:00" 처럼 시간별로 묶어서 설명
function describeTimes(items) {
  const byTime = new Map();
  items.forEach((p) => {
    const key = `${p.start}-${p.end}`;
    if (!byTime.has(key)) byTime.set(key, { p, days: [] });
    byTime.get(key).days.push(p.day);
  });
  return [...byTime.values()].map(({ p, days }) => `${daysText(days)} ${rangeText(p)}`).join(', ');
}
const describe = (items) => `${describeTimes(items)} · <b>${escapeHtml(items[0].task)}</b>`;

const isValidPlan = (p) =>
  p && typeof p.id === 'string' && typeof p.task === 'string' &&
  (p.groupId == null || typeof p.groupId === 'string') &&
  Number.isInteger(p.day) && p.day >= 0 && p.day < 7 &&
  Number.isInteger(p.start) && Number.isInteger(p.end) &&
  p.start >= 0 && p.start < DAY_MIN && p.end > p.start && p.end - p.start <= DAY_MIN;

// 예전 버전은 0 = 월요일이었으므로 0 = 일요일 기준으로 바꿔줌
const migrateV1 = (arr) =>
  arr.map((p) => ({ ...p, day: Number.isInteger(p.day) ? (p.day + 1) % 7 : p.day, groupId: null })).filter(isValidPlan);

const isValidTodo = (t) => t && typeof t.id === 'string' && typeof t.text === 'string' && typeof t.done === 'boolean';
const isValidMandal = (m) =>
  m && typeof m.id === 'string' && Array.isArray(m.cells) && m.cells.length === 9 &&
  m.cells.every((r) => Array.isArray(r) && r.length === 9 && r.every((x) => typeof x === 'string'));

// ===== 저장 (브라우저 localStorage) =====
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return {
        plans: (Array.isArray(d.plans) ? d.plans : []).filter(isValidPlan),
        month: typeof d.month === 'string' ? d.month.replace(/\D/g, '').slice(0, 2) : '',
        colorMap: d.colors && typeof d.colors === 'object' ? d.colors : {},
        todos: (Array.isArray(d.todos) ? d.todos : []).filter(isValidTodo),
        mandals: (Array.isArray(d.mandals) ? d.mandals : []).filter(isValidMandal),
      };
    }
    const old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY));
    if (Array.isArray(old)) return { plans: migrateV1(old), month: '', colorMap: {}, todos: [], mandals: [] };
  } catch { /* 저장된 값이 없거나 읽을 수 없음 */ }
  return { plans: [], month: '', colorMap: {}, todos: [], mandals: [] };
}
function saveData() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, month, plans, colors: colorMap, todos, mandals })); }
  catch { toast('브라우저에 저장하지 못했어요. 백업 파일 저장을 이용해주세요.'); }
}

let { plans, month, colorMap, todos, mandals } = loadData();
// todos: [{ id, text, done }], mandals: [{ id, cells: 9칸 × 9칸 글자 }]
let editing = null; // 수정 중인 일정 정보 { ids, groupId, old }

// 새로운 할 일이 나올 때마다 다음 색을 순서대로 배정하고 기억해둠 (같은 할 일은 항상 같은 색)
function colorFor(task) {
  if (!(task in colorMap)) {
    const used = new Set(plans.map((p) => colorMap[p.task]).filter((i) => i != null));
    const count = Object.keys(colorMap).length;
    let idx = count % COLORS.length;
    for (let i = 0; i < COLORS.length; i++) { // 지금 계획표에 안 쓰인 색을 우선 사용
      const c = (count + i) % COLORS.length;
      if (!used.has(c)) { idx = c; break; }
    }
    colorMap[task] = idx;
    saveData();
  }
  return COLORS[colorMap[task]];
}

// 계획표에 있는 할 일끼리 색이 겹치면 안 쓰인 색으로 바꿔줌 (색이 32개를 넘기 전까지는 모두 다른 색)
function dedupeColors() {
  const tasks = [...new Set(plans.map((p) => p.task))].filter((t) => t in colorMap);
  const used = new Set();
  let changed = false;
  for (const t of tasks) {
    let idx = colorMap[t];
    if (!(idx >= 0 && idx < COLORS.length) || used.has(idx)) {
      const free = COLORS.findIndex((_, i) => !used.has(i));
      if (free === -1) continue;
      colorMap[t] = idx = free;
      changed = true;
    }
    used.add(idx);
  }
  if (changed) saveData();
}
dedupeColors();

// ===== 되돌리기 / 다시 실행 (⌘Z, Ctrl+Z) =====
const undoStack = [];
const redoStack = [];
const snapshot = () => JSON.stringify({ plans, colorMap, todos, mandals });

// 일정을 바꾸기 직전에 부름
function remember() {
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}
function restoreSnapshot(json) {
  const d = JSON.parse(json);
  plans = d.plans;
  colorMap = d.colorMap || {};
  todos = d.todos || [];
  mandals = d.mandals || [];
  if (editing && !editing.ids.every((id) => plans.some((p) => p.id === id))) resetForm();
  saveData();
  render();
  renderTodos();
  renderMandals();
}
function undo() {
  if (!undoStack.length) return toast('되돌릴 작업이 없어요.');
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop());
  toast('되돌렸어요.');
}
function redo() {
  if (!redoStack.length) return toast('다시 실행할 작업이 없어요.');
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop());
  toast('다시 실행했어요.');
}
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  if (!$('modal').classList.contains('hidden')) return;
  // 글자를 쓰고 있는 칸에서는 그 칸의 되돌리기를 그대로 사용
  const t = e.target;
  if (t.isContentEditable) return;
  if (t.matches?.('input[type="text"], input[type="number"], textarea') && t.value) return;
  e.preventDefault();
  if (key === 'y' || e.shiftKey) redo();
  else undo();
});

// ===== 시간 입력칸 (오전/오후 + 숫자만 치면 자동으로 HH:MM) =====
// 4 → 4 / 409 → 4:09 / 0409 → 04:09 / 1930 → 오후 07:30
function maskDigits(digits) {
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return digits[0] + ':' + digits.slice(1);
  return digits.slice(0, 2) + ':' + digits.slice(2, 4);
}
function splitDigits(digits) {
  if (digits.length <= 2) return { h: +digits, m: 0 };
  if (digits.length === 3) return { h: +digits[0], m: +digits.slice(1) };
  return { h: +digits.slice(0, 2), m: +digits.slice(2, 4) };
}

const timeFieldHTML = (label) =>
  `<div class="tfield">` +
    `<span class="tlabel">${label}</span>` +
    `<div class="tbox">` +
      `<div class="ap" role="group" aria-label="${label} 오전/오후">` +
        `<button type="button" data-ap="am">오전</button><button type="button" data-ap="pm">오후</button>` +
      `</div>` +
      `<input type="text" class="time-input" placeholder="--:--" maxlength="5" inputmode="numeric" aria-label="${label}">` +
    `</div>` +
  `</div>`;

class TimeField {
  constructor(root, { next, onChange = () => {}, onNormalize = () => {} } = {}) {
    this.root = root;
    this.box = root.querySelector('.tbox');
    this.input = root.querySelector('input');
    this.onChange = onChange;
    this.onNormalize = onNormalize;
    this.apTouched = false; // 사용자가 오전/오후를 직접 눌렀는지
    this.setAp('am');

    root.querySelectorAll('[data-ap]').forEach((b) =>
      b.addEventListener('click', () => { this.setAp(b.dataset.ap); this.apTouched = true; this.onChange(); })
    );

    let justFocused = false;
    const el = this.input;
    el.addEventListener('focus', () => { el.select(); justFocused = true; });
    el.addEventListener('mouseup', (e) => { if (justFocused) { e.preventDefault(); justFocused = false; } });
    el.addEventListener('input', (e) => {
      this.box.classList.remove('invalid');
      if (!e.inputType?.startsWith('delete')) {          // 지울 때는 그대로 두기
        const digits = el.value.replace(/\D/g, '').slice(0, 4);
        el.value = maskDigits(digits);
        // 숫자 4개를 다 치거나, 3개로 이미 시간이 확실하면(예: 730 → 7:30) 다음 칸으로 자동 이동
        const sure = digits.length === 3 && +digits.slice(0, 2) > 24;
        if (digits.length === 4 || sure) {
          this.normalize();
          if (!this.box.classList.contains('invalid')) next?.()?.focus();
        }
      }
      this.onChange();
    });
    el.addEventListener('blur', () => { this.normalize(); this.onChange(); });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();                                 // 시간 칸에서 엔터 → 다음 칸으로
      this.normalize();
      this.onChange();
      next?.()?.focus();
    });
  }

  setAp(ap) {
    this.ap = ap;
    this.root.querySelectorAll('[data-ap]').forEach((b) => {
      b.classList.toggle('on', b.dataset.ap === ap);
      b.setAttribute('aria-pressed', b.dataset.ap === ap);
    });
  }

  // null(비어 있음) / { error } / { min }
  value() {
    const digits = this.input.value.replace(/\D/g, '');
    if (!digits) return null;
    let { h, m } = splitDigits(digits);
    if (m > 59 || h > 24 || (h === 24 && m > 0)) return { error: true };
    if (h === 24) return { min: 0 };                    // 24:00 = 자정
    if (h === 0 || h >= 13) return { min: h * 60 + m }; // 0시, 13~23시는 오전/오후와 상관없이 그대로
    if (this.ap === 'pm' && h < 12) h += 12;            // 오후 1~11시
    if (this.ap === 'am' && h === 12) h = 0;            // 오전 12시 = 자정
    return { min: h * 60 + m };
  }

  set(min) {
    min = mod(min, DAY_MIN);
    const h = Math.floor(min / 60);
    this.setAp(h >= 12 ? 'pm' : 'am');
    this.input.value = `${pad(h % 12 === 0 ? 12 : h % 12)}:${pad(min % 60)}`;
    this.box.classList.remove('invalid');
  }

  // "오후 07:30" 모양으로 정리
  normalize() {
    const r = this.value();
    this.box.classList.toggle('invalid', !!(r && r.error));
    if (r && !r.error) { this.set(r.min); this.onNormalize(); }
  }

  focus() { this.input.focus(); }
}

// 시작/종료 칸 한 쌍을 연결: 종료가 비어 있으면 시작과 같은 오전/오후로 맞추고,
// 오전 10시 → 1시처럼 쓰면 오후 1시로 알아서 바꿔줌
function linkFields(startF, endF) {
  startF.onNormalize = () => {
    if (!endF.input.value && !endF.apTouched) endF.setAp(startF.ap);
  };
  endF.onNormalize = () => {
    const s = startF.value(), e = endF.value();
    if (!s || s.error || !e || e.error || endF.apTouched) return;
    if (e.min < s.min && e.min >= 60 && e.min < 720 && e.min + 720 > s.min) endF.set(e.min + 720);
  };
}

// 시작/종료 값으로 일정 시간 계산. 종료가 시작보다 이르면 다음날로 넘어간 것으로 처리
function computeRange(startF, endF) {
  const s = startF.value();
  if (!s) return { error: '시작 시간을 입력해주세요.' };
  if (s.error) return { error: '시작 시간이 올바르지 않아요.' };
  const e = endF.value();
  if (!e) return { error: '종료 시간을 입력해주세요.' };
  if (e.error) return { error: '종료 시간이 올바르지 않아요.' };
  let end = e.min;
  if (end === s.min) return { error: '시작 시간과 종료 시간이 같아요.' };
  if (end < s.min) end += DAY_MIN; // 예: 오후 11시 → 오전 1시 는 다음날 01:00
  return { start: s.min, end };
}

// ===== 입력 폼: 시간 줄(요일 + 시작 + 종료)을 여러 개 넣을 수 있음 =====
const PRESETS = { weekdays: [1, 2, 3, 4, 5], weekend: [0, 6], all: [0, 1, 2, 3, 4, 5, 6] };
let slots = [];

function addSlot({ days = [], start = null, end = null } = {}) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.innerHTML =
    `<div class="slot-days">` +
      `<div class="day-chips">` +
        SHORT.map((s, d) => `<label class="chip"><input type="checkbox" value="${d}" aria-label="${DAYS[d]}"><span>${s}</span></label>`).join('') +
      `</div>` +
      `<div class="presets">` +
        `<button type="button" class="chip-btn" data-preset="weekdays">평일</button>` +
        `<button type="button" class="chip-btn" data-preset="weekend">주말</button>` +
        `<button type="button" class="chip-btn" data-preset="all">매일</button>` +
      `</div>` +
    `</div>` +
    `<div class="slot-times">` +
      `<div class="s-start">${timeFieldHTML('시작')}</div>` +
      `<span class="dash">–</span>` +
      `<div class="s-end">${timeFieldHTML('종료')}</div>` +
      `<div class="s-dur tfield hidden"><span class="tlabel">유지 시간</span>` +
        `<div class="duration">` +
          `<input type="number" class="dur-h" min="0" max="24" value="1" aria-label="시간"><span>시간</span>` +
          `<input type="number" class="dur-m" min="0" max="59" value="0" aria-label="분"><span>분</span>` +
        `</div>` +
      `</div>` +
      `<button type="button" class="slot-del" aria-label="이 시간 지우기" title="이 시간 지우기">×</button>` +
    `</div>`;
  slotsBox.appendChild(el);

  const slot = { el };
  slot.checks = [...el.querySelectorAll('.day-chips input')];
  slot.getDays = () => slot.checks.filter((c) => c.checked).map((c) => +c.value);
  slot.setDays = (ds) => slot.checks.forEach((c) => { c.checked = ds.includes(+c.value); });
  slot.durH = el.querySelector('.dur-h');
  slot.durM = el.querySelector('.dur-m');

  const nextAfterEnd = () => {
    const i = slots.indexOf(slot);
    return slots[i + 1] ? slots[i + 1].startF.input : $('submit-btn');
  };
  slot.startF = new TimeField(el.querySelector('.s-start .tfield'), {
    next: () => (getMode() === 'end' ? slot.endF.input : slot.durH),
    onChange: updatePreview,
  });
  slot.endF = new TimeField(el.querySelector('.s-end .tfield'), { next: nextAfterEnd, onChange: updatePreview });
  linkFields(slot.startF, slot.endF);

  slot.checks.forEach((c) => c.addEventListener('change', updatePreview));
  el.querySelectorAll('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => { slot.setDays(PRESETS[b.dataset.preset]); updatePreview(); })
  );
  [slot.durH, slot.durM].forEach((x) => x.addEventListener('input', updatePreview));
  el.querySelector('.slot-del').addEventListener('click', () => {
    slots = slots.filter((s) => s !== slot);
    el.remove();
    if (!slots.length) addSlot();
    refreshSlots();
    updatePreview();
  });

  slot.setDays(days);
  if (start != null) slot.startF.set(start);
  if (end != null) slot.endF.set(end);

  slots.push(slot);
  applyMode();
  refreshSlots();
  return slot;
}

function refreshSlots() {
  // 시간 줄이 하나뿐이면 지우기 버튼은 숨김
  slots.forEach((s) => s.el.querySelector('.slot-del').classList.toggle('hidden', slots.length === 1));
}

function clearSlots() {
  slots = [];
  slotsBox.innerHTML = '';
}

$('add-slot').addEventListener('click', () => {
  const s = addSlot();
  s.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  s.startF.focus();
});

// 시간 줄 하나 → { days, start, end } 또는 { error }
function readSlot(slot) {
  const days = slot.getDays();
  let t;
  if (getMode() === 'end') {
    t = computeRange(slot.startF, slot.endF);
  } else {
    const s = slot.startF.value();
    const d = Math.max(0, parseInt(slot.durH.value) || 0) * 60 + Math.max(0, parseInt(slot.durM.value) || 0);
    if (!s) t = { error: '시작 시간을 입력해주세요.' };
    else if (s.error) t = { error: '시작 시간이 올바르지 않아요.' };
    else if (d <= 0) t = { error: '유지 시간을 1분 이상 입력해주세요.' };
    else if (d > DAY_MIN) t = { error: '유지 시간은 24시간까지 입력할 수 있어요.' };
    else t = { start: s.min, end: s.min + d };
  }
  if (t.error) return t;
  if (!days.length) return { error: '요일을 선택해주세요.' };
  return { days, ...t };
}

function updatePreview() {
  const lines = slots.map((slot, i) => {
    const r = readSlot(slot);
    const label = slots.length > 1 ? `${i + 1}. ` : '';
    const started = slot.startF.input.value || slot.getDays().length;
    if (r.error) return started ? `<div class="err">${label}⚠ ${r.error}</div>` : '';
    return `<div>${label}${daysText(r.days)} · ${rangeText(r)} (${durText(r.end - r.start)})</div>`;
  });
  preview.innerHTML = lines.join('');
}

function applyMode() {
  const mode = getMode();
  slots.forEach((s) => {
    s.el.querySelector('.s-end').classList.toggle('hidden', mode !== 'end');
    s.el.querySelector('.dash').classList.toggle('hidden', mode !== 'end');
    s.el.querySelector('.s-dur').classList.toggle('hidden', mode !== 'duration');
  });
}

// 입력 방식을 바꾸면 이미 입력한 시간을 자동으로 옮겨줌
form.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', () => {
    const toEnd = getMode() === 'end';
    slots.forEach((s) => {
      const st = s.startF.value();
      if (!st || st.error) return;
      if (toEnd) {
        const d = (parseInt(s.durH.value) || 0) * 60 + (parseInt(s.durM.value) || 0);
        if (d > 0) s.endF.set(st.min + d);
      } else {
        const t = computeRange(s.startF, s.endF);
        if (!t.error) { s.durH.value = Math.floor((t.end - t.start) / 60); s.durM.value = (t.end - t.start) % 60; }
      }
    });
    applyMode();
    updatePreview();
  })
);

// ===== 팝업 =====
function showModal({ title, body, buttons, stacked = false, onOpen }) {
  return new Promise((resolve) => {
    const modal = $('modal');
    const box = $('modal-buttons');
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = body;
    box.innerHTML = '';
    box.classList.toggle('stacked', stacked);

    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const close = (v) => {
      modal.classList.add('hidden');
      document.removeEventListener('keydown', onKey);
      modal.onclick = null;
      resolve(v);
    };

    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn ' + (b.style || '');
      el.textContent = b.label;
      el.onclick = () => close(b.value);
      box.appendChild(el);
    });
    modal.onclick = (e) => { if (e.target === modal) close(null); };
    document.addEventListener('keydown', onKey);
    modal.classList.remove('hidden');
    (box.querySelector('.primary') || box.querySelector('.btn'))?.focus();
    onOpen?.($('modal-body'), box);
  });
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== 겹치는 일정 처리 =====
// base: 기존 일정들, entries: 새로 넣을 일정들
// 결과로 바뀐 전체 일정 배열을 돌려주고, 취소하면 null
async function resolveConflicts(base, entries) {
  const hits = entries.map((e) => ({ e, others: base.filter((p) => overlapMin(p, e) > 0) }));
  const conflicted = hits.filter((h) => h.others.length);
  if (!conflicted.length) return base.concat(entries);

  const multi = entries.length > 1;
  const freeCount = entries.length - conflicted.length;
  const same = (p, e) => p.day === e.day && p.start === e.start && p.end === e.end;
  const allSame = conflicted.every((h) => h.others.every((p) => same(p, h.e)));

  const list = conflicted.map((h) =>
    `<li><b>${DAYS[h.e.day]}</b> ` +
    h.others.map((p) =>
      `${p.day !== h.e.day ? DAYS[p.day] + ' ' : ''}${rangeText(p)} ${escapeHtml(p.task)}` +
      (same(p, h.e) ? '' : `<span class="tag">${durText(overlapMin(p, h.e))} 겹침</span>`)
    ).join(', ') + '</li>'
  ).join('');

  const skip = multi && freeCount > 0
    ? { label: `겹치는 것은 빼고 나머지만 추가 (${freeCount}개)`, value: 'skip' }
    : null;

  let choice;
  if (allSame) {
    // 시간이 완전히 같을 때 → 교체 여부 확인
    choice = await showModal({
      title: '같은 시간에 이미 일정이 있어요',
      body: `<ul class="conflicts">${list}</ul><p><b>${escapeHtml(entries[0].task)}</b>(으)로 교체할까요?</p>`,
      buttons: [
        { label: '교체하기', value: 'replace', style: 'primary' },
        ...(skip ? [skip] : []),
        { label: '취소', value: null },
      ],
      stacked: !!skip,
    });
  } else {
    // 일부만 겹칠 때 → 어떻게 할지 선택
    choice = await showModal({
      title: '시간이 겹치는 일정이 있어요',
      body:
        `<p>새 일정: ${describe(entries)}</p>` +
        `<p>겹치는 일정:</p><ul class="conflicts">${list}</ul><p>어떻게 할까요?</p>`,
      buttons: [
        { label: '새 일정 우선 (기존 일정에서 겹치는 시간만 빼기)', value: 'trim', style: 'primary' },
        { label: '새 일정으로 교체 (겹치는 기존 일정 삭제)', value: 'replace' },
        { label: '둘 다 그대로 두기', value: 'both' },
        ...(skip ? [skip] : []),
        { label: multi ? '모두 취소' : '기존 일정 유지 (새 일정 취소)', value: null },
      ],
      stacked: true,
    });
  }

  if (!choice) return null;
  if (choice === 'skip') return base.concat(hits.filter((h) => !h.others.length).map((h) => h.e));
  if (choice === 'both') return base.concat(entries);

  const touched = new Set(conflicted.flatMap((h) => h.others));
  let result = base.filter((p) => !touched.has(p));
  if (choice === 'trim') {
    // 기존 일정에서 새 일정과 겹치는 부분만 잘라냄 (여러 새 일정과 겹쳐도 차례로 잘라냄)
    let pieces = [...touched];
    for (const e of entries) {
      pieces = pieces.flatMap((p) => (overlapMin(p, e) > 0 ? cutOut(p, e) : [p]));
    }
    result = result.concat(pieces);
  }
  return result.concat(entries);
}

// p에서 e와 겹치는 시간을 빼고 남은 조각들을 돌려줌
function cutOut(p, e) {
  const [ps, pe] = absRange(p);
  let [es, ee] = absRange(e);
  for (const k of [-WEEK_MIN, WEEK_MIN]) {                // 주 경계를 넘는 경우 맞춰줌
    if (Math.min(pe, ee + k) - Math.max(ps, es + k) > 0) { es += k; ee += k; break; }
  }
  const make = (s, en) => {
    const day = mod(Math.floor(s / DAY_MIN), 7);
    const start = mod(s, DAY_MIN);
    return { ...p, id: newId(), day, start, end: start + (en - s) };
  };
  const out = [];
  if (ps < es) out.push(make(ps, es));
  if (pe > ee) out.push(make(ee, pe));
  if (out.length === 2) out.forEach((x) => { x.groupId = null; }); // 둘로 쪼개지면 묶음에서 분리
  return out;
}

// 새 일정 추가(또는 수정) 공통 처리. items: [{ days, start, end }], 실제로 추가된 개수를 돌려줌
async function commitEntries(items, task) {
  const count = items.reduce((n, it) => n + it.days.length, 0);
  // 한 번에 여러 개를 넣으면 같은 묶음(groupId)으로 저장 → 나중에 한꺼번에 수정/삭제 가능
  const groupId = count > 1 ? (editing?.groupId || newId()) : null;
  const entries = items.flatMap((it) =>
    it.days.map((day) => ({ id: newId(), groupId, day, start: it.start, end: it.end, task }))
  );

  // 새로 넣는 것끼리 겹치는지 확인
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (overlapMin(entries[i], entries[j]) > 0) {
        toast(`${DAYS[entries[i].day]} 시간이 서로 겹쳐요. 시간을 확인해주세요.`);
        return 0;
      }
    }
  }

  const base = editing ? plans.filter((p) => !editing.ids.includes(p.id)) : plans;
  const result = await resolveConflicts(base, entries);
  if (!result) return 0;
  remember();
  plans = result;
  saveData();
  render();
  return entries.filter((x) => result.includes(x)).length;
}

// ===== 폼으로 추가 / 수정 =====
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  slots.forEach((s) => { s.startF.normalize(); s.endF.normalize(); });
  updatePreview();

  const task = taskIn.value.trim();
  if (!task) { taskIn.focus(); return toast('할 일을 입력해주세요.'); }
  const items = [];
  for (const [i, slot] of slots.entries()) {
    const r = readSlot(slot);
    if (r.error) return toast((slots.length > 1 ? `${i + 1}번째 시간: ` : '') + r.error);
    items.push(r);
  }

  if (editing) {
    const planned = items.flatMap((it) => it.days.map((day) => ({ day, start: it.start, end: it.end, task })));
    const ok = await showModal({
      title: '일정을 수정할까요?',
      body:
        `<div class="compare">` +
        `<div><b>기존</b>${describe(editing.old)}</div>` +
        `<div><b>변경</b>${describe(planned)}</div>` +
        `</div>`,
      buttons: [
        { label: '취소', value: false },
        { label: '수정하기', value: true, style: 'primary' },
      ],
    });
    if (!ok) return;
  }

  const added = await commitEntries(items, task);
  if (!added) return;

  const wasEdit = !!editing;
  resetForm();
  toast(wasEdit ? '수정했어요.' : added > 1 ? `${added}개 일정을 추가했어요.` : '추가했어요.');
  taskIn.focus();
});

function startEdit(members, groupId) {
  editing = { ids: members.map((m) => m.id), groupId, old: members };
  taskIn.value = members[0].task;
  form.querySelector('input[name="mode"][value="end"]').checked = true;

  // 같은 시간끼리 한 줄로 묶어서 보여줌 (예: 월·수 10:00–11:30 / 금 13:00–14:00)
  const byTime = new Map();
  members.forEach((m) => {
    const key = `${m.start}-${m.end}`;
    if (!byTime.has(key)) byTime.set(key, { start: m.start, end: m.end, days: [] });
    byTime.get(key).days.push(m.day);
  });
  clearSlots();
  byTime.forEach((t) => addSlot(t));

  $('form-title').textContent = '할 일 수정';
  $('submit-btn').textContent = '수정 저장';
  $('cancel-edit').classList.remove('hidden');
  updatePreview();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  taskIn.focus({ preventScroll: true });
}

function resetForm() {
  editing = null;
  taskIn.value = '';
  clearSlots();
  addSlot();
  $('form-title').textContent = '할 일 추가';
  $('submit-btn').textContent = '추가하기';
  $('cancel-edit').classList.add('hidden');
  updatePreview();
}
$('cancel-edit').addEventListener('click', resetForm);

// ===== 큰 월 숫자 =====
// 숫자 길이에 맞게 입력칸 너비를 맞춤 (그래야 '월' 글자가 숫자 바로 옆에 붙음)
const monthMeasure = document.createElement('span');
monthMeasure.className = 'month-measure';
monthMeasure.setAttribute('aria-hidden', 'true');
monthIn.parentNode.appendChild(monthMeasure);
function fitMonth() {
  monthMeasure.textContent = monthIn.value || monthIn.placeholder;
  monthIn.style.width = monthMeasure.offsetWidth + 4 + 'px';
  // 2번째 장부터는 같은 월 숫자를 그대로 보여줌
  document.querySelectorAll('.js-month').forEach((el) => { el.textContent = monthIn.value || monthIn.placeholder; });
}
monthIn.placeholder = String(new Date().getMonth() + 1);
monthIn.value = month;
fitMonth();
document.fonts?.ready.then(fitMonth);
window.addEventListener('resize', fitMonth);
monthIn.addEventListener('input', () => {
  monthIn.value = monthIn.value.replace(/\D/g, '').slice(0, 2);
  const n = +monthIn.value;
  if (monthIn.value && (n < 1 || n > 12)) monthIn.value = monthIn.value.slice(0, -1);
  month = monthIn.value;
  fitMonth();
  saveData();
});

// ===== 계획표 그리기 (00:00 ~ 24:00 전체) =====
// 일정을 요일별 조각으로 나눔. 자정을 넘으면 다음날 00:00부터 이어서 그림
function segmentsOf(p) {
  if (p.end <= DAY_MIN) return [{ p, day: p.day, s: p.start, e: p.end }];
  return [
    { p, day: p.day, s: p.start, e: DAY_MIN },
    { p, day: (p.day + 1) % 7, s: 0, e: p.end - DAY_MIN },
  ];
}

// 같은 요일에 시간이 겹치는 일정은 옆으로 나란히 배치
function layoutDay(segs) {
  const sorted = [...segs].sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let cluster = [], laneEnds = [], clusterEnd = -1;
  const flush = () => {
    cluster.forEach((c) => { c.cols = laneEnds.length; });
    out.push(...cluster);
    cluster = []; laneEnds = []; clusterEnd = -1;
  };
  for (const seg of sorted) {
    if (cluster.length && seg.s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= seg.s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(seg.e); }
    else laneEnds[lane] = seg.e;
    cluster.push({ ...seg, lane });
    clusterEnd = Math.max(clusterEnd, seg.e);
  }
  flush();
  return out;
}

function render() {
  const grid = $('grid');
  let html = `<div class="g-head g-corner"></div>` + SHORT.map((d) => `<div class="g-head">${d}</div>`).join('');

  html += '<div class="g-time">';
  for (let h = 0; h < 24; h++) html += `<div class="g-hour">${pad(h)}:00</div>`;
  html += '</div>';

  const segs = plans.flatMap(segmentsOf);
  for (let d = 0; d < 7; d++) {
    html += `<div class="g-day" data-day="${d}">`;
    for (let h = 0; h < 24; h++) html += '<div class="g-slot"></div>';

    layoutDay(segs.filter((x) => x.day === d)).forEach(({ p, s, e, lane, cols }) => {
      const top = (s / DAY_MIN) * 100;
      const height = ((e - s) / DAY_MIN) * 100;
      const w = 100 / cols;
      const [bg, fg] = colorFor(p.task);
      const cls = 'block' + (e - s < 75 ? ' tiny' : '') + (cols > 1 ? ' overlap' : '') + (picked.has(p.id) ? ' selected' : '');
      html +=
        `<div class="block-pos" style="top:${top}%;height:${height}%;left:${lane * w}%;width:${w}%">` +
          `<div class="${cls}" data-id="${p.id}" role="button" tabindex="0" ` +
            `title="${escapeHtml(`${p.task} ${rangeText(p)}`)}" style="background:${bg};color:${fg}">` +
            `<b>${escapeHtml(p.task)}</b><small>${shortRange(p)}</small>` +
          `</div>` +
        `</div>`;
    });
    html += '</div>';
  }
  grid.innerHTML = html;
}

// ===== 일정 블록 클릭 → 수정 / 삭제 =====
async function onBlock(id) {
  const p = plans.find((x) => x.id === id);
  if (!p) return;
  const group = p.groupId ? plans.filter((x) => x.groupId === p.groupId) : [p];

  const action = await showModal({
    title: p.task,
    body:
      `<p>${DAYS[p.day]} ${rangeText(p)} (${durText(p.end - p.start)})</p>` +
      (group.length > 1 ? `<p class="muted-text">같이 추가한 일정: ${describeTimes(group)}</p>` : ''),
    buttons: [
      { label: '닫기', value: null },
      { label: '삭제', value: 'del', style: 'danger' },
      { label: '수정', value: 'edit', style: 'primary' },
    ],
  });
  if (!action) return;

  let scope = [p];
  if (group.length > 1) {
    const s = await showModal({
      title: action === 'edit' ? '어떤 일정을 수정할까요?' : '어떤 일정을 삭제할까요?',
      body: `<p><b>${escapeHtml(p.task)}</b>은(는) ${describeTimes(group)}에 같이 추가한 일정이에요.</p>`,
      buttons: [
        { label: `${DAYS[p.day]}만`, value: 'one' },
        { label: `같이 추가한 일정 전체 (${group.length}개)`, value: 'all', style: action === 'del' ? 'danger' : 'primary' },
        { label: '취소', value: null },
      ],
      stacked: true,
    });
    if (!s) return;
    if (s === 'all') scope = group;
  }

  if (action === 'edit') return startEdit(scope, scope.length > 1 ? p.groupId : null);
  deletePlans(scope.map((x) => x.id));
}

// 일정 지우기 (⌘Z로 되돌릴 수 있으니 한 번 더 묻지 않음)
function deletePlans(ids) {
  const gone = new Set(ids);
  remember();
  plans = plans.filter((x) => !gone.has(x.id));
  ids.forEach((id) => picked.delete(id));
  if (editing && editing.ids.some((eid) => gone.has(eid))) resetForm();
  saveData();
  render();
  toast((ids.length > 1 ? `${ids.length}개 일정을 삭제했어요.` : '삭제했어요.') + ' ⌘Z로 되돌릴 수 있어요.');
}

// ===== 일정 선택 (클릭: 하나 선택, Shift+클릭: 여러 개 선택) =====
let picked = new Set();
function showPicked() {
  [...picked].forEach((id) => { if (!plans.some((p) => p.id === id)) picked.delete(id); });
  $('grid').querySelectorAll('.block').forEach((b) => b.classList.toggle('selected', picked.has(b.dataset.id)));
}
function clearPicked() {
  if (!picked.size) return;
  picked.clear();
  showPicked();
}

// 여러 개 선택한 상태에서 우클릭했을 때
async function onPicked() {
  const items = plans.filter((p) => picked.has(p.id)).sort((a, b) => a.day - b.day || a.start - b.start);
  const sameTask = items.every((p) => p.task === items[0].task);
  const action = await showModal({
    title: `선택한 일정 ${items.length}개`,
    body: `<ul class="conflicts">${items.map((p) => `<li>${DAYS[p.day]} ${rangeText(p)} <b>${escapeHtml(p.task)}</b></li>`).join('')}</ul>` +
      (sameTask ? '' : '<p class="muted-text">할 일이 서로 달라서 한꺼번에 수정할 수는 없어요.</p>'),
    buttons: [
      { label: '닫기', value: null },
      { label: '모두 삭제', value: 'del', style: 'danger' },
      ...(sameTask ? [{ label: '같이 수정', value: 'edit', style: 'primary' }] : []),
    ],
  });
  if (action === 'del') deletePlans(items.map((p) => p.id));
  if (action === 'edit') {
    const gid = items.every((p) => p.groupId && p.groupId === items[0].groupId) ? items[0].groupId : null;
    startEdit(items, gid);
  }
}

// ===== 빈 칸 클릭·드래그 → 그 시간에 바로 추가 =====
// days: 고른 요일들, start/end: 분 단위 시간
async function quickAdd(days, start, end) {
  let saved = null; // 입력이 잘못돼서 다시 열 때 쓰던 값 유지

  for (;;) {
    let qs, qe;
    const ok = await showModal({
      title: `${daysText(days)}에 일정 추가`,
      body:
        `<div class="qa-row"><div class="qa-start">${timeFieldHTML('시작')}</div><div class="qa-end">${timeFieldHTML('종료')}</div></div>` +
        `<label class="field"><span class="label">할 일</span>` +
          `<input type="text" id="qa-task" maxlength="40" value="${escapeHtml(saved?.task || '')}"></label>`,
      buttons: [
        { label: '취소', value: false },
        { label: '추가하기', value: true, style: 'primary' },
      ],
      onOpen: (body, box) => {
        const qt = body.querySelector('#qa-task');
        qs = new TimeField(body.querySelector('.qa-start .tfield'), { next: () => qe.input });
        qe = new TimeField(body.querySelector('.qa-end .tfield'), { next: () => qt });
        linkFields(qs, qe);
        qs.set(start);
        qe.set(end);
        if (saved) {
          qs.input.value = saved.s; qs.setAp(saved.sAp);
          qe.input.value = saved.e; qe.setAp(saved.eAp);
        }
        qt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); box.querySelector('.primary').click(); }
        });
        qt.focus();
      },
    });
    if (!ok) return;

    qs.normalize(); qe.normalize();
    const t = computeRange(qs, qe);
    const task = $('qa-task').value.trim();
    saved = { task: $('qa-task').value, s: qs.input.value, sAp: qs.ap, e: qe.input.value, eAp: qe.ap };
    if (t.error) { toast(t.error); continue; }
    if (!task) { toast('할 일을 입력해주세요.'); continue; }

    const prevEditing = editing;
    editing = null; // 폼에서 수정 중이던 것과 섞이지 않게
    const added = await commitEntries([{ days, start: t.start, end: t.end }], task);
    editing = prevEditing;
    if (added) toast(added > 1 ? `${added}개 일정을 추가했어요.` : '추가했어요.');
    return;
  }
}

// 좌우로 드래그하면 여러 요일, 위아래로 드래그하면 그만큼의 시간이 선택됨 (30분 단위)
const SLOT = 30;
const SLOTS = DAY_MIN / SLOT;
let drag = null;

// 마우스 위치 → { day, slot }
function cellAt(e, rects) {
  let day = rects.findIndex((r) => e.clientX < r.right);
  if (day === -1) day = 6;
  const r = rects[0];
  const ratio = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 0.9999);
  return { day, slot: Math.floor(ratio * SLOTS) };
}

function dragRange({ a, b }) {
  const d1 = Math.min(a.day, b.day), d2 = Math.max(a.day, b.day);
  return {
    days: Array.from({ length: d2 - d1 + 1 }, (_, i) => d1 + i),
    start: Math.min(a.slot, b.slot) * SLOT,
    end: (Math.max(a.slot, b.slot) + 1) * SLOT,
  };
}

function clearSelection() {
  $('grid').querySelectorAll('.drag-sel').forEach((el) => el.remove());
}
function drawSelection() {
  clearSelection();
  const { days, start, end } = dragRange(drag);
  const cols = $('grid').querySelectorAll('.g-day');
  days.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'drag-sel';
    el.style.top = (start / DAY_MIN) * 100 + '%';
    el.style.height = ((end - start) / DAY_MIN) * 100 + '%';
    if (i === 0) el.textContent = `${toHM(start)}–${timeValue(end)}`;
    cols[d].appendChild(el);
  });
}

const gridEl = $('grid');
gridEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.block') || !e.target.closest('.g-day')) return;
  e.preventDefault();
  if (!e.shiftKey) clearPicked();
  const rects = [...gridEl.querySelectorAll('.g-day')].map((c) => c.getBoundingClientRect());
  const cell = cellAt(e, rects);
  drag = { rects, a: cell, b: cell, moved: false };
  gridEl.setPointerCapture(e.pointerId);
  drawSelection();
});
gridEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const cell = cellAt(e, drag.rects);
  if (cell.day === drag.b.day && cell.slot === drag.b.slot) return;
  drag.b = cell;
  drag.moved = true;
  drawSelection();
});
gridEl.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  const range = dragRange(d);
  const single = !d.moved || (d.a.day === d.b.day && d.a.slot === d.b.slot);
  // 그냥 클릭하면 1시간, 드래그하면 드래그한 만큼
  const end = single ? range.start + 60 : range.end;
  quickAdd(range.days, range.start, end).finally(clearSelection);
});
gridEl.addEventListener('pointercancel', () => { drag = null; clearSelection(); });

// 일정 좌클릭 → 선택 (Shift를 누르고 클릭하면 여러 개 선택/해제)
gridEl.addEventListener('click', (e) => {
  const block = e.target.closest('.block');
  if (!block) return;
  const id = block.dataset.id;
  if (e.shiftKey) {
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
  } else {
    picked = new Set([id]);
  }
  showPicked();
});

// 일정 우클릭 → 수정/삭제 메뉴
gridEl.addEventListener('contextmenu', (e) => {
  const block = e.target.closest('.block');
  if (!block) return;
  e.preventDefault();
  const id = block.dataset.id;
  if (!picked.has(id)) { picked = new Set([id]); showPicked(); }
  if (picked.size > 1) onPicked();
  else onBlock(id);
});

gridEl.addEventListener('keydown', (e) => {
  const el = e.target.closest('.block');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onBlock(el.dataset.id); }
});

// 선택한 일정: Delete/Backspace로 삭제, Esc로 선택 해제
document.addEventListener('keydown', (e) => {
  if (!picked.size || !$('modal').classList.contains('hidden')) return;
  if (e.target.matches?.('input, textarea') || e.target.isContentEditable) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deletePlans([...picked]); }
  if (e.key === 'Escape') clearPicked();
});

// 계획표 바깥을 누르면 선택 해제
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#grid') && !e.target.closest('#modal')) clearPicked();
});

$('clear-all').addEventListener('click', async () => {
  if (!plans.length) return toast('삭제할 일정이 없어요.');
  const ok = await showModal({
    title: '모든 일정을 삭제할까요?',
    body: `<p>${plans.length}개의 일정이 모두 지워져요. 지운 뒤에도 ⌘Z로 되돌릴 수 있어요.</p>`,
    buttons: [
      { label: '취소', value: false },
      { label: '전체 삭제', value: true, style: 'danger' },
    ],
  });
  if (!ok) return;
  remember();
  plans = [];
  resetForm();
  saveData();
  render();
  toast('모두 삭제했어요.');
});

// ===== 이미지 / PDF 저장 (A4 가로) =====
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const EXPORT_W = 1684; // A4 가로 비율(297:210) 기준 크기
const EXPORT_H = 1191;

// 저장할 페이지: 1) 주간 계획 2) 할 일 3~) 만다라트
function exportPages() {
  return [
    { el: $('sheet'), name: '주간계획' },
    { el: $('todo-sheet'), name: '할일' },
    ...mandals.map((m, i) => ({ el: $('mandal-' + m.id), name: '만다라트' + (mandals.length > 1 ? i + 1 : '') })),
  ];
}
function updatePageCount() {
  const n = 2 + mandals.length;
  $('save-png').textContent = `이미지 저장 (${n}장)`;
  $('save-pdf').textContent = `PDF 저장 (${n}쪽)`;
}

async function captureSheet(el) {
  if (!window.html2canvas) throw new Error('html2canvas 없음');
  if (document.fonts?.ready) await document.fonts.ready; // 글꼴이 다 불러와진 뒤에 캡처
  return html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    width: EXPORT_W,
    height: EXPORT_H,
    windowWidth: EXPORT_W + 200,
    windowHeight: EXPORT_H + 200,
    onclone: (doc) => {
      doc.querySelectorAll('.block.selected').forEach((b) => b.classList.remove('selected')); // 선택 표시는 빼고 저장
      const sheet = doc.getElementById(el.id);
      sheet.classList.add('exporting');
      Object.assign(sheet.style, { width: EXPORT_W + 'px', height: EXPORT_H + 'px', border: '0', borderRadius: '0' });
      const wrap = sheet.closest('.sheet-wrap');
      if (wrap) wrap.style.overflow = 'visible';
      const input = doc.getElementById('month'); // 입력칸은 글자로 바꿔서 깔끔하게 저장
      if (input && sheet.contains(input)) {
        const span = doc.createElement('span');
        span.className = 'month-value';
        span.textContent = monthIn.value || monthIn.placeholder;
        span.style.width = 'auto';
        input.replaceWith(span);
      }
    },
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const toBlob = (canvas) => new Promise((r) => canvas.toBlob(r));

$('save-png').addEventListener('click', async () => {
  try {
    const pages = exportPages();
    for (const [i, pg] of pages.entries()) {
      const canvas = await captureSheet(pg.el);
      download(await toBlob(canvas), `myplan-${i + 1}-${pg.name}.png`);
      await wait(300); // 여러 파일을 연달아 받을 때 브라우저가 놓치지 않게
    }
    toast(`이미지 ${pages.length}장을 저장했어요.`);
  } catch {
    toast('이미지 저장에 실패했어요. 인터넷 연결을 확인해주세요.');
  }
});

$('save-pdf').addEventListener('click', async () => {
  try {
    if (!window.jspdf) throw new Error('jsPDF 없음');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pages = exportPages();
    for (const [i, pg] of pages.entries()) {
      const canvas = await captureSheet(pg.el);
      if (i > 0) pdf.addPage('a4', 'landscape');
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210); // A4 가로 한 장에 꽉 차게
    }
    pdf.save('myplan.pdf');
    toast(`PDF ${pages.length}쪽을 저장했어요.`);
  } catch {
    toast('PDF 저장에 실패했어요. 인터넷 연결을 확인해주세요.');
  }
});

// ===== 백업 / 불러오기 =====
$('backup').addEventListener('click', () => {
  const data = JSON.stringify({ version: 2, month, plans, colors: colorMap, todos, mandals }, null, 2);
  download(new Blob([data], { type: 'application/json' }), 'myplan-backup.json');
  toast('백업 파일을 저장했어요.');
});

$('restore').addEventListener('click', () => $('restore-file').click());

$('restore-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    let data, m = '', colors = {}, tds = [], mds = [];
    if (Array.isArray(raw)) {                 // 예전 버전 백업
      if (!raw.every((p) => isValidPlan({ ...p, day: (p.day + 1) % 7, groupId: null }))) throw new Error();
      data = migrateV1(raw);
    } else if (raw && Array.isArray(raw.plans) && raw.plans.every(isValidPlan)) {
      data = raw.plans;
      m = typeof raw.month === 'string' ? raw.month.replace(/\D/g, '').slice(0, 2) : '';
      if (raw.colors && typeof raw.colors === 'object') colors = raw.colors;
      if (Array.isArray(raw.todos)) tds = raw.todos.filter(isValidTodo);
      if (Array.isArray(raw.mandals)) mds = raw.mandals.filter(isValidMandal);
    } else {
      throw new Error('형식 오류');
    }

    const ok = await showModal({
      title: '백업 파일을 불러올까요?',
      body: `<p>일정 ${data.length}개, 할 일 ${tds.length}개, 만다라트 ${mds.length}개를 불러와요. 지금 있는 내용은 모두 바뀌어요.</p>`,
      buttons: [
        { label: '취소', value: false },
        { label: '불러오기', value: true, style: 'primary' },
      ],
    });
    if (!ok) return;
    remember();
    plans = data;
    month = m;
    colorMap = colors;
    todos = tds;
    mandals = mds;
    monthIn.value = m;
    fitMonth();
    resetForm();
    saveData();
    render();
    renderTodos();
    renderMandals();
    toast('불러왔어요.');
  } catch {
    toast('올바른 백업 파일이 아니에요.');
  }
});

// ===== 할 일 목록 (저장할 때 2번째 장) =====
const TODO_ROWS = 16; // 기본: 2줄 × 16칸 (빈 칸은 손으로 적을 수 있게 줄만 그려둠)

function renderTodos() {
  const list = $('todo-list');
  const dense = todos.length > TODO_ROWS * 2;   // 많아지면 3줄로
  const cols = dense ? 3 : 2;
  const rows = dense ? Math.max(20, Math.ceil(todos.length / 3)) : TODO_ROWS;
  list.classList.toggle('dense', dense);
  list.style.setProperty('--cols', cols);
  list.style.setProperty('--rows', rows);

  let html = todos.map((t) =>
    `<div class="todo-item${t.done ? ' done' : ''}" data-id="${t.id}">` +
      `<button type="button" class="todo-check" aria-label="${t.done ? '완료 취소' : '완료'}" aria-pressed="${t.done}"></button>` +
      `<span class="todo-text" title="눌러서 고치기">${escapeHtml(t.text)}</span>` +
      `<button type="button" class="todo-del" aria-label="삭제" title="삭제">×</button>` +
    `</div>`
  ).join('');
  for (let i = todos.length; i < cols * rows; i++) {
    html += '<div class="todo-item blank"><span class="todo-check"></span><span class="todo-text"></span></div>';
  }
  list.innerHTML = html;

  const done = todos.filter((t) => t.done).length;
  $('todo-progress').innerHTML = todos.length ? `<b>${done}</b> / ${todos.length} 완료` : '';
}

$('todo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('todo-input');
  const text = input.value.trim();
  if (!text) return;
  remember();
  todos.push({ id: newId(), text, done: false });
  input.value = '';
  saveData();
  renderTodos();
});

function editTodo(item) {
  const t = todos.find((x) => x.id === item.dataset.id);
  const span = item.querySelector('.todo-text');
  const input = document.createElement('input');
  input.className = 'todo-edit';
  input.value = t.text;
  input.maxLength = 60;
  span.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const text = input.value.trim();
    if (save && text !== t.text) {
      remember();
      if (text) t.text = text;
      else todos = todos.filter((x) => x !== t); // 다 지우면 삭제
      saveData();
    }
    renderTodos();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

$('todo-list').addEventListener('click', (e) => {
  const item = e.target.closest('.todo-item');
  if (!item) return;
  if (item.classList.contains('blank')) return $('todo-input').focus();
  const t = todos.find((x) => x.id === item.dataset.id);
  if (!t) return;
  if (e.target.closest('.todo-check')) {
    remember();
    t.done = !t.done;
    saveData();
    renderTodos();
  } else if (e.target.closest('.todo-del')) {
    remember();
    todos = todos.filter((x) => x !== t);
    saveData();
    renderTodos();
    toast('삭제했어요. ⌘Z로 되돌릴 수 있어요.');
  } else if (e.target.closest('.todo-text')) {
    editTodo(item);
  }
});

// ===== 만다라트 (저장할 때 3번째 장부터) =====
// 9칸짜리 블록 9개. 가운데 블록(4번)의 가운데 칸이 핵심 목표, 그 주변 8칸이 세부 목표.
// 세부 목표는 바깥 블록의 가운데 칸에도 똑같이 나타나요(둘 중 어디서 고쳐도 같이 바뀜).
const SUB_COLORS = [0, 1, 2, 3, 4, 5, 7, 8].map((i) => COLORS[i]); // 세부 목표 8개 색

function cellKey(b, c) {
  // 바깥 블록의 가운데 칸은 가운데 블록의 세부 목표 칸과 같은 값
  return b !== 4 && c === 4 ? [4, b] : [b, c];
}
function cellHTML(m, b, c) {
  const [kb, kc] = cellKey(b, c);
  const text = m.cells[kb][kc];
  const isMain = b === 4 && c === 4;
  const isSub = !isMain && (b === 4 || c === 4);
  const k = b === 4 ? c : b;                       // 몇 번째 세부 목표인지
  const color = isSub ? SUB_COLORS[k < 4 ? k : k - 1] : null;
  const size = text.length > 26 ? ' tiny' : text.length > 14 ? ' small' : '';
  const cls = 'm-cell' + (isMain ? ' main' : isSub ? ' sub' : '') + size;
  const style = color ? ` style="background:${color[0]};color:${color[1]}"` : '';
  const ph = isMain ? '핵심 목표' : isSub ? '세부 목표' : '';
  return `<div class="${cls}"${style} contenteditable="true" spellcheck="false" data-b="${b}" data-c="${c}" data-ph="${ph}">${escapeHtml(text)}</div>`;
}

function renderMandals() {
  const box = $('mandal-list');
  box.innerHTML = mandals.map((m, i) => {
    let grid = '';
    for (let b = 0; b < 9; b++) {
      grid += '<div class="m-block">';
      for (let c = 0; c < 9; c++) grid += cellHTML(m, b, c);
      grid += '</div>';
    }
    return (
      `<div class="mandal-wrap" data-id="${m.id}">` +
        `<div class="mandal-bar"><button type="button" class="btn danger js-del-mandal">이 만다라트 삭제</button></div>` +
        `<div class="sheet-wrap"><div class="sheet" id="mandal-${m.id}"><div class="sheet-inner">` +
          `<aside class="side">` +
            `<div class="month-big"><span class="month-value js-month"></span><span class="month-unit">월</span></div>` +
            `<h3 class="sheet-title">만다라트${mandals.length > 1 ? ' ' + (i + 1) : ''}</h3>` +
            `<p class="side-goal js-goal">${escapeHtml(m.cells[4][4])}</p>` +
          `</aside>` +
          `<div class="mandal">${grid}</div>` +
        `</div></div></div>` +
      `</div>`
    );
  }).join('');
  $('mandal-empty').classList.toggle('hidden', mandals.length > 0);
  fitMonth();
  updatePageCount();
}

$('add-mandal').addEventListener('click', () => {
  remember();
  mandals.push({ id: newId(), cells: Array.from({ length: 9 }, () => Array(9).fill('')) });
  saveData();
  renderMandals();
  const last = $('mandal-list').lastElementChild;
  last.scrollIntoView({ behavior: 'smooth', block: 'start' });
  last.querySelector('.m-cell.main').focus({ preventScroll: true });
  toast(`만다라트를 추가했어요. 이제 ${2 + mandals.length}장으로 저장돼요.`);
});

let mandalSaveTimer;
$('mandal-list').addEventListener('input', (e) => {
  const cell = e.target.closest('.m-cell');
  if (!cell) return;
  const wrap = cell.closest('.mandal-wrap');
  const m = mandals.find((x) => x.id === wrap.dataset.id);
  if (!m) return;
  if (!cell.textContent) cell.innerHTML = '';           // 다 지우면 안내 문구가 다시 보이게
  const text = cell.textContent.replace(/\s+/g, ' ');
  const b = +cell.dataset.b, c = +cell.dataset.c;
  const [kb, kc] = cellKey(b, c);
  m.cells[kb][kc] = text;

  // 세부 목표는 짝이 되는 칸도 같이 바꿈
  const twin = b === 4 && c !== 4 ? [c, 4] : b !== 4 && c === 4 ? [4, b] : null;
  if (twin) {
    const other = wrap.querySelector(`.m-cell[data-b="${twin[0]}"][data-c="${twin[1]}"]`);
    if (other) other.textContent = text;
  }
  if (b === 4 && c === 4) wrap.querySelector('.js-goal').textContent = text;
  [cell, twin && wrap.querySelector(`.m-cell[data-b="${twin[0]}"][data-c="${twin[1]}"]`)].forEach((el) => {
    if (!el) return;
    el.classList.toggle('small', text.length > 14 && text.length <= 26);
    el.classList.toggle('tiny', text.length > 26);
  });

  clearTimeout(mandalSaveTimer);
  mandalSaveTimer = setTimeout(saveData, 300);
});

// 칸 안에서 Enter → 다음 칸으로, 붙여넣기는 글자만
$('mandal-list').addEventListener('keydown', (e) => {
  const cell = e.target.closest('.m-cell');
  if (!cell || e.key !== 'Enter') return;
  e.preventDefault();
  const cells = [...cell.closest('.mandal').querySelectorAll('.m-cell')];
  const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
  next?.focus();
});
$('mandal-list').addEventListener('paste', (e) => {
  if (!e.target.closest('.m-cell')) return;
  e.preventDefault();
  const text = (e.clipboardData?.getData('text/plain') || '').replace(/\s+/g, ' ');
  document.execCommand('insertText', false, text);
});

$('mandal-list').addEventListener('click', (e) => {
  const del = e.target.closest('.js-del-mandal');
  if (!del) return;
  const id = del.closest('.mandal-wrap').dataset.id;
  remember();
  mandals = mandals.filter((m) => m.id !== id);
  saveData();
  renderMandals();
  toast('만다라트를 삭제했어요. ⌘Z로 되돌릴 수 있어요.');
});

// ===== 시작 =====
resetForm();
render();
renderTodos();
renderMandals();
