import {
  acceptSharedInvite,
  collectSharedCalendarEvents,
  createSharedGroup,
  createSharedInvite,
  deleteSharedGroup,
  loadSharedGroups,
} from '../shared-calendar.js';
import { esc, formatDate, formatTime, getEventsForDate, today, toDateStr } from '../utils.js';

const toast = (msg, type) => window.AppNav?.showToast(msg, type);
const openModal = (opts) => window.AppNav?.openModal(opts);
const nav = (view) => window.AppNav?.navigate(view);

let state = {
  container: null,
  cursor: new Date(),
  groupId: '',
  groups: [],
  events: [],
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
  const result = await acceptSharedInvite(token);
  url.searchParams.delete('shareInvite');
  window.history.replaceState({}, document.title, `${url.origin}${url.pathname}#shared-calendar`);
  if (result?.pendingLogin) {
    toast('ログインすると、この招待グループに自動で参加します', 'info');
    nav('settings');
    return;
  }
  toast('共有グループに参加しました', 'success');
}

async function refresh() {
  state.loading = true;
  render();
  const result = await collectSharedCalendarEvents(state.groupId);
  state.groups = result.groups || [];
  state.events = result.events || [];
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
          <div class="shared-cal-title-row">
            <h2>共有カレンダー</h2>
            <div class="cal-scope-toggle" aria-label="カレンダー表示切替">
              <button class="cal-scope-btn" id="shared-personal-btn" type="button" aria-pressed="false">個</button>
              <button class="cal-scope-btn active" type="button" aria-pressed="true">共</button>
            </div>
          </div>
          <p>個人予定を保存先にしたまま、共有対象にした予定だけをまとめて表示します。</p>
        </div>
      </div>

      <div class="shared-cal-controls">
        <button class="cal-nav-arrow" id="shared-prev" aria-label="前へ">&#8249;</button>
        <button class="cal-title" id="shared-today">${formatDate(state.cursor, 'month')}</button>
        <button class="cal-nav-arrow" id="shared-next" aria-label="次へ">&#8250;</button>
        <select class="select" id="shared-group-filter">
          <option value="">すべての共有グループ</option>
          ${state.groups.map(group => `<option value="${esc(group.id)}" ${state.groupId === group.id ? 'selected' : ''}>${esc(group.name || '共有グループ')}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="shared-refresh" type="button">更新</button>
      </div>

      ${state.error ? `<div class="card shared-cal-error">共有データを読み込めませんでした。Supabaseに最新の共有カレンダーSQLを適用してください。<br>${esc(state.error)}</div>` : ''}
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
  container.querySelector('#shared-refresh')?.addEventListener('click', async () => {
    await refresh();
    toast('共有カレンダーを更新しました', 'success');
  });
  container.querySelector('#shared-personal-btn')?.addEventListener('click', () => nav('calendar'));
}

function renderMonth() {
  if (!state.groups.length) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">□</div>
        <p class="empty-state-text">共有グループがまだありません</p>
        <p class="empty-state-sub">設定の共有グループから作成し、招待リンクを送ってください。</p>
      </div>
    `;
  }

  const start = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - start.getDay());
  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const todayStr = today();
  let d = new Date(gridStart);

  let html = `
    <div class="shared-cal-grid-wrap">
      <div class="cal-day-headers">${dayLabels.map(label => `<div class="cal-day-header">${label}</div>`).join('')}</div>
      <div class="cal-grid shared-cal-grid">
  `;

  for (let i = 0; i < 42; i += 1) {
    const ds = toDateStr(d);
    const isOther = d.getMonth() !== state.cursor.getMonth();
    const events = getEventsForDate(state.events, ds).slice(0, 4);
    html += `
      <div class="cal-cell${isOther ? ' other-month' : ''}${ds === todayStr ? ' today' : ''}">
        <div class="cal-cell-num">${d.getDate()}</div>
        ${events.map(renderChip).join('')}
      </div>
    `;
    d.setDate(d.getDate() + 1);
  }

  return `${html}</div></div>`;
}

function renderChip(event) {
  const label = event.isOwn ? '自分' : (event.shareVisibility === 'shared_busy' ? '予定あり' : '共有');
  return `
    <span class="shared-event-chip${event.isOwn ? ' own' : ''}">
      <span>${esc(formatTime(event.start))}</span>
      <strong>${esc(event.visibleTitle || event.title || '予定')}</strong>
      <em>${label}</em>
    </span>
  `;
}

