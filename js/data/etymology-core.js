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

// One distinct reading lens per entry. These are deliberately phrased as
// learning guidance, not as claims that every modern related word has an
// identical history or meaning.
const DEEP_FOCUS = {
  'ab-/abs-': '中心や基準点から「離れる」動きを思い浮かべると、absent の不在や abstract の具体性からの距離を一つの像としてつかめます。',
  'ad-': '対象のほうへ寄る動きが核です。adapt や attract では、単に「へ」ではなく、何かに合わせる・引き寄せられる関係として読めます。',
  'un-': 'un- は単純な否定だけでなく、状態を外す・逆向きにする働きも持ちます。unlock は「鍵がない」ではなく、閉じた状態をほどく動きです。',
  'anti-': 'anti- は対象に対して向き合う緊張を含みます。antibiotic と antisocial はどちらも「反対」ですが、対抗する対象はまったく異なります。',
  'bene-': '「良い」は道徳的な善だけではなく、benefit の有益さや benevolent の好意のように、相手にとって望ましい方向へ広がります。',
  'bi-': '二つという数の核から、bilingual の二言語、binary の二進的な対、bicycle の二輪というように「二項のまとまり」を読み取れます。',
  'circum-': 'circum- は一点を通り過ぎるのでなく、周囲を取り巻く視点です。circumnavigate は回り込む動き、circumstance は周りに置かれた事情という像で捉えます。',
  'co-/com-/con-': '「一緒に」は、物を寄せるだけでなく、要素を結び、働きを協力させる関係です。connect・collaborate・combine はその関係の置き方が異なります。',
  'contra-': 'contra- は二つのものが正面から向き合う像です。contrast の違いを際立たせる働きと contradict の否定し合う働きを分けて読みます。',
  'de-': 'de- は下へ・離れて・取り去ってという複数の運動を持ちます。decline と detach を同じ訳で覚えず、元の状態からどう変わるかを見ます。',
  'dis-': 'dis- は「ばらす」「反対側へ向ける」感覚を作ります。disconnect の分離、disagree の不一致、differ の違いは同じ核の別方向です。',
  'en-/em-': 'en-/em- は中に入れる、ある状態にする働きが中心です。enable・encircle・empower は、何をその状態へ移すのかに注目します。',
  'ex-/e-': 'ex- は外へ出すだけでなく、外に置かれた状態や、以前そこにいたことにもつながります。export と ex-president は同じ日本語訳にはなりません。',
  'extra-': 'extra- は基準線の「外側」を示します。extraordinary は普通の範囲を超えること、extracurricular は正課の外であることを表します。',
  'fore-': 'fore- は時間的にも位置的にも前に置く視点です。forecast・foresee・foreword は、何が先にあり、何を見通すのかを比べると分かります。',
  'hyper-': 'hyper- は程度の基準を上回る像です。hyperactive の過度さ、hyperlink の上位概念ではなく、語ごとの専門的な意味を確認します。',
  'under-': 'under- は物理的な下だけでなく、基準を下回る不足にも広がります。underground と underestimate は「下」の種類が違う例です。',
  'in-/im- (not)': '否定の in- は状態や性質を打ち消します。inactive・impossible・irregular は、何が欠けるのかを後ろの語から具体化すると覚えやすくなります。',
  'in-/im- (into)': '方向の in- は中へ入れる・上に置く感覚です。import・insert・illustrate を見比べ、否定の in- と意味だけでなく語源の流れも区別します。',
  'inter-': 'inter- は二者以上の「あいだ」に関係を作ります。international は国と国の間、interact は行為と行為の間というように、関係の相手を探します。',
  'tele-': 'tele- の核は距離です。telephone・television・telework は、遠くにあるものを声・映像・仕事でつなぐ方法の違いとして読めます。',
  'mal-': 'mal- は悪さだけでなく、不十分さ・うまくいかなさを表すことがあります。malfunction と malevolent では、問題になる対象が機能か意図かで異なります。',
  'meta-': 'meta- は一段外から見る、変化の後ろへ進むという視点を作ります。metaphor・metamorphosis・metadata は同じ訳にせず、対象との距離を考えます。',
  'micro-': 'micro- は小ささを示しますが、日常的な小型から科学的な微小まで尺度が動きます。microchip と microbiology は何が小さい単位なのかを確認します。',
  'mis-': 'mis- は誤り・ずれ・不適切さを示します。misunderstand は理解のずれ、mislead は相手を誤った方向へ導く行為で、責任の重さも異なります。',
  'mono-': 'mono- は一つにまとめる像です。monologue・monochrome・monopoly では、一人・一色・一者という異なる領域に同じ「一」が現れます。',
  'multi-': 'multi- は複数をただ数えるのでなく、多様な要素が並ぶ状態を示します。multilingual と multimedia で、何が複数なのかを明確にします。',
  'non-': 'non- は分類から外すために使われることが多い接頭辞です。nonfiction・nonverbal・nonprofit は、何ではないかを先に示して範囲を定めます。',
  'over-': 'over- は上方・越える・過度という三つの読みが混ざります。overcome・overwork・overestimate は、基準を越える対象が障害・労働・評価で違います。',
  'ultra-': 'ultra- は限界の向こう側という強い像です。ultraviolet は可視域の外、ultramodern は通常の新しさを越えるという基準の違いがあります。',
  'poly-': 'poly- は多くの要素が一つの体系を作るときに現れます。polygon・polyglot・polymer は、辺・言語・単位の多さをそれぞれ表します。',
  'post-': 'post- は出来事の後に置く時間軸です。postwar・postpone・postscript を比べると、後に「続く」のか「移す」のかが違うと分かります。',
  'pre-': 'pre- は先取り・予測・準備の方向を作ります。preview・predict・prepare は、未来をただ早くするのでなく、何に先回りするかが焦点です。',
  'pro-': 'pro- は前へ進める、賛成する、代わりに立つという複数の流れを持ちます。progress・promote・pronoun を一つの訳で結びつけないようにします。',
  're-': 're- は再びだけでなく、元の位置・状態へ戻す動きです。rewrite・return・restore は、繰り返しと回復のどちらが中心かを見ます。',
  'retro-': 'retro- は後ろ向きの視線です。retroactive は過去へ効力を及ぼし、retrospect は過去を振り返り、retrofit は古いものへ後から手を入れます。',
  'semi-': 'semi- は完全でない半分・部分性を示します。semifinal・semicircle・semiconscious は、何が途中・半分なのかを分けて読めます。',
  'sub-': 'sub- は下に置く、下位に置く、内側へ潜るといった位置関係を作ります。submarine・support・suggest の完成語では比喩化の幅に注意します。',
  'super-': 'super- は上に置く・越えるという序列の像です。superior・supervise・surpass は、上位性・上から見ること・追い越すことを区別します。',
  'trans-': 'trans- は境界を横切る動きです。transport・translate・transform は、物・言語・形がどの境界を越えるかを追うとつながります。',
  '-able/-ible': '可能・適性を表す語尾ですが、-able と -ible は単なる綴り違いではありません。語幹の由来や慣用で形が定着しており、完成語の意味で覚えるのが安全です。',
  '-al': '「関する」という枠を作ることが多い語尾です。natural・personal・regional は、何に関係する性質なのかを名詞との関係で確かめます。',
  '-ance/-ence': '状態・性質・行為を名詞として取り出す語尾です。importance・difference・existence では、動きそのものより、その成立している状態に焦点が移ります。',
  '-ant/-ent': '行為をする人・ものと、その性質を示す形容詞の両方に現れます。assistant・student・dependent は、文の中で名詞か形容詞かを必ず確認します。',
  '-ary': '場所・人・関係する性質を作る語尾です。library・imaginary・secretary は似た綴りでも品詞と意味の役割が異なります。',
  '-ate': '動詞を作る場合と、形容詞・名詞の一部として定着する場合があります。activate・educate・separate は、語尾だけで品詞を断定しない練習に向きます。',
  '-dom': '身分・領域・状態を一つのまとまりとして名詞化します。freedom・kingdom・wisdom は、具体的な場所だけでなく抽象的な状態にも使われます。',
  '-ed': '過去形・過去分詞だけでなく、closed や interested のように「そうなった状態」を表す形容詞にもなります。時制と状態を分けて読むのが大切です。',
  '-en': 'widen のように「〜にする」動詞にも、wooden のように材料を表す形容詞にもなります。同じ綴りでも働きが一つではありません。',
  '-er/-or': '行為者・道具・役割を作る代表的な語尾です。teacher・actor・processor は、誰がするのか、何が処理するのかという主役を名詞にします。',
  '-ery/-ry': '場所・行為・集合・抽象名詞など幅広い形を作ります。bakery・machinery・poetry を同じ意味にまとめず、語幹との組み合わせを見る必要があります。',
  '-esque': '何かの様式・印象を借りて「〜風の」と言う語尾です。評価がほめ言葉か皮肉かは、picturesque や Kafkaesque の文脈で変わります。',
  '-ess': '歴史的に女性を表した語尾ですが、現代では性別を限定しない語へ置き換わる場面もあります。語源と現在の使用感を分けて確認します。',
  '-ful': '「満ちた」という像から性質を強めます。helpful・careful・beautiful は、量が多いというより、その性質を帯びていることを表します。',
  '-hood': '期間・身分・関係を一まとまりの状態として名詞化します。childhood・neighborhood・likelihood は、時間・場所・可能性へ広がる例です。',
  '-ic': '関係や性質を形容詞にする語尾です。historic・scientific・poetic は、何らかの分野に属するという説明以上に、文中でどの名詞を修飾するかが重要です。',
  '-ify': 'ある状態へ作り変える動詞を作ります。clarify・simplify・identify は、何をより明確にするのか、単純にするのか、同定するのかを目的語と一緒に見ます。',
  '-ing': '進行・行為・結果・性質を作るため、文法上の役割がとても多い語尾です。running・building・interesting を同じ品詞として扱わないようにします。',
  '-ion/-sion/-tion': '行為・過程・結果を名詞として切り出す大きな語尾群です。action・decision・translation は、動詞の出来事を概念として扱える形にします。',
  '-ish': '完全ではない「やや〜」、その人らしい「〜っぽい」、民族・言語名の一部など、幅があります。childish と childlike の評価の違いも確認します。',
  '-ism': '思想・制度・傾向を名詞にします。realism・capitalism・criticism では、個別の行為ではなく、まとまった考え方や実践を指します。',
  '-ist': '専門家・実践者・支持者を表します。artist・scientist・pianist は、何を行う人かを示しますが、立場を表す語では評価や文脈に注意します。',
  '-ity': '性質や状態を抽象名詞にします。ability・clarity・activity は、形容詞的な特徴を「話題にできるもの」として取り出す働きです。',
  '-ive': '作用・傾向・性質を帯びる形容詞を作ります。active・creative・sensitive は、何に対してその性質が現れるかでニュアンスが具体化します。',
  '-ize/-ise': '変化・処理・体系化を表す動詞を作ります。modernize・realize・organise は、語尾だけでなく英米の綴り差や完成語の意味にも注目します。',
  '-less': '欠如を強く見せる語尾です。careless・hopeless・endless は、何がないのかだけでなく、その欠如が評価や感情をどう変えるかを読みます。',
  '-let': '小ささ・縮小版を作ることがあります。booklet・leaflet・droplet は物理的に小さい例ですが、語によっては親しみや軽さのニュアンスも生まれます。',
  '-like': '類似を表す語尾です。childlike は子どものような良さにもなり得ますが、childish とは評価が違うため、同じ「〜らしい」で済ませません。',
  '-ling': '小さいもの・関係する人を示すことがあります。duckling・sibling・underling は、現代では語尾の意味が見えにくく定着している例もあります。',
  '-ly': '副詞を作る場合と、friendly・daily のように形容詞の一部となる場合があります。語尾を見た瞬間に副詞と決めないことが実用上のポイントです。',
  '-ment': '行為・結果・手段を名詞にします。development・movement・instrument では、同じ語尾でも出来事・変化・道具という焦点が異なります。',
  '-ness': '形容詞の性質をそのまま名詞にしやすい語尾です。kindness・darkness・awareness は、感じ方や状態を話題の中心に置けるようにします。',
  '-ous': '性質を帯びる形容詞を作ります。dangerous・curious・famous は、何に満ちているかという原義の感覚が、現代では定着した評価語になっています。',
  '-ship': '関係・身分・技能・状態を名詞にします。friendship・leadership・craftsmanship は、個人そのものより、その間にある関係や能力のあり方を示します。',
  '-ward/-wards': '方向を示す語尾です。forward・homeward・afterwards は、空間的な進行と時間的な順序のどちらを指すかを文脈で見分けます。',
  'act-/ag-': 'act・agent・agenda を比べると、「行う」という動作が、行為そのもの・行為者・行うべき事柄へ展開する様子が見えます。',
  'aud-': 'aud- は聞く側の注意を含む語根です。audio は音そのもの、audience は聞く人の集まり、audible は聞こえうる性質に焦点を移します。',
  'bio-': 'bio- は生命を学問・記録・環境の視点へ広げます。biology・biography・biodegradable で、生命が対象・人生・分解過程として現れます。',
  'cap-/capt-/cept-': '「取る・つかむ」は、物理的に捕えることから、accept の受け入れや concept の考えをつかむことへ抽象化します。',
  'ced-/ceed-/cess-': '進むという動きが、proceed の前進、recede の後退、process の進行へ変化します。方向を与える接頭辞と合わせて読むと効果的です。',
  'chron-': 'chron- は時間をただの数字でなく、順序や長さとして扱います。chronology の並び、synchronize の同時性、chronic の長期性を分けて見ます。',
  'cid-/cis-': '切るという具体的な動作が、decide の「切り分けて決める」や incision の切開へ広がります。precise では境界を切り出す精密さが関わります。',
  'clam-/claim-': '叫ぶ声の像から、exclaim・proclaim の公的な発声、claim の主張へ進みます。声の大きさより、何を前に出して主張するかに注目します。',
  'cred-': 'cred- は信じることを、信用・信頼性・信じがたさへ広げます。credit・credible・incredible は評価する側との関係を含む語です。',
  'cur-/curs-': '走る動きは、current の流れ、cursor の移動、course の道筋へ変わります。物理的な走行から、時間や情報の流れまで広がるのが特徴です。',
  'dic-/dict-': '言う・示すという核は、dictate の指示、predict の前もって言うこと、dictionary の語の記録へつながります。',
  'duc-/duct-': '導くことは、人を連れていく動きから、conduct の運営、produce の前へ出すこと、educate の引き出す学びへ広がります。',
  'fac-/fact-/fect-': '作る・行うという核は、factory の生産、effect の生じた結果、perfect の十分に作り上がった状態などへ姿を変えます。',
  'fer-': 'fer- は運ぶ・担うという動きです。transfer は向こうへ運ぶ、refer は話題を運び戻す、offer は前へ差し出すという関係を作ります。',
  'fin-': 'fin- は終わりであると同時に境界です。final の終結、define の範囲を定めること、infinite の境界のなさを並べると核が見えます。',
  'flex-/flect-': '曲げる動きは、flexible の柔軟さ、reflect の折り返し、deflect のそらすことへ広がります。方向がどこへ曲がるかを追います。',
  'flu-/flux-': '流れることから、fluid の流動性、influence の流れ込む作用、fluent の滑らかな言葉の流れが生まれます。',
  'form-': 'form- は形そのものだけでなく、形づくる働きも含みます。transform と uniform は、変化と統一という異なる形の扱い方を見せます。',
  'fract-/frag-': '壊す・砕くという像は、fracture の破断、fragment の破片、fragile の壊れやすさへ分かれます。結果・部分・性質を区別します。',
  'gen-': 'gen- は生む・種類という核を持ちます。generate の生産、gene の遺伝、general の広い類別は、起源と分類の両方へ伸びています。',
  'geo-': 'geo- は地球・土地を対象にする視点です。geography・geology・geometry は、場所・地質・測定という違う切り口で地を扱います。',
  'grad-/gress-': '一歩ずつ進む像が、grade の段階、progress の前進、degree の度合いへ広がります。動きが尺度や到達度へ変わる例です。',
  'graph-/gram-': '書く・記録するという核から、graphic の視覚的な記述、paragraph の書かれたまとまり、telegram の遠くへの記録が生まれます。',
  'ject-': '投げる動きは、project の前へ投げ出すこと、reject の投げ返すこと、object の前に投げ出された対象という方向差に現れます。',
  'jur-/jus-': '法・正しさの核は、justice の公正、jury の判断する集団、jurisdiction の法が及ぶ範囲として現れます。',
  'leg-/lect-': '選ぶ・読むという核は、select の選別、collect の集めること、lecture の読まれる・語られる内容へ分かれます。',
  'loc-': 'loc- は場所を定める視点です。local はその場所に属すること、locate は場所を特定すること、allocate は場所や資源を割り当てることです。',
  'log-/logue-': 'logos に由来する語群は、言葉・説明・理屈を扱います。logic・dialogue・biology は、話すことと知識体系の両方へ伸びています。',
  'luc-/lum-': '光の像は、lucid の明晰さ、illuminate の照らすこと、luminous の光を帯びた状態へ比喩的にも物理的にも広がります。',
  'manu-': '手という具体的な像は、manual の手作業、manufacture の手で作ること、manuscript の手書きへ残ります。',
  'mater-/matr-': '母・源という核は、maternal の母性、matrix の母体・基盤、maternity の母である状態へ広がります。',
  'memor-': '覚えていることは、memory の記憶、memorial の記念、remember の思い出す行為へ展開します。過去を心に留める像が共通します。',
  'metr-/meter-': '測ることから、meter の尺度、geometry の地を測ること、thermometer の温度を測る道具がつながります。',
  'migr-': '移動することが、migrate の移住、immigrant の入ってくる人、emigrate の外へ出る行為として方向を伴って現れます。',
  'mit-/miss-': '送るという核は、submit の下へ送ること、transmit の越えて送ること、mission の送られた役目へ広がります。',
  'mob-/mot-/mov-': '動くという核は、mobile の動かせること、motion の動き、remove の別の場所へ動かすことに残ります。物が実際に移る場合だけでなく、状態や注意が「動く」比喩にも広がるため、何が移動の主体かを確かめます。',
  'mort-': 'mort- は死を示す語根です。mortal・immortal の生死の対比に加え、mortgage のように歴史的な意味が見えにくい語もあるため注意します。',
  'nat-': '生まれることから、native の生まれつき、 nature の生まれ持つ性質、nation の生まれや出自に結びつく集団へ広がります。',
  'nom-/nym-': '名前という核は、nominate の名を挙げること、synonym の共に使われる名、anonymous の名がないことへ向かいます。',
  'nov-': '新しいことは、novel の新しさ、innovate の中へ新しさを入れること、renovate の再び新しくすることへつながります。',
  'pac-/peas-': '平和・合意の核は、pacify の穏やかにすること、peace の平和、appease の怒りを静めることへ広がります。',
  'path-': 'path- は感じること・苦しむことを含む核です。empathy の共に感じること、pathetic の感情を引き起こすこと、pathology の病いの経験を比べます。',
  'ped-': '足という像は、pedal の踏むもの、pedestrian の歩行者、biped の二本足の存在として具体的に残ります。抽象的な比喩より身体の部位との結びつきが見えやすいので、語根を初めて追うときの基準になる語群です。',
  'pend-/pens-': '吊るす・量ることから、depend の何かにぶら下がる関係、suspend の吊るして止めること、expense の支払いを量る感覚が広がります。',
  'phon-': '音・声の核は、telephone の遠い声、phonetic の音声に関すること、symphony の音の共鳴へ展開します。',
  'photo-': 'photo- は光を使う・光から得る視点です。photograph・photosynthesis・photon で、記録・化学反応・粒子という異なる科学的文脈に現れます。',
  'plac-/pleas-': '喜ばせる・穏やかにする核は、please の喜ばせること、pleasant の心地よさ、placid の静けさへ広がります。',
  'pon-/pos-': '置くという動作は、position の置かれた場所、compose の一緒に置いて作ること、opponent の向かいに置かれた相手へ変化します。',
  'port-': '運ぶことは、transport の越えて運ぶこと、portable の持ち運べること、report の情報を運び伝えることに残ります。',
  'press-': '押すことから、pressure の圧力、express の外へ押し出す表現、compress の一緒に押し縮めることが見えてきます。',
  'psych-': 'psych- は心・魂を扱う核です。psychology の学問、psychic の心的なもの、psychiatry の医療的文脈では使い方が異なります。',
  'rupt-': '破ることは、rupture の破裂、interrupt の流れを断つこと、corrupt の本来の状態を壊すことへ抽象化します。',
  'scrib-/script-': '書くことから、describe の書き添える説明、script の書かれた台本、manuscript の手書き資料がつながります。',
  'sec-/sect-': '切ることは、section の切り分けた部分、dissect の細かく切ること、sector の切り出された領域として現れます。',
  'sens-/sent-': '感じる・考えることが、sense の感覚、sensitive の感じやすさ、consent の共に感じて同意することへ広がります。',
  'sequ-/secut-': '続く・従うことから、sequence の順番、consequence の後から続いて起こる結果、execute の手順に従って実行することが見えます。',
  'sign-': '印・しるしの核は、signal の合図、design の印を付けて計画すること、signature の個人を示す印へ展開します。',
  'sim-/sem-': '似ていることから、similar の類似、resemble の似た姿、simulate の似せて再現することへ広がります。',
  'sol-': 'sol- は太陽の系統です。solar・solstice・parasol は光や太陽の位置に関わり、似た綴りの solv-「ほどく」とは別に扱います。',
  'solv-/solut-': 'solv- はほどく・ゆるめる系統です。solve は問題をほどくこと、dissolve は結びつきをほどくこと、solution はほどかれた結果という像で見ます。',
  'spec-/spect-/spic-': '見ることから、inspect の注意深く見る、spectator の見る人、perspective の見方・視点へ広がります。視覚から判断や観点へ進む代表例です。',
  'spir-': '息をすることは、respire の呼吸、spirit の息・精神、inspire の息を吹き込むような刺激へ比喩的に広がります。',
  'sta-/stat-/stit-': '立つ・置くという核は、status の置かれた状態、station の立つ場所、constitute の一緒に置いて成り立たせることへ展開します。',
  'struct-': '積み上げて組み立てることから、structure の構造、construct の建設、instruct の中へ組み立てて教えることがつながります。',
  'tang-/tact-': '触れることが、tangible の触れられること、contact の触れ合い、tactile の触覚的な性質へ残ります。',
  'temp-/tempor-': '時間の核は、temporary の一時性、contemporary の同じ時代、tempo の時間的な速さへ異なる角度で現れます。',
  'ten-/tain-': '保つ・持つことから、retain の保持、contain の中に保つこと、tenant の場所を保有して使う人という関係が見えます。',
  'terr-': 'terr- は大地・土地の系統です。terrain の地形、territory の区切られた土地、terrestrial の地上のものを結び、sol- の太陽系統と混同しません。',
  'tract-': '引くことから、attract のこちらへ引くこと、contract の一緒に引き締めること、extract の外へ引き出すことが読み取れます。',
  'ven-/vent-': '来ることから、event の起こって来ること、invent の中へ見つけ出すこと、convention の共に来る集まりへ広がります。',
  'ver-': '真実の核は、verify の真と確かめること、verdict の真実を言い渡すこと、very の強調へ歴史的に関わります。',
  'vid-/vis-': '見ることから、video の見るもの、visible の見える性質、evidence の見えるしるしへつながります。spec- 系と近いが別の語根として比べます。',
  'voc-/vok-': '呼ぶ・声の核は、voice の声、vocabulary の呼び名の集まり、invoke の呼び出すことへ広がります。声を出すことから、名前を与えること、何かを呼び起こすことへと、対象との関係を作る方向に意味が伸びています。',
  'vol-': '望む・意志することから、voluntary の自発性、benevolent の善意、volition の意志という内側の選択を表します。',
  'viv-/vit-': '生きる・生命の核は、vivid の生き生きした印象、survive の生き残ること、vital の生命に不可欠なことへ広がります。',
};

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

