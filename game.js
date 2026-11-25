(function () {
  const WORLD_HEIGHT = 640;
  const GROUND_HEIGHT = 76;
  const PLAYABLE_HEIGHT = WORLD_HEIGHT - GROUND_HEIGHT;

  const GRAVITY = 1520;
  const FLAP_VELOCITY = -455;
  const MAX_FALL_SPEED = 640;

  const PIPE_WIDTH = 72;
  const PIPE_CAP_HEIGHT = 26;
  const PIPE_CAP_OVERHANG = 6;

  const BASE_PIPE_SPEED = 198;
  const MAX_PIPE_SPEED = 325;
  const BASE_PIPE_GAP = 166;
  const MIN_PIPE_GAP = 138;
  const PIPE_SPACING = 258;

  const CHARACTER_DRAW_HEIGHT = 68;
  const CHARACTER_HIT_RADIUS = 19;

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const scoreDisplay = document.getElementById('score-display');
  const pauseBtn = document.getElementById('pause-btn');
  const readyOverlay = document.getElementById('ready-overlay');
  const playBtn = document.getElementById('play-btn');
  const pausedOverlay = document.getElementById('paused-overlay');
  const pausedScore = document.getElementById('paused-score');
  const resumeBtn = document.getElementById('resume-btn');
  const pausedRestartBtn = document.getElementById('paused-restart-btn');
  const gameoverOverlay = document.getElementById('gameover-overlay');
  const gameoverScore = document.getElementById('gameover-score');
  const gameoverRestartBtn = document.getElementById('gameover-restart-btn');

  // --- Sound Effects (Web Audio API) ---
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playFlapSound() {
    const ac = ensureAudio();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.09);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  function playScoreSound() {
    const ac = ensureAudio();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.setValueAtTime(880, now + 0.06);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  function playHitSound() {
    const ac = ensureAudio();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.2);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  // --- Character Extraction from Uploaded Asset ---
  let characterSprite = null;

  function isPaperPixel(r, g, b) {
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return minC > 192 && maxC - minC < 26;
  }

  function extractCharacter(img) {
    const cropX = Math.floor(img.naturalWidth * 0.08);
    const cropY = Math.floor(img.naturalHeight * 0.21);
    const cropW = Math.floor(img.naturalWidth * 0.70);
    const cropH = Math.floor(img.naturalHeight * 0.51);

    const work = document.createElement('canvas');
    work.width = cropW;
    work.height = cropH;
    const wCtx = work.getContext('2d', { willReadFrequently: true });
    wCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const imageData = wCtx.getImageData(0, 0, cropW, cropH);
    const data = imageData.data;
    const total = cropW * cropH;

    const visited = new Uint8Array(total);
    const removed = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    function tryEnqueue(idx) {
      if (visited[idx]) return;
      visited[idx] = 1;
      const p = idx * 4;
      if (isPaperPixel(data[p], data[p + 1], data[p + 2])) {
        removed[idx] = 1;
        queue[tail++] = idx;
      }
    }

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

    wCtx.putImageData(imageData, 0, 0);

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
    trimmed.getContext('2d').drawImage(work, tx, ty, tw, th, 0, 0, tw, th);
    return { canvas: trimmed, width: tw, height: th };
  }

  const charImg = new Image();
  charImg.onload = function () {
    characterSprite = extractCharacter(charImg);
  };
  charImg.src = window.CHARACTER_ASSET_DATA_URL || './character.jpg';

  // --- Simulation State ---
  function createInitialClouds(worldWidth) {
    const count = Math.max(4, Math.ceil(worldWidth / 240) + 1);
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: i * 240 + (i % 2) * 60,
        y: 75 + (i % 3) * 68,
        width: 90 + (i % 3) * 28,
        speedFactor: 0.14 + (i % 3) * 0.05,
        opacity: 0.78 + (i % 2) * 0.14,
      });
    }
    return list;
  }

  const sim = {
    state: 'READY',
    worldWidth: 480,
    scale: 1,
    playerX: 130,
    playerY: PLAYABLE_HEIGHT * 0.45,
    vy: 0,
    rotation: 0,
    squash: 1,
    score: 0,
    pipes: [],
    particles: [],
    clouds: createInitialClouds(960),
    groundOffset: 0,
    hillOffset: 0,
    elapsed: 0,
    shakeTime: 0,
    flashAlpha: 0,
    gameOverTimestamp: 0,
  };

  function computePlayerX(worldWidth) {
    return Math.max(76, Math.min(worldWidth * 0.28, 280));
  }

  function syncUI() {
    scoreDisplay.textContent = String(sim.score);
    pausedScore.textContent = String(sim.score);
    gameoverScore.textContent = String(sim.score);

    pauseBtn.classList.toggle('hidden', sim.state !== 'PLAYING');
    readyOverlay.classList.toggle('hidden', sim.state !== 'READY');
    pausedOverlay.classList.toggle('hidden', sim.state !== 'PAUSED');
    gameoverOverlay.classList.toggle('hidden', sim.state !== 'GAME_OVER');
  }

  function spawnPipe(spawnX) {
    const gapHeight = Math.max(MIN_PIPE_GAP, BASE_PIPE_GAP - sim.score * 0.9);
    const margin = 78;
    const minCenter = margin + gapHeight / 2;
    const maxCenter = PLAYABLE_HEIGHT - margin - gapHeight / 2;

    let gapY;
    const lastPipe = sim.pipes[sim.pipes.length - 1];
    if (lastPipe) {
      const maxDelta = 170;
      const low = Math.max(minCenter, lastPipe.gapY - maxDelta);
      const high = Math.min(maxCenter, lastPipe.gapY + maxDelta);
      gapY = low + Math.random() * (high - low);
    } else {
      gapY = minCenter + Math.random() * (maxCenter - minCenter);
    }

    sim.pipes.push({
      x: spawnX,
      gapY: gapY,
      gapHeight: gapHeight,
      passed: false,
    });
  }

  function spawnFlapParticles() {
    for (let i = 0; i < 5; i++) {
      sim.particles.push({
        x: sim.playerX - 12 + (Math.random() - 0.5) * 10,
        y: sim.playerY + 14 + (Math.random() - 0.5) * 8,
        vx: -65 - Math.random() * 65,
        vy: 35 + Math.random() * 60,
        radius: 3 + Math.random() * 3.5,
        alpha: 0.85,
        color: '#FFFFFF',
      });
    }
  }

  function spawnScoreParticles() {
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      const speed = 55 + Math.random() * 55;
      sim.particles.push({
        x: sim.playerX,
        y: sim.playerY - 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 3 + Math.random() * 2.5,
        alpha: 0.95,
        color: '#FDE047',
      });
    }
  }

  function resetWorld(nextState) {
    sim.state = nextState;
    sim.playerX = computePlayerX(sim.worldWidth);
    sim.playerY = PLAYABLE_HEIGHT * 0.45;
    sim.vy = 0;
    sim.rotation = 0;
    sim.squash = 1;
    sim.score = 0;
    sim.pipes = [];
    sim.particles = [];
    sim.shakeTime = 0;
    sim.flashAlpha = 0;

    if (nextState === 'PLAYING') {
      spawnPipe(Math.max(sim.worldWidth * 0.85, sim.playerX + 340));
    }
    syncUI();
  }

  function performFlap() {
    ensureAudio();
    if (sim.state === 'READY') {
      resetWorld('PLAYING');
      sim.vy = FLAP_VELOCITY;
      sim.squash = 1.15;
      sim.rotation = -0.38;
      spawnFlapParticles();
      playFlapSound();
      return;
    }

    if (sim.state === 'PLAYING') {
      sim.vy = FLAP_VELOCITY;
      sim.squash = 1.15;
      spawnFlapParticles();
      playFlapSound();
    }
  }

  function handlePlay() {
    ensureAudio();
    if (sim.state === 'READY') {
      performFlap();
    } else if (sim.state === 'PAUSED') {
      sim.state = 'PLAYING';
      syncUI();
    }
  }

  function handlePause() {
    if (sim.state === 'PLAYING') {
      sim.state = 'PAUSED';
      syncUI();
    }
  }

  function handleRestart() {
    ensureAudio();
    resetWorld('PLAYING');
    sim.vy = FLAP_VELOCITY * 0.85;
    sim.squash = 1.12;
    playFlapSound();
  }

  // --- Controls ---
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (sim.state === 'READY' || sim.state === 'PLAYING') {
      performFlap();
    }
  });

  playBtn.addEventListener('click', handlePlay);
  resumeBtn.addEventListener('click', handlePlay);
  pauseBtn.addEventListener('click', handlePause);
  pausedRestartBtn.addEventListener('click', handleRestart);
  gameoverRestartBtn.addEventListener('click', handleRestart);

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      if (sim.state === 'READY' || sim.state === 'PLAYING') {
        performFlap();
      } else if (sim.state === 'PAUSED') {
        handlePlay();
      } else if (
        sim.state === 'GAME_OVER' &&
        performance.now() - sim.gameOverTimestamp > 320
      ) {
        handleRestart();
      }
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (sim.state === 'PLAYING') {
        handlePause();
      } else if (sim.state === 'PAUSED') {
        handlePlay();
      }
    }
  });

  window.addEventListener('blur', function () {
    if (sim.state === 'PLAYING') {
      handlePause();
    }
  });

  // --- Resize & Collision Helpers ---
  function resizeCanvas() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const cssWidth = rect.width > 0 ? rect.width : window.innerWidth || 480;
    const cssHeight = rect.height > 0 ? rect.height : window.innerHeight || 640;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    canvas.height = Math.max(1, Math.floor(cssHeight * dpr));

    sim.scale = cssHeight / WORLD_HEIGHT;
    sim.worldWidth = cssWidth / sim.scale;
    sim.playerX = computePlayerX(sim.worldWidth);

    if (Number.isFinite(sim.worldWidth) && sim.clouds.length < Math.ceil(sim.worldWidth / 240) + 1) {
      sim.clouds = createInitialClouds(sim.worldWidth + 240);
    }
  }

  function circleIntersectsRect(cx, cy, cr, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy < cr * cr;
  }

  function triggerGameOver() {
    if (sim.state === 'GAME_OVER') return;
    sim.state = 'GAME_OVER';
    sim.shakeTime = 0.22;
    sim.flashAlpha = 0.45;
    sim.gameOverTimestamp = performance.now();
    playHitSound();
    syncUI();
  }

  // --- Main Loop ---
  function update(dt) {
    sim.elapsed += dt;

    if (sim.shakeTime > 0) sim.shakeTime = Math.max(0, sim.shakeTime - dt);
    if (sim.flashAlpha > 0) sim.flashAlpha = Math.max(0, sim.flashAlpha - dt * 2.4);

    if (sim.state === 'PAUSED') return;

    const currentSpeed =
      sim.state === 'PLAYING'
        ? Math.min(MAX_PIPE_SPEED, BASE_PIPE_SPEED + sim.score * 3.2)
        : sim.state === 'READY'
          ? BASE_PIPE_SPEED * 0.55
          : 0;

    for (let i = 0; i < sim.clouds.length; i++) {
      const cloud = sim.clouds[i];
      cloud.x -= Math.max(18, currentSpeed * cloud.speedFactor) * dt;
      if (cloud.x + cloud.width < -40) {
        cloud.x = sim.worldWidth + 40 + Math.random() * 80;
      }
    }

    if (sim.state === 'READY' || sim.state === 'PLAYING') {
      sim.groundOffset = (sim.groundOffset + currentSpeed * dt) % 48;
      sim.hillOffset = (sim.hillOffset + currentSpeed * 0.22 * dt) % 320;
    }

    for (let i = sim.particles.length - 1; i >= 0; i--) {
      const p = sim.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= dt * 2.2;
      if (p.alpha <= 0) sim.particles.splice(i, 1);
    }

    if (sim.state === 'READY') {
      sim.playerY = PLAYABLE_HEIGHT * 0.45 + Math.sin(sim.elapsed * 3.6) * 9;
      sim.rotation = Math.sin(sim.elapsed * 3.6) * 0.05;
      return;
    }

    if (sim.state === 'GAME_OVER') {
      if (sim.playerY + CHARACTER_HIT_RADIUS < PLAYABLE_HEIGHT) {
        sim.vy = Math.min(MAX_FALL_SPEED, sim.vy + GRAVITY * dt);
        sim.playerY = Math.min(PLAYABLE_HEIGHT - CHARACTER_HIT_RADIUS, sim.playerY + sim.vy * dt);
        sim.rotation = Math.min(1.25, sim.rotation + dt * 4.5);
      }
      return;
    }

    sim.vy = Math.min(MAX_FALL_SPEED, sim.vy + GRAVITY * dt);
    sim.playerY += sim.vy * dt;
    sim.squash += (1 - sim.squash) * Math.min(1, dt * 12);

    const targetRotation =
      sim.vy < 0
        ? -0.36
        : Math.min(1.05, ((sim.vy - 40) / (MAX_FALL_SPEED - 40)) * 1.12);
    sim.rotation += (targetRotation - sim.rotation) * Math.min(1, dt * 9);

    if (sim.playerY < CHARACTER_HIT_RADIUS + 4) {
      sim.playerY = CHARACTER_HIT_RADIUS + 4;
      if (sim.vy < 0) sim.vy = 0;
    }

    if (sim.playerY + CHARACTER_HIT_RADIUS >= PLAYABLE_HEIGHT) {
      sim.playerY = PLAYABLE_HEIGHT - CHARACTER_HIT_RADIUS;
      triggerGameOver();
      return;
    }

    const lastPipe = sim.pipes[sim.pipes.length - 1];
    if (!lastPipe || sim.worldWidth - lastPipe.x >= PIPE_SPACING) {
      spawnPipe(Math.max(sim.worldWidth + 24, lastPipe ? lastPipe.x + PIPE_SPACING : sim.worldWidth + 24));
    }

    for (let i = sim.pipes.length - 1; i >= 0; i--) {
      const pipe = sim.pipes[i];
      pipe.x -= currentSpeed * dt;

      if (!pipe.passed && pipe.x + PIPE_WIDTH / 2 < sim.playerX) {
        pipe.passed = true;
        sim.score += 1;
        syncUI();
        spawnScoreParticles();
        playScoreSound();
      }

      const topHeight = pipe.gapY - pipe.gapHeight / 2;
      const bottomY = pipe.gapY + pipe.gapHeight / 2;
      const bottomHeight = PLAYABLE_HEIGHT - bottomY;

      const hitTopShaft = circleIntersectsRect(sim.playerX, sim.playerY, CHARACTER_HIT_RADIUS, pipe.x, -200, PIPE_WIDTH, topHeight + 200);
      const hitTopCap = circleIntersectsRect(sim.playerX, sim.playerY, CHARACTER_HIT_RADIUS, pipe.x - PIPE_CAP_OVERHANG, topHeight - PIPE_CAP_HEIGHT, PIPE_WIDTH + PIPE_CAP_OVERHANG * 2, PIPE_CAP_HEIGHT);
      const hitBottomShaft = circleIntersectsRect(sim.playerX, sim.playerY, CHARACTER_HIT_RADIUS, pipe.x, bottomY, PIPE_WIDTH, bottomHeight);
      const hitBottomCap = circleIntersectsRect(sim.playerX, sim.playerY, CHARACTER_HIT_RADIUS, pipe.x - PIPE_CAP_OVERHANG, bottomY, PIPE_WIDTH + PIPE_CAP_OVERHANG * 2, PIPE_CAP_HEIGHT);

      if (hitTopShaft || hitTopCap || hitBottomShaft || hitBottomCap) {
        triggerGameOver();
        return;
      }

      if (pipe.x + PIPE_WIDTH + PIPE_CAP_OVERHANG * 2 < -20) {
        sim.pipes.splice(i, 1);
      }
    }
  }

  function drawPipe(x, y, width, height, capAtBottom) {
    if (height <= 0) return;

    ctx.fillStyle = '#22C55E';
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = '#4ADE80';
    ctx.fillRect(x + 8, y, 10, height);
    ctx.fillStyle = '#86EFAC';
    ctx.fillRect(x + 11, y, 3, height);
    ctx.fillStyle = '#16A34A';
    ctx.fillRect(x + width - 14, y, 14, height);

    ctx.strokeStyle = '#14532D';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, width, height);

    const capX = x - PIPE_CAP_OVERHANG;
    const capW = width + PIPE_CAP_OVERHANG * 2;
    const capY = capAtBottom ? y + height - PIPE_CAP_HEIGHT : y;

    ctx.fillStyle = '#22C55E';
    ctx.fillRect(capX, capY, capW, PIPE_CAP_HEIGHT);

    ctx.fillStyle = '#4ADE80';
    ctx.fillRect(capX + 8, capY + 2, 12, PIPE_CAP_HEIGHT - 4);
    ctx.fillStyle = '#16A34A';
    ctx.fillRect(capX + capW - 15, capY + 2, 13, PIPE_CAP_HEIGHT - 4);

    ctx.strokeStyle = '#14532D';
    ctx.lineWidth = 3;
    ctx.strokeRect(capX, capY, capW, PIPE_CAP_HEIGHT);
  }

  function render() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const totalScale = sim.scale * dpr;

    ctx.save();
    ctx.setTransform(totalScale, 0, 0, totalScale, 0, 0);

    if (sim.shakeTime > 0) {
      const mag = (sim.shakeTime / 0.22) * 8;
      ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
    }

    const skyGrad = ctx.createLinearGradient(0, 0, 0, PLAYABLE_HEIGHT);
    skyGrad.addColorStop(0, '#38BDF8');
    skyGrad.addColorStop(0.6, '#7DD3FC');
    skyGrad.addColorStop(1, '#E0F2FE');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-20, -20, sim.worldWidth + 40, PLAYABLE_HEIGHT + 30);

    for (let i = 0; i < sim.clouds.length; i++) {
      const c = sim.clouds[i];
      ctx.save();
      ctx.globalAlpha = c.opacity;
      ctx.fillStyle = '#FFFFFF';
      const r = c.width * 0.24;
      ctx.beginPath();
      ctx.arc(c.x + r, c.y, r * 0.85, 0, Math.PI * 2);
      ctx.arc(c.x + c.width * 0.45, c.y - r * 0.35, r * 1.1, 0, Math.PI * 2);
      ctx.arc(c.x + c.width * 0.78, c.y, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = '#86EFAC';
    const hillSpan = 320;
    const hillCount = Math.ceil(sim.worldWidth / hillSpan) + 2;
    for (let i = -1; i < hillCount; i++) {
      const hx = i * hillSpan - sim.hillOffset;
      ctx.beginPath();
      ctx.arc(hx + 100, PLAYABLE_HEIGHT + 24, 130, Math.PI, 0);
      ctx.arc(hx + 250, PLAYABLE_HEIGHT + 36, 110, Math.PI, 0);
      ctx.fill();
    }

    for (let i = 0; i < sim.pipes.length; i++) {
      const pipe = sim.pipes[i];
      const topHeight = pipe.gapY - pipe.gapHeight / 2;
      const bottomY = pipe.gapY + pipe.gapHeight / 2;
      const bottomHeight = PLAYABLE_HEIGHT - bottomY;

      drawPipe(pipe.x, -4, PIPE_WIDTH, topHeight + 4, true);
      drawPipe(pipe.x, bottomY, PIPE_WIDTH, bottomHeight, false);
    }

    for (let i = 0; i < sim.particles.length; i++) {
      const p = sim.particles[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = '#D6B678';
    ctx.fillRect(-20, PLAYABLE_HEIGHT, sim.worldWidth + 40, GROUND_HEIGHT + 20);

    const grassH = 20;
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(-20, PLAYABLE_HEIGHT, sim.worldWidth + 40, grassH);

    ctx.fillStyle = '#66BB6A';
    const stripeW = 24;
    const stripeCount = Math.ceil((sim.worldWidth + 96) / 48) + 2;
    for (let i = -1; i < stripeCount; i++) {
      const sx = i * 48 - sim.groundOffset;
      ctx.beginPath();
      ctx.moveTo(sx, PLAYABLE_HEIGHT);
      ctx.lineTo(sx + stripeW, PLAYABLE_HEIGHT);
      ctx.lineTo(sx + stripeW - 10, PLAYABLE_HEIGHT + grassH);
      ctx.lineTo(sx - 10, PLAYABLE_HEIGHT + grassH);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = '#1B5E20';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-20, PLAYABLE_HEIGHT);
    ctx.lineTo(sim.worldWidth + 20, PLAYABLE_HEIGHT);
    ctx.moveTo(-20, PLAYABLE_HEIGHT + grassH);
    ctx.lineTo(sim.worldWidth + 20, PLAYABLE_HEIGHT + grassH);
    ctx.stroke();

    ctx.save();
    ctx.translate(sim.playerX, sim.playerY);
    ctx.rotate(sim.rotation);
    ctx.scale(2 - sim.squash, sim.squash);

    if (characterSprite) {
      const aspect = characterSprite.width / characterSprite.height;
      const drawH = CHARACTER_DRAW_HEIGHT;
      const drawW = drawH * aspect;
      ctx.drawImage(characterSprite.canvas, -drawW / 2, -drawH / 2, drawW, drawH);
    } else {
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(0, 0, CHARACTER_HIT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (sim.flashAlpha > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, ' + sim.flashAlpha + ')';
      ctx.fillRect(-20, -20, sim.worldWidth + 40, WORLD_HEIGHT + 40);
    }

    ctx.restore();
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  syncUI();

  let lastTime = performance.now();
  function tick(now) {
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0), 0.05);
    update(dt);
    render();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
