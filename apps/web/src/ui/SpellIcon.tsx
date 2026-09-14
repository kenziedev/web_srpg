import manifest from "../assets/vendor/manifest.json";
import "./asset-icons.css";

const images = import.meta.glob<string>("../assets/vendor/painterly/*.png", {
  eager: true,
  import: "default",
});
const files: Record<string, { part: number; file: string }> = manifest.spells;

/** Decorative spell art only. MP, range, effects and eligibility remain core data. */
export function SpellIcon({ spellId }: { spellId: string }) {
  const file = files[spellId]?.file;
  const src = file ? images[`../assets/vendor/painterly/${file}`] : undefined;
  return (
    <span className="asset-icon spell-icon" aria-hidden="true">
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
          <path d="M20 4l4 12 12 4-12 4-4 12-4-12-12-4 12-4z" />
        </svg>
      )}
    </span>
  );
}
