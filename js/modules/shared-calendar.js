import {
  acceptSharedInvite,
  collectSharedCalendarEvents,
  createSharedGroup,
  createSharedInvite,
  loadSharedGroups,
} from '../shared-calendar.js';
import { getCategories, getCategoryColor, updateEvent } from '../storage.js';
import { esc, formatDate, formatTime, getEventsForDate, today, toDateStr } from '../utils.js';

const toast = (msg, type) => window.AppNav?.showToast(msg, type);
const openModal = (opts) => window.AppNav?.openModal(opts);

let state = {
  container: null,
  cursor: new Date(),
  groupId: '',
  groups: [],
  events: [],
  userId: null,
  loading: false,
  error: null,
};

export function initSharedCalendar(container) {
  state.container = container;
  state.loading = true;
  render();
  handleInviteFromUrl()
    .then(refresh)
    .catch(err => {
      state.error = err?.message || '共有カレンダーを読み込めませんでした';
      state.loading = false;
      render();
    });

  return () => {
    if (state.container === container) state.container = null;
  };
}

async function handleInviteFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('shareInvite');
  if (!token) return;
  await acceptSharedInvite(token);
  url.searchParams.delete('shareInvite');
  window.history.replaceState({}, document.title, `${url.origin}${url.pathname}#shared-calendar`);
  toast('共有カレンダーに参加しました', 'success');
}

async function refresh() {
  state.loading = true;
  render();
  const result = await collectSharedCalendarEvents(state.groupId);
  state.groups = result.groups || [];
  state.events = result.events || [];
  state.userId = result.userId || null;
  state.error = result.error?.message || null;
  state.loading = false;
  render();
}

function moveMonth(delta) {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
  render();
}

function render() {
  const container = state.container;
  if (!container) return;

  container.innerHTML = `
    <section class="shared-cal-page">
      <div class="shared-cal-head">
        <div>
          <p class="shared-cal-kicker">PERSONAL SOURCE / SHARED VIEW</p>
          <h2>共有カレンダー</h2>
          <p>個人予定を保存元にしたまま、共有対象だけを合成表示します。</p>
        </div>
        <button class="btn btn-primary btn-sm" id="shared-manage-btn">共有グループ</button>
      </div>

      <div class="shared-cal-controls">
        <button class="cal-nav-arrow" id="shared-prev" aria-label="前へ">&#8249;</button>
        <button class="cal-title" id="shared-today">${formatDate(state.cursor, 'month')}</button>
        <button class="cal-nav-arrow" id="shared-next" aria-label="次へ">&#8250;</button>
        <select class="select" id="shared-group-filter">
          <option value="">すべての共有グループ</option>
          ${state.groups.map(group => `<option value="${esc(group.id)}" ${state.groupId === group.id ? 'selected' : ''}>${esc(group.name || '共有グループ')}</option>`).join('')}
        </select>
      </div>

      ${state.error ? `<div class="card shared-cal-error">共有データを読み込めませんでした。Supabaseに共有カレンダー用SQLを適用すると使えます。<br>${esc(state.error)}</div>` : ''}
      ${state.loading ? '<div class="empty-state"><div class="loader-ring"></div><p class="empty-state-text">読み込み中...</p></div>' : renderMonth()}
    </section>
  `;

  container.querySelector('#shared-prev')?.addEventListener('click', () => moveMonth(-1));
  container.querySelector('#shared-next')?.addEventListener('click', () => moveMonth(1));
  container.querySelector('#shared-today')?.addEventListener('click', () => {
    state.cursor = new Date();
    render();
  });
  container.querySelector('#shared-group-filter')?.addEventListener('change', async e => {
    state.groupId = e.target.value;
    await refresh();
  });
  container.querySelector('#shared-manage-btn')?.addEventListener('click', openGroupManager);
  container.querySelectorAll('[data-shared-event-id]').forEach(btn => {
    btn.addEventListener('click', () => openSharedEvent(btn.dataset.sharedEventId));
  });
}

