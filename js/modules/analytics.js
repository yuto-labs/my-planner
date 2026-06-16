// ============================================================
// analytics.js — タスク分析 / ナレッジ分析
// ============================================================
import {
  getTasks, getArchivedTasks, getKnowledgeMemos,
  isAiAvailable, getMonthlyReport, setMonthlyReport, getReviewSchedule,
  getReviewLog,
} from '../storage.js';
import { generateAnalyticsSummary } from '../ai.js';
import { esc, today } from '../utils.js';

const toast = (msg, type) => window.AppNav?.showToast(msg, type);
const WEIGHT = { large: 3, medium: 2, small: 1 };
const wt = t => WEIGHT[t.weight] || 1;

/* ---- Date helpers ---- */
function ds(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function weekBounds(offsetWeeks = 0) {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + offsetWeeks * 7);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { s: ds(mon), e: ds(sun) };
}
function monthBounds(offsetMonths = 0) {
  const now = new Date();
  const d1 = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const d2 = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  const yyyymm = `${d1.getFullYear()}-${String(d1.getMonth()+1).padStart(2,'0')}`;
  return { s: ds(d1), e: ds(d2), label: yyyymm.replace('-', '/'), yyyymm };
}
function allTasks() { return [...getTasks(), ...getArchivedTasks()]; }

/* ---- Task calculations ---- */
function calcWeekScore() {
  const wb = weekBounds();
  const tasks = allTasks();
  const planned = tasks.filter(t => t.dueDate && t.dueDate >= wb.s && t.dueDate <= wb.e);
  const earned  = planned.filter(t => t.completed);
  const plannedPts = planned.reduce((s, t) => s + wt(t), 0);
  const earnedPts  = earned.reduce((s, t) => s + wt(t), 0);
  return {
    plannedPts, earnedPts,
    rate: plannedPts ? Math.round(earnedPts / plannedPts * 100) : null,
    counts: { planned: planned.length, earned: earned.length },
  };
}

function calcMonthlyTrend() {
  const tasks = allTasks();
  return Array.from({ length: 6 }, (_, i) => {
    const mb = monthBounds(i - 5);
    const planned = tasks.filter(t => t.dueDate && t.dueDate >= mb.s && t.dueDate <= mb.e);
    const earned  = planned.filter(t => t.completed);
    const plannedPts = planned.reduce((s, t) => s + wt(t), 0);
    const earnedPts  = earned.reduce((s, t) => s + wt(t), 0);
    return { label: mb.label, rate: plannedPts ? Math.round(earnedPts / plannedPts * 100) : 0, plannedPts };
  });
}

function calcProcrastination() {
  const tasks = allTasks().filter(t =>
    t.completed && t.createdAt && t.completedAt && t.tags?.length
  );
  const tagMap = {};
  tasks.forEach(t => {
    const days = Math.max(0, Math.round((new Date(t.completedAt) - new Date(t.createdAt)) / 86400000));
    t.tags.forEach(tag => {
      if (!tagMap[tag]) tagMap[tag] = [];
      tagMap[tag].push(days);
    });
  });
  return Object.entries(tagMap)
    .map(([tag, arr]) => ({
      tag,
      avg: Math.round(arr.reduce((s, v) => s + v, 0) / arr.length),
      count: arr.length,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);
}

function calcPlanAccuracy(mode = 'week') {
  const tasks = allTasks().filter(t => t.completed && t.dueDate && t.completedAt);
  let filtered;
  if (mode === 'week') {
    const wb = weekBounds();
    filtered = tasks.filter(t => t.dueDate >= wb.s && t.dueDate <= wb.e);
  } else {
    const mb = monthBounds();
    filtered = tasks.filter(t => t.dueDate >= mb.s && t.dueDate <= mb.e);
  }
  if (!filtered.length) return { rate: null, on: 0, total: 0 };
  const onTime = filtered.filter(t => t.completedAt.slice(0, 10) === t.dueDate);
  return { rate: Math.round(onTime.length / filtered.length * 100), on: onTime.length, total: filtered.length };
}

/* ---- Knowledge calculations ---- */
function calcFieldBalance() {
  const memos = getKnowledgeMemos();
  const tagMap = {};
  memos.forEach(m => (m.tags || []).forEach(tag => { tagMap[tag] = (tagMap[tag] || 0) + 1; }));
  const total = memos.length || 1;
  return Object.entries(tagMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, cnt]) => ({ tag, cnt, pct: Math.round(cnt / total * 100) }));
}

