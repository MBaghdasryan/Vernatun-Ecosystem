import { base, DeckFooter } from '../../components/DeckShared';

export default function Slide2() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide">
      <div className="deck-split">
        <div>
          <h1 className="deck-title">Կառավարումը չպետք է կախված լինի ցրված հաղորդագրություններից</h1>
          <ul className="deck-bullets">
            <li className="deck-bullet">Բնակիչների դիմումները մնում են տարբեր ալիքներում</li>
            <li className="deck-bullet">Կատարման պատասխանատուն և ժամկետը միշտ տեսանելի չեն</li>
            <li className="deck-bullet">Ֆինանսական ու սպասարկման տվյալները պահվում են առանձին</li>
            <li className="deck-bullet">Ղեկավարությունը դժվար է ստանում շենքի ամբողջական պատկերը</li>
          </ul>
        </div>
        <div className="deck-photo">
          <img className="deck-image" src={`${base}assets/console.jpg`} crossOrigin="anonymous" alt="Կցված Vernatun պլատֆորմի կառավարման վահանակի պատկեր" />
        </div>
      </div>
      <DeckFooter />
    </div>
  );
}
