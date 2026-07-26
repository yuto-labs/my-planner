// Built-in, versioned morphology reference. User notes are stored separately.
// The compact source rows keep the offline bundle small; expandSeed provides
// one consistent detail contract for every entry.

const CORE_VERSION = 1;

const PREFIX_ROWS = [
  ['ab-/abs-', '離れて・外へ', 'Latin', 'ab', '〜から離れて', 'abs-', 'absent,abstract,abduct'],
  ['ad-', '〜へ・近づいて', 'Latin', 'ad', '〜の方へ', 'ac-,af-,ag-,al-,an-,ap-,ar-,as-,at-', 'adapt,attract,approach'],
  ['un-', '否定・逆の動作', 'Old English', 'un', '〜でない／反対にする', '', 'unhappy,unlock,uncertain'],
  ['anti-', '反対・対抗', 'Greek', 'anti', '〜に対して', '', 'antibiotic,antisocial,antithesis'],
  ['bene-', '良く・善く', 'Latin', 'bene', '良く', 'ben-', 'benefit,benevolent,benediction'],
  ['bi-', '二つ・二度', 'Latin', 'bi', '二つ', 'bin-', 'bicycle,bilingual,binary'],
  ['circum-', '周囲に', 'Latin', 'circum', '周りに', 'circu-', 'circumstance,circumnavigate,circuit'],
  ['co-/com-/con-', '共に・一緒に', 'Latin', 'com', '共に', 'co-,col-,com-,con-,cor-', 'connect,collaborate,combine'],
  ['contra-', '反対に', 'Latin', 'contra', '〜に対して', 'counter-', 'contradict,contrast,counteract'],
  ['de-', '下へ・離して・完全に', 'Latin', 'de', '下へ／〜から', '', 'decline,detach,describe'],
  ['dis-', '離れて・否定・反対', 'Latin', 'dis', '離れて', 'dif-,di-', 'disconnect,differ,disagree'],
  ['en-/em-', '中に入れる・〜にする', 'French/Latin', 'en', '中に', 'em-', 'enable,encircle,empower'],
  ['ex-/e-', '外へ・以前の', 'Latin', 'ex', '外へ', 'e-,ef-', 'export,exclude,ex-president'],
  ['extra-', '外側・範囲外', 'Latin', 'extra', '外に', '', 'extraordinary,extracurricular,extraterrestrial'],
  ['fore-', '前・あらかじめ', 'Old English', 'fore', '前に', '', 'forecast,foresee,foreword'],
  ['hyper-', '超えて・過度に', 'Greek', 'hyper', '上に／超えて', '', 'hyperactive,hyperlink,hypertension'],
  ['under-', '下に・不足して', 'Old English', 'under', '下に', '', 'underground,underestimate,underpaid'],
  ['in-/im- (not)', '否定・〜でない', 'Latin', 'in', '〜でない', 'il-,im-,ir-', 'inactive,impossible,irregular'],
  ['in-/im- (into)', '中へ・上に', 'Latin', 'in', '中へ', 'il-,im-,ir-', 'import,insert,illustrate'],
  ['inter-', '間に・相互に', 'Latin', 'inter', '〜の間に', '', 'international,interact,intervene'],
  ['tele-', '遠く離れて', 'Greek', 'tele', '遠くに', '', 'telephone,television,telework'],
  ['mal-', '悪く・不十分に', 'French/Latin', 'malus', '悪い', '', 'malfunction,malnutrition,malevolent'],
  ['meta-', '越えて・変化・自己参照', 'Greek', 'meta', '後に／越えて', '', 'metaphor,metamorphosis,metadata'],
  ['micro-', '小さい', 'Greek', 'mikros', '小さい', '', 'microscope,microchip,microbiology'],
  ['mis-', '誤って・悪く', 'Old English', 'mis', '誤って', '', 'misunderstand,mislead,misprint'],
  ['mono-', '一つ', 'Greek', 'monos', '単独の', '', 'monologue,monochrome,monopoly'],
  ['multi-', '多くの', 'Latin', 'multus', '多い', '', 'multilingual,multiply,multimedia'],
  ['non-', '〜でない', 'Latin', 'non', '〜でない', '', 'nonfiction,nonverbal,nonprofit'],
  ['over-', '上に・過度に', 'Old English', 'ofer', '上方に', '', 'overcome,overwork,overestimate'],
  ['ultra-', '越えて・極端に', 'Latin', 'ultra', '向こう側へ', '', 'ultraviolet,ultramodern,ultrasound'],
  ['poly-', '多くの', 'Greek', 'polys', '多い', '', 'polygon,polyglot,polymer'],
  ['post-', '後に', 'Latin', 'post', '後に', '', 'postwar,postpone,postscript'],
  ['pre-', '前に・あらかじめ', 'Latin', 'prae', '前に', '', 'preview,predict,prepare'],
  ['pro-', '前へ・賛成して・代わりに', 'Latin', 'pro', '前へ', '', 'progress,promote,pronoun'],
  ['re-', '再び・元へ', 'Latin', 're', '再び／後ろへ', '', 'rewrite,return,restore'],
  ['retro-', '後ろへ・過去を振り返る', 'Latin', 'retro', '後方へ', '', 'retroactive,retrospect,retrofit'],
  ['semi-', '半分・部分的', 'Latin', 'semi', '半分', '', 'semicircle,semifinal,semiconscious'],
  ['sub-', '下に・下位に', 'Latin', 'sub', '下に', 'suc-,suf-,sug-,sup-,sus-', 'submarine,support,suggest'],
  ['super-', '上に・超えて', 'Latin', 'super', '上に', 'sur-', 'superior,supervise,surpass'],
  ['trans-', '越えて・向こう側へ', 'Latin', 'trans', '横切って', 'tra-,tran-', 'transport,translate,transform'],
];