function calcLearningSpeed() {
  const memos = getKnowledgeMemos();
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const wb = weekBounds(i - 7);
    const cnt = memos.filter(m =>
      m.createdAt && m.createdAt.slice(0, 10) >= wb.s && m.createdAt.slice(0, 10) <= wb.e
    ).length;
    return { label: wb.s.slice(5), cnt };
  });
  const thisWeek = weeks[7].cnt;
  const lastWeek = weeks[6].cnt;
  const monthAvg = Math.round(weeks.reduce((s, w) => s + w.cnt, 0) / 2);
  return { weeks, thisWeek, lastWeek, monthAvg };
}

function calcReviewSpeed() {
  const log = getReviewLog();
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const wb = weekBounds(i - 7);
    const cnt = log.filter(e => e.date >= wb.s && e.date <= wb.e).length;
    return { label: wb.s.slice(5), cnt };
  });
  const thisWeek = weeks[7].cnt;
  const lastWeek = weeks[6].cnt;
  const monthAvg = Math.round(weeks.reduce((s, w) => s + w.cnt, 0) / 2);
  return { weeks, thisWeek, lastWeek, monthAvg };
}

function calcReviewByField() {
  const log = getReviewLog();
  const mb = monthBounds();
  const thisMonth = log.filter(e => e.date >= mb.s && e.date <= mb.e);
  const tagMap = {};
  thisMonth.forEach(e => (e.tags || []).forEach(t => { tagMap[t] = (tagMap[t] || 0) + 1; }));
  const total = Object.values(tagMap).reduce((s, n) => s + n, 0) || 1;
  return Object.entries(tagMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, cnt]) => ({ tag, cnt, pct: Math.round(cnt / total * 100) }));
}

function calcNeglectedTopics() {
  const memos = getKnowledgeMemos();
  const tagLast = {};
  memos.forEach(m => {
    const date = (m.updatedAt || m.createdAt || '').slice(0, 10);
    if (!date) return;
    (m.tags || []).forEach(tag => {
      if (!tagLast[tag] || date > tagLast[tag]) tagLast[tag] = date;
    });
  });
  const cutoff = ds(new Date(Date.now() - 30 * 86400000));
  return Object.entries(tagLast)
    .filter(([, d]) => d < cutoff)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([tag, date]) => ({ tag, date }));
}

function calcReviewRate() {
  const schedule = getReviewSchedule();
  const entries  = Object.values(schedule).filter(e => e.stage < 3);
  if (!entries.length) return { rate: null, done: 0, total: 0 };
  const todayStr = today();
  const overdue  = entries.filter(e => e.nextReview <= todayStr).length;
  const done     = entries.length - overdue;
  return { rate: Math.round(done / entries.length * 100), done, total: entries.length };
}

function calcDepthBreadth() {
  const memos = getKnowledgeMemos();
  const tags  = new Set();
  memos.forEach(m => (m.tags || []).forEach(t => tags.add(t)));
  const breadth = tags.size;
  const totalTagUse = memos.reduce((s, m) => s + (m.tags?.length || 0), 0);
  const depth = breadth ? (totalTagUse / breadth).toFixed(1) : '0';
  return { breadth, depth };
}

/* ---- Render helpers ---- */
const noData = (msg = 'まだデータが足りません') =>
  `<div class="analytics-info-box">${esc(msg)}</div>`;