function naturalList(words = []) {
  if (words.length <= 1) return words[0] || '';
  if (words.length === 2) return `${words[0]} と ${words[1]}`;
  return `${words.slice(0, -1).join('、')} と ${words.at(-1)}`;
}

function buildDeepDive({ type, typeLabel, form, meaningJa, originLanguage, originalForm, originalMeaningJa, words, variants }) {
  const examples = naturalList(words);
  const focus = DEEP_FOCUS[form] || `「${meaningJa}」という核が、${examples} の中でどのように形を変えるかを比べて読みます。`;
  const variantNote = variants.length
    ? `また、${variants.join('、')} のような綴りも、後ろに来る音に合わせて姿を変えた仲間として扱います。`
    : '表面上の綴りが同じでも別の由来を持つ語があるため、形だけで決めつけず、辞書の語源欄も確認します。';

  if (type === 'prefix') {
    return {
      originPathJa: `${form} は ${originLanguage} の ${originalForm} に由来し、その出発点は「${originalMeaningJa}」です。接頭辞は、後ろの語の意味を丸ごと置き換える部品ではありません。むしろ「どちらへ向かうか」「何と関係づけるか」という向きを与え、語全体の解釈を少しずつ傾けます。`,
      nuanceJa: `「${meaningJa}」は、一つの日本語訳に固定しないほうが理解しやすい核です。具体的な移動・位置・関係として始まった像が、抽象的な判断や状態にも移るためです。${form} を見たら、まず後ろの語の意味を押さえ、その意味に「${meaningJa}」の向きを重ねて読んでみてください。${focus}`,
      relationJa: `${examples} は、この向きが異なる語の中でどう働くかを見るための入口です。同じ接頭辞でも完成語が同義語になるわけではありません。共通するのは日本語訳ではなく、意味の組み立てにある「${meaningJa}」という関係です。${variantNote}`,
      studyGuideJa: [
        `後ろの語を先に大まかに捉え、${form} が加えた「${meaningJa}」の方向を後から重ねます。`,
        '綴りの似た別語と混同しないため、意味・発音・辞書の語源欄を三点セットで確認します。',
        '接頭辞は現在の用法を保証するルールではないので、完成語は必ず例文でも確かめます。',
      ],
    };
  }

  if (type === 'suffix') {
    return {
      originPathJa: `${form} は ${originLanguage} の ${originalForm} と結びつく語尾です。原義の「${originalMeaningJa}」は、語幹の内容を人・もの・性質・状態・行為などの形へ仕立てる働きに残っています。接尾辞は、単語の最後にありながら、意味だけでなく品詞や文中での役割にも深く関わります。`,
      nuanceJa: `「${meaningJa}」という説明は出発点です。実際には、語幹との組み合わせによって「可能」「結果」「傾向」「人」「抽象的な性質」など、解釈の重心が動きます。語尾だけを日本語一語に置き換えるより、完成語が名詞・形容詞・動詞のどれとして使われるかを見るほうが実用的です。${focus}`,
      relationJa: `${examples} は、同じ語尾が違う語幹と結びついた例です。関連語を比べるときは、語尾が作る共通の枠と、語幹が運ぶ固有の意味を分けて読むと整理しやすくなります。${variantNote}`,
      studyGuideJa: [
        '語幹だけの語と、語尾を付けた完成語の品詞・意味を並べて確認します。',
        `「${meaningJa}」を唯一の訳として暗記せず、完成語の文中での役割を優先します。`,
        '発音や綴りが似る語尾でも、歴史的な由来まで同じとは限りません。',
      ],
    };
  }

  return {
    originPathJa: `${form} は ${originLanguage} の ${originalForm} にさかのぼる語根で、出発点は「${originalMeaningJa}」です。語根は単独で意味を完成させるより、接頭辞や接尾辞と組み合わさりながら、語族に共通する骨格を作ります。`,
    nuanceJa: `「${meaningJa}」という核は、具体的な動作や物の像から始まり、時間・評価・知的活動・感情などへ比喩的に広がることがあります。だから語根は「答えを一発で当てる鍵」ではなく、知らない語の意味の候補を絞り、単語同士のつながりを見つけるための手がかりです。${focus}`,
    relationJa: `${examples} を並べると、完成語はそれぞれ別の意味を持ちながらも、「${meaningJa}」という核を異なる方向へ発展させていることが分かります。関連語を同義語として覚えるのではなく、どの接辞や文脈が核の意味をどう変えたかを追うのがポイントです。${variantNote}`,
    studyGuideJa: [
      `まず ${form} の「${meaningJa}」という像を持ち、接頭辞・接尾辞で意味がどう動くかを見ます。`,
      '関連語は似た綴りだけでまとめず、実際の意味と品詞を横に並べて比べます。',
      '語根は推測の補助です。最終的な意味・発音・使い方は完成語の辞書と例文で確定します。',
    ],
  };
}

