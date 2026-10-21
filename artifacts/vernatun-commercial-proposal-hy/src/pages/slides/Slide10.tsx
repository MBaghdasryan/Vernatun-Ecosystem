import { base, DeckFooter } from '../../components/DeckShared';

export default function Slide10() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide">
      <div className="closing-band" />
      <div className="closing-copy">
        <img className="closing-logo" src={`${base}assets/vernatun.png`} crossOrigin="anonymous" alt="Vernatun" />
        <h1 className="deck-title">Քննարկենք ձեր շենքի առաջին կիրառելի սցենարը</h1>
        <ul className="deck-bullets">
          <li className="deck-bullet">Ընտրենք ամենակարևոր խնդիրները</li>
          <li className="deck-bullet">Ցուցադրենք համապատասխան Vernatun գործառույթները</li>
          <li className="deck-bullet">Սահմանենք փորձնական ծրագրի կազմը</li>
        </ul>
        <p className="deck-subtitle">Vernatun — հստակ գործընթացներ կառավարման համար, հասանելի ծառայություններ՝ բնակիչների համար։</p>
      </div>
      <div className="closing-image">
        <img src={`${base}assets/landing.jpg`} crossOrigin="anonymous" alt="Vernatun-ի հանրային կայքի իրական գլխավոր էջ՝ երեք արտադրանքի լոգոներով" />
      </div>
      <DeckFooter />
    </div>
  );
}
