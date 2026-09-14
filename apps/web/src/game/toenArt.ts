import type { Unit } from "@orden/core";
import sheetUrl from "../assets/vendor/toen/medieval-strategy.png?url";
import mageUrl from "../assets/vendor/toen-characters/uran.png?url";
import clericUrl from "../assets/vendor/toen-characters/hermit.png?url";

/** Andre Mari Coppola / Toen, CC BY 4.0. Original sheet, without pixel edits. */
export const TOEN_SHEET_URL = sheetUrl;
export const TOEN_TILE_SIZE = 16;
export const TOEN_SHEET_WIDTH = 112;
export const TOEN_SHEET_HEIGHT = 832;
export const TOEN_SHEET_COLUMNS = 7;
export const TOEN_MAGE_URL = mageUrl;
export const TOEN_CLERIC_URL = clericUrl;

export interface ToenFrame {
  url: string;
  sheetWidth: number;
  sheetHeight: number;
  index: number;
  column: number;
  row: number;
  x: number;
  y: number;
  width: 16;
  height: 16;
}

export function toenFrame(column: number, row: number): ToenFrame {
  return {
    url: TOEN_SHEET_URL,
    sheetWidth: TOEN_SHEET_WIDTH,
    sheetHeight: TOEN_SHEET_HEIGHT,
    index: row * TOEN_SHEET_COLUMNS + column,
    column,
    row,
    x: column * TOEN_TILE_SIZE,
    y: row * TOEN_TILE_SIZE,
    width: 16,
    height: 16,
  };
}

function characterFrame(url: string): ToenFrame {
  return { ...toenFrame(0, 0), url, sheetWidth: 16, sheetHeight: 16 };
}

/** Visual roles only: no class, attack, movement, or team rules are changed. */
export function toenUnitFrame(unit: Unit): ToenFrame | null {
  // The pack has no convoy or faithful representations of our nine summons.
  if (unit.kind === "escort" || unit.summon) return null;
  const row = unit.side === "enemy" ? 17 : unit.side === "npc" ? 19 : 16;
  // The current mage commander keeps an archer's physical attack rules.
  // A caster silhouette reflects her visible spell loadout, without changing it.
  if (
    unit.kind === "commander" &&
    unit.unitType === "archer" &&
    unit.spellIds.length
  )
    return characterFrame(TOEN_MAGE_URL);
  switch (unit.unitType) {
    case "infantry":
      return toenFrame(1, row);
    case "pike":
      return toenFrame(2, row);
    case "cavalry":
    case "flier":
      // Fliers share the mounted frame and retain our separate wing silhouette.
      return toenFrame(3, row);
    case "archer":
      return toenFrame(0, row);
    case "cleric":
      return characterFrame(TOEN_CLERIC_URL);
    case "mage":
      return characterFrame(TOEN_MAGE_URL);
    case "sailor":
      return toenFrame(0, unit.side === "enemy" ? 36 : 35);
    default:
      return null;
  }
}
