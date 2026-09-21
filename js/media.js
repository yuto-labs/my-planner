// ============================================================
// media.js - ユーザー専用画像の圧縮・保存・表示・削除
//
// 画像本体はlocalStorageへ入れず、Supabase Storageへ保存する。
// メモ等にはpathと寸法だけを持たせ、表示時に期限付きURLへ解決する。
// ホーム画像だけはオフラインでも見えるようCache Storageにも控えを置く。
// ============================================================

import { getClient, getUserId } from './supabase.js';
import { generateId } from './utils.js';
import {
  escapeMediaAttribute,
  escapeMediaHtml,
  hydratedMediaSource,
  isOwnedMediaPath,
  sanitizeMediaKind,
  scaledImageDimensions,
} from './media-model.js';

const BUCKET = 'planner-media';
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.84;
const SIGNED_URL_TTL = 60 * 60;
const PERSISTENT_IMAGE_CACHE = 'my-planner-images-v1';
const urlCache = new Map();
const blobUrlCache = new Map();
let activeViewerClose = null;

/** 画像を端末向けサイズへ圧縮し、ログインユーザー専用パスへ保存する。 */
export async function uploadPlannerImage(file, kind = 'misc') {
  if (!(file instanceof File) || !file.type.startsWith('image/')) {
    throw new Error('画像ファイルを選択してください');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('画像は15MB以下にしてください');
  }

  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) {
    throw new Error('写真を同期するにはログインしてください');
  }

  const compressed = await compressImage(file);
  const safeKind = sanitizeMediaKind(kind);
  const path = `${userId}/${safeKind}/${generateId()}.jpg`;
  const { error } = await client.storage.from(BUCKET).upload(path, compressed.blob, {
    cacheControl: '31536000',
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) {
    if (/bucket|not found/i.test(error.message || '')) {
      throw new Error('写真保存の初期設定が未完了です。Supabaseの画像Storage設定を確認してください');
    }
    throw error;
  }
  if (safeKind === 'home') {
    await writePersistentImage(path, compressed.blob);
  }

  return {
    id: generateId(),
    path,
    width: compressed.width,
    height: compressed.height,
    size: compressed.blob.size,
    alt: '',
    createdAt: new Date().toISOString(),
  };
}

/** 保存パスを表示可能なURLへ変換する。期限付きURLはメモリ上で再利用する。 */
export async function resolvePlannerImageUrl(path, { persistent = false, forceRefresh = false } = {}) {
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return '';

  if (persistent) {
    const persistentUrl = await resolvePersistentImageUrl(cleanPath);
    if (persistentUrl) return persistentUrl;
  }

  if (forceRefresh) urlCache.delete(cleanPath);
  const cached = urlCache.get(cleanPath);
  let signedUrl = cached?.expiresAt > Date.now() ? cached.url : '';
  if (!signedUrl) {
    const client = await getClient();
    if (!client) return '';
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrl(cleanPath, SIGNED_URL_TTL);
    if (error || !data?.signedUrl) return '';
    signedUrl = data.signedUrl;
    urlCache.set(cleanPath, {
      url: signedUrl,
      expiresAt: Date.now() + (SIGNED_URL_TTL - 120) * 1000,
    });
  }

  if (!persistent) return signedUrl;
  try {
    const response = await fetch(signedUrl);
    if (!response.ok) return signedUrl;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return signedUrl;
    await writePersistentImage(cleanPath, blob);
    return createCachedBlobUrl(cleanPath, blob);
  } catch {
    return signedUrl;
  }
}

/** root内の画像要素へ、非同期で実画像URLを設定する。 */
export async function hydratePlannerImages(root) {
  const images = [...(root?.querySelectorAll?.('img[data-media-path]') || [])];
  await Promise.all(images.map(async image => {
    const path = image.dataset.mediaPath;
    if (!path || image.dataset.mediaLoaded === '1' || image.dataset.mediaLoaded === 'loading') return;
    image.dataset.mediaLoaded = 'loading';
    const cached = urlCache.get(path);
    if (cached?.expiresAt > Date.now() && cached.url) {
      image.src = cached.url;
    }
    const url = await resolvePlannerImageUrl(path, {
      persistent: image.dataset.mediaPersist === '1',
    });
    if (!image.isConnected) return;
    if (!url) {
      image.dataset.mediaLoaded = 'error';
      image.closest('.media-frame')?.classList.remove('media-frame--loading');
      image.closest('.media-frame')?.classList.add('media-frame--error');
      return;
    }

    const frame = image.closest('.media-frame');
    /** `finish`: 非同期処理を完了させ、登録済みの後始末を一度だけ行う。 */
    const finish = () => {
      image.dataset.mediaLoaded = '1';
      frame?.classList.remove('media-frame--loading', 'media-frame--error');
    };
    /** `fail`: 非同期処理を失敗として終了し、呼び出し元へエラーを返す。 */
    const fail = () => {
      image.dataset.mediaLoaded = 'error';
      frame?.classList.remove('media-frame--loading');
      frame?.classList.add('media-frame--error');
    };
    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', fail, { once: true });
    image.src = url;
    if (image.complete) {
      if (image.naturalWidth > 0) finish();
      else fail();
    }
  }));
}

