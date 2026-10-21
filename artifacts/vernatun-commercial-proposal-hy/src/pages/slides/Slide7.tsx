import { base, DeckFooter } from '../../components/DeckShared';

export default function Slide7() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide">
      <h1 className="deck-title">Ֆինանսական գործընթաց՝ հաշվարկից մինչև բանկային համադրում</h1>
      <div className="deck-split finance-layout">
        <div>
          <ul className="deck-bullets">
            <li className="deck-bullet">Զանգվածային հաշվարկների նախադիտում և վերահսկվող հրապարակում</li>
            <li className="deck-bullet">Բանկային քաղվածքի ներմուծում CSV ձևաչափով</li>
            <li className="deck-bullet">Գործարքների համադրում և բաշխում ըստ հաշվի</li>
            <li className="deck-bullet">Բնակիչը տեսնում է միայն իր հաշվարկներն ու պատմությունը</li>
            <li className="deck-bullet">Արտաքին բանկային կամ առցանց վճարման կապը ներառվում է առանձին ինտեգրմամբ</li>
          </ul>
        </div>
        <div className="finance-screen">
          <img className="deck-image" src={`${base}assets/finance.jpg`} crossOrigin="anonymous" alt="Vernatun OS հաշվապահի իրական ցուցադրական էկրան" />
        </div>
      </div>
      <DeckFooter />
    </div>
  );
}
