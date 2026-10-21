import { base, DeckFooter } from '../../components/DeckShared';

export default function Slide3() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide">
      <h1 className="deck-title">Մեկ էկոհամակարգ՝ յուրաքանչյուր դերի համար իր միջերեսով</h1>
      <div className="ecosystem-grid">
        <section className="ecosystem-item">
          <img src={`${base}assets/vernatun.png`} crossOrigin="anonymous" alt="Vernatun OS լոգո" />
          <h2>Vernatun OS</h2>
          <p>Շենքեր, ֆինանսներ, աշխատակիցներ և վերահսկողություն</p>
          <div className="ecosystem-preview"><img src={`${base}assets/organization.jpg`} crossOrigin="anonymous" alt="Vernatun OS աշխատակիցների իրական ցուցադրական էկրան" /></div>
        </section>
        <section className="ecosystem-item">
          <img src={`${base}assets/hayat.png`} crossOrigin="anonymous" alt="HAYAT լոգո" />
          <h2>HAYAT</h2>
          <p>Կառավարիչների, դիսպետչերների, տեխնիկների և կապալառուների աշխատանք</p>
          <div className="ecosystem-preview"><img src={`${base}assets/operations.jpg`} crossOrigin="anonymous" alt="HAYAT կառավարչի իրական ցուցադրական էկրան" /></div>
        </section>
        <section className="ecosystem-item">
          <img src={`${base}assets/imtun.png`} crossOrigin="anonymous" alt="ImTun լոգո" />
          <h2>ImTun</h2>
          <p>Բնակչի տունը, դիմումները, հաշվարկները և տեղեկությունները հեռախոսում</p>
          <div className="ecosystem-preview"><img src={`${base}assets/imtun-expo.jpg`} crossOrigin="anonymous" alt="ImTun Expo հավելվածի իրական վեբ նախադիտում՝ ցուցադրական տվյալներով" /></div>
          <span style={{ fontSize: '1.5vw' }}>ImTun · Expo Web</span>
        </section>
      </div>
      <p className="deck-subtitle">Միասնական տվյալներ և փոխկապակցված գործընթացներ</p>
      <DeckFooter />
    </div>
  );
}
