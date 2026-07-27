// Built-in guide to the high-frequency relationship words that carry English
// sentence structure. These are learning maps, not one-to-one translations.

const ref = form => [{
  title: `Merriam-Webster: ${form}`,
  organization: 'Merriam-Webster Dictionary',
  url: `https://www.merriam-webster.com/dictionary/${encodeURIComponent(form)}`,
}];

function item(type, form, coreImageJa, detailJa, contrastJa, patterns, examples, related = []) {
  return {
    id: `${type}-${form.toLowerCase().replace(/[^a-z]+/g, '-')}`.replace(/-$/, ''),
    type,
    typeLabel: type === 'preposition' ? '前置詞' : type === 'conjunction' ? '接続詞' : 'パーティクル',
    form,
    coreImageJa,
    detailJa,
    contrastJa,
    patterns,
    examples,
    related,
    sourceRefs: ref(form),
  };
}

const PREPOSITIONS = [
  item('preposition', 'at', '一点・時点・狙いをピンで留める', 'at は面積のある場所そのものより、住所・集合点・時刻・到達点を「一点」として指します。at the station は駅という地点、at 7 は時刻表上の一点です。動詞の矢印が向かう相手にも使われ、look at は視線の先を一点で捉えます。', 'in は内部の広がり、on は表面との接触。at は中や面を描かず、座標だけを示す感覚です。', ['at + 時刻', 'at + 地点', '動詞 + at + 対象'], [['Meet me at six.', '6時に会おう。'], ['She laughed at the joke.', '彼女はその冗談を笑った。']], ['in', 'on']),
  item('preposition', 'in', '境界の内側に包まれている', 'in は容器・空間・期間・状態の内側に入っている像です。in Japan は国の枠の内側、in July は月という時間の箱の内側、in trouble は困難という状態の内側です。境界の中であることが大切で、接触面は意識しません。', 'at の一点、on の表面接触と比べます。into は外から内へ入る移動そのものを表し、in は入った後の位置です。', ['in + 国・都市・部屋', 'in + 月・年・期間', 'in + 状態'], [['The keys are in the drawer.', '鍵は引き出しの中にある。'], ['He is in a hurry.', '彼は急いでいる。']], ['at', 'on', 'into']),
  item('preposition', 'on', '表面に接して支えられている', 'on は何かの表面に触れ、その表面が基準になっている像です。on the table は机の面に接し、on Monday は曜日を時間軸上の面のように捉えます。on TV のように媒体・チャンネルに載る感覚にも広がります。', 'in は内部、at は一点。onto は表面へ乗る動き、on は乗った後の位置です。', ['on + 表面', 'on + 曜日・日付', 'on + 媒体'], [['Your phone is on the desk.', 'あなたの電話は机の上にある。'], ['The show is on TV tonight.', 'その番組は今夜テレビで放送される。']], ['in', 'at', 'onto']),
  item('preposition', 'to', '到達点へ向かう矢印', 'to は出発点ではなく、移動・関係・変化が向かう先を示します。go to school の目的地、give it to her の受け手、from A to B の終点です。不定詞の to は同じ形でも、動作へ向かうという別の文法的働きです。', 'for は受益者や目的に焦点を置き、to は到着する相手・方向を置きます。toward は到達を約束せず方向だけを示します。', ['go + to + 場所', 'give + 物 + to + 人', 'from A to B'], [['Send the file to me.', 'そのファイルを私に送って。'], ['We walked to the river.', '私たちは川まで歩いた。']], ['for', 'toward']),
  item('preposition', 'for', '目的・利益・交換に向けて確保する', 'for は「誰・何のために」「どれくらいの期間」「何と引き換えに」という目的側の関係を作ります。buy a gift for her は彼女を受益者に置き、for two hours は期間を確保し、pay for lunch は対価を結びます。', 'to は到着する受け手、for は受益・目的。I gave it to her と I bought it for her は焦点が違います。', ['for + 人・目的', 'for + 期間', 'pay for + 物'], [['I saved a seat for you.', 'あなたのために席を取っておいた。'], ['We talked for an hour.', '私たちは1時間話した。']], ['to', 'during']),
  item('preposition', 'from', '起点・出どころから離れる', 'from は移動・変化・情報・時期の出発点を示します。leave from Tokyo は出発地、learn from mistakes は知識の源、different from は比較の基準から離れた違いです。矢印は from の後ろから外へ向きます。', 'since は時間の起点から現在までの継続を強く示します。from は単に出発点を置くだけです。', ['from + 場所・人・材料', 'from A to B', 'different from'], [['This train comes from Osaka.', 'この電車は大阪から来る。'], ['I learned a lot from her.', '私は彼女から多くを学んだ。']], ['to', 'since']),
  item('preposition', 'of', '全体から切り出した所属・内容', 'of は「全体と部分」「所有者と持ち物」「材料・内容」という内側のつながりを示します。the end of the road は道という全体の端、a cup of tea はカップの内容、the color of the wall は壁に属する性質です。', 'from が起点から出る動きなら、of は全体に属したまま切り出す関係です。', ['the + 名詞 + of + 名詞', '量 + of + 名詞', 'be afraid of'], [['The cover of the book is blue.', 'その本の表紙は青い。'], ['A piece of advice can help.', '一つの助言が役に立つことがある。']], ['from']),
  item('preposition', 'with', '一緒に持つ・伴う', 'with は人・道具・特徴が主語に伴っている関係です。with a friend は同伴、cut with a knife は道具、a room with a window は備わる特徴を示します。対立を表す fight with のように、相手と同じ場にいる関係から意味が広がることもあります。', 'by は行為者・手段の経路、with は手元に伴う道具や同伴者に焦点があります。', ['with + 人', 'with + 道具', '名詞 + with + 特徴'], [['I wrote it with a pencil.', '私は鉛筆でそれを書いた。'], ['She came with her brother.', '彼女は兄（弟）と一緒に来た。']], ['by']),
  item('preposition', 'by', 'すぐそば・手段・行為者を通す', 'by の核は「横に置く」「その経路を通す」です。by the door はそば、by train は手段、a book written by her は行為者、by Friday は期限の端を示します。手段でも、何を介して結果が起きるかを見るとつながります。', 'with は手に持つ道具、by は方法・行為者。I opened it with a key と It was opened by Ken は役割が異なります。', ['by + 交通手段', 'by + 行為者', 'by + 期限'], [['The report was written by Maya.', 'その報告書はマヤによって書かれた。'], ['Please finish it by Friday.', '金曜までにそれを終えてください。']], ['with', 'until']),
  item('preposition', 'about', '周囲を取り巻く話題・おおよその範囲', 'about は対象の中心をぴったり指すより、その周りをめぐる話題や概算を示します。talk about art は芸術を話題の中心に置き、about ten は十の周辺を許す概算です。心配の対象にも使われます。', 'on は専門的・体系的に「〜について」、about は会話で広く「〜のこと」。', ['talk/read/worry + about', 'about + 数量'], [['We talked about the trip.', '私たちは旅行について話した。'], ['It takes about ten minutes.', 'それには約10分かかる。']], ['on']),
  item('preposition', 'over', '上方から覆う・越える', 'over は物理的に上を覆う像から、数値の超過、期間全体、支配・見渡しへ広がります。over 100 は100を越え、over dinner は食事という時間にまたがり、look over は上から全体を見る感覚です。', 'above は位置の上下関係を静かに示し、over は覆う・横切る・越える動きや範囲を含みやすい語です。', ['over + 数量', 'over + 期間・活動', '動詞 + over'], [['The plane flew over the city.', '飛行機は街の上を飛んだ。'], ['The price is over 100 dollars.', '価格は100ドルを超える。']], ['above', 'under']),
  item('preposition', 'under', '下にあり、上から影響を受ける', 'under は物の下だけでなく、上からの重み・管理・条件の下に置かれる感覚です。under the table は位置、under pressure は圧力の影響、under 18 は上限未満を示します。', 'below は単純に低い位置・数値。under は覆われる・制約される関係を含みやすい語です。', ['under + 物・条件', 'under + 数量', 'under pressure/control'], [['The bag is under the chair.', 'かばんは椅子の下にある。'], ['She works under pressure.', '彼女はプレッシャーの中で働く。']], ['below', 'over']),
  item('preposition', 'between', '二つ（または個別に数える複数）の間', 'between は二者を両側に置く線・選択・関係です。between A and B は両端がはっきりし、choose between は選択肢を個別に比較します。三者以上でも、一つずつの関係を意識するなら使えます。', 'among は集団の中に溶け込む関係。between は個別の両端、among は群れの内部です。', ['between A and B', 'choose/difference + between'], [['The café is between the bank and the park.', 'そのカフェは銀行と公園の間にある。'], ['There is a difference between the two plans.', '二つの計画には違いがある。']], ['among']),
  item('preposition', 'among', '集団の中に分け入る', 'among は複数の人・物から成る集団の内部に位置する像です。among friends は友人たちの中、share among the team は集団の各メンバーへ分配する感覚です。両端を指定せず、群れ全体を背景にします。', 'between は個々を向かい合わせる。among は誰が両端かを決めない集団内の関係です。', ['among + 複数名詞', 'share + 物 + among + 集団'], [['She felt safe among friends.', '彼女は友人たちの中で安心した。'], ['Divide the work among the team.', '仕事をチームで分担して。']], ['between']),
  item('preposition', 'through', '入口から出口まで内側を通り抜ける', 'through は空間・過程・困難の内部を、最初から最後まで抜ける線です。walk through the tunnel はトンネルの中を通過し、through practice は練習という過程を経て、go through a hard time は困難の中を通り抜けます。', 'across は一方の側から反対側へ横切る面、through は内部に入って抜ける立体・過程です。', ['through + 空間・過程', 'go/get + through + 困難'], [['We drove through the tunnel.', '私たちはトンネルを通って運転した。'], ['He learned through experience.', '彼は経験を通して学んだ。']], ['across']),
  item('preposition', 'across', '一方の側から反対側へ横切る', 'across は川・道・表面などの幅を横断し、反対側へ届く像です。across the street は道を渡った先、across the table は机の向こう側です。情報が広がるときも、範囲を横切って届く感覚があります。', 'through は内部を通る。across は表面や幅を横切って反対側へ行くことが焦点です。', ['across + 道・川・表面', 'across from + 場所'], [['She ran across the road.', '彼女は道路を走って渡った。'], ['The store is across from the station.', '店は駅の向かいにある。']], ['through']),
  item('preposition', 'along', '線に沿って並行に進む', 'along は道・川・壁のような長い線を横切らず、そのそばをたどる感覚です。walk along the beach は海岸線をたどって歩くことです。時間・話の流れに沿う比喩にもなります。', 'across は横断、along は線に並行して進む。', ['along + 道・川・線', 'all along'], [['We walked along the river.', '私たちは川沿いを歩いた。'], ['Trees grow along the road.', '道路沿いに木が生えている。']], ['across']),
  item('preposition', 'around', '中心の周りを取り巻く・およそ', 'around は中心点の周囲を回る像です。around the table はテーブルの周り、around noon は正午の周辺、look around は周囲を見回すことです。正確な一点より余白を残します。', 'about も概算を表しますが、around は空間的な「周囲」の像が強く残ります。', ['around + 中心・時刻', 'look/walk + around'], [['They sat around the fire.', '彼らは火の周りに座った。'], ['I will arrive around noon.', '正午ごろに着く。']], ['about']),
  item('preposition', 'against', '面に押し当てる・反対側へ向かう', 'against は二つのものが接して圧力や対立を生む像です。against the wall は壁に寄せて接し、against the plan は計画に反対し、protect against rain は雨に対抗して守ることです。', 'with が同伴・協力にも使えるのに対し、against は摩擦・抵抗・防御を明示します。', ['against + 面', 'be against + 考え', 'protect against + 危険'], [['The bike is against the wall.', '自転車は壁に立てかけてある。'], ['I am against the proposal.', '私はその提案に反対だ。']], ['with']),
  item('preposition', 'before', '時間・順序で前に置く', 'before は時刻・出来事・順序の前方に置きます。before lunch は昼食より前、read before class は授業開始より前です。相手の前でという位置にも使えますが、核は基準より先です。', 'ago は今から過去へ数える表現で、before は別の基準時点より前を示します。', ['before + 時点・出来事', 'before + 名詞/動名詞'], [['Wash your hands before dinner.', '夕食前に手を洗って。'], ['I had seen it before.', '私は以前それを見たことがあった。']], ['after']),
  item('preposition', 'after', '基準の後ろに続く', 'after は時間・順序・追跡で基準の後に来ることです。after school は学校の後、run after a bus はバスの後を追うことです。何が先で何が続くかを示します。', 'later は現在や文脈から後、after は明示した基準の後です。', ['after + 時点・出来事', '動詞 + after + 対象'], [['Let us talk after class.', '授業の後に話そう。'], ['The dog ran after the ball.', '犬はボールを追いかけた。']], ['before']),
  item('preposition', 'during', 'ある期間の内部のどこかで', 'during は始まりと終わりがある期間を箱として捉え、その内部で起きたことを置きます。during the meeting は会議の間のどこかであり、全期間ずっとという意味ではありません。', 'for は継続した長さ、during は出来事が属する期間。I slept for two hours と I slept during the movie は焦点が違います。', ['during + 名詞の期間'], [['Do not talk during the movie.', '映画の間は話さないで。'], ['It rained during the game.', '試合中に雨が降った。']], ['for']),
  item('preposition', 'since', '過去の起点から今まで続く', 'since はある時点を出発点にし、そこから現在や基準時までの継続を見ます。現在完了と結びつきやすく、since 2020 は2020年から今までの線を引きます。理由の接続詞 since とは文法上の役割が違います。', 'from は単なる起点、since はそこからの継続。for は長さだけを示します。', ['have/has + 過去分詞 + since + 起点'], [['I have lived here since 2020.', '私は2020年からここに住んでいる。'], ['It has been quiet since morning.', '朝から静かだ。']], ['from', 'for']),
  item('preposition', 'until', '終点に達するまで線を延ばす', 'until は動作・状態が続く終点を示します。wait until five は5時まで待つ、not until five は5時になって初めてという意味になります。終点の直前まで続くことが核です。', 'by は期限までに完了すればよく、until はその時点まで状態・動作が続くことを表します。', ['動詞 + until + 時点', 'not + 動詞 + until + 時点'], [['Stay here until noon.', '正午までここにいて。'], ['Do not leave until I call.', '私が呼ぶまで出ないで。']], ['by']),
  item('preposition', 'within', '境界の内側に収める', 'within は in よりも境界・制限を意識し、「範囲を越えない内側」を示します。within two days は二日という上限の内側、within reach は手が届く範囲内です。やや書き言葉寄りです。', 'in two days は二日後という到達時点にもなりますが、within two days は二日以内という期限です。', ['within + 範囲・期限'], [['Please reply within two days.', '二日以内に返信してください。'], ['The station is within walking distance.', '駅は歩ける距離の範囲内にある。']], ['in']),
  item('preposition', 'without', '伴うはずのものを欠いたまま', 'without は with の反対で、通常期待される人・物・条件がないまま進む像です。without a key は鍵を伴わず、without saying anything は何も言わないままです。欠如した条件を強調します。', 'not with の単なる否定ではなく、「それを持たない状態」を一まとまりで置きます。', ['without + 名詞', 'without + 動名詞'], [['Do not leave without me.', '私を置いて行かないで。'], ['She left without saying goodbye.', '彼女はさよならを言わずに去った。']], ['with']),
  item('preposition', 'into', '外から内へ境界を越えて入る', 'into は移動が外側から内側へ境界を越える瞬間を描きます。walk into the room は部屋の中へ入る動き、turn water into ice はある状態から別の状態へ変化して入る動きです。', 'in は中にある位置、into は中へ入る移動。', ['動詞 + into + 場所', 'turn/change A into B'], [['She walked into the room.', '彼女は部屋に入っていった。'], ['Heat turns water into steam.', '熱は水を蒸気に変える。']], ['in']),
  item('preposition', 'onto', '表面へ向かって乗る', 'onto は移動が表面に到着することを表します。jump onto the bed はベッドの表面へ飛び乗る動きです。日常では on to と分ける綴りもありますが、位置の on と動きの onto を意味で分けます。', 'on は表面上の位置、onto はそこへ向かう移動です。', ['動詞 + onto + 表面'], [['The cat jumped onto the table.', '猫はテーブルの上に飛び乗った。'], ['Put the file onto the desk.', 'そのファイルを机の上に置いて。']], ['on']),
  item('preposition', 'out of', '内側から外へ、または範囲を外れて', 'out of は容器・状態・供給の内側から外へ出る像です。out of the room は部屋の外へ、out of time は時間の持ち分が尽きて範囲外、out of curiosity は好奇心を動機として外へ行動が出る比喩です。', 'from は起点、out of は内側という境界を越えることを明示します。', ['out of + 場所・供給・理由'], [['He ran out of the house.', '彼は家から走って出た。'], ['We are out of milk.', '牛乳を切らしている。']], ['from', 'out']),
];

