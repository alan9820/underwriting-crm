// app.js — UI wiring for 核保 CRM v1.5 (wizard + PDF export)
let rulesData = null;
let currentStep = 1;
const TOTAL_STEPS = 3;

// ─── Lifecycle ───
document.addEventListener('DOMContentLoaded', async () => {
  // Disclaimer first (PDPO)
  if (window.Disclaimer && typeof window.Disclaimer.ensureConsent === 'function') {
    try {
      await window.Disclaimer.ensureConsent();
      console.log('[app] disclaimer accepted');
    } catch (e) {
      console.error('[app] disclaimer error', e);
    }
  }

  // Load rules
  if (window.SUNLIFE_RULES) {
    rulesData = window.SUNLIFE_RULES;
    console.log('[app] SUNLIFE_RULES loaded from script bundle');
  } else {
    try {
      const resp = await fetch('../data/sunlife-rules.json');
      rulesData = await resp.json();
    } catch (e) {
      console.error('[app] failed to load rules', e);
      document.getElementById('conditionsContainer').innerHTML =
        '<p class="muted">❌ 規則載入失敗</p>';
      return;
    }
  }

  // Wire BMI auto-calc
  document.getElementById('height_cm').addEventListener('input', updateBMI);
  document.getElementById('weight_kg').addEventListener('input', updateBMI);
  updateBMI();

  // Render conditions for Step 2
  renderConditions();

  // Wizard nav
  document.getElementById('wizardPrev').addEventListener('click', wizardPrev);
  document.getElementById('wizardNext').addEventListener('click', wizardNext);
  document.getElementById('wizardCalc').addEventListener('click', wizardCalc);
  document.getElementById('wizardReset').addEventListener('click', wizardReset);

  // Result actions
  document.getElementById('exportBtn').addEventListener('click', exportResults);
  document.getElementById('printBtn').addEventListener('click', printReport);
  document.getElementById('historyBtn').addEventListener('click', toggleHistory);

  // Restore draft if exists
  restoreDraft();

  document.getElementById('clientForm')?.addEventListener('input', saveDraft);
  document.getElementById('conditionsContainer').addEventListener('change', saveDraft);

  // Show step 1 initially
  showStep(1);
});

// ─── BMI auto-calc ───
function updateBMI() {
  const h = parseFloat(document.getElementById('height_cm').value);
  const w = parseFloat(document.getElementById('weight_kg').value);
  const bmiEl = document.getElementById('bmi_display');
  if (h > 0 && w > 0) {
    bmiEl.value = (w / Math.pow(h / 100, 2)).toFixed(1);
  } else {
    bmiEl.value = '—';
  }
}

// ─── Wizard Navigation ───
function showStep(n) {
  currentStep = n;
  document.querySelectorAll('.step-pane').forEach(p => {
    p.style.display = parseInt(p.dataset.step) === n ? 'block' : 'none';
  });
  document.querySelectorAll('.step-indicator .step').forEach(s => {
    const sn = parseInt(s.dataset.step);
    s.classList.toggle('active', sn === n);
    s.classList.toggle('completed', sn < n);
  });
  document.getElementById('wizardPrev').style.display = n > 1 ? 'inline-block' : 'none';
  document.getElementById('wizardNext').style.display = n < TOTAL_STEPS ? 'inline-block' : 'none';
  document.getElementById('wizardCalc').style.display = n === TOTAL_STEPS ? 'inline-block' : 'none';

  // Scroll to top of wizard pane
  document.querySelector('.step-pane[data-step="' + n + '"]').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // If step 3, refresh review summary
  if (n === 3) updateReviewSummary();
}

function wizardNext() {
  if (currentStep === 1) {
    const profile = collectProfile();
    if (!profile.age) { alert('請填年齡'); return; }
  }
  if (currentStep < TOTAL_STEPS) showStep(currentStep + 1);
}

function wizardPrev() {
  if (currentStep > 1) showStep(currentStep - 1);
}

function wizardCalc() {
  onCalculate();
  document.getElementById('printBtn').style.display = 'inline-block';
}

function wizardReset() {
  if (!confirm('重設會清空表單同歷史記錄，確定？')) return;
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch (e) {}
  location.reload();
}

function updateReviewSummary() {
  const profile = collectProfile();
  const conditions = collectConditions();
  const r = document.getElementById('reviewSummary');
  const smokerLabel = profile.smoker === 'never' ? '非吸煙' : profile.smoker === 'former' ? '已戒' : '吸煙';
  r.innerHTML = `
    <strong>${profile.client_name || '未命名客戶'}</strong> ·
    ${profile.age}歲 ${profile.sex === 'M' ? '男' : '女'} ·
    BMI ${profile.bmi.toFixed(1)} ·
    ${smokerLabel} ·
    簽約額 $${(profile.sum_assured || 0).toLocaleString()}
    <br>
    <span style="color:var(--text-muted); font-size:0.88rem;">
      已選 ${conditions.length} 個病史：${conditions.map(c => c.code).join(', ') || '（無）'}
    </span>
  `;
}

