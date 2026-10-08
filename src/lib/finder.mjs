// Editorial guides to finished cosmetic products, not medical diagnoses.
const option = (id, label, description, ingredients) => ({ id, label, description, ingredients });
export const careAreas = [
  { id: 'skin', label: '肌', english: 'SKIN', icon: 'face', description: '顔のうるおいを考える', article: 'moisturizer-basics',
    states: [option('dry', '乾燥・つっぱりが気になる', '洗顔後のうるおいを見直したい', ['ceramide', 'hyaluronic-acid']), option('mixed', 'ベタつきと乾燥が混在', '部位で違う使用感が気になる', ['glycerin', 'niacinamide']), option('daily', 'いつものケアを見直したい', '基本の保湿を知りたい', ['glycerin', 'ceramide'])],
    goals: [option('moist', 'うるおいを保ちたい', '保湿を中心に選ぶ', ['hyaluronic-acid', 'ceramide']), option('comfortable', '心地よい使用感', '肌になじむ保湿の役割を知る', ['glycerin', 'hyaluronic-acid']), option('simple', '基本を整えたい', '毎日の保湿から始める', ['ceramide', 'glycerin'])],
    tips: 'さっぱり・しっとりは成分名だけでは決まりません。香料の有無や使い心地も確認しましょう。',
    reasons: { ceramide: '肌のうるおいを支える脂質に関連する保湿成分。乾燥を意識したケアの候補に。', 'hyaluronic-acid': '水分を保つ保湿成分。うるおいを補う製品選びの手がかりに。', glycerin: '角層の水分を保つ保湿成分。日常の保湿製品に広く使われます。', niacinamide: '整肌・保湿製品に使われる成分。肌を整える配合を考える候補に。皮脂への効果を保証するものではありません。' } },
  { id: 'hair', label: '髪', english: 'HAIR', icon: 'hair', description: '毛先や手触りのケア', article: 'hair-washing-basics',
    states: [option('dry', '毛先がパサつく', '乾燥したような手触りが気になる', ['panthenol', 'glycerin']), option('tangled', '指通りが気になる', 'とかすときの引っかかりをケアしたい', ['dimethicone', 'panthenol']), option('daily', 'いつものケアを見直したい', '自分に合うヘアケアを考えたい', ['glycerin', 'dimethicone'])],
    goals: [option('smooth', 'なめらかな指通り', '手触りを整えるケアを探す', ['dimethicone', 'panthenol']), option('moist', 'しっとりした仕上がり', '保湿を意識した配合を知る', ['glycerin', 'panthenol']), option('simple', '続けやすいケア', 'いつものコンディショナーを見直す', ['panthenol', 'dimethicone'])],
    tips: '毛先を中心に、製品の説明どおりの量を。仕上がりは髪質と配合全体で変わります。',
    reasons: { dimethicone: '髪を整えるコンディショニング成分。指通りを考える製品選びの候補に。', panthenol: 'ヘアコンディショニング用途が報告されている成分。手触りを整える配合を知る手がかりに。', glycerin: '保湿・ヘアコンディショニング用途のある成分。うるおいを意識した配合の候補に。' } },
  { id: 'nail', label: '爪', english: 'NAIL', icon: 'nail', description: '爪と指先をいたわる', article: 'nail-care-basics',
    states: [option('dry', '爪まわりが乾燥しやすい', '指先の保湿を考えたい', ['glycerin', 'petrolatum']), option('polish', 'ネイル後のケアをしたい', 'ネイルを休む時間の保湿に', ['petrolatum', 'glycerin']), option('washing', '手洗い・水仕事が多い', '日常の乾燥対策をしたい', ['glycerin', 'petrolatum'])],
    goals: [option('protect', 'うるおいを守りたい', '爪や甘皮の保護を意識する', ['petrolatum', 'glycerin']), option('comfortable', '日中も続けたい', '使いやすいハンドケアを考える', ['glycerin', 'petrolatum']), option('night', '夜にじっくりケア', '指先まで保湿する習慣に', ['petrolatum', 'glycerin'])],
    tips: '成分で爪そのものを修復する診断ではありません。水仕事の手袋や、無理にはがさない習慣も大切です。',
    reasons: { petrolatum: '爪と甘皮の保湿に専門団体が紹介する保護成分。水分が逃げるのを抑えるケアの候補に。', glycerin: '指先の皮膚の保湿を意識したハンドケアの候補。爪を強くする効果を示すものではありません。' } },
  { id: 'body', label: '身体', english: 'BODY', icon: 'body', description: '身体の乾燥と保湿に', article: 'body-moisturizing-basics',
    states: [option('dry', '身体の乾燥が気になる', 'お風呂のあとの保湿を考えたい', ['ceramide', 'glycerin']), option('rough', 'ひじ・かかとがカサつく', '傷や炎症のない乾燥部位に', ['urea', 'petrolatum']), option('daily', 'ボディケアを習慣にしたい', '続けやすい保湿を見つけたい', ['glycerin', 'ceramide'])],
    goals: [option('moist', 'うるおいを補いたい', '保湿の役割を知る', ['glycerin', 'ceramide']), option('protect', '乾燥を防ぎたい', '水分を守るケアも考える', ['petrolatum', 'ceramide']), option('local', '乾燥する部位をケア', '使用部位に合う製品を選ぶ', ['urea', 'petrolatum'])],
    tips: '入浴後の少し水分が残る肌に保湿を。尿素は刺激を感じることがあるため、傷や炎症のある部位を避けてください。',
    reasons: { glycerin: '水分を保つ保湿成分。毎日のボディ用保湿製品を選ぶ手がかりに。', ceramide: 'うるおいを支える保湿成分。身体の乾燥を意識したケアの候補に。', petrolatum: '保護膜で水分が逃げるのを抑える成分。乾燥する部位のケアを考える候補に。', urea: '乾燥肌の保湿製品に使われる成分。濃度や使用部位を製品の説明で確認して選びましょう。' } },
];
export function matchCare(areaId, stateId, goalId) {
  const area = careAreas.find(item => item.id === areaId);
  const state = area?.states.find(item => item.id === stateId);
  const goal = area?.goals.find(item => item.id === goalId);
  if (!area || !state || !goal) return null;
  const weights = new Map();
  for (const selection of [state, goal]) selection.ingredients.forEach((id, index) => weights.set(id, (weights.get(id) || 0) + (index === 0 ? 3 : 1)));
  const recommendations = [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([id]) => ({ id, reason: area.reasons[id] }));
  return { area, state, goal, recommendations, slug: `${areaId}-${stateId}-${goalId}` };
}
export function allMatches() {
  return careAreas.flatMap(area => area.states.flatMap(state => area.goals.map(goal => {
    const match = matchCare(area.id, state.id, goal.id);
    if (!match) throw new Error(`Invalid care guide: ${area.id}/${state.id}/${goal.id}`);
    return match;
  })));
}