/** root内の画像タップを、共通の拡大ビューアへ接続する。 */
export function wirePlannerImageViewer(root) {
  if (!root?.addEventListener || root.dataset.mediaViewerWired === '1') return;
  root.dataset.mediaViewerWired = '1';

  /** `openFromTarget`: クリックされた画像要素からパスと説明を読み、画像ビューアを開く。 */
  const openFromTarget = target => {
    const image = target?.closest?.('img[data-media-view]');
    if (!image || !root.contains(image)) return false;
    openPlannerImageViewer({
      path: image.dataset.mediaPath,
      // 読み込み途中のimg.srcは現在ページのURLになる場合があるため再利用しない。
      src: hydratedMediaSource(image),
      alt: image.alt,
      caption: image.dataset.mediaCaption,
      trigger: image,
    });
    return true;
  };

  root.addEventListener('click', event => {
    openFromTarget(event.target);
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!openFromTarget(event.target)) return;
    event.preventDefault();
  });
}

/** 端末画面に収まる拡大ビューアを開き、必要なら削除操作も提供する。 */
export async function openPlannerImageViewer({
  path = '',
  src = '',
  alt = '',
  caption = '',
  trigger = null,
} = {}) {
  activeViewerClose?.();

  const previousOverflow = document.body.style.overflow;
  const viewer = document.createElement('div');
  viewer.className = 'media-lightbox media-lightbox--loading';
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.setAttribute('aria-label', '写真の拡大表示');
  viewer.innerHTML = `
    <button type="button" class="media-lightbox-close" aria-label="拡大表示を閉じる">×</button>
    <div class="media-lightbox-stage">
      <img alt="${escapeMediaAttribute(alt)}">
      ${caption ? `<div class="media-lightbox-caption">${escapeMediaHtml(caption)}</div>` : ''}
    </div>
  `;

  const closeButton = viewer.querySelector('.media-lightbox-close');
  const image = viewer.querySelector('img');
  let closed = false;
  let loadAttempt = 0;
  let loadTimer = null;
  /** `close`: 現在開いているモーダルまたはシートを閉じる。 */
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    clearTimeout(loadTimer);
    document.body.style.overflow = previousOverflow;
    viewer.remove();
    if (activeViewerClose === close) activeViewerClose = null;
    trigger?.focus?.({ preventScroll: true });
  };
  /** `onKeyDown`: 画像ビューアのEscape・左右キー操作を処理する。 */
  const onKeyDown = event => {
    if (event.key === 'Escape') close();
  };

  activeViewerClose = close;
  closeButton.addEventListener('click', close);
  viewer.addEventListener('click', event => {
    if (event.target === viewer || event.target.classList.contains('media-lightbox-stage')) close();
  });
  image.addEventListener('click', event => {
    event.stopPropagation();
    viewer.classList.toggle('media-lightbox--zoomed');
    image.setAttribute(
      'aria-label',
      viewer.classList.contains('media-lightbox--zoomed') ? '写真を画面内に戻す' : '写真を拡大する'
    );
  });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(viewer);
  document.body.style.overflow = 'hidden';
  closeButton.focus({ preventScroll: true });

  // A hydrated image already has a valid signed/blob URL. Reusing it makes
  // the viewer open immediately on mobile and avoids a second network lookup.
  const reveal = () => {
    if (closed) return;
    clearTimeout(loadTimer);
    loadTimer = null;
    viewer.classList.remove('media-lightbox--loading');
    viewer.classList.remove('media-lightbox--error');
    requestAnimationFrame(() => viewer.classList.add('media-lightbox--open'));
  };
  /** `fail`: 非同期処理を失敗として終了し、呼び出し元へエラーを返す。 */
  const fail = () => {
    if (closed) return;
    clearTimeout(loadTimer);
    loadTimer = null;
    viewer.classList.remove('media-lightbox--loading');
    viewer.classList.add('media-lightbox--error');
  };
  /** 候補URLをライトボックスへ読み込み、失効URLなら保存パスから一度だけ再取得する。 */
  const loadSource = async (candidate, { allowRefresh = true } = {}) => {
    if (closed) return;
    const attempt = ++loadAttempt;
    const value = String(candidate || '').trim();
    if (!value) {
      if (allowRefresh && path) {
        const fresh = await resolvePlannerImageUrl(path, {
          persistent: trigger?.dataset?.mediaPersist === '1',
          forceRefresh: true,
        });
        if (attempt === loadAttempt) await loadSource(fresh, { allowRefresh: false });
      } else fail();
      return;
    }
    viewer.classList.add('media-lightbox--loading');
    viewer.classList.remove('media-lightbox--error', 'media-lightbox--open');
    image.onload = () => { if (attempt === loadAttempt) reveal(); };
    /** 失効URLや通信失敗時は、保存パスから一度だけ新しいURLを取り直す。 */
    const retryOrFail = async () => {
      if (attempt !== loadAttempt) return;
      clearTimeout(loadTimer);
      loadTimer = null;
      if (allowRefresh && path) {
        const fresh = await resolvePlannerImageUrl(path, {
          persistent: trigger?.dataset?.mediaPersist === '1',
          forceRefresh: true,
        });
        if (attempt === loadAttempt) await loadSource(fresh, { allowRefresh: false });
      } else fail();
    };
    image.onerror = retryOrFail;
    // タイマーをsrc設定より先に用意し、同期的に読み込みが完了してもrevealで解除できるようにする。
    clearTimeout(loadTimer);
    loadTimer = setTimeout(retryOrFail, 12000);
    image.src = value;
    if (image.complete && image.naturalWidth > 0) reveal();
  };

  image.setAttribute('role', 'button');
  image.setAttribute('tabindex', '0');
  image.setAttribute('aria-label', '写真を拡大する');
  image.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    image.click();
  });
  await loadSource(String(src || '').trim(), { allowRefresh: true });
}

