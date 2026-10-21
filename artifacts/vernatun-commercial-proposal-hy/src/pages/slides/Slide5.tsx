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
        <div className="portrait-screen" style={{ gap: '1vw', background: 'transparent' }}>
          <figure style={{ width: '48%', margin: 0, textAlign: 'center' }}>
            <img src={`${base}assets/imtun-expo.jpg`} style={{ width: '100%', height: '62vh' }} crossOrigin="anonymous" alt="ImTun Expo հավելվածի իրական վեբ նախադիտում՝ ցուցադրական տվյալներով" />
            <figcaption style={{ fontSize: '1.5vw', marginTop: '1vh' }}>ImTun · Expo Web</figcaption>
          </figure>
          <figure style={{ width: '48%', margin: 0, textAlign: 'center' }}>
            <img src={`${base}assets/resident.jpg`} style={{ width: '100%', height: '62vh' }} crossOrigin="anonymous" alt="ImTun բնակչի իրական ցուցադրական վեբ էկրան՝ հեռախոսի չափերով" />
            <figcaption style={{ fontSize: '1.5vw', marginTop: '1vh' }}>ImTun · բջջային վեբ</figcaption>
          </figure>
        </div>
      </div>
      <DeckFooter />
    </div>
  );
}
