export const CHARACTER_ASSET_URL =
  '/assets/aistudio/Screenshot_2026-11-25-03-38-43-393_com.vblast.flipaclip_12359ee3.jpg';

export interface CharacterSprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

function isPaperPixel(r: number, g: number, b: number): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  return minC > 192 && maxC - minC < 26;
}

function extractCharacterFromUpload(img: HTMLImageElement): CharacterSprite {
  // Crop strictly inside the FlipaClip canvas region where the character is drawn
  const cropX = Math.floor(img.naturalWidth * 0.08);
  const cropY = Math.floor(img.naturalHeight * 0.21);
  const cropW = Math.floor(img.naturalWidth * 0.70);
  const cropH = Math.floor(img.naturalHeight * 0.51);

  const work = document.createElement('canvas');
  work.width = cropW;
  work.height = cropH;
  const ctx = work.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return { canvas: work, width: cropW, height: cropH };
  }

  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  const imageData = ctx.getImageData(0, 0, cropW, cropH);
  const data = imageData.data;
  const total = cropW * cropH;

  // Edge-seeded BFS flood-fill removes the white/cream paper background
  // while leaving all internal character pixels untouched.
  const visited = new Uint8Array(total);
  const removed = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const tryEnqueue = (idx: number) => {
    if (visited[idx]) return;
    visited[idx] = 1;
    const p = idx * 4;
    if (isPaperPixel(data[p], data[p + 1], data[p + 2])) {
      removed[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < cropW; x++) {
    tryEnqueue(x);
    tryEnqueue((cropH - 1) * cropW + x);
  }
  for (let y = 0; y < cropH; y++) {
    tryEnqueue(y * cropW);
    tryEnqueue(y * cropW + (cropW - 1));
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % cropW;
    const y = (idx - x) / cropW;

    if (x > 0) tryEnqueue(idx - 1);
    if (x < cropW - 1) tryEnqueue(idx + 1);
    if (y > 0) tryEnqueue(idx - cropW);
    if (y < cropH - 1) tryEnqueue(idx + cropW);
  }

  // Apply transparency to removed background and soften 1px light fringe
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    if (removed[i]) {
      data[p + 3] = 0;
      continue;
    }

    const x = i % cropW;
    const y = (i - x) / cropW;
    const touchesRemoved =
      (x > 0 && removed[i - 1]) ||
      (x < cropW - 1 && removed[i + 1]) ||
      (y > 0 && removed[i - cropW]) ||
      (y < cropH - 1 && removed[i + cropW]);

    if (touchesRemoved) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const avg = (r + g + b) / 3;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (avg > 175 && chroma < 24) {
        data[p + 3] = Math.round(Math.max(0, (220 - avg) * 4));
      }
    }
  }

  // Filter out tiny stray paper grain specks so tight bounds fit only the character
  const compVisited = new Uint8Array(total);
  const compQueue = new Int32Array(total);
  const compCells = new Int32Array(total);

  for (let i = 0; i < total; i++) {
    if (compVisited[i] || data[i * 4 + 3] === 0) continue;

    let cHead = 0;
    let cTail = 0;
    compVisited[i] = 1;
    compQueue[cTail] = i;
    compCells[cTail++] = i;

    while (cHead < cTail) {
      const cur = compQueue[cHead++];
      const cx = cur % cropW;
      const cy = (cur - cx) / cropW;

      const neighbors = [
        cx > 0 ? cur - 1 : -1,
        cx < cropW - 1 ? cur + 1 : -1,
        cy > 0 ? cur - cropW : -1,
        cy < cropH - 1 ? cur + cropW : -1,
      ];

      for (let k = 0; k < 4; k++) {
        const nb = neighbors[k];
        if (nb >= 0 && !compVisited[nb] && data[nb * 4 + 3] > 0) {
          compVisited[nb] = 1;
          compQueue[cTail] = nb;
          compCells[cTail++] = nb;
        }
      }
    }

    if (cTail < 28) {
      for (let j = 0; j < cTail; j++) {
        data[compCells[j] * 4 + 3] = 0;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Compute tight bounding box of the character
  let minX = cropW;
  let minY = cropH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      if (data[(y * cropW + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { canvas: work, width: cropW, height: cropH };
  }

  const pad = 2;
  const tx = Math.max(0, minX - pad);
  const ty = Math.max(0, minY - pad);
  const tw = Math.min(cropW - tx, maxX - minX + 1 + pad * 2);
  const th = Math.min(cropH - ty, maxY - minY + 1 + pad * 2);

  const trimmed = document.createElement('canvas');
  trimmed.width = tw;
  trimmed.height = th;
  const tCtx = trimmed.getContext('2d');
  if (tCtx) {
    tCtx.drawImage(work, tx, ty, tw, th, 0, 0, tw, th);
  }

  return { canvas: trimmed, width: tw, height: th };
}

export function loadCharacterSprite(): Promise<CharacterSprite> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve(extractCharacterFromUpload(img));
    };
    img.onerror = () => {
      reject(new Error('Failed to load character image'));
    };
    img.src = CHARACTER_ASSET_URL;
  });
}