/** Storage・永続キャッシュ・URLキャッシュから同じ画像を削除する。 */
export async function deletePlannerImage(path) {
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return true;
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId || !isOwnedMediaPath(cleanPath, userId)) return false;
  const { error } = await client.storage.from(BUCKET).remove([cleanPath]);
  urlCache.delete(cleanPath);
  revokeCachedBlobUrl(cleanPath);
  await deletePersistentImage(cleanPath);
  return !error;
}

/** `resolvePersistentImageUrl`: 条件に合う永続・画像・URLを探して返す。 */
async function resolvePersistentImageUrl(path) {
  const existingUrl = blobUrlCache.get(path);
  if (existingUrl) return existingUrl;
  if (!('caches' in globalThis)) return '';
  try {
    const cache = await caches.open(PERSISTENT_IMAGE_CACHE);
    const response = await cache.match(persistentCacheKey(path));
    if (!response) return '';
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return '';
    return createCachedBlobUrl(path, blob);
  } catch {
    return '';
  }
}

/** 画像BlobをCache Storageへ長期保存し、ホーム画像キャッシュの古い項目を整理する。 */
async function writePersistentImage(path, blob) {
  if (!path || !(blob instanceof Blob) || !('caches' in globalThis)) return false;
  try {
    const cache = await caches.open(PERSISTENT_IMAGE_CACHE);
    await cache.put(
      persistentCacheKey(path),
      new Response(blob, {
        headers: {
          'Content-Type': blob.type || 'image/jpeg',
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      })
    );
    await prunePersistentHomeImages(cache, path);
    revokeCachedBlobUrl(path);
    return true;
  } catch {
    return false;
  }
}

/** `prunePersistentHomeImages`: 永続・Home・Imagesを安全に終了または削除する。 */
async function prunePersistentHomeImages(cache, currentPath) {
  const parts = String(currentPath).split('/');
  if (parts.length < 3 || parts[1] !== 'home') return;
  const ownerPrefix = `${parts[0]}/home/`;
  const requests = await cache.keys();
  await Promise.all(requests.map(async request => {
    const encodedPath = new URL(request.url).pathname.split('/').pop() || '';
    let cachedPath = '';
    try {
      cachedPath = decodeURIComponent(encodedPath);
    } catch {
      return;
    }
    if (cachedPath !== currentPath && cachedPath.startsWith(ownerPrefix)) {
      revokeCachedBlobUrl(cachedPath);
      await cache.delete(request);
    }
  }));
}

/** `deletePersistentImage`: 永続・画像を安全に終了または削除する。 */
async function deletePersistentImage(path) {
  if (!('caches' in globalThis)) return false;
  try {
    const cache = await caches.open(PERSISTENT_IMAGE_CACHE);
    return cache.delete(persistentCacheKey(path));
  } catch {
    return false;
  }
}

/** `persistentCacheKey`: 永続画像URLを端末キャッシュへ保存するためのキーを作る。 */
function persistentCacheKey(path) {
  return new Request(
    `${location.origin}/__planner-image-cache__/${encodeURIComponent(path)}`,
    { credentials: 'same-origin' }
  );
}

/** `createCachedBlobUrl`: 受け取った情報からCached・一時画像・URLを作る。 */
function createCachedBlobUrl(path, blob) {
  const existing = blobUrlCache.get(path);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(path, url);
  return url;
}

/** `revokeCachedBlobUrl`: Cached・一時画像・URLを安全に終了または削除する。 */
function revokeCachedBlobUrl(path) {
  const url = blobUrlCache.get(path);
  if (!url) return;
  URL.revokeObjectURL(url);
  blobUrlCache.delete(path);
}

/** 長辺とJPEG品質を抑え、同期速度とStorage使用量を安定させる。 */
async function compressImage(file) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const { width, height } = scaledImageDimensions(
      image.naturalWidth,
      image.naturalHeight,
      MAX_EDGE,
    );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => {
        if (result) resolve(result);
        else reject(new Error('画像を圧縮できませんでした'));
      }, 'image/jpeg', JPEG_QUALITY);
    });
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

/** URLをHTMLImageElementとして非同期読込し、圧縮処理で使える状態にして返す。 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('この画像形式を読み込めませんでした'));
    image.src = url;
  });
}
