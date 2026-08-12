// ============================================================
// media.js - private, user-owned image storage helpers
// ============================================================

import { getClient, getUserId } from './supabase.js';
import { generateId } from './utils.js';

const BUCKET = 'planner-media';
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.84;
const SIGNED_URL_TTL = 60 * 60;
const PERSISTENT_IMAGE_CACHE = 'my-planner-images-v1';
const urlCache = new Map();
const blobUrlCache = new Map();
let activeViewerClose = null;

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
  const safeKind = String(kind || 'misc').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'misc';
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

export async function resolvePlannerImageUrl(path, { persistent = false } = {}) {
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return '';

  if (persistent) {
    const persistentUrl = await resolvePersistentImageUrl(cleanPath);
    if (persistentUrl) return persistentUrl;
  }

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
    const finish = () => {
      image.dataset.mediaLoaded = '1';
      frame?.classList.remove('media-frame--loading', 'media-frame--error');
    };
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

export function wirePlannerImageViewer(root) {
  if (!root?.addEventListener || root.dataset.mediaViewerWired === '1') return;
  root.dataset.mediaViewerWired = '1';

  const openFromTarget = target => {
    const image = target?.closest?.('img[data-media-view]');
    if (!image || !root.contains(image)) return false;
    openPlannerImageViewer({
      path: image.dataset.mediaPath,
      src: image.currentSrc || image.src,
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
      <img alt="${escapeAttribute(alt)}">
      ${caption ? `<div class="media-lightbox-caption">${escapeHtml(caption)}</div>` : ''}
    </div>
  `;

  const closeButton = viewer.querySelector('.media-lightbox-close');
  const image = viewer.querySelector('img');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    document.body.style.overflow = previousOverflow;
    viewer.remove();
    if (activeViewerClose === close) activeViewerClose = null;
    trigger?.focus?.({ preventScroll: true });
  };
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
  const visibleSrc = String(src || '').trim();
  const resolvedSrc = visibleSrc || (path
    ? await resolvePlannerImageUrl(path, {
        persistent: trigger?.dataset?.mediaPersist === '1',
      })
    : '');
  if (closed) return;
  if (!resolvedSrc) {
    viewer.classList.remove('media-lightbox--loading');
    viewer.classList.add('media-lightbox--error');
    return;
  }

  image.addEventListener('load', () => {
    viewer.classList.remove('media-lightbox--loading');
    requestAnimationFrame(() => viewer.classList.add('media-lightbox--open'));
  }, { once: true });
  image.addEventListener('error', () => {
    viewer.classList.remove('media-lightbox--loading');
    viewer.classList.add('media-lightbox--error');
  }, { once: true });
  image.src = resolvedSrc;
  image.setAttribute('role', 'button');
  image.setAttribute('tabindex', '0');
  image.setAttribute('aria-label', '写真を拡大する');
  image.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    image.click();
  });
  if (image.complete && image.naturalWidth > 0) {
    viewer.classList.remove('media-lightbox--loading');
    requestAnimationFrame(() => viewer.classList.add('media-lightbox--open'));
  }
}

export async function deletePlannerImage(path) {
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return true;
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId || !cleanPath.startsWith(`${userId}/`)) return false;
  const { error } = await client.storage.from(BUCKET).remove([cleanPath]);
  urlCache.delete(cleanPath);
  revokeCachedBlobUrl(cleanPath);
  await deletePersistentImage(cleanPath);
  return !error;
}

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

async function deletePersistentImage(path) {
  if (!('caches' in globalThis)) return false;
  try {
    const cache = await caches.open(PERSISTENT_IMAGE_CACHE);
    return cache.delete(persistentCacheKey(path));
  } catch {
    return false;
  }
}

function persistentCacheKey(path) {
  return new Request(
    `${location.origin}/__planner-image-cache__/${encodeURIComponent(path)}`,
    { credentials: 'same-origin' }
  );
}

function createCachedBlobUrl(path, blob) {
  const existing = blobUrlCache.get(path);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(path, url);
  return url;
}

function revokeCachedBlobUrl(path) {
  const url = blobUrlCache.get(path);
  if (!url) return;
  URL.revokeObjectURL(url);
  blobUrlCache.delete(path);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('\n', ' ');
}

async function compressImage(file) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
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

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('この画像形式を読み込めませんでした'));
    image.src = url;
  });
}
