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
const urlCache = new Map();
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

export async function resolvePlannerImageUrl(path) {
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return '';
  const cached = urlCache.get(cleanPath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const client = await getClient();
  if (!client) return '';
  const { data, error } = await client.storage
    .from(BUCKET)
    .createSignedUrl(cleanPath, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return '';

  urlCache.set(cleanPath, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_URL_TTL - 120) * 1000,
  });
  return data.signedUrl;
}

export async function hydratePlannerImages(root) {
  const images = [...(root?.querySelectorAll?.('img[data-media-path]') || [])];
  await Promise.all(images.map(async image => {
    const path = image.dataset.mediaPath;
    if (!path || image.dataset.mediaLoaded === '1') return;
    const url = await resolvePlannerImageUrl(path);
    if (!image.isConnected) return;
    if (!url) {
      image.closest('.media-frame')?.classList.add('media-frame--error');
      return;
    }
    image.src = url;
    image.dataset.mediaLoaded = '1';
    image.closest('.media-frame')?.classList.remove('media-frame--loading');
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
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(viewer);
  document.body.style.overflow = 'hidden';
  closeButton.focus({ preventScroll: true });

  const resolvedSrc = path ? await resolvePlannerImageUrl(path) : src;
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
  if (!error) urlCache.delete(cleanPath);
  return !error;
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