export async function openSharedCalendarSettings() {
  state.groups = await loadSharedGroups().catch(() => state.groups || []);

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="shared-group-manager">
      <section class="shared-manager-card">
        <div class="shared-manager-card-head">
          <span class="shared-manager-step">1</span>
          <div>
            <h3>共有グループを作る</h3>
            <p>友達や家族など、予定を一緒に見たい相手ごとにグループを作ります。</p>
          </div>
        </div>
        <label class="form-label" for="shared-new-name">グループ名</label>
        <div class="shared-inline shared-inline--wide">
          <input class="input" id="shared-new-name" placeholder="例: 友達カレンダー / 家族予定">
          <button class="btn btn-primary" id="shared-create-group">作成</button>
        </div>
      </section>

      <section class="shared-manager-card">
        <div class="shared-manager-card-head">
          <span class="shared-manager-step">2</span>
          <div>
            <h3>招待リンクを作る</h3>
            <p>相手がログインした状態でリンクを開くと、そのアカウントでグループに参加できます。未ログインの場合は、ログイン後に自動で参加します。</p>
          </div>
        </div>
        <div class="shared-manager-grid">
          <div class="form-group">
            <label class="form-label" for="shared-invite-group">招待先のグループ</label>
            <select class="select" id="shared-invite-group">
              ${state.groups.map(group => `<option value="${esc(group.id)}">${esc(group.name || '共有グループ')}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="shared-invite-email">相手のメール（任意）</label>
            <input class="input" id="shared-invite-email" placeholder="例: friend@example.com">
            <p class="form-help">空欄ならリンクを知っているログイン済みユーザーが参加できます。メールを書くと、そのメールのアカウントだけ参加できます。</p>
          </div>
        </div>
        <button class="btn btn-ghost btn-full" id="shared-create-invite" ${state.groups.length ? '' : 'disabled'}>招待リンクを作成</button>
        <textarea class="input shared-invite-output" id="shared-invite-output" readonly placeholder="作成した招待リンクがここに表示されます。コピーしてLINEやメールで送れます。"></textarea>
        <p class="form-help">招待リンクは7日で期限切れになり、1回使うと再利用できません。</p>
      </section>

      <section class="shared-manager-card shared-manager-card--compact">
        <div class="shared-manager-card-head">
          <span class="shared-manager-step">3</span>
          <div>
            <h3>参加中の共有グループ</h3>
            <p>ここに表示されるグループが、カレンダーの共表示で選べます。</p>
          </div>
        </div>
        <div class="shared-group-list">
          ${state.groups.length ? state.groups.map(group => `
            <div class="shared-group-row">
              <strong>${esc(group.name || '共有グループ')}</strong>
              <span>${esc(group.role || 'member')}</span>
              ${group.role === 'owner' ? `<button class="shared-group-delete" data-delete-group-id="${esc(group.id)}" data-delete-group-name="${esc(group.name || '共有グループ')}" type="button">削除</button>` : ''}
            </div>
          `).join('') : '<p class="form-help">まだグループがありません。まず上でグループを作成してください。</p>'}
        </div>
      </section>
    </div>
  `;

  const close = openModal({ title: '共有設定', body });

  body.querySelector('#shared-create-group')?.addEventListener('click', async () => {
    const input = body.querySelector('#shared-new-name');
    const name = input?.value.trim();
    if (!name) {
      toast('グループ名を入力してください', 'error');
      return;
    }
    try {
      await createSharedGroup(name);
      toast('共有グループを作成しました', 'success');
      close();
      await openSharedCalendarSettings();
    } catch (e) {
      toast(e.message || '共有グループを作成できませんでした', 'error');
    }
  });

  body.querySelector('#shared-create-invite')?.addEventListener('click', async () => {
    const groupId = body.querySelector('#shared-invite-group')?.value;
    const email = body.querySelector('#shared-invite-email')?.value || '';
    try {
      const invite = await createSharedInvite(groupId, email);
      const out = body.querySelector('#shared-invite-output');
      if (out) {
        out.value = invite.url;
        out.focus();
        out.select();
      }
      await navigator.clipboard?.writeText(invite.url).catch(() => {});
      toast('招待リンクを作成しました', 'success');
    } catch (e) {
      toast(e.message || '招待リンクを作成できませんでした', 'error');
    }
  });

  body.querySelectorAll('[data-delete-group-id]').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteGroup(btn.dataset.deleteGroupId, btn.dataset.deleteGroupName || '共有グループ', close));
  });
}

function confirmDeleteGroup(groupId, groupName, parentClose) {
  const body = document.createElement('div');
  body.innerHTML = `
    <p>共有グループ「${esc(groupName)}」を削除します。</p>
    <p class="form-help">作成者だけが削除できます。共有設定は外れますが、各ユーザーの個人予定そのものは削除されません。</p>
    <label class="form-label" for="shared-delete-confirm">確認のためグループ名を入力</label>
    <input class="input" id="shared-delete-confirm" placeholder="${esc(groupName)}">
  `;
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;width:100%';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost btn-sm';
  cancel.textContent = 'キャンセル';
  const ok = document.createElement('button');
  ok.className = 'btn btn-danger btn-sm';
  ok.textContent = '削除';
  footer.append(cancel, ok);
  const close = openModal({ title: '共有グループを削除', body, footer });
  cancel.onclick = () => close();
  ok.onclick = async () => {
    const typed = body.querySelector('#shared-delete-confirm')?.value.trim();
    if (typed !== groupName) {
      toast('グループ名が一致しません', 'error');
      return;
    }
    try {
      await deleteSharedGroup(groupId);
      close();
      parentClose?.();
      toast('共有グループを削除しました', 'success');
    } catch (e) {
      toast(e.message || '共有グループを削除できませんでした', 'error');
    }
  };
}
