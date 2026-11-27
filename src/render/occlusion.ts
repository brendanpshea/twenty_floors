import { Vector2, Vector3 } from 'three';

/** Soft light around the camera target, applied to the floor shader only (never to characters). */
export const heroUniforms = {
  uHeroP: { value: new Vector3() },
  uHeroC: { value: new Vector3(0.4, 0.4, 0.4) },
  uHeroR: { value: 13 },
};

/** Shared uniforms: walls between the camera and the camera target are lowered so the target is never hidden. */
export const occUniforms = {
  uOccT: { value: new Vector2() },
  uOccD: { value: new Vector2(0, 1) },
  uOccP: { value: new Vector2(6, 16) },
};

/** Camera elevation state for `coversTarget` (tangent of the pitch above the horizon; `active` is false in the overview). */
const occView = { active: false, tanPitch: 1 };

/** How much of a wall's height above its base is removed (matches the vertex shader). */
export const OCC_STRENGTH = 0.85;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Multiplies the sink band's width and depth (foliage themes clear a wider, deeper corridor). Set per floor. */
export const occScale = { v: 1 };

/** `yaw` is the camera azimuth (camera sits at +sin(yaw), +cos(yaw) from the target). */
export function updateOcclusion(tx: number, tz: number, yaw: number, dist: number, pitch: number): void {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  occUniforms.uOccT.value.set(tx, tz);
  occUniforms.uOccD.value.set(dx, dz);
  const lat = Math.min(10, Math.max(4.5, dist * 0.3)) * occScale.v;
  const along = Math.max(8, dist * Math.cos(pitch) * 1.15 + 2) * (occScale.v > 1 ? 1.3 : 1);
  occUniforms.uOccP.value.set(lat, along);
  occView.active = true;
  occView.tanPitch = Math.tan(Math.min(1.5, Math.max(0.2, pitch)));
}

/** No wall is lowered (the overview looks straight down, so nothing hides the floor). */
export function disableOcclusion(): void {
  occUniforms.uOccP.value.set(1e-4, 1e-4);
  occView.active = false;
}

/** CPU twin of the shader factor in [0, 1]. */
export function occFactor(wx: number, wz: number): number {
  const t = occUniforms.uOccT.value;
  const d = occUniforms.uOccD.value;
  const p = occUniforms.uOccP.value;
  const vx = wx - t.x;
  const vz = wz - t.y;
  const along = vx * d.x + vz * d.y;
  const lat = Math.abs(vx * d.y - vz * d.x);
  return (1 - smooth(p.x * 0.6, p.x, lat)) * smooth(-2, 1, along) * (1 - smooth(p.y * 0.7, p.y, along));
}

/** True if a creature of `height` standing at (wx, wz) would be drawn over the camera target (it stands on the camera's side, tall enough to cover the target's chest). */
export function coversTarget(wx: number, wz: number, height: number): boolean {
  if (!occView.active) return false;
  const t = occUniforms.uOccT.value;
  const d = occUniforms.uOccD.value;
  const vx = wx - t.x;
  const vz = wz - t.y;
  const along = vx * d.x + vz * d.y;
  const lat = Math.abs(vx * d.y - vz * d.x);
  if (along < 0.7 || along > 10 || lat > 1.8) return false;
  return height > 1.3 + along * occView.tanPitch * 0.9;
}
