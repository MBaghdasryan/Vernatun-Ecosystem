import { base, DeckFooter } from '../../components/DeckShared';

export default function Slide6() {
  return (
    <div className="relative h-screen w-screen overflow-hidden deck-slide">
      <div className="deck-split">
        <div>
          <h1 className="deck-title">Կազմակերպության ամբողջ կառուցվածքը՝ մեկ վերահսկվող միջավայրում</h1>
          <ul className="deck-bullets">
            <li className="deck-bullet">Կազմակերպություններ, շենքեր, տարածքներ և բնակիչներ</li>
            <li className="deck-bullet">Աշխատակիցներ, դերեր և թույլտվությունների մատրիցա</li>
            <li className="deck-bullet">Յուրաքանչյուր օգտատիրոջ իրական հասանելիության ստուգում</li>
            <li className="deck-bullet">Տվյալների տեսանելիություն՝ ըստ կազմակերպության, շենքի և պարտականության</li>
          </ul>
        </div>
        <div className="deck-photo">
          <img className="deck-image" src={`${base}assets/organization.jpg`} crossOrigin="anonymous" alt="Vernatun OS աշխատակիցների իրական ցուցադրական էկրան" />
        </div>
      </div>
      <DeckFooter />
    </div>
  );
}
