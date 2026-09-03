// disclaimer.js — Modal + consent flow for PDPO compliance
// Shows before first calculation; logs consent; can be re-opened from header

(function() {
  const CONSENT_KEY = '***';
  const DISCLAIMER_VERSION = '1';

  function getConsent() {
    try {
      const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      if (c && c.version === DISCLAIMER_VERSION) return c;
    } catch (e) {}
    return null;
  }

  function setConsent(consent) {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({
      ...consent,
      version: DISCLAIMER_VERSION,
      timestamp: new Date().toISOString()
    }));
  }

  function showDisclaimer() {
    return new Promise((resolve) => {
      // Build modal HTML
      const modal = document.createElement('div');
      modal.id = 'disclaimerModal';
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); z-index: 9999; display: flex;
        align-items: center; justify-content: center; padding: 1rem;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang HK", sans-serif;
      `;
      modal.innerHTML = `
        <div style="background: #131826; border: 1px solid #2a3450; border-radius: 12px;
                    max-width: 560px; width: 100%; padding: 2rem; max-height: 90vh;
                    overflow-y: auto; color: #e5e9f0;">
          <h2 style="color: #ffd700; margin-bottom: 1rem; font-size: 1.3rem;">⚠️ 重要聲明 + 私隱同意</h2>

          <div style="background: rgba(255,215,0,0.08); border-left: 3px solid #fbbf24;
                      padding: 1rem; border-radius: 4px; margin-bottom: 1.5rem;">
            <p><strong>本系統只供內部專業用途。</strong> 客戶健康資料屬敏感個資，必須遵守 PDPO 處理。</p>
          </div>

          <h3 style="color: #ffd700; margin-bottom: 0.5rem; font-size: 1rem;">系統用途</h3>
          <ul style="margin-bottom: 1rem; padding-left: 1.5rem; line-height: 1.6;">
            <li>協助保險經紀 <strong>初步比較</strong> 不同保險公司嘅核保決定</li>
            <li>根據公司公開嘅 underwriting guideline 推算</li>
            <li><strong>唔係最終決定</strong> — 保險公司有最終審批權</li>
          </ul>

          <h3 style="color: #ffd700; margin-bottom: 0.5rem; font-size: 1rem;">資料處理</h3>
          <ul style="margin-bottom: 1rem; padding-left: 1.5rem; line-height: 1.6;">
            <li>客戶資料<strong>只儲存喺你本機 browser</strong>（localStorage）</li>
            <li>計算過程 client-side，唔過 server</li>
            <li>唔會 send 客戶資料去第三方</li>
            <li>你可隨時喺設定清除所有記錄</li>
          </ul>

          <h3 style="color: #ffd700; margin-bottom: 0.5rem; font-size: 1rem;">經紀責任</h3>
          <ul style="margin-bottom: 1.5rem; padding-left: 1.5rem; line-height: 1.6;">
            <li>使用本系統前，必須先取得客戶<strong>書面同意</strong>處理其健康資料</li>
            <li>結果只供 <strong>同客戶分析</strong> 用，唔可以做為保險銷售嘅唯一依據</li>
            <li>實際申請仍須遞交完整文件俾保險公司</li>
          </ul>

          <label style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer;
                        background: rgba(52,211,153,0.1); padding: 0.75rem;
                        border-radius: 6px; margin-bottom: 1rem;">
            <input type="checkbox" id="disclaimerAgree" style="margin-top: 0.2rem; width: 18px; height: 18px;">
            <span style="font-size: 0.92rem;">
              我已閱讀並同意以上聲明。本人為持牌保險經紀，
              確認會遵守 PDPO 及內部 compliance 要求處理客戶資料。
            </span>
          </label>

          <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
            <button id="disclaimerDecline" style="background: transparent; border: 1px solid #6b7280;
                                                  color: #8b95a8; padding: 0.6rem 1.2rem;
                                                  border-radius: 6px; cursor: pointer;">
              唔同意，離開
            </button>
            <button id="disclaimerAccept" disabled style="background: #ffd700; color: #0a0e1a;
                                                         border: none; padding: 0.6rem 1.5rem;
                                                         border-radius: 6px; cursor: pointer;
                                                         font-weight: 600; opacity: 0.5;">
              ✅ 同意並開始使用
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const agreeBox = document.getElementById('disclaimerAgree');
      const acceptBtn = document.getElementById('disclaimerAccept');
      const declineBtn = document.getElementById('disclaimerDecline');

      agreeBox.addEventListener('change', () => {
        acceptBtn.disabled = !agreeBox.checked;
        acceptBtn.style.opacity = agreeBox.checked ? '1' : '0.5';
      });

      acceptBtn.addEventListener('click', () => {
        const consent = {
          broker_name: 'Alan老闆',  // TODO: from auth later
          agreed: true,
          ip: 'browser-local',
          ua: navigator.userAgent.substring(0, 100)
        };
        setConsent(consent);
        document.body.removeChild(modal);
        resolve(true);
      });

      declineBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        window.location.href = 'about:blank';
      });
    });
  }

  // Public API
  window.Disclaimer = {
    ensureConsent: async function() {
      const c = getConsent();
      if (c) return c;
      return await showDisclaimer();
    },
    hasConsent: function() { return !!getConsent(); },
    resetConsent: function() {
      localStorage.removeItem(CONSENT_KEY);
    },
    version: DISCLAIMER_VERSION
  };
})();