const CONJUNCTIONS = [
  item('conjunction', 'and', '二つを同じ流れに並べる', 'and は情報・行為・結果を追加し、同じ方向へ並べます。単なる足し算だけでなく、順序や結果を自然に連ねることもあります。長い文では、何と何を同じ階層で結んでいるかを見るのが大切です。', 'but は期待を曲げ、or は選択肢を分けます。and は基本的に流れを継続させます。', ['A and B', '文, and 文'], [['I opened the window and sat down.', '私は窓を開けて座った。'], ['She is kind and patient.', '彼女は親切で辛抱強い。']], ['but', 'or']),
  item('conjunction', 'but', '前の流れに逆向きの折れ目を作る', 'but は前半から予想される流れを後半で修正・制限・対比します。I tried, but I failed は努力から期待される成功を折り返します。単なる「しかし」ではなく、何の期待が変わるかを読むと自然です。', 'although は従属節を使って譲歩を前置きし、but は同じ文で二つの節を対等に対比します。通常 although ... but は重ねません。', ['文, but 文', 'not A but B'], [['I wanted to go, but I was tired.', '行きたかったが、疲れていた。'], ['It is small but useful.', '小さいが役に立つ。']], ['although', 'yet']),
  item('conjunction', 'or', '分岐した選択肢を置く', 'or は複数の可能性のどれかを選ぶ分岐です。命令文では、前半をしなければ後半の結果になるという警告にもなります。質問では選択肢の範囲を明示します。', 'and は両方を加える、or はどちらか・場合によっては両方を許す選択を作ります。文脈で排他的かどうかを判断します。', ['A or B', '命令文, or 文'], [['Tea or coffee?', '紅茶かコーヒー、どちらにする？'], ['Hurry up, or you will miss the bus.', '急がないとバスに乗り遅れるよ。']], ['and', 'nor']),
  item('conjunction', 'so', '前の事実から後の結果へ進む', 'so は原因・状況を受け、そこから自然に生じる結果や判断を後ろに置きます。It was late, so we left は遅いという状況から帰る判断へ進みます。', 'because は理由を後ろから示し、so は結果を前に進めます。同じ因果を両方で一文に重ねないのが基本です。', ['文, so 文'], [['It was raining, so we stayed home.', '雨が降っていたので、私たちは家にいた。'], ['I was tired, so I went to bed early.', '疲れていたので早く寝た。']], ['because']),
  item('conjunction', 'yet', '予想に反して、それでも続く', 'yet は but に近い対比ですが、意外さや未解決の緊張を残します。simple yet effective は単純なのに効果的、He has not arrived yet の副詞用法では「まだ」を表します。接続詞としては二つの事実の両立の意外さが核です。', 'but より少し硬く、逆説の驚きを残しやすい語です。', ['A, yet B'], [['The task was difficult, yet she finished it.', '課題は難しかったが、それでも彼女は終えた。'], ['It is simple yet powerful.', 'それは単純でありながら強力だ。']], ['but']),
  item('conjunction', 'because', '後ろに明確な理由を置く', 'because は出来事・判断の直接的な理由をはっきり示します。理由節が答えになるので、Why? に対する説明として強い語です。because of は前置詞句で、後ろに名詞を取る点を分けます。', 'since や as は理由を背景として軽く添えることがあり、because は理由そのものを強調します。', ['because + 主語 + 動詞', 'because of + 名詞'], [['I stayed home because I was sick.', '病気だったので家にいた。'], ['The game was canceled because of rain.', '雨のため試合は中止になった。']], ['since', 'as']),
  item('conjunction', 'although', '不利な事実を認めてから主張を進める', 'although は「確かに〜だが」という譲歩の枠を先に作ります。後ろの主節が本当に伝えたい内容で、前半の事実を認めても結論が変わらないことを示します。', 'but と同じ節で重ねず、Although it was cold, we went out. のように使います。though はより会話的です。', ['although + 文, 主節'], [['Although it was cold, we went out.', '寒かったが、私たちは出かけた。'], ['Although she is young, she is experienced.', '彼女は若いが、経験豊富だ。']], ['though', 'but']),
  item('conjunction', 'if', '条件の門を開く', 'if は後ろの条件が満たされた場合にだけ主節が成り立つという門を作ります。現実的な条件にも仮定にも使えます。未来の条件節では通常 will ではなく現在形を使う点が重要です。', 'when は起こることを前提に時を置き、if は起こるかどうか自体が未確定です。', ['if + 現在形, will + 動詞', 'if + 過去形, would + 動詞'], [['If it rains, we will stay home.', '雨が降ったら家にいる。'], ['If I had more time, I would travel.', 'もっと時間があれば旅行するのに。']], ['when', 'unless']),
  item('conjunction', 'unless', '例外がなければ、という否定条件', 'unless は「〜でない限り」「もし〜でなければ」と条件を否定側から置きます。主節の成立を止める唯一の例外を示す感覚です。二重否定になる表現は意味を慎重に読みます。', 'if ... not と近いですが、unless は例外条件を一つに絞る響きがあります。', ['主節 + unless + 文'], [['You cannot enter unless you have a ticket.', 'チケットがない限り入れない。'], ['I will go unless it rains.', '雨が降らない限り行く。']], ['if']),
  item('conjunction', 'while', '二つの時間・性質を並行させる', 'while は同時進行の時間帯を重ねるほか、二つの性質を対照させる働きもあります。While I cooked, he set the table は同時、While this is cheap, that is durable は対比です。どちらの意味かは節の内容で決めます。', 'during は名詞の期間、while は主語と動詞を持つ節を取ります。', ['while + 主語 + 動詞', 'while A, B（対比）'], [['While I was cooking, he called.', '私が料理している間に、彼は電話してきた。'], ['While it is cheap, it is not durable.', '安い一方で、耐久性はない。']], ['during', 'whereas']),
  item('conjunction', 'when', '起こる時点・機会を重ねる', 'when はある出来事が起きる時点・場面に主節を置きます。未来についても、起こることをある程度前提にする響きがあります。疑問詞の when と接続詞の when は役割を分けて読みます。', 'if は起こるか未定の条件、when は起きる時・起きた時を置く感覚です。', ['when + 主語 + 動詞'], [['Call me when you arrive.', '着いたら電話して。'], ['I was reading when she came in.', '彼女が入ってきたとき、私は読書していた。']], ['if', 'while']),
  item('conjunction', 'before', '基準となる出来事より先に起こす', '接続詞の before は後ろに主語と動詞を置き、「〜する前に」という時間順序を作ります。主節の行為を先、before節の出来事を後として読むため、どちらが先かを矢印で確認します。', '前置詞 before は名詞を取ります。before I leave と before lunch を混同しないようにします。', ['主節 + before + 文'], [['Finish this before you leave.', '出発する前にこれを終えて。'], ['Think before you speak.', '話す前に考えて。']], ['after', 'until']),
  item('conjunction', 'after', '基準となる出来事が終わってから続ける', '接続詞の after は「〜した後で」という順序を作ります。after節の出来事が先に完了し、その後に主節が続く像です。時制は文全体の基準時に合わせます。', '前置詞 after は名詞、接続詞 after は節を取ります。', ['after + 主語 + 動詞, 主節'], [['After I ate, I went for a walk.', '食べた後で散歩に行った。'], ['Call me after you arrive.', '着いた後で電話して。']], ['before']),
  item('conjunction', 'until', 'ある出来事まで状態を保つ', '接続詞の until は後ろの出来事を終点にし、主節の状態・動作をそこまで続けます。not ... until はその終点になるまで出来事が起きないという焦点を作ります。', 'by the time はその時点までに完了、until はその時点まで継続です。', ['主節 + until + 文', 'not + 動詞 + until + 文'], [['Wait here until I come back.', '私が戻るまでここで待って。'], ['I did not understand until she explained.', '彼女が説明するまで理解できなかった。']], ['by']),
  item('conjunction', 'as soon as', '一方が起きた直後にもう一方を起こす', 'as soon as は二つの出来事の間隔を極力なくす表現です。未来の内容でも as soon as節では現在形を使うのが通常です。単なる after より直後性を強調します。', 'when は時点一般、as soon as は直後という速さを加えます。', ['as soon as + 現在形, will + 動詞'], [['I will call you as soon as I arrive.', '着いたらすぐ電話する。'], ['As soon as the rain stopped, we left.', '雨がやむとすぐに出発した。']], ['when', 'after']),
  item('conjunction', 'so that', '目的または結果が届く先を示す', 'so that は前の行為が後ろの結果・目的に届くようにする橋です。目的なら can/will/may などが伴うことがあり、文脈によって結果にもなります。', 'so は単純な結果、so that は「何のために／どの結果へ」という節を明示します。', ['主節 + so that + 文'], [['Speak slowly so that everyone can understand.', '皆が理解できるようにゆっくり話して。'], ['I wrote it down so that I would not forget.', '忘れないように書き留めた。']], ['so']),
  item('conjunction', 'whether', '二つの可能性を問いとして保留する', 'whether は「〜かどうか」と、yes/noの分岐を一つの名詞的な内容として扱います。or not を伴えること、前置詞の後にも置きやすいことが if との実用上の違いです。', 'if も間接疑問で使えますが、whether は選択肢や公式な文で明確です。', ['whether + 文', 'whether A or B'], [['I do not know whether he is ready.', '彼の準備ができているかどうか分からない。'], ['It depends on whether it rains.', '雨が降るかどうかによる。']], ['if']),
];