function renderMonth() {
  if (!state.groups.length) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">◎</div>
        <p class="empty-state-text">共有グループがまだありません</p>
        <p class="empty-state-sub">「共有グループ」から作成して、友人に招待リンクを渡せます。</p>
      </div>
    `;
  }

  const start = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - start.getDay());
  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const todayStr = today();

  let html = `
    <div class="shared-cal-grid-wrap">
      <div class="cal-day-headers">${dayLabels.map(d => `<div class="cal-day-header">${d}</div>`).join('')}</div>
      <div class="cal-grid shared-cal-grid">
  `;
  let d = new Date(gridStart);
  for (let i = 0; i < 42; i += 1) {
    const ds = toDateStr(d);
    const isOther = d.getMonth() !== state.cursor.getMonth();
    const events = getEventsForDate(state.events, ds).slice(0, 4);
    html += `
      <div class="cal-cell${isOther ? ' other-month' : ''}${ds === todayStr ? ' today' : ''}">
        <div class="cal-cell-num">${d.getDate()}</div>
        ${events.map(ev => renderChip(ev)).join('')}
      </div>
    `;
    d.setDate(d.getDate() + 1);
  }
  html += '</div></div>';
  return html;
}

function renderChip(event) {
  const color = event.isOwn ? getCategoryColor(event.categoryId) : 'var(--primary)';
  const label = event.isOwn ? '自分' : (event.shareVisibility === 'shared_busy' ? '予定あり' : '共有');
  return `
    <button class="shared-event-chip${event.isOwn ? ' own' : ''}" data-shared-event-id="${esc(event.id)}" style="--event-color:${color}">
      <span>${esc(formatTime(event.start))}</span>
      <strong>${esc(event.visibleTitle || event.title || '予定')}</strong>
      <em>${label}</em>
    </button>
  `;
}

function openSharedEvent(eventId) {
  const event = state.events.find(ev => ev.id === eventId);
  if (!event) return;
  const cats = getCategories();
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="shared-event-detail">
      <p class="shared-cal-kicker">${event.isOwn ? 'YOUR EVENT' : 'READ ONLY'}</p>
      <h3>${esc(event.visibleTitle || event.title || '予定')}</h3>
      <p>${esc(formatDate(new Date(event.start), 'medium'))} ${esc(formatTime(event.start))}${event.end ? ` - ${esc(formatTime(event.end))}` : ''}</p>
      ${event.visibleMemo ? `<p class="shared-event-memo">${esc(event.visibleMemo)}</p>` : ''}
      <p class="form-help">${event.isOwn ? '共有画面からでも、自分の予定だけ編集できます。' : '他のメンバーの予定は閲覧のみです。'}</p>
    </div>
  `;

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;width:100%';
  if (event.isOwn) {
    const edit = document.createElement('button');
    edit.className = 'btn btn-primary btn-sm';
    edit.textContent = '自分の予定を編集';
    edit.onclick = () => {
      close();
      openQuickEdit(event, cats);
    };
    footer.appendChild(edit);
  }
  const close = openModal({ title: '共有予定', body, footer });
}

