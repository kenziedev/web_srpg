import type { Unit } from "@orden/core";
import kaiel from "../assets/vendor/zeneria29/portrait24.png";
import roen from "../assets/vendor/zeneria29/portrait25.png";
import mira from "../assets/vendor/zeneria29/portrait21.png";

const illustrations: Record<string, string> = { A1: kaiel, A2: roen, A3: mira };

/** Licensed commander portraits with the original unit-type illustration as fallback. */
export function Portrait({ unit }: { unit: Unit | undefined }) {
  const illustration = unit && illustrations[unit.id];
  if (illustration)
    return (
      <div className="portrait" data-art="zeneria29" aria-hidden="true">
        <svg viewBox="0 0 300 380" preserveAspectRatio="xMidYMin slice">
          <image href={illustration} width="900" height="760" />
        </svg>
      </div>
    );
  const archer = unit?.unitType === "archer";
  const knight = unit?.unitType === "pike";
  const enemy = unit?.side === "enemy";
  const hair = archer ? "#966846" : knight ? "#6e736e" : "#584139";
  const light = enemy ? "#c08372" : archer ? "#a7b49b" : "#b4c7cf";
  const armor = enemy ? "#743f4c" : archer ? "#4c756e" : "#476985";
  return (
    <div className="portrait" aria-hidden="true">
      <svg viewBox="0 0 48 56" shapeRendering="crispEdges">
        <path fill="#20394c" d="M0 0h48v56H0z" />
        <path fill="#324e61" d="M0 0h35v7H29v7H23v7H17v7H11v7H0z" />
        <path fill="#597078" d="M0 1h2v54H0zM2 0h44v2H2z" />
        <path
          fill="#142639"
          d="M8 56V46h4v-5h7v-6h-4v-5h-3V15h3V9h5V6h14v3h4v6h3v18h-4v8h5v5h6v10z"
        />
        <path
          fill={hair}
          d="M14 15V11h5V8h14v3h5v5h2v15h-4v10h-5V24H16v9h-3V17z"
        />
        <path fill="#aa7454" d="M18 17h17v15h-3v5h-5v7H18v-6h5v-6h-5z" />
        <path fill="#e4b488" d="M18 16h15v8h2v5h-4v5h-9v-4h-4z" />
        <path fill="#f2cea1" d="M20 17h10v4h-6v8h-4z" />
        <path fill={hair} d="M16 16h6v5h-3v5h-3zM21 12h14v5h-7v3h-5v-3h-2z" />
        <path fill="#714d3e" d="M27 22h7v1h-7zM20 22h4v1h-4z" />
        <path fill="#f2dcc0" d="M28 23h5v2h-5zM20 23h3v2h-3z" />
        <path fill="#263c49" d="M30 23h2v2h-2zM21 23h2v2h-2z" />
        <path fill="#b57f5d" d="M26 25h2v4h3v1h-5zM25 32h6v1h-6z" />
        {knight && (
          <>
            <path fill="#839aa4" d="M14 13V9h5V5h13v4h5v8H13z" />
            <path fill="#d3d9c8" d="M19 8h13v3H19zM14 13h23v3H14z" />
            <path
              fill="#566e82"
              d="M14 16h4v12h-3v-8h-2zM34 15h4v17h-4v-5h2V19h-2z"
            />
            <path fill="#ccae6e" d="M23 6h3v9h-3z" />
          </>
        )}
        {archer && <path fill="#c8bc92" d="M16 16h22v2H16zM32 13h3v8h-3z" />}
        <path fill={armor} d="M14 40h8l4 4 6-5h6v4h5v5h5v8H4v-9h5v-4h5z" />
        <path
          fill={light}
          d="M10 43h10v3h-5v4H7v-4h3zM32 41h7v3h5v5H33zM18 47h3v9h-5v-6h2z"
        />
        <path fill="#d9c79c" d="M21 40l5 4 6-5v3l-6 5-5-4zM24 49h4v4h-4z" />
        <path fill="#243d55" d="M33 49h15v7H33zM7 52h7v4H7z" />
        {archer && (
          <path
            fill="#b99765"
            d="M4 56V43h2v-9h2v-7h2v-4h2v-2h2v3h-2v5h-2v7H8v9H6v11z"
          />
        )}
        {!archer && (
          <>
            <path fill="#203449" d="M35 43h13v13H32V46h3z" />
            <path fill="#c0c9ba" d="M35 43h13v2H35zM33 45h2v11h-2z" />
            <path fill={armor} d="M36 46h12v10H36z" />
            <path fill="#d0b479" d="M40 48h2v7h-2zM38 50h6v2h-6z" />
          </>
        )}
      </svg>
    </div>
  );
}
