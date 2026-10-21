import { base, DeckFooter } from '../../components/DeckShared';

export default function Slide5() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide">
      <div className="deck-split">
        <div>
          <h1 className="deck-title">ImTun — տան ծառայությունները բնակչի հեռախոսում</h1>
          <ul className="deck-bullets">
            <li className="deck-bullet">Սեփական հաշվարկներն ու վճարումների պատմությունը</li>
            <li className="deck-bullet">Դիմումների ստեղծում և ընթացքի հետևում</li>
            <li className="deck-bullet">Հաշվիչների ցուցմունքների փոխանցում</li>
            <li className="deck-bullet">Հայտարարություններ, փաստաթղթեր և հյուրերի անցագրեր</li>
            <li className="deck-bullet">Ընտանեկան հասանելիություն՝ վերահսկվող իրավունքներով</li>
          </ul>
        </div>
        <div className="portrait-screen">
          <img src={`${base}assets/resident.jpg`} crossOrigin="anonymous" alt="Կցված ImTun բնակչի բջջային գլխավոր էջի պատկեր" />
        </div>
      </div>
      <DeckFooter />
    </div>
  );
}