const SUFFIX_ROWS = [
  ['-able/-ible', '〜できる・〜に適した', 'Latin/French', 'abilis', '〜する能力がある', 'readable,possible,flexible'],
  ['-al', '〜に関する', 'Latin', 'alis', '〜に属する', 'natural,personal,regional'],
  ['-ance/-ence', '状態・性質・行為', 'Latin/French', 'antia/entia', '〜であること', 'importance,difference,existence'],
  ['-ant/-ent', '〜する人・もの／〜の性質', 'Latin', 'ans/ens', '〜している', 'assistant,student,dependent'],
  ['-ary', '〜に関する・場所・人', 'Latin', 'arius', '〜に属する', 'library,imaginary,secretary'],
  ['-ate', '〜にする・〜を行う', 'Latin', 'atus', '〜にされた', 'activate,educate,separate'],
  ['-dom', '状態・領域', 'Old English', 'dom', '判断／状態', 'freedom,kingdom,wisdom'],
  ['-ed', '過去・完了／〜した状態', 'Old English', 'ed', '動作が完了した', 'walked,interested,closed'],
  ['-en', '〜にする／〜でできた', 'Old English', 'en', '〜にする', 'widen,strengthen,wooden'],
  ['-er/-or', '〜する人・道具', 'English/Latin', 'er/or', '動作を担うもの', 'teacher,actor,processor'],
  ['-ery/-ry', '行為・場所・集合', 'French', 'erie', '〜に関わるもの', 'bakery,machinery,poetry'],
  ['-esque', '〜風の', 'French/Italian', 'esco', '〜の様式で', 'picturesque,Romanesque,Kafkaesque'],
  ['-ess', '女性を表す名詞語尾', 'French', 'esse', '女性の', 'actress,hostess,goddess'],
  ['-ful', '〜に満ちた', 'Old English', 'full', 'いっぱいの', 'helpful,careful,beautiful'],
  ['-hood', '身分・期間・状態', 'Old English', 'had', '状態／身分', 'childhood,neighborhood,likelihood'],
  ['-ic', '〜に関する・〜的な', 'Greek/Latin', 'ikos', '〜に属する', 'historic,scientific,poetic'],
  ['-ify', '〜にする', 'Latin/French', 'ficare', '作る', 'clarify,simplify,identify'],
  ['-ing', '進行・行為・結果', 'Old English', 'ing', '行為／その最中', 'running,building,interesting'],
  ['-ion/-sion/-tion', '行為・過程・結果', 'Latin', 'io', '〜すること', 'action,decision,translation'],
  ['-ish', '〜らしい・やや〜', 'Old English', 'isc', '〜に属する', 'childish,greenish,English'],
  ['-ism', '思想・制度・傾向', 'Greek/Latin', 'ismos', '行為／考え方', 'realism,capitalism,criticism'],
  ['-ist', '専門家・支持者', 'Greek/Latin', 'istes', '〜を行う人', 'artist,scientist,pianist'],
  ['-ity', '性質・状態', 'Latin/French', 'itas', '〜であること', 'ability,clarity,activity'],
  ['-ive', '〜する性質・傾向', 'Latin/French', 'ivus', '〜する', 'active,creative,sensitive'],
  ['-ize/-ise', '〜にする・〜化する', 'Greek/French', 'izein', '〜として扱う', 'modernize,realize,organise'],
  ['-less', '〜がない', 'Old English', 'leas', '欠いている', 'careless,hopeless,endless'],
  ['-let', '小さいもの', 'French', 'ette/let', '小さい', 'booklet,leaflet,droplet'],
  ['-like', '〜のような', 'Old English', 'lic', '形が似た', 'childlike,dreamlike,businesslike'],
  ['-ling', '小さいもの・関係する者', 'Old English', 'ling', '〜に属するもの', 'duckling,sibling,underling'],
  ['-ly', '〜のように／〜ごとの', 'Old English', 'lic', '形・性質が似た', 'slowly,friendly,daily'],
  ['-ment', '行為・結果・手段', 'Latin/French', 'mentum', '結果／手段', 'development,movement,instrument'],
  ['-ness', '性質・状態', 'Old English', 'nes', '〜であること', 'kindness,darkness,awareness'],
  ['-ous', '〜に満ちた・〜の性質', 'Latin/French', 'osus', '豊富に持つ', 'dangerous,curious,famous'],
  ['-ship', '状態・関係・技能', 'Old English', 'scipe', '形／状態', 'friendship,leadership,craftsmanship'],
  ['-ward/-wards', '〜の方向へ', 'Old English', 'weard', '向いて', 'forward,homeward,afterwards'],
];

