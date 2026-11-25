import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import {
  BASE_PIPE_GAP,
  BASE_PIPE_SPEED,
  CHARACTER_DRAW_HEIGHT,
  CHARACTER_HIT_RADIUS,
  Cloud,
  FLAP_VELOCITY,
  GRAVITY,
  GROUND_HEIGHT,
  GameState,
  MAX_FALL_SPEED,
  MAX_PIPE_SPEED,
  MIN_PIPE_GAP,
  PIPE_CAP_HEIGHT,
  PIPE_CAP_OVERHANG,
  PIPE_SPACING,
  PIPE_WIDTH,
  PLAYABLE_HEIGHT,
  Particle,
  Pipe,
  WORLD_HEIGHT,
} from './game/types';
import { CharacterSprite, loadCharacterSprite } from './game/characterSprite';
import { soundEngine } from './game/sound';

interface Simulation {
  state: GameState;
  worldWidth: number;
  scale: number;
  playerX: number;
  playerY: number;
  vy: number;
  rotation: number;
  squash: number;
  score: number;
  pipes: Pipe[];
  particles: Particle[];
  clouds: Cloud[];
  groundOffset: number;
  hillOffset: number;
  elapsed: number;
  shakeTime: number;
  flashAlpha: number;
  gameOverTimestamp: number;
}

function circleIntersectsRect(
  cx: number,
  cy: number,
  cr: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < cr * cr;
}