function buildWordLink({ type, form, meaningJa, originalMeaningJa, word, wordIndex }) {
  const role = [
    '核が比較的見えやすい入口の例',
    '別の文脈へ意味が広がった比較用の例',
    '語全体の意味を辞書で照合するための例',
  ][wordIndex] || '関連を確かめるための例';
  const typeHint = type === 'prefix'
    ? '語の前にある方向づけ'
    : type === 'suffix'
      ? '語尾が作る品詞・性質の枠'
      : '語の中心に残る意味の骨格';
  return {
    id: `${type}-${form}-${word}`,
    term: word,
    breakdownJa: `${word} は${role}です。${typeHint}として ${form} を見つけたら、まず「${meaningJa}」という核が完成語にどう関わるかを考えます。`,
    bridgeJa: `原義の「${originalMeaningJa}」から現在の「${meaningJa}」へは、具体的な像が抽象的な関係へ伸びる道筋があります。ただし ${word} 全体の意味は接辞・借用の歴史・現代の用法も重なるため、この一部分だけで断定しません。`,
    whatToNoticeJa: wordIndex === 0
      ? '最初に辞書の語源欄と定義を見比べ、核がどこまで実感できるか確かめます。'
      : '先の例と同義語として扱わず、同じ核が別の文脈でどう変形したかを比べます。',
  };
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
  const deepDive = buildDeepDive({
    type,
    typeLabel,
    form,
    meaningJa,
    originLanguage,
    originalForm,
    originalMeaningJa,
    words,
    variants,
  });
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
      noteJa: deepDive.originPathJa,
    },
    coreImageJa: `「${originalMeaningJa}」という像から、${location}「${meaningJa}」という意味の方向を作ります。`,
    semanticBridgeJa: deepDive.nuanceJa,
    deepDive,
    senses: [{
      id: `${type}-${index + 1}-sense-1`,
      labelJa: meaningJa,
      explanationJa: `${location}、語全体を「${meaningJa}」の方向へ導きます。${deepDive.relationJa}`,
    }],
    formChanges: variants.length
      ? [`語幹の最初の音に同化するなどして ${variants.join('、')} の形が現れます。意味の核は同じでも、綴りだけで別の語源と判断しないようにします。`]
      : ['目立った異形は少ないものの、借用された時代や綴りの固定過程で形が変わる場合があります。'],
    wordLinks: words.map((word, wordIndex) => ({
      ...buildWordLink({ type, form, meaningJa, originalMeaningJa, word, wordIndex }),
      id: `${type}-${index + 1}-word-${wordIndex + 1}`,
    })),
    comparisons: [],
    cautionsJa: [
      `見た目が ${form} と一致しても、すべての単語がこの${typeLabel}からできたとは限りません。`,
      ...deepDive.studyGuideJa,
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