const PARTICLES = [
  item('particle', 'out', '内側から外へ出て、境界の外に現れる', 'out は「中にあったものが外へ出る」「隠れていたものが明らかになる」「供給が尽きて内側が空になる」という三つの広がりを持ちます。find out は情報が隠れた内側から出る、run out は在庫の内側が空になる像です。', 'off は表面から離れる、away は中心から距離を取る。out は容器・範囲の内外という境界が中心です。', ['go/get + out', 'find out + 内容', 'run out of + 名詞'], [['Please find out the answer.', '答えを調べて分かるようにして。'], ['We ran out of time.', '時間が尽きた。']], ['off', 'away', 'out of']),
  item('particle', 'off', '接していた面から離れて切れる', 'off は on の接触を外す動きです。take off は身につけた物を外す、turn off はつながっていた電源を切る、get off は乗り物・表面から降りるというように、接触や接続が切れる像が核です。', 'out は内外の境界、off は表面・接続からの分離。', ['take/turn/get + off', 'off + 表面・機器'], [['Turn off the light.', '電気を消して。'], ['The plane took off on time.', '飛行機は定刻に離陸した。']], ['on', 'out']),
  item('particle', 'up', '下から上へ、または完全なところまで', 'up は上方への動きから、量を増やす、最後まで完了する、近くへ寄るという意味へ広がります。use up は残りを上まで使い切る像、pick up は下から取る・近くで拾う像です。', 'over は上を越える・覆う、up は上向きまたは完了までの上昇過程に焦点があります。', ['pick/use/set + up', 'up to + 上限'], [['Use up the milk first.', 'まず牛乳を使い切って。'], ['She picked up the coin.', '彼女は硬貨を拾い上げた。']], ['down', 'over']),
  item('particle', 'down', '上から下へ、または小さく固定する', 'down は下方向だけでなく、量・速度・音量を下げる、情報を紙に固定する、横になる意味へ広がります。write down は頭の中の情報を紙の上へ落として固定する学習像が役立ちます。', 'up と対になることが多いですが、句動詞ごとに完成語として意味を確認します。', ['write/sit/slow + down'], [['Write down the address.', '住所を書き留めて。'], ['Please slow down.', '少し速度を落として。']], ['up']),
  item('particle', 'in', '外側から内へ入り、関与する', 'パーティクルの in は中に入る位置から、参加・提出・到着・理解の内側へ入る感覚へ広がります。check in は記録の中へ入る、fill in は空欄を内側から満たす、give in は抵抗の外側から中へ折れる像として学べます。', 'into は移動の方向を明示する前置詞、in は句動詞内で到着後の参加・収まりを表すことが多いです。', ['check/fill/give + in'], [['Please fill in this form.', 'この用紙に記入してください。'], ['We checked in at noon.', '私たちは正午にチェックインした。']], ['out', 'into']),
  item('particle', 'on', '接触を保ったまま先へ続ける', 'パーティクルの on は表面接触から、継続・稼働・先送りのない前進へ広がります。carry on は止めずに続ける、turn on は回路をつないで稼働させる、try on は身につけて自分の上に載せる像です。', 'off が接続を切るのに対し、on は接続・継続を保ちます。', ['carry/turn/try + on'], [['Please carry on.', '続けてください。'], ['Try on this jacket.', 'このジャケットを試着して。']], ['off']),
  item('particle', 'over', '一方を越えて反対側へ、または全体を見直す', 'パーティクルの over は越える・覆う・もう一度通す像です。go over は上から全体を見直す、start over は最初の側へ戻ってやり直す、think over は考えを一度通り越すまで検討する感覚です。', 'through は内部を通り抜ける、over は上から越える・全体を見渡す。', ['go/start/think + over'], [['Let us go over the plan.', '計画を見直そう。'], ['She started over.', '彼女は最初からやり直した。']], ['through', 'up']),
  item('particle', 'away', '中心・話し手から距離を取り続ける', 'away は中心点から離れていく持続を表します。throw away は手元から離して不要にする、walk away はその場を離れる、fade away は見える中心から徐々に遠ざかって消える像です。', 'out は内外の境界を越える、away は中心から距離が開くことが焦点です。', ['throw/walk/fade + away'], [['Do not throw it away.', 'それを捨てないで。'], ['He walked away quietly.', '彼は静かに立ち去った。']], ['out']),
  item('particle', 'back', '元の位置・前の状態へ戻す', 'back は後方だけでなく、以前の場所・状態・相手へ返す動きです。give back は返却、call back は折り返し、come back は復帰です。前に進んだ線を反対向きにたどる像で覚えます。', 'again は繰り返し、back は元の地点・相手への復帰を含みます。', ['come/give/call + back'], [['Please give the book back.', 'その本を返してください。'], ['I will call you back.', 'あとで折り返し電話する。']], ['away']),
  item('particle', 'through', '内部を最後まで通し切る', 'パーティクルの through は作業・困難・資料の内部を端から端まで通過する感覚です。read through は最初から最後まで読む、get through は困難を抜け切る、go through は内容を順に通すことです。', 'over は上から見直す、through は中身を一つずつ通り抜ける。', ['read/get/go + through'], [['Read through the email once.', 'そのメールを一度最後まで読んで。'], ['We got through the difficult week.', '私たちは大変な一週間を乗り切った。']], ['over']),
  item('particle', 'around', '中心の周囲を回り、別の経路を探す', 'around は中心を避けたり、周囲を回ったり、順番を回したりする像です。look around は周囲を見る、get around a problem は問題の周囲を回って別経路を見つける、pass around は集団の周りへ回すことです。', 'through が内部を通るのに対し、around は中心を取り巻く・避ける動きです。', ['look/get/pass + around'], [['Look around before you decide.', '決める前に周りを見て。'], ['We found a way around the problem.', '私たちはその問題を回避する方法を見つけた。']], ['through']),
];

