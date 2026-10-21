import { base, DeckFooter } from '../../components/DeckShared';

export default function Slide1() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide deck-cover">
      <img className="deck-mark" src={`${base}assets/vernatun.png`} crossOrigin="anonymous" alt="Vernatun" />
      <div className="cover-grid">
        <div className="cover-copy">
          <h1 className="deck-title">Vernatun — բնակելի շենքերի կառավարման ամբողջական միջավայր</h1>
          <p className="deck-subtitle">Կոմերցիոն առաջարկ համատիրությունների, կառավարման ընկերությունների և կառուցապատողների համար</p>
        </div>
        <div className="cover-image">
          <img className="deck-image" src={`${base}assets/landing.jpg`} crossOrigin="anonymous" alt="Vernatun-ի հանրային կայքի իրական էկրան՝ HAYAT և ImTun արտադրանքի ներկայացմամբ" />
        </div>
      </div>
      <DeckFooter />
    </div>
  );
}
