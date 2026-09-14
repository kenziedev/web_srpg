import type Phaser from "phaser";
import {
  TOEN_SHEET_URL,
  TOEN_SHEET_WIDTH,
  TOEN_SHEET_HEIGHT,
  TOEN_MAGE_URL,
  TOEN_CLERIC_URL,
  type ToenFrame,
} from "./toenArt";

export const TOEN_TEXTURE = "toen-medieval-strategy";
const TOEN_MAGE_TEXTURE = "toen-uran";
const TOEN_CLERIC_TEXTURE = "toen-hermit";
type PixelRun = {
  x: number;
  y: number;
  width: number;
  color: number;
  alpha: number;
};
type PixelAtlas = {
  pixels: Uint8ClampedArray;
  frames: Map<number, PixelRun[]>;
};
// The weak key is owned by a single Phaser game and cannot keep a destroyed
// scene, canvas, texture, or StrictMode instance alive.
const atlases = new WeakMap<Phaser.Textures.Texture, PixelAtlas | null>();

export function preloadToen(scene: Phaser.Scene) {
  for (const [key, url] of [
    [TOEN_TEXTURE, TOEN_SHEET_URL],
    [TOEN_MAGE_TEXTURE, TOEN_MAGE_URL],
    [TOEN_CLERIC_TEXTURE, TOEN_CLERIC_URL],
  ] as const)
    if (!scene.textures.exists(key)) scene.load.image(key, url);
}

export function toenSource(scene: Phaser.Scene): CanvasImageSource | null {
  if (!scene.textures.exists(TOEN_TEXTURE)) return null;
  const texture = scene.textures.get(TOEN_TEXTURE);
  if (
    texture.source[0]?.width !== TOEN_SHEET_WIDTH ||
    texture.source[0]?.height !== TOEN_SHEET_HEIGHT
  )
    return null;
  return texture.getSourceImage() as CanvasImageSource;
}

function frameTextureKey(frame: ToenFrame): string {
  return frame.url === TOEN_MAGE_URL
    ? TOEN_MAGE_TEXTURE
    : frame.url === TOEN_CLERIC_URL
      ? TOEN_CLERIC_TEXTURE
      : TOEN_TEXTURE;
}

export function toenFrameSource(
  scene: Phaser.Scene,
  frame: ToenFrame,
): CanvasImageSource | null {
  const key = frameTextureKey(frame);
  if (!scene.textures.exists(key)) return null;
  const texture = scene.textures.get(key);
  if (
    texture.source[0]?.width !== frame.sheetWidth ||
    texture.source[0]?.height !== frame.sheetHeight
  )
    return null;
  return texture.getSourceImage() as CanvasImageSource;
}

function frameRuns(scene: Phaser.Scene, frame: ToenFrame): PixelRun[] | null {
  const source = toenFrameSource(scene, frame);
  if (!source) return null;
  const texture = scene.textures.get(frameTextureKey(frame));
  if (!atlases.has(texture)) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = frame.sheetWidth;
      canvas.height = frame.sheetHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("No canvas context");
      ctx.drawImage(source, 0, 0);
      atlases.set(texture, {
        pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        frames: new Map(),
      });
    } catch {
      atlases.set(texture, null);
    }
  }
  const atlas = atlases.get(texture);
  if (!atlas) return null;
  const cached = atlas.frames.get(frame.index);
  if (cached) return cached;
  const runs: PixelRun[] = [];
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width;) {
      const offset = ((frame.y + y) * frame.sheetWidth + frame.x + x) * 4;
      const alpha = atlas.pixels[offset + 3]!;
      if (!alpha) {
        x++;
        continue;
      }
      const color =
        (atlas.pixels[offset]! << 16) |
        (atlas.pixels[offset + 1]! << 8) |
        atlas.pixels[offset + 2]!;
      let width = 1;
      while (x + width < frame.width) {
        const next = offset + width * 4;
        if (
          atlas.pixels[next + 3] !== alpha ||
          atlas.pixels[next] !== atlas.pixels[offset] ||
          atlas.pixels[next + 1] !== atlas.pixels[offset + 1] ||
          atlas.pixels[next + 2] !== atlas.pixels[offset + 2]
        )
          break;
        width++;
      }
      runs.push({ x, y, width, color, alpha: alpha / 255 });
      x += width;
    }
  }
  atlas.frames.set(frame.index, runs);
  return runs;
}

/** Reuses the Graphics API so moving ghosts and summons keep identical art. */
export function drawToenFrame(
  g: Phaser.GameObjects.Graphics,
  frame: ToenFrame,
  x: number,
  y: number,
  scale = 2,
  faded = false,
  flip = false,
): boolean {
  const runs = frameRuns(g.scene, frame);
  if (!runs) return false;
  for (const run of runs) {
    g.fillStyle(run.color, run.alpha * (faded ? 0.58 : 1)).fillRect(
      x + (flip ? frame.width - run.x - run.width : run.x) * scale,
      y + run.y * scale,
      run.width * scale,
      scale,
    );
  }
  return true;
}
