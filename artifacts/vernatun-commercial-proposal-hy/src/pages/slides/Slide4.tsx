import { base, DeckFooter } from '../../components/DeckShared';

export default function Slide4() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide">
      <div className="deck-split">
        <div>
          <h1 className="deck-title">Դիմումից մինչև հաստատված աշխատանք՝ մեկ վերահսկվող շղթայով</h1>
          <div className="ops-flow">
            <div className="ops-step"><b>01</b><span>Բնակիչը ստեղծում է դիմում</span></div>
            <div className="ops-step"><b>02</b><span>Դիսպետչերը դասակարգում և նշանակում է կատարողին</span></div>
            <div className="ops-step"><b>03</b><span>Տեխնիկը կամ կապալառուն լրացնում է աշխատանքը, ստուգաթերթը և լուսանկարները</span></div>
            <div className="ops-step"><b>04</b><span>Կառավարիչը ստուգում և ընդունում է արդյունքը</span></div>
            <div className="ops-step"><b>05</b><span>Պահպանվում են կարգավիճակները, ժամկետներն ու պատմությունը</span></div>
          </div>
        </div>
        <div className="deck-photo">
          <img className="deck-image" src={`${base}assets/contractor.jpg`} crossOrigin="anonymous" alt="Կցված կապալառուի առաջադրանքների բջջային միջերեսի պատկեր" />
        </div>
      </div>
      <DeckFooter />
    </div>
  );
}
