import { base, DeckFooter } from '../../components/DeckShared';

export default function Slide8() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide">
      <div className="deck-split">
        <div>
          <h1 className="deck-title">Յուրաքանչյուր գործողություն ունի պատասխանատու, ապացույց և պատմություն</h1>
          <ul className="deck-bullets">
            <li className="deck-bullet">Ժամկետների և սպասարկման մակարդակի վերահսկում</li>
            <li className="deck-bullet">Այցեր, ստուգաթերթեր, լուսանկարներ և կատարման հաշվետվություններ</li>
            <li className="deck-bullet">Գործողությունների աուդիտ և դերերով սահմանված հասանելիություն</li>
            <li className="deck-bullet">Մասնավոր ֆայլերի պաշտպանված դիտում</li>
            <li className="deck-bullet">Ղեկավարության համար՝ խնդիրների և ընթացքի միասնական պատկեր</li>
          </ul>
        </div>
        <div className="deck-photo">
          <img className="deck-image" src={`${base}assets/technician.jpg`} crossOrigin="anonymous" alt="Կցված տեխնիկի առաջադրանքների և աշխատանքների միջերեսի պատկեր" />
        </div>
      </div>
      <DeckFooter />
    </div>
  );
}