function openQuickEdit(event, cats) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">タイトル</label>
      <input class="input" id="shared-edit-title" value="${esc(event.title || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">カテゴリ</label>
      <select class="select" id="shared-edit-category">
        ${cats.map(cat => `<option value="${esc(cat.id)}" ${event.categoryId === cat.id ? 'selected' : ''}>${esc(cat.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">共有範囲</label>
      <select class="select" id="shared-edit-visibility">
        <option value="private" ${event.shareVisibility === 'private' ? 'selected' : ''}>共有しない</option>
        <option value="shared_busy" ${event.shareVisibility === 'shared_busy' ? 'selected' : ''}>時間だけ共有</option>
        <option value="shared_detail" ${event.shareVisibility === 'shared_detail' ? 'selected' : ''}>詳細も共有</option>
      </select>
    </div>
  `;
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;width:100%';
  const save = document.createElement('button');
  save.className = 'btn btn-primary btn-sm';
  save.textContent = '保存';
  footer.appendChild(save);
  const close = openModal({ title: '自分の予定を編集', body, footer });
  save.onclick = async () => {
    const title = body.querySelector('#shared-edit-title')?.value.trim();
    if (!title) return;
    updateEvent(event.id, {
      title,
      categoryId: body.querySelector('#shared-edit-category')?.value || event.categoryId,
      shareVisibility: body.querySelector('#shared-edit-visibility')?.value || 'private',
    });
    close();
    toast('予定を更新しました', 'success');
    await refresh();
  };
}

async function openGroupManager() {
  await loadSharedGroups().then(groups => { state.groups = groups; }).catch(() => {});
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="shared-group-manager">
      <section class="shared-manager-card">
        <div class="shared-manager-card-head">
          <span class="shared-manager-step">1</span>
          <div>
            <h3>共有グループを作る</h3>
            <p>友人や家族など、一緒に予定を見たい相手ごとにグループを作ります。</p>
          </div>
        </div>
        <label class="form-label" for="shared-new-name">グループ名</label>
        <div class="shared-inline shared-inline--wide">
          <input class="input" id="shared-new-name" placeholder="例: 友人カレンダー / 家族予定 / 部活メンバー">
          <button class="btn btn-primary" id="shared-create-group">作成</button>
        </div>
      </section>

      <section class="shared-manager-card">
        <div class="shared-manager-card-head">
          <span class="shared-manager-step">2</span>
          <div>
            <h3>招待リンクを作る</h3>
            <p>相手に送るリンクです。相手がログインしてリンクを開くと、この共有グループに参加できます。</p>
          </div>
        </div>
        <div class="shared-manager-grid">
          <div class="form-group">
            <label class="form-label" for="shared-invite-group">招待先のグループ</label>
            <select class="select" id="shared-invite-group">
              ${state.groups.map(group => `<option value="${esc(group.id)}">${esc(group.name || '共有グループ')}</option>`).join('')}
            </select>
            <p class="form-help">どの共有カレンダーに招待するかを選びます。</p>
          </div>
          <div class="form-group">
            <label class="form-label" for="shared-invite-email">相手のメール（任意）</label>
            <input class="input" id="shared-invite-email" placeholder="例: friend@example.com">
            <p class="form-help">空欄ならリンクを知っているログイン済みユーザーが使えます。メールを書くと、そのメールのアカウントだけが参加できます。</p>
          </div>
        </div>
        <button class="btn btn-ghost btn-full" id="shared-create-invite" ${state.groups.length ? '' : 'disabled'}>招待リンクを作成</button>
        <textarea class="input shared-invite-output" id="shared-invite-output" readonly placeholder="作成した招待リンクがここに表示されます。コピーしてLINEやメールで送ってください。"></textarea>
        <p class="form-help">招待リンクは7日で期限切れになり、1回使われると再利用できません。</p>
      </section>

      <section class="shared-manager-card shared-manager-card--compact">
        <div class="shared-manager-card-head">
          <span class="shared-manager-step">3</span>
          <div>
            <h3>いま参加している共有グループ</h3>
            <p>ここに表示されるグループだけが共有カレンダーに反映されます。</p>
          </div>
        </div>
        <div class="shared-group-list">
          ${state.groups.length ? state.groups.map(group => `<div class="shared-group-row"><strong>${esc(group.name || '共有グループ')}</strong><span>${esc(group.role || 'member')}</span></div>`).join('') : '<p class="form-help">まだグループがありません。まず上でグループを作成してください。</p>'}
        </div>
      </section>
    </div>
  `;
  const close = openModal({ title: '共有グループ', body, footer: null, wide: true });

  body.querySelector('#shared-create-group')?.addEventListener('click', async () => {
    const name = body.querySelector('#shared-new-name')?.value.trim();
    if (!name) return;
    try {
      await createSharedGroup(name);
      toast('共有グループを作成しました', 'success');
      close();
      await refresh();
      openGroupManager();
    } catch (e) {
      toast(e.message || '作成できませんでした', 'error');
    }
  });

  body.querySelector('#shared-create-invite')?.addEventListener('click', async () => {
    const groupId = body.querySelector('#shared-invite-group')?.value;
    const email = body.querySelector('#shared-invite-email')?.value || '';
    try {
      const invite = await createSharedInvite(groupId, email);
      body.querySelector('#shared-invite-output').value = invite.url;
      toast('招待リンクを作成しました', 'success');
    } catch (e) {
      toast(e.message || '招待リンクを作成できませんでした', 'error');
    }
  });
}
