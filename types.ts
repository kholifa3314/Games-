export type GameState = 'READY' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

export interface Pipe {
  x: number;
  gapY: number;
  gapHeight: number;
  passed: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
}

export interface Cloud {
  x: number;
  y: number;
  width: number;
  speedFactor: number;
  opacity: number;
}

export const WORLD_HEIGHT = 640;
export const GROUND_HEIGHT = 76;
export const PLAYABLE_HEIGHT = WORLD_HEIGHT - GROUND_HEIGHT;

export const GRAVITY = 1520;
export const FLAP_VELOCITY = -455;
export const MAX_FALL_SPEED = 640;

export const PIPE_WIDTH = 72;
export const PIPE_CAP_HEIGHT = 26;
export const PIPE_CAP_OVERHANG = 6;

export const BASE_PIPE_SPEED = 198;
export const MAX_PIPE_SPEED = 325;
export const BASE_PIPE_GAP = 166;
export const MIN_PIPE_GAP = 138;
export const PIPE_SPACING = 258;

export const CHARACTER_DRAW_HEIGHT = 68;
export const CHARACTER_HIT_RADIUS = 19;