const ROOT_ROWS = [
  ['act-/ag-', '行う・動かす', 'Latin', 'agere', '動かす／行う', 'act,agent,agenda'],
  ['aud-', '聞く', 'Latin', 'audire', '聞く', 'audio,audience,audible'],
  ['bio-', '生命', 'Greek', 'bios', '生命', 'biology,biography,biodegradable'],
  ['cap-/capt-/cept-', '取る・つかむ', 'Latin', 'capere', '取る', 'capture,accept,concept'],
  ['ced-/ceed-/cess-', '進む・行く', 'Latin', 'cedere', '進む', 'proceed,recede,process'],
  ['chron-', '時間', 'Greek', 'khronos', '時間', 'chronology,synchronize,chronic'],
  ['cid-/cis-', '切る・殺す', 'Latin', 'caedere', '切る', 'decide,incision,precise'],
  ['clam-/claim-', '叫ぶ', 'Latin', 'clamare', '叫ぶ', 'exclaim,proclaim,claim'],
  ['cred-', '信じる', 'Latin', 'credere', '信じる', 'credit,credible,incredible'],
  ['cur-/curs-', '走る', 'Latin', 'currere', '走る', 'current,cursor,course'],
  ['dic-/dict-', '言う・示す', 'Latin', 'dicere', '言う', 'dictate,predict,dictionary'],
  ['duc-/duct-', '導く', 'Latin', 'ducere', '導く', 'conduct,produce,educate'],
  ['fac-/fact-/fect-', '作る・行う', 'Latin', 'facere', '作る', 'factory,effect,perfect'],
  ['fer-', '運ぶ・担う', 'Latin', 'ferre', '運ぶ', 'transfer,refer,offer'],
  ['fin-', '終わり・境界', 'Latin', 'finis', '境界／終わり', 'final,define,infinite'],
  ['flex-/flect-', '曲げる', 'Latin', 'flectere', '曲げる', 'flexible,reflect,deflect'],
  ['flu-/flux-', '流れる', 'Latin', 'fluere', '流れる', 'fluid,influence,fluent'],
  ['form-', '形', 'Latin', 'forma', '形', 'form,transform,uniform'],
  ['fract-/frag-', '壊す・砕く', 'Latin', 'frangere', '壊す', 'fracture,fragment,fragile'],
  ['gen-', '生む・種類', 'Greek/Latin', 'genos/gignere', '生む／種族', 'generate,gene,general'],
  ['geo-', '地球・土地', 'Greek', 'ge', '大地', 'geography,geology,geometry'],
  ['grad-/gress-', '歩く・段階', 'Latin', 'gradi', '歩く', 'grade,progress,degree'],
  ['graph-/gram-', '書く・記録', 'Greek', 'graphein', '書く', 'graphic,paragraph,telegram'],
  ['ject-', '投げる', 'Latin', 'iacere', '投げる', 'project,reject,object'],
  ['jur-/jus-', '法・正しさ', 'Latin', 'ius', '法／権利', 'justice,jury,jurisdiction'],
  ['leg-/lect-', '選ぶ・読む', 'Latin', 'legere', '集める／選ぶ', 'select,collect,lecture'],
  ['loc-', '場所', 'Latin', 'locus', '場所', 'local,locate,allocate'],
  ['log-/logue-', '言葉・学問', 'Greek', 'logos', '言葉／理', 'logic,dialogue,biology'],
  ['luc-/lum-', '光', 'Latin', 'lux/lumen', '光', 'lucid,illuminate,luminous'],
  ['manu-', '手', 'Latin', 'manus', '手', 'manual,manufacture,manuscript'],
  ['mater-/matr-', '母・源', 'Latin', 'mater', '母', 'maternal,matrix,maternity'],
  ['memor-', '覚えている', 'Latin', 'memor', '心に留める', 'memory,memorial,remember'],
  ['metr-/meter-', '測る', 'Greek', 'metron', '尺度', 'meter,geometry,thermometer'],
  ['migr-', '移動する', 'Latin', 'migrare', '移る', 'migrate,immigrant,emigrate'],
  ['mit-/miss-', '送る', 'Latin', 'mittere', '送る', 'submit,transmit,mission'],
  ['mob-/mot-/mov-', '動く', 'Latin', 'movere', '動かす', 'mobile,motion,remove'],
  ['mort-', '死', 'Latin', 'mors', '死', 'mortal,mortgage,immortal'],
  ['nat-', '生まれる', 'Latin', 'nasci', '生まれる', 'native,nature,nation'],
  ['nom-/nym-', '名前', 'Greek/Latin', 'nomen/onyma', '名前', 'nominate,synonym,anonymous'],
  ['nov-', '新しい', 'Latin', 'novus', '新しい', 'novel,innovate,renovate'],
  ['pac-/peas-', '平和・合意', 'Latin', 'pax', '平和', 'pacify,peace,appease'],
  ['path-', '感じる・苦しむ', 'Greek', 'pathos', '経験／感情', 'empathy,pathetic,pathology'],
  ['ped-', '足', 'Latin', 'pes', '足', 'pedal,pedestrian,biped'],
  ['pend-/pens-', '吊るす・量る', 'Latin', 'pendere', '吊るす', 'depend,suspend,expense'],
  ['phon-', '音・声', 'Greek', 'phone', '声／音', 'telephone,phonetic,symphony'],
  ['photo-', '光', 'Greek', 'phos', '光', 'photograph,photosynthesis,photon'],
  ['plac-/pleas-', '喜ばせる・穏やか', 'Latin', 'placere', '喜ばせる', 'please,pleasant,placid'],
  ['pon-/pos-', '置く', 'Latin', 'ponere', '置く', 'position,compose,opponent'],
  ['port-', '運ぶ', 'Latin', 'portare', '運ぶ', 'transport,portable,report'],
  ['press-', '押す', 'Latin', 'premere', '押す', 'pressure,express,compress'],
  ['psych-', '心・魂', 'Greek', 'psyche', '息／魂', 'psychology,psychic,psychiatry'],
  ['rupt-', '破る', 'Latin', 'rumpere', '壊す', 'rupture,interrupt,corrupt'],
  ['scrib-/script-', '書く', 'Latin', 'scribere', '書く', 'describe,script,manuscript'],
  ['sec-/sect-', '切る', 'Latin', 'secare', '切る', 'section,dissect,sector'],
  ['sens-/sent-', '感じる', 'Latin', 'sentire', '感じる', 'sense,sensitive,consent'],
  ['sequ-/secut-', '続く・従う', 'Latin', 'sequi', '後を追う', 'sequence,consequence,execute'],
  ['sign-', '印', 'Latin', 'signum', 'しるし', 'signal,design,signature'],
  ['sim-/sem-', '同じ・似た', 'Latin', 'similis', '似ている', 'similar,resemble,simulate'],
  ['sol-', '太陽', 'Latin', 'sol', '太陽', 'solar,solstice,parasol'],
  ['solv-/solut-', '解く・ほどく', 'Latin', 'solvere', 'ほどく', 'solve,dissolve,solution'],
  ['spec-/spect-/spic-', '見る', 'Latin', 'specere', '見る', 'inspect,spectator,perspective'],
  ['spir-', '息をする', 'Latin', 'spirare', '息をする', 'inspire,respire,spirit'],
  ['sta-/stat-/stit-', '立つ・置く', 'Latin', 'stare', '立つ', 'status,station,constitute'],
  ['struct-', '組み立てる', 'Latin', 'struere', '積み重ねる', 'structure,construct,instruct'],
  ['tang-/tact-', '触れる', 'Latin', 'tangere', '触る', 'tangible,contact,tactile'],
  ['temp-/tempor-', '時間', 'Latin', 'tempus', '時間', 'temporary,contemporary,tempo'],
  ['ten-/tain-', '保つ・持つ', 'Latin', 'tenere', '持つ', 'retain,contain,tenant'],
  ['terr-', '大地・土地', 'Latin', 'terra', '大地', 'terrain,territory,terrestrial'],
  ['tract-', '引く', 'Latin', 'trahere', '引っ張る', 'attract,contract,extract'],
  ['ven-/vent-', '来る', 'Latin', 'venire', '来る', 'event,invent,convention'],
  ['ver-', '真実', 'Latin', 'verus', '真実の', 'verify,verdict,very'],
  ['vid-/vis-', '見る', 'Latin', 'videre', '見る', 'video,visible,evidence'],
  ['voc-/vok-', '呼ぶ・声', 'Latin', 'vocare', '呼ぶ', 'voice,vocabulary,invoke'],
  ['vol-', '意志・望む', 'Latin', 'velle', '望む', 'voluntary,benevolent,volition'],
  ['viv-/vit-', '生きる・生命', 'Latin', 'vivere/vita', '生きる', 'vivid,survive,vital'],
];