// The first sentence is intentionally concrete: it is the exact scene used by
// the motion panel, then the longer explanation expands that scene into usage.
const PARTICLE_MOTION_SUMMARIES = {
  out: { motionKind: 'out', motionSummaryJa: '中にあったものが、境界を越えて外に出る。' },
  up: { motionKind: 'up', motionSummaryJa: '低い位置から、より上の段階へ上がる。' },
  in: { motionKind: 'in', motionSummaryJa: '外側にあるものが、境界の内側へ入って収まる。' },
  off: { motionKind: 'off', motionSummaryJa: '接していた面から離れ、つながりが切れる。' },
  through: { motionKind: 'through', motionSummaryJa: '内部を入り口から出口まで、途中で止まらず通り抜ける。' },
  down: { motionKind: 'down', motionSummaryJa: '上にあったものが下へ落ち、下の面に落ち着く。' },
  on: { motionKind: 'on', motionSummaryJa: '接触を保ったまま、流れが前へ続いていく。' },
  over: { motionKind: 'over', motionSummaryJa: '一方の側を越え、反対側まで渡って全体を見渡す。' },
  away: { motionKind: 'away', motionSummaryJa: '中心から離れ、その距離が広がり続ける。' },
  back: { motionKind: 'back', motionSummaryJa: '離れた場所から、元の位置へ戻ってくる。' },
  around: { motionKind: 'around', motionSummaryJa: '中心を避けながら、その周囲を回り込む。' },
};

