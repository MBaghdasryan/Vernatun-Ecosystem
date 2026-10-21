import { DeckFooter } from '../../components/DeckShared';

export default function Slide9() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide">
      <h1 className="deck-title">Ներդրումը սկսվում է ձեր իրական գործընթացներից</h1>
      <div className="roadmap">
        <div className="roadmap-step"><strong>01</strong><p>Քարտեզագրում ենք շենքի կառավարման ընթացիկ աշխատանքը</p></div>
        <div className="roadmap-step"><strong>02</strong><p>Համաձայնեցնում ենք դերերը, տվյալները և առաջնային սցենարները</p></div>
        <div className="roadmap-step"><strong>03</strong><p>Կազմակերպում ենք տվյալների նախապատրաստումն ու թիմի ուսուցումը</p></div>
        <div className="roadmap-step"><strong>04</strong><p>Սկսում ենք համաձայնեցված փորձնական ծավալից</p></div>
      </div>
      <p className="deck-subtitle">Արդյունքներով հաստատում ենք հաջորդ ընդլայնման փուլը</p>
      <DeckFooter />
    </div>
  );
}