// ─── Conditions rendering (same as v1) ───
function renderConditions() {
  const container = document.getElementById('conditionsContainer');
  container.innerHTML = '';
  if (!rulesData.conditions || rulesData.conditions.length === 0) {
    container.innerHTML = '<p class="muted">冇條件可選</p>';
    return;
  }
  const grouped = {};
  rulesData.conditions.forEach(cond => {
    if (!grouped[cond.category_zh]) grouped[cond.category_zh] = [];
    grouped[cond.category_zh].push(cond);
  });
  for (const [catZh, conds] of Object.entries(grouped)) {
    const catDiv = document.createElement('div');
    catDiv.className = 'category-group';
    catDiv.innerHTML = `<h3 style="color: var(--accent-dim); font-size: 0.95rem; margin: 1rem 0 0.5rem;">${catZh}</h3>`;
    conds.forEach(cond => catDiv.appendChild(createConditionBlock(cond)));
    container.appendChild(catDiv);
  }
}

function createConditionBlock(cond) {
  const block = document.createElement('div');
  block.className = 'condition-block';
  block.dataset.code = cond.code;
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'cond-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.code = cond.code;
  cb.addEventListener('change', () => {
    block.classList.toggle('active', cb.checked);
    saveDraft();
  });
  toggleLabel.appendChild(cb);
  toggleLabel.appendChild(document.createTextNode(`${cond.name_zh} (${cond.name_en})`));
  block.appendChild(toggleLabel);

  if (cond.questions && cond.questions.length) {
    const details = document.createElement('div');
    details.className = 'condition-details';
    cond.questions.forEach(q => {
      const lbl = document.createElement('label');
      lbl.innerHTML = `<span>${q.label_zh}</span>`;
      let input;
      if (q.type === 'select') {
        input = document.createElement('select');
        (q.options || []).forEach(opt => {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          input.appendChild(o);
        });
      } else if (q.type === 'number') {
        input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
      } else if (q.type === 'boolean') {
        input = document.createElement('select');
        ['否', '是'].forEach((o, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = o;
          input.appendChild(opt);
        });
      } else {
        input = document.createElement('input');
        input.type = 'text';
      }
      input.dataset.qid = q.id;
      input.addEventListener('change', saveDraft);
      lbl.appendChild(input);
      details.appendChild(lbl);
    });
    block.appendChild(details);
  }
  return block;
}

// ─── Collect profile / conditions ───
function collectProfile() {
  return {
    client_name: document.getElementById('clientName').value,
    age: parseInt(document.getElementById('age').value) || 0,
    sex: document.getElementById('sex').value,
    height_cm: parseFloat(document.getElementById('height_cm').value) || 0,
    weight_kg: parseFloat(document.getElementById('weight_kg').value) || 0,
    bmi: parseFloat(document.getElementById('bmi_display').value) || 0,
    smoker: document.getElementById('smoker').value,
    country: document.getElementById('country').value,
    sum_assured: parseInt(document.getElementById('sum_assured').value) || 0
  };
}

function collectConditions() {
  const result = [];
  document.querySelectorAll('.condition-block.active').forEach(block => {
    const code = block.dataset.code;
    const cond = rulesData.conditions.find(c => c.code === code);
    if (!cond) return;
    const input = { code };
    block.querySelectorAll('[data-qid]').forEach(el => {
      const qid = el.dataset.qid;
      let val = el.value;
      const qDef = cond.questions.find(q => q.id === qid);
      if (qDef) {
        if (qDef.type === 'number') val = parseFloat(val) || 0;
        else if (qDef.type === 'boolean') val = val === '1' || val === 'true';
      }
      input[qid] = val;
    });
    result.push(input);
  });
  return result;
}

// ─── Calculation ───
function onCalculate() {
  const profile = collectProfile();
  const conditions = collectConditions();
  try {
    if (!window.UnderwritingRule || typeof window.UnderwritingRule.evaluateForMultipleInsurers !== 'function') {
      throw new Error('Rule engine 未載入或舊版 cached — 請 hard-refresh (Ctrl+Shift+R)');
    }
    const insurers = [
      { name: 'Sun Life', rules_data: rulesData },
      { name: 'CTF Life', rules_data: ctfPlaceholderRules() }
    ];
    const results = window.UnderwritingRule.evaluateForMultipleInsurers(profile, conditions, insurers);
    displayResults(results, profile, conditions);
  } catch (err) {
    console.error('[app] calc failed', err);
    const tbody = document.querySelector('#resultsTable tbody');
    const summary = document.getElementById('resultsSummary');
    tbody.innerHTML = '';
    summary.innerHTML = `<p style="color:var(--red); padding:0.5rem;">❌ 計算錯誤：${err.message}</p>`;
  }
}

function ctfPlaceholderRules() {
  return { insurer: 'CTF Life', version: 'placeholder', conditions: [] };
}