const PARTICLE_USAGE_GUIDES = {
  out: '動詞のあとで out を見たら、「中にあったものが外へ現れる」と置きます。find out は答えが隠れた状態から表へ出ること、run out of は持っていた量が外へ出切って残らないことです。物が出る場合と、情報・資源が見える／尽きる場合を同じ境界の動きとして結びます。',
  off: 'off は「ただ遠い」ではなく、何かに接していた関係が外れることです。turn off は機器とのつながりを切り、take off は服や地面との接触を外し、get off は乗り物の面から降ります。on と迷ったら、接続を保つなら on、切るなら off と考えます。',
  up: 'up は上方向だけでなく、「上まで達して仕上がる」感覚を持ちます。pick up は下にある物を取り上げ、use up は残りを最後まで使い切り、set up はばらばらの物を使える状態まで組み上げます。動作が上へ向かうか、完成点まで届くかを確かめます。',
  down: 'down は下がるだけでなく、散らばったものを下の面に落ち着かせ、固定する感覚です。write down は頭の中の情報を紙へ定着させ、slow down は速さを低い段階へ下げます。「小さくする」「落ち着かせる」「記録する」という広がりを、下へ置く動きからつかみます。',
  in: 'in は境界の内側へ入って、そこに参加・収まる感覚です。check in は宿や手続きの中へ自分を登録し、fill in は空欄の内側を満たし、give in は対立の内側へ譲って入るように見ます。移動そのものより、内側に属する結果を意識します。',
  on: 'on は表面への接触から、「つながったまま先へ続く」感覚に広がります。carry on は進行を切らずに続け、turn on は電気の回路をつなぎ、try on は服を身につけた状態に乗せて試します。off と対にして、接続が続くなら on と判断します。',
  over: 'over は上を越えるため、物理的には障害の反対側へ渡る動きです。go over は内容を上からなぞって全体を見直し、start over はいったん越えた区切りを新しい始点に戻します。through が内部を通り切る語なのに対し、over は上から越える・全体を見渡す語です。',
  away: 'away は中心から離れる距離そのものに焦点があります。throw away は手元から不要な物を遠ざけ、walk away はその場から離れ、fade away は見え方や音が中心から遠のくように消えます。out が内側から外へ出る語なのに対し、away は外に出た後も距離が広がる語です。',
  back: 'back は単なる反対方向ではなく、元の場所・持ち主・状態へ戻す感覚です。give back は物を元の持ち主へ返し、call back は会話をもう一度こちらへ戻し、come back は以前いた場所へ帰ります。again と違い、戻る先が意識されていることが大切です。',
  through: 'through は入口から出口まで内部を通り切る語です。read through は文章の途中で止まらず最後まで読み、get through は困難な期間の中を抜け、go through は過程を一段ずつ経験します。over と迷ったら、内部を通過するなら through、上から越える／見直すなら over です。',
  around: 'around は中心に正面からぶつからず、その周囲を回り込みます。look around は周囲を見回し、get around a problem は問題の中心を避けて別の経路を探し、pass around は物を輪の周りへ回します。through が中を抜けるのに対し、around は外縁をたどる動きです。',
};

