// ============================================================
// atlas-loader.js - 表現帳の画面コードを、初めて使う時に読み込む
//
// 表現帳(expression-atlas.js)は辞書データ込みで約280KBあり、起動のたびに読むと
// 表現帳を使わない日でも起動が重くなる。ここを通して必要な時だけ読み込む。
// 一度読めばブラウザーが覚えているので、2回目以降はすぐ使える。
// オフライン用のキャッシュ(sw.js)には入っているので、通信がなくても開ける。
// ============================================================

let loaded = null;
let loading = null;

/** 表現帳の画面コードを読み込み、その中身(公開関数の集まり)を返す。 */
export function loadAtlasModule() {
  loading ??= import('./modules/expression-atlas.js').then(module => {
    loaded = module;
    return module;
  });
  return loading;
}

/** 既に読み込み済みなら中身を、まだならnullを返す(すぐ答えが必要な場面用)。 */
export function loadedAtlasModule() {
  return loaded;
}

/**
 * 表現帳画面の初期化。読み込みが終わってから描画し、その間に別の画面へ移っていたら
 * 何もしない(遅れて届いた描画で新しい画面を上書きしないため)。片付け用の関数を返す。
 */
export function initExpressionAtlasLazily(container) {
  let cleanup = null;
  let cancelled = false;
  if (loaded) return loaded.initExpressionAtlas(container);
  container.innerHTML = '<div class="search-hint">表現帳を読み込んでいます…</div>';
  loadAtlasModule().then(module => {
    if (cancelled || !container.isConnected || container.dataset.view !== 'expression-atlas') return;
    cleanup = module.initExpressionAtlas(container) || null;
  }).catch(error => {
    console.error('[Atlas] failed to load:', error);
    if (!cancelled) container.innerHTML = '<div class="search-empty">表現帳を読み込めませんでした。再読み込みしてください。</div>';
  });
  return () => {
    cancelled = true;
    cleanup?.();
  };
}