function renderLineChart(data) {
  const active = data.filter(d => d.plannedPts > 0);
  if (active.length < 2) {
    const weeksLeft = Math.max(1, (2 - active.length) * 4);
    return noData(`まだデータが足りません（あと約${weeksLeft}週間で表示されます）`);
  }
  const W = 280, H = 84, px = 22, py = 10;
  const chartH = H - py * 2 - 14;
  const n = data.length;
  const step = (W - px * 2) / (n - 1);
  const pts = data.map((d, i) => ({
    x: px + i * step,
    y: py + chartH * (1 - (d.rate || 0) / 100),
    rate: d.rate,
    label: d.label.slice(5),
    active: d.plannedPts > 0,
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const gridLines = [0, 50, 100].map(v => {
    const y = (py + chartH * (1 - v / 100)).toFixed(1);
    return `<line x1="${px}" y1="${y}" x2="${W - px}" y2="${y}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3,3"/>
            <text x="${(px - 3)}" y="${parseFloat(y) + 3}" text-anchor="end" font-size="7" fill="var(--text-dim)">${v}%</text>`;
  }).join('');
  return `
    <svg class="analytics-line-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      <path d="${linePath}" fill="none" stroke="var(--primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      ${pts.map(p => `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.active ? 3 : 2}"
          fill="${p.active ? 'var(--primary)' : 'var(--border)'}"/>
        ${p.active ? `<text x="${p.x.toFixed(1)}" y="${(p.y - 5).toFixed(1)}" text-anchor="middle" font-size="7" fill="var(--primary)" font-weight="600">${p.rate}%</text>` : ''}
        <text x="${p.x.toFixed(1)}" y="${H - 1}" text-anchor="middle" font-size="8" fill="var(--text-dim)">${p.label}</text>
      `).join('')}
    </svg>`;
}

function renderAccuracyContent(acc) {
  if (acc.rate === null) return noData('この期間に期限付き完了タスクがありません');
  const color = acc.rate >= 80 ? 'var(--success)' : acc.rate >= 50 ? 'var(--warning)' : 'var(--danger)';
  return `<div class="analytics-big-stat">
    <div class="analytics-big-val" style="color:${color}">${acc.rate}%</div>
    <div class="analytics-big-sub">${acc.on}/${acc.total}タスクを予定通り完了</div>
  </div>`;
}

/* ---- Tasks tab ---- */
function renderTasksTab() {
  const score = calcWeekScore();
  const trend = calcMonthlyTrend();
  const proc  = calcProcrastination();
  const acc   = calcPlanAccuracy('week');

  const trendActive = trend.filter(t => t.plannedPts > 0);
  let trendDelta = '';
  if (trendActive.length >= 2) {
    const curr  = trendActive[trendActive.length - 1].rate;
    const prev  = trendActive[trendActive.length - 2].rate;
    const delta = curr - prev;
    trendDelta = ` <span class="analytics-delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta}%</span>`;
  }

  const maxProcDays = proc[0]?.avg || 1;

  return `
    <!-- 週次スコア -->
    <div class="analytics-section">
      <div class="analytics-section-title">週次スコア（重み付き達成率）</div>
      ${score.plannedPts === 0
        ? noData('今週は期限付きタスクがありません')
        : `<div class="analytics-stat-grid">
             <div class="analytics-stat-card">
               <div class="analytics-stat-value" style="color:var(--primary)">${score.earnedPts}</div>
               <div class="analytics-stat-label">獲得ポイント</div>
               <div class="analytics-stat-sub">${score.counts.earned}タスク完了</div>
             </div>
             <div class="analytics-stat-card">
               <div class="analytics-stat-value">${score.plannedPts}</div>
               <div class="analytics-stat-label">計画ポイント</div>
               <div class="analytics-stat-sub">${score.counts.planned}タスク予定</div>
             </div>
           </div>
           <div class="analytics-week-rate">
             <div class="analytics-week-rate-val" style="color:${score.rate >= 80 ? 'var(--success)' : score.rate >= 50 ? 'var(--warning)' : 'var(--danger)'}">${score.rate}%</div>
             <div class="analytics-week-rate-label">今週の達成率</div>
             <div class="analytics-week-rate-sub">大=3pt ／ 中=2pt ／ 小=1pt</div>
           </div>`
      }
    </div>

    <!-- 月次推移 -->
    <div class="analytics-section">
      <div class="analytics-section-title">月次推移グラフ${trendDelta}</div>
      ${renderLineChart(trend)}
    </div>

    <!-- カテゴリ別先延ばし指数 -->
    <div class="analytics-section">
      <div class="analytics-section-title">カテゴリ別先延ばし指数</div>
      ${proc.length === 0
        ? noData('タグ付き完了タスクがまだありません')
        : `<div class="analytics-proc-table">
             ${proc.map(p => `
               <div class="analytics-proc-row">
                 <div class="analytics-proc-tag">${esc(p.tag)}</div>
                 <div class="analytics-proc-bar-wrap">
                   <div class="analytics-proc-bar" style="width:${Math.min(100, Math.round(p.avg / Math.max(maxProcDays, 1) * 100))}%"></div>
                 </div>
                 <div class="analytics-proc-days">${p.avg}日</div>
               </div>`).join('')}
           </div>`
      }
    </div>

    <!-- 計画精度 -->
    <div class="analytics-section">
      <div class="analytics-section-title">計画精度
        <div class="analytics-mode-toggle">
          <button class="plan-accuracy-toggle active" data-mode="week">週</button>
          <button class="plan-accuracy-toggle" data-mode="month">月</button>
        </div>
      </div>
      <div id="plan-accuracy-val">${renderAccuracyContent(acc)}</div>
    </div>
  `;
}

/* ---- Knowledge tab ---- */
function renderKnowledgeTab() {
  const balance      = calcFieldBalance();
  const addSpeed     = calcLearningSpeed();
  const revSpeed     = calcReviewSpeed();
  const revByField   = calcReviewByField();
  const neglected    = calcNeglectedTopics();
  const review       = calcReviewRate();
  const db           = calcDepthBreadth();

  const maxCnt        = balance[0]?.cnt || 1;
  const maxRevField   = revByField[0]?.cnt || 1;
  const maxRevWeekCnt = Math.max(...revSpeed.weeks.map(w => w.cnt), 1);
  const maxAddWeekCnt = Math.max(...addSpeed.weeks.map(w => w.cnt), 1);

  return `
    <!-- 分野バランス（メモ数） -->
    <div class="analytics-section">
      <div class="analytics-section-title">分野バランス（メモ数・上位5）</div>
      ${balance.length === 0
        ? noData('タグ付きメモがまだありません')
        : `<div class="analytics-bar-list">
             ${balance.map(d => `
               <div class="analytics-bar-row">
                 <div class="analytics-bar-label">${esc(d.tag)}</div>
                 <div class="analytics-bar-track">
                   <div class="analytics-bar-fill" style="width:${Math.round(d.cnt / maxCnt * 100)}%"></div>
                 </div>
                 <div class="analytics-bar-val">${d.cnt}<span class="analytics-bar-pct"> (${d.pct}%)</span></div>
               </div>`).join('')}
           </div>`
      }
    </div>

    <!-- 復習速度（直近8週間） -->
    <div class="analytics-section">
      <div class="analytics-section-title">復習速度（直近8週間）</div>
      ${revSpeed.weeks.every(w => w.cnt === 0)
        ? noData('まだ「学習した」ボタンを押したことがありません')
        : `<div class="analytics-speed-stats">
             <div class="analytics-speed-stat"><div class="analytics-speed-val" style="color:var(--success)">${revSpeed.thisWeek}</div><div class="analytics-speed-lbl">今週</div></div>
             <div class="analytics-speed-stat"><div class="analytics-speed-val">${revSpeed.lastWeek}</div><div class="analytics-speed-lbl">先週</div></div>
             <div class="analytics-speed-stat"><div class="analytics-speed-val">${revSpeed.monthAvg}</div><div class="analytics-speed-lbl">月平均</div></div>
           </div>
           <div class="analytics-chart-bars" style="padding-bottom:20px;gap:4px">
             ${revSpeed.weeks.map(w => {
               const h = w.cnt > 0 ? Math.round(w.cnt / maxRevWeekCnt * 48) : 2;
               return `<div class="analytics-chart-col">
                 <div class="analytics-chart-bar" style="height:${h}px;background:var(--success);opacity:0.8"></div>
                 <div class="analytics-chart-day">${w.label}</div>
               </div>`;
             }).join('')}
           </div>`
      }
    </div>

    <!-- 分野別 復習回数（今月） -->
    <div class="analytics-section">
      <div class="analytics-section-title">分野別 復習回数（今月）</div>
      ${revByField.length === 0
        ? noData('今月の復習記録がまだありません')
        : `<div class="analytics-bar-list">
             ${revByField.map(d => `
               <div class="analytics-bar-row">
                 <div class="analytics-bar-label">${esc(d.tag)}</div>
                 <div class="analytics-bar-track">
                   <div class="analytics-bar-fill" style="width:${Math.round(d.cnt / maxRevField * 100)}%;background:var(--success)"></div>
                 </div>
                 <div class="analytics-bar-val">${d.cnt}回<span class="analytics-bar-pct"> (${d.pct}%)</span></div>
               </div>`).join('')}
           </div>`
      }
    </div>

    <!-- メモ追加速度（直近8週間） -->
    <div class="analytics-section">
      <div class="analytics-section-title">メモ追加速度（直近8週間）</div>
      <div class="analytics-speed-stats">
        <div class="analytics-speed-stat"><div class="analytics-speed-val">${addSpeed.thisWeek}</div><div class="analytics-speed-lbl">今週</div></div>
        <div class="analytics-speed-stat"><div class="analytics-speed-val">${addSpeed.lastWeek}</div><div class="analytics-speed-lbl">先週</div></div>
        <div class="analytics-speed-stat"><div class="analytics-speed-val">${addSpeed.monthAvg}</div><div class="analytics-speed-lbl">月平均</div></div>
      </div>
      <div class="analytics-chart-bars" style="padding-bottom:20px;gap:4px">
        ${addSpeed.weeks.map(w => {
          const h = w.cnt > 0 ? Math.round(w.cnt / maxAddWeekCnt * 48) : 2;
          return `<div class="analytics-chart-col">
            <div class="analytics-chart-bar" style="height:${h}px;background:var(--primary);opacity:0.75"></div>
            <div class="analytics-chart-day">${w.label}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- 放置トピック -->
    <div class="analytics-section">
      <div class="analytics-section-title">放置トピック（30日以上未活動）</div>
      ${neglected.length === 0
        ? `<div class="analytics-info-box" style="color:var(--success)">全タグが直近30日以内にアクティブです</div>`
        : `<div class="analytics-neglect-list">
             ${neglected.map(n => `
               <div class="analytics-neglect-row">
                 <div class="analytics-neglect-tag">${esc(n.tag)}</div>
                 <div class="analytics-neglect-date">最終: ${n.date}</div>
               </div>`).join('')}
           </div>`
      }
    </div>

    <!-- 復習率 -->
    <div class="analytics-section">
      <div class="analytics-section-title">復習率（スペースドリピティション）</div>
      ${review.rate === null
        ? noData('スペースドリピティションのスケジュールがまだありません')
        : `<div class="analytics-big-stat">
             <div class="analytics-big-val" style="color:${review.rate >= 80 ? 'var(--success)' : review.rate >= 50 ? 'var(--warning)' : 'var(--danger)'}">${review.rate}%</div>
             <div class="analytics-big-sub">${review.done}/${review.total}件を期限内に復習済み</div>
           </div>`
      }
    </div>

    <!-- 深さvs広さ -->
    <div class="analytics-section">
      <div class="analytics-section-title">深さ vs 広さ</div>
      ${db.breadth === 0
        ? noData('メモがまだありません')
        : `<div class="analytics-stat-grid">
             <div class="analytics-stat-card">
               <div class="analytics-stat-value" style="color:var(--primary)">${db.breadth}</div>
               <div class="analytics-stat-label">広さ</div>
               <div class="analytics-stat-sub">ユニークタグ数</div>
             </div>
             <div class="analytics-stat-card">
               <div class="analytics-stat-value" style="color:var(--success)">${db.depth}</div>
               <div class="analytics-stat-label">深さ</div>
               <div class="analytics-stat-sub">タグあたり平均メモ数</div>
             </div>
           </div>`
      }
    </div>
  `;
}

/* ---- Monthly AI summary ---- */
async function maybeGenerateSummary(container, currentMonth) {
  if (!isAiAvailable()) return;

  const summaryKey = `${currentMonth}_analytics`;
  const cached = getMonthlyReport(summaryKey);

  if (cached?.summary) {
    appendSummarySection(container, cached.summary, currentMonth);
    return;
  }

  const placeholder = document.createElement('div');
  placeholder.className = 'analytics-section';
  placeholder.innerHTML = `
    <div class="analytics-section-title">月次AIサマリー（${currentMonth}）</div>
    <div class="analytics-info-box"><span class="ai-spinner"></span> 生成中…</div>
  `;
  container.querySelector('.analytics-page')?.appendChild(placeholder);

  try {
    const tasks  = allTasks();
    const memos  = getKnowledgeMemos();
    const mb     = monthBounds();
    const prevMb = monthBounds(-1);

    const monthTasks   = tasks.filter(t => t.dueDate && t.dueDate >= mb.s && t.dueDate <= mb.e);
    const prevTasks    = tasks.filter(t => t.dueDate && t.dueDate >= prevMb.s && t.dueDate <= prevMb.e);
    const monthPts     = monthTasks.reduce((s, t) => s + wt(t), 0);
    const monthEarned  = monthTasks.filter(t => t.completed).reduce((s, t) => s + wt(t), 0);
    const prevPts      = prevTasks.reduce((s, t) => s + wt(t), 0);
    const prevEarned   = prevTasks.filter(t => t.completed).reduce((s, t) => s + wt(t), 0);

    const data = {
      month: currentMonth,
      taskRate: monthPts ? Math.round(monthEarned / monthPts * 100) : 0,
      prevTaskRate: prevPts ? Math.round(prevEarned / prevPts * 100) : 0,
      newMemos: memos.filter(m => m.createdAt?.slice(0, 7) === currentMonth).length,
      totalMemos: memos.length,
      topTags: calcFieldBalance().slice(0, 3).map(t => t.tag),
      reviewRate: calcReviewRate().rate,
    };

    const summary = await generateAnalyticsSummary(currentMonth, data);
    setMonthlyReport(summaryKey, { summary });
    placeholder.innerHTML = `
      <div class="analytics-section-title">月次AIサマリー（${currentMonth}）</div>
      <div class="analytics-ai-summary">${esc(summary).replace(/\n/g, '<br>')}</div>
    `;
  } catch (e) {
    placeholder.innerHTML = `
      <div class="analytics-section-title">月次AIサマリー</div>
      <div class="analytics-info-box">サマリー生成に失敗しました: ${esc(e.message)}</div>
    `;
  }
}

function appendSummarySection(container, summary, monthStr) {
  const sec = document.createElement('div');
  sec.className = 'analytics-section';
  sec.innerHTML = `
    <div class="analytics-section-title">月次AIサマリー（${monthStr}）</div>
    <div class="analytics-ai-summary">${esc(summary).replace(/\n/g, '<br>')}</div>
  `;
  container.querySelector('.analytics-page')?.appendChild(sec);
}

/* ---- Entry point ---- */
export function initAnalytics(container) {
  const todayStr     = today();
  const currentMonth = todayStr.slice(0, 7);

  container.innerHTML = `
    <div class="analytics-page">
      <div class="analytics-tab-bar">
        <button class="analytics-tab active" data-tab="tasks">Tasks</button>
        <button class="analytics-tab" data-tab="knowledge">Knowledge</button>
      </div>
      <div class="analytics-tab-panel" id="atab-tasks">${renderTasksTab()}</div>
      <div class="analytics-tab-panel hidden" id="atab-knowledge">${renderKnowledgeTab()}</div>
    </div>
  `;

  // Tab switching
  container.querySelectorAll('.analytics-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.analytics-tab').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.analytics-tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      container.querySelector(`#atab-${btn.dataset.tab}`)?.classList.remove('hidden');
    });
  });

  // Plan accuracy mode toggle
  container.querySelectorAll('.plan-accuracy-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.plan-accuracy-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const acc = calcPlanAccuracy(btn.dataset.mode);
      const el  = container.querySelector('#plan-accuracy-val');
      if (el) el.innerHTML = renderAccuracyContent(acc);
    });
  });

  // Monthly AI summary (async, appended after render)
  maybeGenerateSummary(container, currentMonth);
}
