import manifest from "../assets/vendor/manifest.json";
import "./asset-icons.css";

const images = import.meta.glob<string>("../assets/vendor/ravenmore/*.png", {
  eager: true,
  import: "default",
});
const files: Record<string, string> = manifest.items;

// These item categories are absent from the licensed pack. Keep their symbols
// original instead of presenting an unrelated weapon as a different item.
const symbols: Record<string, string> = {
  "iron-dumbbell": "M7 10h5v20H7zM28 10h5v20h-5zM12 18h16v4H12z",
  robe: "M13 5l7 5 7-5 8 10-7 5-2-5 5 21H9l5-21-2 5-7-5zM20 10v24",
  "mirage-robe": "M13 5l7 5 7-5 8 10-7 5-2-5 5 21H9l5-21-2 5-7-5zM20 10v24",
  "speed-boots": "M12 5h14l-2 19 10 6v5H8v-9l4-3zM13 12h11M12 18h12",
  cross: "M17 5h6v11h10v6H23v14h-6V22H7v-6h10z",
  crown: "M5 12l8 6 7-12 7 12 8-6-4 21H9zM10 28h20",
  gleipnir:
    "M16 12l-5 5a6 6 0 0 0 9 9l4-4M24 28l5-5a6 6 0 0 0-9-9l-4 4M15 25l10-10",
};

/** Decorative category art; the adjacent item name supplies its accessible name. */
export function ItemIcon({ itemId }: { itemId: string | null | undefined }) {
  const file = itemId ? files[itemId] : undefined;
  const src = file
    ? images[`../assets/vendor/ravenmore/${file}.png`]
    : undefined;
  return (
    <span className="asset-icon item-icon" aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt=""
          width="40"
          height="40"
          loading="lazy"
          decoding="async"
          draggable="false"
        />
      ) : (
        <svg viewBox="0 0 40 40" focusable="false">
          <path
            d={
              (itemId && symbols[itemId]) ||
              "M20 7l12 13-12 13L8 20zM20 12v16M13 20h14"
            }
          />
        </svg>
      )}
    </span>
  );
}