// Each motion is deliberately concrete. The renderer reuses a small set of
// visual grammars, while this table keeps the learning scene specific to every
// relationship word in the built-in guide.
const RELATION_MOTION_CONFIG = Object.fromEntries([
  ['preposition-at', ['point', '広がる場所の中から、一点だけを狙って止める。']],
  ['preposition-in', ['container', '境界で囲まれた空間の内側にある。']],
  ['preposition-on', ['surface', '物が面に接触し、その面に支えられている。']],
  ['preposition-to', ['arrow', '出発点から決まった到達点へ進み、その終点に届く。']],
  ['preposition-for', ['purpose', '行為が、目的や受け手のほうへ確保される。']],
  ['preposition-from', ['origin', '起点から外へ向かって、流れが始まる。']],
  ['preposition-of', ['portion', '全体の中から一部分だけを切り出して示す。']],
  ['preposition-with', ['companion', '二つのものが離れず、同じ場に伴っている。']],
  ['preposition-by', ['beside', 'ある基準のすぐそばに位置する。その近さが手段や行為者の意味へ広がる。']],
  ['preposition-about', ['orbit', '中心そのものではなく、その周りを話題がめぐる。']],
  ['preposition-over', ['arch', '障害や基準の上を越え、反対側まで渡る。']],
  ['preposition-under', ['shelter', '上のものの下に入り、覆われる位置に置かれる。']],
  ['preposition-between', ['between', '二つの基準に挟まれ、その間の位置を占める。']],
  ['preposition-among', ['cluster', '複数のものからなる集団の一員として、その中にある。']],
  ['preposition-through', ['tunnel', '入口から内部を通り、出口まで抜け切る。']],
  ['preposition-across', ['cross', '一方の端から、幅を横切って反対側へ届く。']],
  ['preposition-along', ['along', '長い線を横切らず、そのそばをたどり続ける。']],
  ['preposition-around', ['orbit', '中心を囲みながら、その周囲を回る。']],
  ['preposition-against', ['press', '二つの面がぶつかり、押し当てる力が生まれる。']],
  ['preposition-before', ['timeline-before', '基準の出来事より前の位置で、行為が止まる。']],
  ['preposition-after', ['timeline-after', '基準の出来事を通り過ぎた後に、次が続く。']],
  ['preposition-during', ['duration', '始まりと終わりのある時間箱の内側で出来事が起きる。']],
  ['preposition-since', ['timeline-from', '過去の起点から、今へ向かう線が伸び続ける。']],
  ['preposition-until', ['deadline', '動きや状態が、終点の直前まで続く。']],
  ['preposition-within', ['container', 'はっきりした境界を越えず、その内側に収める。']],
  ['preposition-without', ['absence', '本来あるはずのものがない空白を残したまま進む。']],
  ['preposition-into', ['enter', '外側から境界を越え、内側へ移動する。']],
  ['preposition-onto', ['land', '動きが面へ到着し、その上に乗る。']],
  ['preposition-out-of', ['exit', '内側から境界を越えて、外へ抜け出す。']],

  ['conjunction-and', ['join', '二つの流れが合流し、同じ方向へ続く。']],
  ['conjunction-but', ['turn', '前の流れが折れ、予想と違う方向へ向く。']],
  ['conjunction-or', ['fork', '一つの流れが、選べる二つの枝に分かれる。']],
  ['conjunction-so', ['result', '前の出来事から、結果が後ろへ生まれる。']],
  ['conjunction-yet', ['turn', '予想と反対の事実が、それでも続いて現れる。']],
  ['conjunction-because', ['cause', '理由が押し出し、結果がその先に現れる。']],
  ['conjunction-although', ['contrast', '不利な事実を越えて、主張が前へ進む。']],
  ['conjunction-if', ['condition', '条件の門が開いたときだけ、次の流れへ進める。']],
  ['conjunction-unless', ['condition', '例外の門が閉じない限り、流れは前へ進む。']],
  ['conjunction-while', ['parallel', '二つの出来事が、同じ時間帯を並行して進む。']],
  ['conjunction-when', ['trigger', 'ある時点で合図が入り、次の出来事が始まる。']],
  ['conjunction-before', ['timeline-before', '基準になる出来事の前で、先の行為が完了する。']],
  ['conjunction-after', ['timeline-after', '基準になる出来事が終わってから、次の行為が続く。']],
  ['conjunction-until', ['deadline', '終点になる出来事まで、状態が保たれる。']],
  ['conjunction-as-soon-as', ['trigger', '一つが起きた直後に、次の出来事がすぐ続く。']],
  ['conjunction-so-that', ['purpose', '前の行為が、目的となる結果のほうへ届く。']],
  ['conjunction-whether', ['fork', '答えを決めず、二つの可能性を分岐として保留する。']],
].map(([id, [motionKind, motionSummaryJa]]) => [id, { motionKind, motionSummaryJa }]));

