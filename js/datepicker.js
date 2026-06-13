// ============================================================
// datepicker.js — Custom Date & Time Picker
// ============================================================

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function _pad(n) { return String(n).padStart(2, '0'); }

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;
}

function _dateStr(d) {
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;
}

/** Format YYYY-MM-DD → "6/8（月）" for display in trigger buttons */
export function formatPickerDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const dow = DOW[d.getDay()];
  return `${d.getMonth()+1}/${d.getDate()}（${dow}）`;
}

// ---- Overlay management ----

function _getOverlay() {
  let el = document.getElementById('dp-picker-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dp-picker-overlay';
    el.className = 'dp-picker-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = '';
  el.classList.remove('hidden');
  return el;
}

function _close() {
  const el = document.getElementById('dp-picker-overlay');
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}

// ---- Date Picker ----

export function openDatePicker({ value, onConfirm, onClear }) {
  const overlay = _getOverlay();
  const now = new Date();

  let selectedStr = value || null;
  let viewYear  = value ? parseInt(value.slice(0, 4)) : now.getFullYear();
  let viewMonth = value ? parseInt(value.slice(5, 7)) - 1 : now.getMonth();

  const todayStr    = _dateStr(now);
  const tomorrowD   = new Date(now); tomorrowD.setDate(now.getDate() + 1);
  const nextWeekD   = new Date(now); nextWeekD.setDate(now.getDate() + 7);
  const tomorrowStr = _dateStr(tomorrowD);
  const nextWeekStr = _dateStr(nextWeekD);

  const popup = document.createElement('div');
  popup.className = 'dp-popup';

  const render = () => {
    const firstDow    = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += `<span class="dp-cell"></span>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${viewYear}-${_pad(viewMonth+1)}-${_pad(d)}`;
      let cls = 'dp-cell dp-day';
      if (dStr === todayStr)    cls += ' dp-today';
      if (dStr === selectedStr) cls += ' dp-selected';
      cells += `<button class="${cls}" data-date="${dStr}">${d}</button>`;
    }

    popup.innerHTML = `
      <div class="dp-header-bar">
        <span class="dp-title">日付を選択</span>
        <button class="dp-x">✕</button>
      </div>
      <div class="dp-shortcuts">
        <button class="dp-sc${selectedStr===todayStr?' dp-sc--on':''}" data-date="${todayStr}">今日</button>
        <button class="dp-sc${selectedStr===tomorrowStr?' dp-sc--on':''}" data-date="${tomorrowStr}">明日</button>
        <button class="dp-sc${selectedStr===nextWeekStr?' dp-sc--on':''}" data-date="${nextWeekStr}">来週</button>
        ${selectedStr ? `<button class="dp-sc dp-sc--clear">クリア</button>` : ''}
      </div>
      <div class="dp-month-nav">
        <button class="dp-nav-arrow dp-prev">‹</button>
        <span class="dp-month-label">${viewYear}年${viewMonth+1}月</span>
        <button class="dp-nav-arrow dp-next">›</button>
      </div>
      <div class="dp-grid">
        ${DOW.map(d => `<span class="dp-dow">${d}</span>`).join('')}
        ${cells}
      </div>
    `;

    // Nav
    popup.querySelector('.dp-prev').onclick = () => {
      viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    };
    popup.querySelector('.dp-next').onclick = () => {
      viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    };

    // Day select → confirm immediately
    popup.querySelectorAll('.dp-day').forEach(btn => {
      btn.onclick = () => { onConfirm(btn.dataset.date); _close(); };
    });

    // Shortcuts
    popup.querySelectorAll('.dp-sc:not(.dp-sc--clear)').forEach(btn => {
      btn.onclick = () => { onConfirm(btn.dataset.date); _close(); };
    });
    popup.querySelector('.dp-sc--clear')?.addEventListener('click', () => {
      onClear?.(); _close();
    });

    popup.querySelector('.dp-x').onclick = _close;
  };

  overlay.onclick = e => { if (e.target === overlay) _close(); };
  overlay.appendChild(popup);
  render();
}

// ---- Time Picker ----

export function openTimePicker({ value, onConfirm, onClear }) {
  const overlay = _getOverlay();
  const now = new Date();

  let selH = value ? parseInt(value.split(':')[0]) : now.getHours();
  let selM = value
    ? Math.round(parseInt(value.split(':')[1]) / 5) * 5
    : Math.ceil(now.getMinutes() / 5) * 5;
  if (selM >= 60) { selM = 0; selH = Math.min(selH + 1, 23); }

  const HOURS   = Array.from({ length: 24 }, (_, i) => i);
  const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

  const popup = document.createElement('div');
  popup.className = 'dp-popup tp-popup';

  const render = () => {
    popup.innerHTML = `
      <div class="dp-header-bar">
        <span class="dp-title">時刻を選択</span>
        <button class="dp-x">✕</button>
      </div>
      <div class="tp-display">${_pad(selH)}:${_pad(selM)}</div>
      <div class="tp-cols">
        <div class="tp-col">
          <div class="tp-col-hd">時</div>
          <div class="tp-scroll" id="tp-h">
            ${HOURS.map(h => `<button class="tp-item${h===selH?' tp-sel':''}" data-h="${h}">${_pad(h)}</button>`).join('')}
          </div>
        </div>
        <div class="tp-colon">:</div>
        <div class="tp-col">
          <div class="tp-col-hd">分</div>
          <div class="tp-scroll" id="tp-m">
            ${MINUTES.map(m => `<button class="tp-item${m===selM?' tp-sel':''}" data-m="${m}">${_pad(m)}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="dp-footer">
        ${value ? `<button class="dp-sc dp-sc--clear">クリア</button>` : '<span></span>'}
        <button class="dp-confirm-btn">決定</button>
      </div>
    `;

    // Scroll selected into view
    requestAnimationFrame(() => {
      popup.querySelectorAll('.tp-sel').forEach(el =>
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
    });

    popup.querySelector('.dp-x').onclick = _close;
    popup.querySelector('.dp-sc--clear')?.addEventListener('click', () => { onClear?.(); _close(); });
    popup.querySelector('.dp-confirm-btn').onclick = () => {
      onConfirm(`${_pad(selH)}:${_pad(selM)}`); _close();
    };

    popup.querySelectorAll('[data-h]').forEach(btn => {
      btn.onclick = () => { selH = +btn.dataset.h; render(); };
    });
    popup.querySelectorAll('[data-m]').forEach(btn => {
      btn.onclick = () => { selM = +btn.dataset.m; render(); };
    });
  };

  overlay.onclick = e => { if (e.target === overlay) _close(); };
  overlay.appendChild(popup);
  render();
}