function sourceRefs(row, type) {
  const form = row[0];
  const words = type === 'prefix' ? row[6] : row[5];
  const firstWord = String(words || '').split(',')[0].trim();
  return [
    {
      title: `${firstWord} - Online Etymology Dictionary`,
      organization: 'Online Etymology Dictionary',
      url: `https://www.etymonline.com/word/${encodeURIComponent(firstWord)}`,
    },
    {
      title: `${firstWord} - Merriam-Webster`,
      organization: 'Merriam-Webster',
      url: `https://www.merriam-webster.com/dictionary/${encodeURIComponent(firstWord)}`,
    },
  ];
}

function expandSeed(row, type, index) {
  const [form, meaningJa, originLanguage, originalForm, originalMeaningJa] = row;
  const variantsRaw = type === 'prefix' ? row[5] : '';
  const wordsRaw = type === 'prefix' ? row[6] : row[5];
  const variants = String(variantsRaw || '').split(',').map(value => value.trim()).filter(Boolean);
  const words = String(wordsRaw || '').split(',').map(value => value.trim()).filter(Boolean);
  const typeLabel = type === 'prefix' ? '接頭辞' : type === 'suffix' ? '接尾辞' : '語根';
  const location = type === 'prefix'
    ? '単語の前に付いて'
    : type === 'suffix'
      ? '単語の末尾に付いて'
      : '単語の意味の中心に入り';
  return {
    id: `core-${type}-${String(index + 1).padStart(3, '0')}`,
    version: CORE_VERSION,
    type,
    typeLabel,
    form,
    displayForm: form,
    aliases: variants,
    quickSummaryJa: `${form} は「${meaningJa}」という方向を与える${typeLabel}です。`,
    origin: {
      language: originLanguage,
      form: originalForm,
      meaningJa: originalMeaningJa,
      noteJa: `${originLanguage} の ${originalForm} にさかのぼり、もともとは「${originalMeaningJa}」という具体的な関係や動きを表しました。`,
    },
    coreImageJa: `「${originalMeaningJa}」という像から、${location}「${meaningJa}」という意味の方向を作ります。`,
    semanticBridgeJa: `原義の「${originalMeaningJa}」が、位置・動き・状態の比喩へ広がり、現代語では「${meaningJa}」を示すまとまりとして働きます。`,
    senses: [{
      id: `${type}-${index + 1}-sense-1`,
      labelJa: meaningJa,
      explanationJa: `${location}、語全体を「${meaningJa}」の方向へ導きます。単語ごとに比喩化の段階が違うため、機械的な直訳ではなく意味の橋渡しを確認するのが重要です。`,
    }],
    formChanges: variants.length
      ? [`語幹の最初の音に同化するなどして ${variants.join('、')} の形が現れます。意味の核は同じでも、綴りだけで別の語源と判断しないようにします。`]
      : ['目立った異形は少ないものの、借用された時代や綴りの固定過程で形が変わる場合があります。'],
    wordLinks: words.map((word, wordIndex) => ({
      id: `${type}-${index + 1}-word-${wordIndex + 1}`,
      term: word,
      breakdownJa: `${word} の中で ${form} に対応する部分が、語全体へ「${meaningJa}」の方向を加えています。`,
      bridgeJa: `「${originalMeaningJa}」という原義から「${meaningJa}」という抽象的な関係へ意味が移った例として確認できます。`,
      example: wordIndex === 0
        ? `The word "${word}" preserves the core idea of ${form}.`
        : '',
      exampleJa: wordIndex === 0
        ? `「${word}」には ${form} の中心イメージが残っています。`
        : '',
    })),
    comparisons: [],
    cautionsJa: [
      `見た目が ${form} と一致しても、すべての単語がこの${typeLabel}からできたとは限りません。`,
      '語源は現在の意味を覚える助けですが、現代の用法を完全に予測する規則ではありません。',
    ],
    grammarImpactJa: type === 'suffix'
      ? '接尾辞は品詞を変えることがあります。元の語と完成語の品詞をセットで確認してください。'
      : type === 'prefix'
        ? '接頭辞は通常、語の意味を変えますが、品詞を必ず変えるわけではありません。'
        : '語根は複数の品詞にまたがって現れるため、前後の接辞と完成語の品詞を確認します。',
    relatedIds: [],
    status: 'core',
    confidence: 'reference',
    sourceRefs: sourceRefs(row, type),
  };
}