const IPA_BY_FORM = {
  at: '/æt/', in: '/ɪn/', on: '/ɑːn/', to: '/tuː/・/tə/', for: '/fɔːr/・/fər/', from: '/frʌm/', of: '/əv/', with: '/wɪð/', by: '/baɪ/', about: '/əˈbaʊt/', over: '/ˈoʊvər/', under: '/ˈʌndər/', between: '/bɪˈtwiːn/', among: '/əˈmʌŋ/', through: '/θruː/', across: '/əˈkrɔːs/', along: '/əˈlɔːŋ/', around: '/əˈraʊnd/', against: '/əˈɡenst/', before: '/bɪˈfɔːr/', after: '/ˈæftər/', during: '/ˈdʊrɪŋ/', since: '/sɪns/', until: '/ənˈtɪl/', within: '/wɪˈðɪn/', without: '/wɪˈðaʊt/', into: '/ˈɪntuː/', onto: '/ˈɑːntuː/', 'out of': '/ˈaʊt əv/', and: '/ænd/・/ənd/', but: '/bʌt/', or: '/ɔːr/・/ər/', so: '/soʊ/', yet: '/jet/', because: '/bɪˈkɔːz/', although: '/ɔːlˈðoʊ/', if: '/ɪf/', unless: '/ənˈles/', while: '/waɪl/', when: '/wen/', 'as soon as': '/æz suːn æz/', 'so that': '/soʊ ðæt/', whether: '/ˈweðər/', out: '/aʊt/', off: '/ɔːf/', up: '/ʌp/', down: '/daʊn/', away: '/əˈweɪ/', back: '/bæk/',
};

PARTICLES.forEach(particle => Object.assign(particle, PARTICLE_MOTION_SUMMARIES[particle.form] || {}, { usageGuideJa: PARTICLE_USAGE_GUIDES[particle.form] || '' }));
[...PREPOSITIONS, ...CONJUNCTIONS, ...PARTICLES].forEach(entry => {
  Object.assign(entry, RELATION_MOTION_CONFIG[entry.id] || {});
  entry.pronunciation = IPA_BY_FORM[entry.form] || '';
});

export const ENGLISH_USAGE_CORE = [...PREPOSITIONS, ...CONJUNCTIONS, ...PARTICLES];
export const ENGLISH_USAGE_CORE_STATS = {
  total: ENGLISH_USAGE_CORE.length,
  prepositions: PREPOSITIONS.length,
  conjunctions: CONJUNCTIONS.length,
  particles: PARTICLES.length,
};

export function getEnglishUsageCoreEntry(id) {
  return ENGLISH_USAGE_CORE.find(entry => entry.id === id) || null;
}