function createInitialClouds(worldWidth: number): Cloud[] {
  const count = Math.max(4, Math.ceil(worldWidth / 240) + 1);
  const clouds: Cloud[] = [];
  for (let i = 0; i < count; i++) {
    clouds.push({
      x: i * 240 + (i % 2) * 60,
      y: 75 + (i % 3) * 68,
      width: 90 + (i % 3) * 28,
      speedFactor: 0.14 + (i % 3) * 0.05,
      opacity: 0.78 + (i % 2) * 0.14,
    });
  }
  return clouds;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spriteRef = useRef<CharacterSprite | null>(null);

  const [gameState, setGameState] = useState<GameState>('READY');
  const [score, setScore] = useState<number>(0);

  const simRef = useRef<Simulation>({
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
  });

  const computePlayerX = (worldWidth: number): number => {
    return Math.max(76, Math.min(worldWidth * 0.28, 280));
  };

  const spawnPipe = useCallback((sim: Simulation, spawnX: number) => {
    const gapHeight = Math.max(MIN_PIPE_GAP, BASE_PIPE_GAP - sim.score * 0.9);
    const margin = 78;
    const minCenter = margin + gapHeight / 2;
    const maxCenter = PLAYABLE_HEIGHT - margin - gapHeight / 2;

    let gapY: number;
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
      gapY,
      gapHeight,
      passed: false,
    });
  }, []);

  const spawnFlapParticles = (sim: Simulation) => {
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
  };

  const spawnScoreParticles = (sim: Simulation) => {
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
  };

  const resetWorld = useCallback(
    (nextState: GameState) => {
      const sim = simRef.current;
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
        spawnPipe(sim, Math.max(sim.worldWidth * 0.85, sim.playerX + 340));
      }

      setScore(0);
      setGameState(nextState);
    },
    [spawnPipe]
  );

  const performFlap = useCallback(() => {
    const sim = simRef.current;
    soundEngine.unlock();

    if (sim.state === 'READY') {
      resetWorld('PLAYING');
      sim.vy = FLAP_VELOCITY;
      sim.squash = 1.15;
      sim.rotation = -0.38;
      spawnFlapParticles(sim);
      soundEngine.playFlap();
      return;
    }

    if (sim.state === 'PLAYING') {
      sim.vy = FLAP_VELOCITY;
      sim.squash = 1.15;
      spawnFlapParticles(sim);
      soundEngine.playFlap();
    }
  }, [resetWorld]);

  const handlePlay = useCallback(() => {
    const sim = simRef.current;
    soundEngine.unlock();

    if (sim.state === 'READY') {
      performFlap();
    } else if (sim.state === 'PAUSED') {
      sim.state = 'PLAYING';
      setGameState('PLAYING');
    }
  }, [performFlap]);

  const handlePause = useCallback(() => {
    const sim = simRef.current;
    if (sim.state === 'PLAYING') {
      sim.state = 'PAUSED';
      setGameState('PAUSED');
    }
  }, []);

  const handleRestart = useCallback(() => {
    soundEngine.unlock();
    resetWorld('PLAYING');
    const sim = simRef.current;
    sim.vy = FLAP_VELOCITY * 0.85;
    sim.squash = 1.12;
    soundEngine.playFlap();
  }, [resetWorld]);

  // Load the uploaded character image asset once on mount
  useEffect(() => {
    let active = true;
    loadCharacterSprite()
      .then((sprite) => {
        if (active) {
          spriteRef.current = sprite;
        }
      })
      .catch(() => {
        // Asset unavailable fallback handled safely in render loop
      });
    return () => {
      active = false;
    };
  }, []);

  // Keyboard controls (Spacebar to fly, Escape/P to pause)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;

        const sim = simRef.current;
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
        const sim = simRef.current;
        if (sim.state === 'PLAYING') {
          handlePause();
        } else if (sim.state === 'PAUSED') {
          handlePlay();
        }
      }
    };

    const onBlur = () => {
      const sim = simRef.current;
      if (sim.state === 'PLAYING') {
        sim.state = 'PAUSED';
        setGameState('PAUSED');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [handlePause, handlePlay, handleRestart, performFlap]);

  // Main 60fps Canvas sizing + simulation + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const cssWidth = rect.width > 0 ? rect.width : window.innerWidth || 480;
      const cssHeight = rect.height > 0 ? rect.height : window.innerHeight || 640;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr));

      const scale = cssHeight / WORLD_HEIGHT;
      const worldWidth = cssWidth / scale;

      const sim = simRef.current;
      sim.scale = scale;
      sim.worldWidth = worldWidth;
      sim.playerX = computePlayerX(worldWidth);
      if (Number.isFinite(worldWidth) && sim.clouds.length < Math.ceil(worldWidth / 240) + 1) {
        sim.clouds = createInitialClouds(worldWidth + 240);
      }
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }
    window.addEventListener('resize', resizeCanvas);

    let rafId = 0;
    let lastTime = performance.now();

    const triggerGameOver = (sim: Simulation) => {
      if (sim.state === 'GAME_OVER') return;
      sim.state = 'GAME_OVER';
      sim.shakeTime = 0.22;
      sim.flashAlpha = 0.45;
      sim.gameOverTimestamp = performance.now();
      soundEngine.playHit();
      setGameState('GAME_OVER');
    };

    const update = (dt: number) => {
      const sim = simRef.current;
      sim.elapsed += dt;

      if (sim.shakeTime > 0) {
        sim.shakeTime = Math.max(0, sim.shakeTime - dt);
      }
      if (sim.flashAlpha > 0) {
        sim.flashAlpha = Math.max(0, sim.flashAlpha - dt * 2.4);
      }

      if (sim.state === 'PAUSED') {
        return;
      }

      const currentSpeed =
        sim.state === 'PLAYING'
          ? Math.min(MAX_PIPE_SPEED, BASE_PIPE_SPEED + sim.score * 3.2)
          : sim.state === 'READY'
            ? BASE_PIPE_SPEED * 0.55
            : 0;

      // Update clouds
      for (let i = 0; i < sim.clouds.length; i++) {
        const cloud = sim.clouds[i];
        cloud.x -= Math.max(18, currentSpeed * cloud.speedFactor) * dt;
        if (cloud.x + cloud.width < -40) {
          cloud.x = sim.worldWidth + 40 + Math.random() * 80;
        }
      }

      // Scroll ground & distant hills
      if (sim.state === 'READY' || sim.state === 'PLAYING') {
        sim.groundOffset = (sim.groundOffset + currentSpeed * dt) % 48;
        sim.hillOffset = (sim.hillOffset + currentSpeed * 0.22 * dt) % 320;
      }

      // Update particles
      for (let i = sim.particles.length - 1; i >= 0; i--) {
        const p = sim.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.alpha -= dt * 2.2;
        if (p.alpha <= 0) {
          sim.particles.splice(i, 1);
        }
      }

      if (sim.state === 'READY') {
        sim.playerY = PLAYABLE_HEIGHT * 0.45 + Math.sin(sim.elapsed * 3.6) * 9;
        sim.rotation = Math.sin(sim.elapsed * 3.6) * 0.05;
        return;
      }

      if (sim.state === 'GAME_OVER') {
        // Character falls to rest on ground if hit mid-air
        if (sim.playerY + CHARACTER_HIT_RADIUS < PLAYABLE_HEIGHT) {
          sim.vy = Math.min(MAX_FALL_SPEED, sim.vy + GRAVITY * dt);
          sim.playerY = Math.min(
            PLAYABLE_HEIGHT - CHARACTER_HIT_RADIUS,
            sim.playerY + sim.vy * dt
          );
          sim.rotation = Math.min(1.25, sim.rotation + dt * 4.5);
        }
        return;
      }

      // PLAYING simulation
      sim.vy = Math.min(MAX_FALL_SPEED, sim.vy + GRAVITY * dt);
      sim.playerY += sim.vy * dt;

      // Smooth squash recovery
      sim.squash += (1 - sim.squash) * Math.min(1, dt * 12);

      // Tilt upward on flap, pitch downward as fall accelerates
      const targetRotation =
        sim.vy < 0
          ? -0.36
          : Math.min(1.05, ((sim.vy - 40) / (MAX_FALL_SPEED - 40)) * 1.12);
      sim.rotation += (targetRotation - sim.rotation) * Math.min(1, dt * 9);

      // Keep within sky ceiling
      if (sim.playerY < CHARACTER_HIT_RADIUS + 4) {
        sim.playerY = CHARACTER_HIT_RADIUS + 4;
        if (sim.vy < 0) sim.vy = 0;
      }

      // Ground collision
      if (sim.playerY + CHARACTER_HIT_RADIUS >= PLAYABLE_HEIGHT) {
        sim.playerY = PLAYABLE_HEIGHT - CHARACTER_HIT_RADIUS;
        triggerGameOver(sim);
        return;
      }

      // Spawn new pipes on the right
      const lastPipe = sim.pipes[sim.pipes.length - 1];
      if (!lastPipe || sim.worldWidth - lastPipe.x >= PIPE_SPACING) {
        spawnPipe(sim, Math.max(sim.worldWidth + 24, lastPipe ? lastPipe.x + PIPE_SPACING : sim.worldWidth + 24));
      }

      // Move pipes, score, and check collisions
      for (let i = sim.pipes.length - 1; i >= 0; i--) {
        const pipe = sim.pipes[i];
        pipe.x -= currentSpeed * dt;

        if (!pipe.passed && pipe.x + PIPE_WIDTH / 2 < sim.playerX) {
          pipe.passed = true;
          sim.score += 1;
          setScore(sim.score);
          spawnScoreParticles(sim);
          soundEngine.playScore();
        }

        const topHeight = pipe.gapY - pipe.gapHeight / 2;
        const bottomY = pipe.gapY + pipe.gapHeight / 2;
        const bottomHeight = PLAYABLE_HEIGHT - bottomY;

        const hitTopShaft = circleIntersectsRect(
          sim.playerX,
          sim.playerY,
          CHARACTER_HIT_RADIUS,
          pipe.x,
          -200,
          PIPE_WIDTH,
          topHeight + 200
        );
        const hitTopCap = circleIntersectsRect(
          sim.playerX,
          sim.playerY,
          CHARACTER_HIT_RADIUS,
          pipe.x - PIPE_CAP_OVERHANG,
          topHeight - PIPE_CAP_HEIGHT,
          PIPE_WIDTH + PIPE_CAP_OVERHANG * 2,
          PIPE_CAP_HEIGHT
        );
        const hitBottomShaft = circleIntersectsRect(
          sim.playerX,
          sim.playerY,
          CHARACTER_HIT_RADIUS,
          pipe.x,
          bottomY,
          PIPE_WIDTH,
          bottomHeight
        );
        const hitBottomCap = circleIntersectsRect(
          sim.playerX,
          sim.playerY,
          CHARACTER_HIT_RADIUS,
          pipe.x - PIPE_CAP_OVERHANG,
          bottomY,
          PIPE_WIDTH + PIPE_CAP_OVERHANG * 2,
          PIPE_CAP_HEIGHT
        );

        if (hitTopShaft || hitTopCap || hitBottomShaft || hitBottomCap) {
          triggerGameOver(sim);
          return;
        }

        if (pipe.x + PIPE_WIDTH + PIPE_CAP_OVERHANG * 2 < -20) {
          sim.pipes.splice(i, 1);
        }
      }
    };

    const drawPipe = (
      x: number,
      y: number,
      width: number,
      height: number,
      capAtBottom: boolean
    ) => {
      if (height <= 0) return;

      // Main pipe body
      ctx.fillStyle = '#22C55E';
      ctx.fillRect(x, y, width, height);

      // Left highlight & right shading
      ctx.fillStyle = '#4ADE80';
      ctx.fillRect(x + 8, y, 10, height);
      ctx.fillStyle = '#86EFAC';
      ctx.fillRect(x + 11, y, 3, height);
      ctx.fillStyle = '#16A34A';
      ctx.fillRect(x + width - 14, y, 14, height);

      ctx.strokeStyle = '#14532D';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);

      // Pipe cap
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
    };

    const render = () => {
      const sim = simRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const totalScale = sim.scale * dpr;

      ctx.save();
      ctx.setTransform(totalScale, 0, 0, totalScale, 0, 0);

      // Apply decaying impact shake
      if (sim.shakeTime > 0) {
        const mag = (sim.shakeTime / 0.22) * 8;
        ctx.translate(
          (Math.random() - 0.5) * mag * 2,
          (Math.random() - 0.5) * mag * 2
        );
      }

      // 1. Clean colorful sky gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, PLAYABLE_HEIGHT);
      skyGrad.addColorStop(0, '#38BDF8');
      skyGrad.addColorStop(0.6, '#7DD3FC');
      skyGrad.addColorStop(1, '#E0F2FE');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(-20, -20, sim.worldWidth + 40, PLAYABLE_HEIGHT + 30);

      // 2. Simple geometric clouds
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

      // 3. Soft distant rolling hills (basic shapes)
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

      // 4. Pipes
      for (let i = 0; i < sim.pipes.length; i++) {
        const pipe = sim.pipes[i];
        const topHeight = pipe.gapY - pipe.gapHeight / 2;
        const bottomY = pipe.gapY + pipe.gapHeight / 2;
        const bottomHeight = PLAYABLE_HEIGHT - bottomY;

        drawPipe(pipe.x, -4, PIPE_WIDTH, topHeight + 4, true);
        drawPipe(pipe.x, bottomY, PIPE_WIDTH, bottomHeight, false);
      }

      // 5. Particles
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

      // 6. Ground strip
      ctx.fillStyle = '#D6B678';
      ctx.fillRect(-20, PLAYABLE_HEIGHT, sim.worldWidth + 40, GROUND_HEIGHT + 20);

      // Grass top band
      const grassH = 20;
      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(-20, PLAYABLE_HEIGHT, sim.worldWidth + 40, grassH);

      // Scrolling grass ticks
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

      // 7. Uploaded Character Sprite
      const sprite = spriteRef.current;
      ctx.save();
      ctx.translate(sim.playerX, sim.playerY);
      ctx.rotate(sim.rotation);
      ctx.scale(2 - sim.squash, sim.squash);

      if (sprite) {
        const aspect = sprite.width / sprite.height;
        const drawH = CHARACTER_DRAW_HEIGHT;
        const drawW = drawH * aspect;
        ctx.drawImage(sprite.canvas, -drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        // Transient loading shape while uploaded image decodes (first millisecond)
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.arc(0, 0, CHARACTER_HIT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 8. Collision impact flash
      if (sim.flashAlpha > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${sim.flashAlpha})`;
        ctx.fillRect(-20, -20, sim.worldWidth + 40, WORLD_HEIGHT + 40);
      }

      ctx.restore();
    };

    const tick = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(Math.max(rawDt, 0), 0.05);

      update(dt);
      render();
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [spawnPipe]);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (gameState === 'READY' || gameState === 'PLAYING') {
      performFlap();
    }
  };

  return (
    <main className="fixed inset-0 h-full w-full overflow-hidden bg-sky-300">
      <canvas
        ref={canvasRef}
        onPointerDown={handleCanvasPointerDown}
        className="block h-full w-full touch-none cursor-pointer"
        aria-label="Endless arcade game canvas"
      />

      {/* Minimal Top HUD: Score + Pause */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 sm:p-6">
        <div className="w-12" aria-hidden="true" />

        <div
          className="text-5xl sm:text-6xl font-extrabold text-white tabular-nums tracking-tight drop-shadow-[0_3px_0_rgba(15,23,42,0.55)]"
          style={{ WebkitTextStroke: '2px #0f172a' }}
          aria-live="polite"
        >
          {score}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {gameState === 'PLAYING' && (
            <button
              type="button"
              onClick={handlePause}
              aria-label="Pause"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl border-2 border-slate-900 bg-white/95 px-3.5 py-2 text-sm font-bold text-slate-900 shadow-[0_3px_0_#0f172a] transition-transform duration-150 hover:bg-white active:translate-y-0.5 active:shadow-none whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <Pause className="h-4 w-4 fill-current" />
              <span className="hidden sm:inline">Pause</span>
            </button>
          )}
        </div>
      </div>

      {/* Ready State: Minimal Play Button */}
      {gameState === 'READY' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
          <button
            type="button"
            onClick={handlePlay}
            className="pointer-events-auto mt-28 inline-flex min-h-[52px] items-center justify-center gap-2.5 rounded-2xl border-2 border-slate-900 bg-emerald-500 px-8 py-3 text-lg font-extrabold text-white shadow-[0_4px_0_#0f172a] transition-transform duration-150 hover:bg-emerald-400 active:translate-y-1 active:shadow-none whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <Play className="h-5 w-5 fill-current" />
            <span>Play</span>
          </button>
        </div>
      )}

      {/* Paused State: Score + Play + Restart */}
      {gameState === 'PAUSED' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/35 p-6">
          <div className="flex w-full max-w-xs flex-col items-center gap-5 rounded-2xl border-2 border-slate-900 bg-white p-6 shadow-[0_6px_0_#0f172a]">
            <div className="text-4xl font-extrabold text-slate-900 tabular-nums">
              {score}
            </div>
            <div className="flex w-full flex-col gap-3">
              <button
                type="button"
                onClick={handlePlay}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-900 bg-emerald-500 px-5 py-2.5 text-base font-bold text-white shadow-[0_3px_0_#0f172a] transition-transform duration-150 hover:bg-emerald-400 active:translate-y-0.5 active:shadow-none whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <Play className="h-5 w-5 fill-current" />
                <span>Play</span>
              </button>
              <button
                type="button"
                onClick={handleRestart}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-900 bg-amber-400 px-5 py-2.5 text-base font-bold text-slate-900 shadow-[0_3px_0_#0f172a] transition-transform duration-150 hover:bg-amber-300 active:translate-y-0.5 active:shadow-none whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <RotateCcw className="h-5 w-5" />
                <span>Restart</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Over State: Score + Restart */}
      {gameState === 'GAME_OVER' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 p-6">
          <div className="flex w-full max-w-xs flex-col items-center gap-5 rounded-2xl border-2 border-slate-900 bg-white p-6 shadow-[0_6px_0_#0f172a]">
            <div className="text-5xl font-extrabold text-slate-900 tabular-nums">
              {score}
            </div>
            <button
              type="button"
              onClick={handleRestart}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-900 bg-amber-400 px-5 py-2.5 text-base font-bold text-slate-900 shadow-[0_3px_0_#0f172a] transition-transform duration-150 hover:bg-amber-300 active:translate-y-0.5 active:shadow-none whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <RotateCcw className="h-5 w-5" />
              <span>Restart</span>
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