const RAW_CORE = [
  ...PREFIX_ROWS.map((row, index) => expandSeed(row, 'prefix', index)),
  ...SUFFIX_ROWS.map((row, index) => expandSeed(row, 'suffix', index)),
  ...ROOT_ROWS.map((row, index) => expandSeed(row, 'root', index)),
];

const RELATED_FORMS = {
  'anti-': ['contra-', 'un-', 'non-'],
  'bene-': ['mal-'],
  'bi-': ['mono-', 'multi-', 'poly-'],
  'co-/com-/con-': ['inter-', 'ad-'],
  'de-': ['dis-', 'ab-/abs-'],
  'ex-/e-': ['in-/im- (into)', 'trans-'],
  'fore-': ['pre-', 'post-'],
  'hyper-': ['super-', 'over-'],
  'in-/im- (not)': ['un-', 'non-'],
  'in-/im- (into)': ['en-/em-', 'in-/im- (not)'],
  'inter-': ['co-/com-/con-', 'trans-'],
  'micro-': ['multi-', 'mono-'],
  'post-': ['pre-', 'fore-'],
  'sub-': ['under-', 'super-'],
  'tele-': ['trans-'],
  '-ance/-ence': ['-ity', '-ness'],
  '-er/-or': ['-ist', '-ant/-ent'],
  '-ful': ['-less', '-ous'],
  '-ion/-sion/-tion': ['-ment', '-ing'],
  '-ity': ['-ness', '-ance/-ence'],
  '-ize/-ise': ['-ify', '-ate'],
  '-less': ['-ful', 'un-'],
  '-ness': ['-ity', '-dom'],
  'aud-': ['phon-', 'voc-/vok-'],
  'bio-': ['viv-/vit-', 'nat-'],
  'dic-/dict-': ['voc-/vok-', 'log-/logue-'],
  'fac-/fact-/fect-': ['struct-', 'form-'],
  'flu-/flux-': ['cur-/curs-', 'mob-/mot-/mov-'],
  'geo-': ['terr-'],
  'graph-/gram-': ['scrib-/script-'],
  'luc-/lum-': ['photo-', 'sol-'],
  'mit-/miss-': ['fer-', 'port-'],
  'nom-/nym-': ['voc-/vok-'],
  'path-': ['psych-', 'sens-/sent-'],
  'phon-': ['aud-', 'voc-/vok-'],
  'photo-': ['luc-/lum-', 'sol-'],
  'sol-': ['photo-', 'luc-/lum-'],
  'solv-/solut-': ['-ion/-sion/-tion'],
  'spec-/spect-/spic-': ['vid-/vis-'],
  'terr-': ['geo-'],
  'vid-/vis-': ['spec-/spect-/spic-'],
  'viv-/vit-': ['bio-', 'nat-'],
};

