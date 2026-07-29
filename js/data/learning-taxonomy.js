export const LEARNING_TAXONOMY = [
  {
    id: 'formal_sciences',
    label: '数学・形式科学',
    children: [
      ['mathematics', '数学'], ['probability_statistics', '確率・統計'],
      ['logic', '論理学'], ['computation_theory', '計算理論'], ['systems_science', 'システム科学'],
    ],
  },
  {
    id: 'natural_sciences',
    label: '自然科学',
    children: [
      ['physics', '物理学'], ['chemistry', '化学'], ['astronomy_space', '天文学・宇宙科学'],
      ['earth_science', '地球科学'], ['atmospheric_science', '気象・大気科学'],
      ['ocean_science', '海洋科学'], ['environmental_science', '環境科学'],
    ],
  },
  {
    id: 'life_sciences',
    label: '生命科学',
    children: [
      ['biology', '生物学'], ['genetics', '遺伝学'], ['evolution', '進化学'],
      ['ecology', '生態学'], ['microbiology', '微生物学'], ['neuroscience', '神経科学'],
      ['agriculture_food_science', '農学・食料科学'],
    ],
  },
  {
    id: 'medicine_health',
    label: '医学・健康',
    children: [
      ['basic_medicine', '基礎医学'], ['clinical_medicine', '臨床医学'],
      ['public_health', '公衆衛生'], ['pharmacy', '薬学'], ['nutrition', '栄養学'],
      ['mental_health', '心理的健康'], ['exercise_body', '運動・身体科学'],
    ],
  },
  {
    id: 'engineering_technology',
    label: '工学・技術',
    children: [
      ['computer_science', '情報科学'], ['ai_data_science', 'AI・データ科学'],
      ['software_engineering', 'ソフトウェア工学'], ['mechanical_engineering', '機械工学'],
      ['electrical_electronics', '電気電子工学'], ['architecture_civil', '建築・土木工学'],
      ['materials_engineering', '材料工学'], ['chemical_engineering', '化学工学'],
      ['energy_engineering', 'エネルギー工学'], ['transport_technology', '交通・輸送技術'],
      ['manufacturing', '製造・生産技術'], ['biotechnology', 'バイオテクノロジー'],
    ],
  },
  {
    id: 'social_sciences',
    label: '社会科学',
    children: [
      ['economics', '経済学'], ['political_science', '政治学'], ['international_relations', '国際関係'],
      ['sociology', '社会学'], ['psychology', '心理学'], ['law', '法学'], ['education', '教育学'],
      ['anthropology', '人類学'], ['human_geography', '人文地理学'],
      ['media_studies', 'メディア研究'], ['public_policy', '行政・公共政策'], ['demography', '人口学'],
    ],
  },
  {
    id: 'humanities',
    label: '人文科学',
    children: [
      ['history', '歴史'], ['philosophy', '哲学'], ['ethics', '倫理学'], ['religion', '宗教研究'],
      ['archaeology', '考古学'], ['history_of_ideas', '思想史'],
      ['classics_philology', '古典・文献学'], ['area_studies', '地域研究'],
    ],
  },
  {
    id: 'language_communication',
    label: '言語・コミュニケーション',
    children: [
      ['linguistics', '言語学'], ['english', '英語'], ['japanese', '日本語'],
      ['other_languages', 'その他の言語'], ['translation_interpretation', '翻訳・通訳'],
      ['writing_rhetoric', '文章・修辞'], ['interpersonal_communication', '対人コミュニケーション'],
    ],
  },
  {
    id: 'arts_culture',
    label: '芸術・文化',
    children: [
      ['literature', '文学'], ['visual_arts', '美術'], ['music', '音楽'],
      ['performing_arts', '演劇・舞台'], ['film_video', '映画・映像'], ['design', 'デザイン'],
      ['architecture_culture', '建築文化'], ['traditional_culture', '伝統文化'],
      ['popular_culture', 'ポップカルチャー'], ['cultural_heritage', '文化遺産'],
    ],
  },
  {
    id: 'business_finance',
    label: 'ビジネス・金融',
    children: [
      ['management', '経営'], ['business_strategy', '戦略'], ['accounting', '会計'],
      ['corporate_finance', '企業金融'], ['investment', '投資'], ['financial_markets', '金融市場'],
      ['marketing', 'マーケティング'], ['organization_hr', '組織・人事'],
      ['entrepreneurship', '起業'], ['business_operations', '業務運営'],
      ['consumer_behavior', '消費者行動'],
    ],
  },
  {
    id: 'life_practical',
    label: '生活・実用',
    children: [
      ['food_cooking', '食・料理'], ['home_living', '住まい・暮らし'],
      ['personal_finance', '家計'], ['travel', '旅行'], ['sports', 'スポーツ'],
      ['hobbies', '趣味'], ['self_management', '自己管理'], ['relationships', '対人関係'],
      ['career', 'キャリア'], ['civic_procedures', '行政・手続き'], ['safety_disaster', '安全・防災'],
    ],
  },
  {
    id: 'interdisciplinary',
    label: '学際・総合',
    children: [
      ['science_history_philosophy', '科学史・科学哲学'],
      ['science_technology_society', '科学技術社会論'],
      ['environmental_policy', '環境政策'], ['sustainability', '持続可能性'],
      ['international_development', '国際開発'], ['complex_systems', '複雑系'],
      ['future_studies', '未来研究'], ['gender_studies', 'ジェンダー研究'],
      ['urban_studies', '都市研究'], ['information_society', '情報社会'],
      ['cross_regional', '地域横断テーマ'], ['general_knowledge', '一般知識'],
      ['unclassified', '未分類'],
    ],
  },
].map(group => ({
  ...group,
  children: group.children.map(([id, label]) => ({ id, label })),
}));

export const LEARNING_MAJOR_BY_ID = new Map(LEARNING_TAXONOMY.map(item => [item.id, item]));
export const LEARNING_MIDDLE_BY_ID = new Map(
  LEARNING_TAXONOMY.flatMap(group => group.children.map(item => [
    item.id,
    { ...item, majorId: group.id, majorLabel: group.label },
  ]))
);

export function getLearningClassificationLabel(classification = {}) {
  const major = LEARNING_MAJOR_BY_ID.get(classification.majorId);
  const middle = LEARNING_MIDDLE_BY_ID.get(classification.middleId);
  return [major?.label, middle?.label, classification.specialty]
    .filter(Boolean)
    .join(' › ');
}

export function serializeLearningTaxonomyForAI() {
  return LEARNING_TAXONOMY.map(group => ({
    id: group.id,
    label: group.label,
    children: group.children.map(item => ({
      id: item.id,
      label: item.label,
    })),
  }));
}