function displayResults(results, profile, conditions) {
  const tbody = document.querySelector('#resultsTable tbody');
  const summary = document.getElementById('resultsSummary');
  tbody.innerHTML = '';
  document.getElementById('exportBtn').style.display = 'inline-block';

  window.__lastResults = { results, profile, conditions, timestamp: new Date().toISOString() };
  try { saveToHistory(window.__lastResults); } catch (e) {}

  const totalDecl = results.reduce((s, r) => s + r.declined_count, 0);
  const totalProducts = results.reduce((s, r) => s + r.total_products, 0);
  const hasRules = results.filter(r => r.has_rules);

  summary.innerHTML = `
    <p><strong>${profile.client_name || '客戶'}</strong> · ${profile.age}歲 ${profile.sex === 'M' ? '男' : '女'} · BMI ${profile.bmi.toFixed(1)} · ${profile.smoker === 'never' ? '非吸煙' : profile.smoker === 'former' ? '已戒' : '吸煙'}</p>
    <p>共 ${results.length} 間公司比較 · ${hasRules.length} 間有病史 rule · ${totalProducts} 個 product 評估 · 生成時間 ${new Date().toLocaleString('zh-HK')}</p>
  `;

  results.forEach(r => {
    const tr = document.createElement('tr');
    const declinedText = r.declined_count > 0
      ? `🔴 拒保：${r.declined_products.join(', ')}`
      : (r.postponed_count > 0
          ? `🟠 擱置：${r.postponed_products.join(', ')}`
          : '✅ 全線有 offer');
    tr.innerHTML = `
      <td><strong>${r.insurer}</strong></td>
      <td><span class="outcome-badge outcome-${r.best_outcome}">${r.best_outcome_label}</span></td>
      <td>${r.best_product_label}</td>
      <td>
        <span class="confidence-bar"><span class="confidence-fill" style="width:${r.best_confidence_pct}%"></span></span>
        ${r.best_confidence_pct}%
      </td>
      <td>${r.loading_pct ? '+' + r.loading_pct + '%' : '—'}</td>
      <td>${r.loading_multiplier > 1 ? '×' + r.loading_multiplier : '—'}</td>
      <td>${declinedText}</td>
    `;
    tbody.appendChild(tr);
  });

  // Refresh review summary at top
  updateReviewSummary();
}

// ─── Print / PDF ───
function printReport() {
  // Set CSS variable for print date header
  const dateStr = new Date().toLocaleDateString('zh-HK');
  document.documentElement.style.setProperty('--report-date', `"${dateStr}"`);
  // Wait a frame for CSS variable to take effect
  setTimeout(() => {
    window.print();
  }, 100);
}

// ─── LocalStorage persistence ───
const HISTORY_KEY = '***';
const DRAFT_KEY = '***';

function saveDraft() {
  try {
    const data = { profile: collectProfile(), conditions: collectConditions() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch (e) {}
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !data.profile) return;
    const p = data.profile;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    setVal('clientName', p.client_name);
    setVal('age', p.age);
    setVal('sex', p.sex);
    setVal('height_cm', p.height_cm);
    setVal('weight_kg', p.weight_kg);
    setVal('smoker', p.smoker);
    setVal('country', p.country);
    setVal('sum_assured', p.sum_assured);
    updateBMI();
    (data.conditions || []).forEach(c => {
      const block = document.querySelector(`.condition-block[data-code="${c.code}"]`);
      if (block) {
        block.classList.add('active');
        const cb = block.querySelector('input[type=checkbox]');
        if (cb) cb.checked = true;
        block.querySelectorAll('[data-qid]').forEach(el => {
          if (c[el.dataset.qid] !== undefined) el.value = c[el.dataset.qid];
        });
      }
    });
    console.log('[app] restored draft from localStorage');
  } catch (e) {}
}

function saveToHistory(result) {
  try {
    const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    hist.unshift(result);
    if (hist.length > 10) hist.length = 10;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch (e) {}
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch (e) { return []; }
}

function toggleHistory() {
  const panel = document.getElementById('historyPanel');
  if (!panel) return;
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    return;
  }
  const hist = loadHistory();
  if (hist.length === 0) {
    panel.innerHTML = '<h3>📂 歷史記錄</h3><p class="muted">未有記錄</p>';
  } else {
    panel.innerHTML = '<h3>📂 歷史記錄（最近 10 個）</h3>' + hist.map((h, i) => `
      <div class="history-item" data-idx="${i}">
        <div class="h-name">${(h.profile && h.profile.client_name) || '未命名'} · ${h.profile ? h.profile.age : '?'}歲 ${h.profile && h.profile.sex === 'M' ? '男' : '女'}</div>
        <div class="h-meta">${new Date(h.timestamp).toLocaleString('zh-HK')}</div>
        <div class="h-outcome">${(h.conditions || []).map(c => c.code).join(', ') || '無病史'}</div>
      </div>
    `).join('');
    panel.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx);
        const h = hist[idx];
        if (!h) return;
        window.__lastResults = h;
        showStep(3);
        displayResults(h.results, h.profile, h.conditions);
        panel.classList.remove('open');
      });
    });
  }
  panel.classList.add('open');
}

function exportResults() {
  if (!window.__lastResults) return;
  const text = JSON.stringify(window.__lastResults, null, 2);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('exportBtn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✅ 已複製！';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }
    }).catch(() => alert('複製失敗 — JSON:\n' + text));
  } else {
    alert('複製 JSON:\n' + text);
  }
}