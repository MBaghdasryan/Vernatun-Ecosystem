export const base = import.meta.env.BASE_URL;

export function DeckFooter() {
  return (
    <div className="deck-footer">
      <img src={`${base}assets/vernatun.png`} crossOrigin="anonymous" alt="Vernatun" />
    </div>
  );
}