const FORM_TO_ID = new Map(RAW_CORE.map(entry => [entry.form, entry.id]));

export const ETYMOLOGY_CORE = RAW_CORE.map(entry => {
  const relatedForms = RELATED_FORMS[entry.form] || [];
  const relatedIds = relatedForms.map(form => FORM_TO_ID.get(form)).filter(Boolean);
  const comparisons = relatedForms.slice(0, 2).map(form => {
    const related = RAW_CORE.find(item => item.form === form);
    return {
      form,
      differenceJa: related
        ? `${entry.form} は「${entry.senses[0].labelJa}」、${form} は「${related.senses[0].labelJa}」を中心にします。完成語では両者が似た方向に見えることがあるため、原義からの意味の橋を比べます。`
        : '',
    };
  }).filter(item => item.differenceJa);
  return { ...entry, relatedIds, comparisons };
});

export const ETYMOLOGY_CORE_STATS = Object.freeze({
  version: CORE_VERSION,
  prefixes: PREFIX_ROWS.length,
  suffixes: SUFFIX_ROWS.length,
  roots: ROOT_ROWS.length,
  total: ETYMOLOGY_CORE.length,
});

export function getEtymologyCoreEntry(id) {
  return ETYMOLOGY_CORE.find(entry => entry.id === id) || null;
}
