(function (global) {
    'use strict';
    const TABLE = (global.EraTable && global.EraTable.TABLE) || [];
    const DYNASTY_ALIAS = (global.EraTable && global.EraTable.DynastyTable) || {};
    // 年号表里年号外面可能包一层括号（如「（天復）」）—— 那只是个标记，与程序无关。
    // 读进来就去掉，免得它混进正则、查表键和界面显示。
    function cleanEraName(raw) {
        const s = raw == null ? '' : String(raw);
        return s.replace(/[（）()]/g, '').trim();
    }
    // 表里第 6 列：start 那一年是这个年号的第几年（缺省 1，即 start 就是元年）。
    // 例：["北漢","英武帝","天會",968,973,12] → 968 是天會十二年 → 天會元年 = 957。
    function rowOffset(row) {
        const n = Number(row && row[5]);
        return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    }
    const ERAS = TABLE.map(function (row) {
        return {
            dynasty: row[0] || '',
            emperor: row[1] || '',
            name: cleanEraName(row[2]),
            start: row[3],
            end: row[4] === undefined ? null : row[4],
            offset: rowOffset(row)
        };
    }).filter(function (e) { return typeof e.name === 'string' && e.name; });
    const VARIANT_GROUPS = (global.EraTable && global.EraTable.VARIANT_GROUPS) || [];
    const VARIANT_OF = new Map();
    const VARIANTS_OF = new Map();
    for (const g of VARIANT_GROUPS) {
        const chars = Array.from(g);
        VARIANTS_OF.set(chars[0], chars);
        for (const c of chars)
            VARIANT_OF.set(c, chars[0]);
    }
    function canonicalForm(name) {
        const s = name == null ? '' : String(name);
        let out = '';
        for (const ch of s)
            out += (VARIANT_OF.get(ch) || ch);
        return out;
    }
    function patternOf(canonical) {
        let out = '';
        for (const ch of canonical) {
            const set = VARIANTS_OF.get(ch);
            out += (set && set.length > 1) ? '[' + set.join('') + ']' : escapeRe(ch);
        }
        return out;
    }
    function sameEra(a, b) {
        return a.start === b.start && a.end === b.end && a.dynasty === b.dynasty
            && (a.offset || 1) === (b.offset || 1);
    }
    const BY_NAME = new Map();
    const CANONICAL_NAMES = new Map();
    for (const e of ERAS) {
        const key = canonicalForm(e.name);
        if (!BY_NAME.has(key))
            BY_NAME.set(key, []);
        const list = BY_NAME.get(key);
        if (!list.some(function (x) { return sameEra(x, e); }))
            list.push(e);
        if (!CANONICAL_NAMES.has(key))
            CANONICAL_NAMES.set(key, e.name);
    }
    const NAMES = Array.from(BY_NAME.keys()).sort(function (a, b) {
        return b.length - a.length;
    });
    function escapeRe(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    // 纪年数字只认：元、中文数字 2～61、阿拉伯数字 1～61。
    // 中文「一」不是纪年写法，第一年统一使用「元年」。
    // 中文结构严格限制在 1～61，避免把「三三」「六十二」等错误写法识别进去。
    //
    // ⚠️ 分支必须**从长到短**排。正则的选择是「先匹配上就算」，不是「取最长」：
    // 把 [二三四五六七八九] 放在 [二三四五]十… 前面时，像 sidepanel 那种
    // 「(NUM_PART)\s*年?」——末尾的「年」是可选的——会直接吃下「二十三年」里的「二」
    // 就不再回溯，于是纪年被截成 2。buildRegex 里「年」是必需的，靠回溯侥幸没露馅。
    // 阿拉伯数字同理：「23年」里的「2」。
    const CN_YEAR_PART = '(?:元|六十(?:一)?|[廿卅卌][一二三四五六七八九]?|[二三四五]十[一二三四五六七八九]?|十[一二三四五六七八九]?|[二三四五六七八九])';
    const ARABIC_YEAR_PART = '(?:[1-5１-５][0-9０-９]|6[0-1０-１]|６[０-１]|[1-9１-９])';
    const YEAR_NUM_PART = '(?:' + CN_YEAR_PART + '|' + ARABIC_YEAR_PART + ')';
    const NUM_PART = YEAR_NUM_PART;

    // 中文纪年数字 → 阿拉伯数字；不符合 1～61 的标准中文写法时返回 NaN。
    function cnToNumber(input) {
        if (input === null || input === undefined) return NaN;
        let s = String(input).trim();
        if (!s) return NaN;
        if (s === '元' || s === '元年') return 1;
        s = s.replace(/[０-９]/g, function (c) {
            return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
        });
        if (/^\d+$/.test(s)) {
            const n = parseInt(s, 10);
            return (n >= 1 && n <= 61) ? n : NaN;
        }
        if (!new RegExp('^' + CN_YEAR_PART + '$').test(s)) return NaN;
        if (/^[二三四五六七八九]$/.test(s))
            return '二三四五六七八九'.indexOf(s) + 2;
        if (s === '十') return 10;
        if (/^十[一二三四五六七八九]$/.test(s))
            return 10 + '一二三四五六七八九'.indexOf(s[1]) + 1;
        if (/^[二三四五]十(?:[一二三四五六七八九])?$/.test(s)) {
            const tens = '二三四五'.indexOf(s[0]) + 2;
            return tens * 10 + (s.length === 3 ? '一二三四五六七八九'.indexOf(s[2]) + 1 : 0);
        }
        if (/^[廿卅卌]$/.test(s))
            return { '廿': 20, '卅': 30, '卌': 40 }[s];
        if (/^[廿卅卌][一二三四五六七八九]$/.test(s))
            return { '廿': 20, '卅': 30, '卌': 40 }[s[0]] + '一二三四五六七八九'.indexOf(s[1]) + 1;
        if (s === '六十') return 60;
        if (s === '六十一') return 61;
        return NaN;
    }
    const NAME_PART = NAMES.map(patternOf).join('|');
    const FIRST_CHARS = [];
    for (const n of NAMES) {
        const set = VARIANTS_OF.get(n[0]) || [n[0]];
        for (const c of set)
            if (FIRST_CHARS.indexOf(c) === -1)
                FIRST_CHARS.push(c);
    }
    const PREFILTER = new RegExp('[' + FIRST_CHARS.join('') + ']');
    const STEMS = '甲乙丙丁戊己庚辛壬癸';
    const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
    function ganzhiOf(year) {
        if (!Number.isFinite(year))
            return '';
        const astro = year > 0 ? year : year + 1;
        const i = ((astro - 4) % 60 + 60) % 60;
        return STEMS.charAt(i % 10) + BRANCHES.charAt(i % 12);
    }
    function ganzhiOffsetIn(start, end, gz) {
        if (!Number.isFinite(start) || !gz)
            return -1;
        const span = Number.isFinite(end) ? Math.max(0, end - start) : 59;
        for (let off = 0; off <= span && off < 60; off++) {
            if (ganzhiOf(start + off) === gz)
                return off;
        }
        return -1;
    }
    // 干支**只有 60 个**，不是 10×12=120 的笛卡尔积：天干地支各按阴阳排，
    // 阳干（甲丙戊庚壬）只配阳支（子寅辰午申戌），阴干（乙丁己辛癸）只配阴支（丑卯巳未酉亥）。
    // 所以「癸子」「甲丑」这种阴阳错配的写法**根本不存在**（癸是阴干、子是阳支），不能被认成干支。
    // 拆成两支写：5×6 + 5×6 = 30 + 30 = 60。
    //
    // ⚠️ 这是**唯一**的干支定义，别在别处再抄一份 10×12 的字符类 ——
    //    以前散在 6 个文件里各写一遍，结果「癸子年」在正文里也被标成了纪年。
    //    消费方：eras.js 的 buildRegex（eraG）· content-scanner.js / canvas-adapter.js 的
    //    BARE_GZ 与 gzAfter · content-correction.js 的 GANZHI_TAIL · sidepanel.js 的 GANZHI_PART。
    //    加新的干支匹配点时，引用 `D.GANZHI_PART`，别再手写字符类。
    const GANZHI_PART = '(?:[甲丙戊庚壬][子寅辰午申戌]|[乙丁己辛癸][丑卯巳未酉亥])';
    const SP = '[ \\t\\u3000]*';
    // 「年」的另一种写法：唐玄宗天寶三年（744）改「年」為「載」，到肅宗乾元元年（758）才改回「年」，
    // 所以「天寶三載」「貞觀十載」这类写法在古籍里常见，简繁两种都要认。
    // ⚠️ 只用在「数年份」的位置 —— 年号+数字+年、干支+年、以及省略年号的裸纪年。
    //    「年間」「年表」「元年」这些不能换，所以**没有**全局替换，各处显式引用这个片段。
    //    消费方：content-scanner.js / canvas-adapter.js 的 BARE_GZ / BARE_YEAR / BARE_YEAR_HEAD，
    //            content-annotation.js 抽年数，content-correction.js 的纪年尾巴，
    //            era-search.js / sidepanel.js 的查询解析。
    const YEAR_MARK = '(?:年|載|载)';
    // 范围写法的「尾巴」：间 / 間（简繁）· 中 · 初 · 末 —— 五个单字，一个字符类就够。
    // 写成 `(?:间|間|中|初|末)` 或 `(?:[间間]|中|初|末)` 效果一样，只是多一层分组和竖线。
    //
    // ⚠️ 这个常量里**只放那五个字，不放「年」**。原因是它要同时插进两个位置：
    //      eraR = 年号 + '年' + RANGE_SUFFIX   ← 前面已经有「年」了
    //      eraM = 年号 +        RANGE_SUFFIX   ← 前面**不能**有「年」（「貞觀間」就是这种）
    //    一旦把「年」写进常量（比如抄成 `(?:年[间間]|中|初|末)`），eraR 会拼出
    //    `年(?:年[间間]|…)`，只有「貞觀年年間」才匹配；而 eraM 又会要求先有「年」，
    //    「貞觀間」反而不认了 —— 两个方向同时坏掉。
    //    所以「年」由**调用处**各自处理：eraR 自己写 `'年'`，RANGE_FORM 用 `年?`。
    //
    // 同一份定义供两处用，别再各写一遍 —— 2026-10-23 就是各写一遍，加「間」时只改了正则、
    // 漏了 `RANGE_FORM`，结果「貞觀間」标出来了但点「更正」预填不出年号。
    //   RANGE_SUFFIX —— buildRegex 的 eraR / eraM 分支（正则片段，不带锚点、不含「年」）
    //   RANGE_FORM —— 更正面板的 eraTailAccepted()（判「年号后面那一截」合不合法，整串锚定）
    // 「貞觀年間」和「貞觀間」是一个意思，古籍里两种都常见。
    // ⚠️ 带「年」的（eraR）不做边界检查，不带「年」的（eraM）要做 —— 见 buildRegex 上面的说明。
    const RANGE_SUFFIX = '[间間中初末时時]';
    const RANGE_FORM = new RegExp('^(?:年?' + RANGE_SUFFIX + ')$');
    // 「光秃秃的年号 + 干支」里**不认**的年号（用户 2026-10-18 要求）。
    //
    // 为什么单拎出「上元」：历法术数里「上元甲子 / 上元乙丑…」指的是三元九运的**起算点**
    //（上元、中元、下元各配六十年），跟哪位皇帝在位没关系，正文里出现时根本不是纪年。
    // 但「上元」本身是**真实年号**（唐·高宗 674-676、唐·肅宗 760-761、南詔·異牟尋 784-808），
    // 所以**只拦「上元 + 干支」这一个光秃秃的形态**，见下面 `excludedEraG()`。
    //
    // ⚠️ 这条**不能写在正则里**：判据之一是「前面紧挨着朝代 / 帝号」，而年号前面的朝代 / 帝号
    //    前缀本来就是在正则外面算的（见 `whoPrefixLength` 上面那段说明 —— 正则里看不到「唐」）。
    //    所以给调用方一个 `excludedEraG()`，**两个扫描器都必须调用**（和 eraM 的边界过滤一样）：
    //      content-scanner.js 的 runRegex
    //      canvas-adapter.js 的 findMatches
    //    以后新增 buildRegex 的消费者，记得也补这一步，否则「上元甲子」会被标出来。
    //    （applyContextMatches 那条路只处理 eraR / eraM，eraG 在那儿本来就被跳过了。）
    // ⚠️ 只写**年号名**（表里的写法），不加「年」「年间」之类。要再加排除项直接往数组里放。
    // ⚠️ 必须放在 YEAR_MARK 之后：ERA_G_YEAR_TAIL 要用它（const 有 TDZ，放前面会直接抛错）。
    const ERA_G_EXCLUDED = ['上元'];
    const ERA_G_EXCLUDED_SET = new Set(ERA_G_EXCLUDED.map(canonicalForm));
    // matched 末尾是不是「年 / 載 / 载」—— 带了就说明不是光秃秃的干支。
    const ERA_G_YEAR_TAIL = new RegExp(YEAR_MARK + '$');
    // 这个 eraG 匹配该不该丢掉？**只拦光秃秃的「上元 + 干支」**：
    //   上元甲子 / 上元乙丑        → 丢（术数里的「上元」）
    //   上元甲子年                 → 留（带了「年」，是正经纪年写法）
    //   唐上元甲子 / 唐高宗上元甲子 → 留（前面紧挨着朝代 / 帝号）
    //   上元三年 / 上元年間         → 走 era / eraR 分支，压根不经过这里
    //   eraName —— 捕获到的年号；matched —— 整个匹配；before —— 匹配起点之前的正文。
    function excludedEraG(eraName, matched, before) {
        if (!ERA_G_EXCLUDED_SET.size || !ERA_G_EXCLUDED_SET.has(canonicalForm(eraName)))
            return false;
        if (whoPrefixLength(before) > 0)
            return false;
        return !ERA_G_YEAR_TAIL.test(String(matched == null ? '' : matched));
    }
    // 「年号 + 中/初/末/间/間」（**「年」可有可无**）这里**不加任何边界约束** —— 约束放在调用方做。
    //
    // 两条分支（都在 `opts.range` 为真时才加）：
    //   eraR = 年号 + 「年」 + RANGE_SUFFIX   →「貞觀年間 / 貞觀年中 / 貞觀年初」
    //   eraM = 年号 +        RANGE_SUFFIX   →「貞觀間 / 貞觀中 / 貞觀初 / 貞觀末」
    // 拆成两个命名组**不是冗余**：只有不带「年」的 eraM 需要额外做边界检查（见下），
    // 带「年」的 eraR 有强信号、不用查。合并成一个组就没法只对一半生效了。
    // 两条共用 `RANGE_SUFFIX` 那一份定义，改字符集时只改那里。
    //
    // 为什么不能在正则里做：要看的是「整段高亮起点」前面是不是标点，而高亮起点可能比年号还靠左
    // —— 紧挨在年号前面的朝代 / 帝号前缀也算高亮的一部分：「。周广顺末」的高亮起点是「周」，
    // 正则里根本看不到「周」，判不了。只能由调用方算完 hlIndex（= 年号起点 − whoPrefixLength）
    // 之后再用各自的 isBoundary() 过滤。
    //
    // 判定规则：hlIndex 前面必须是标点 / 空白 / 段首。原来的规则是反过来的（要求「中/初/末」
    // 后面是标点或行尾），会漏掉古籍里不点句读的写法 ——「太和中詔中書監」的「太和中」后面
    // 紧跟「詔」，一直标不出来。为什么不看后面：`中書監`「中書令」这类词里也有「中」，
    // 光看后面区分不开；而前面是标点说明这里是新分句的起头，「年号+中」只可能是范围写法。
    //
    // ⚠️ 两个调用方必须都过滤（少一处那条路径就会误标）：
    //      content-scanner.js 的 applyContextMatches（DOM）
    //      canvas-adapter.js 的 findMatches（识典古籍 canvas）
    //    以后新增 buildRegex({ range: true }) 的消费者，记得也补这一步。
    function buildRegex(opts) {
        const standalone = !!(opts && opts.standalone);
        // eraG（年号 + 干支）末尾的「年」是**可选**的 —— 古籍里「康熙甲子」和「康熙甲子年」一个意思，
        // 干支本身就说明了是哪一年，不必再写「年」字。侧边栏的查询解析（sidepanel.js 的
        // ganzhiBarePattern）一直就是这么认的，这里对齐。
        // ⚠️ 只有 eraG 能省 —— era（年号 + 数字）的「年」绝不能省：数字后面没有「年」字时
        //    「建元三」和「建元三十三年」分不开，且「贞观三年」的「三」会被当成独立数字吞掉。
        // ⚠️ 同理**不要**把这条放宽挪到裸干支（content-scanner.js / canvas-adapter.js 的 BARE_GZ）：
        //    那边没有年号兜底，「建隆元年春正月乙巳」里的「乙巳」是**纪日**，会全被误标成年。
        // ⚠️ 「上元甲子」这类要排除的形态**不在这里处理** —— 正则看不到朝代 / 帝号前缀，
        //    由调用方用 `D.excludedEraG()` 过滤，见上面的常量说明。
        const parts = [
            '(?<eraG>' + NAME_PART + ')' + SP + '(?<gz>' + GANZHI_PART + ')' + SP + YEAR_MARK + '?',
            '(?<era>' + NAME_PART + ')' + SP + '(?<num>' + NUM_PART + ')' + SP + YEAR_MARK,
        ];
        // 改元 + 年号
        parts.push('(?<=改元)' + SP + '(?<eraC>' + NAME_PART + ')');
        if (opts && opts.range) {
            parts.push('(?<eraR>' + NAME_PART + ')' + SP + '年' + RANGE_SUFFIX,
                '(?<eraM>' + NAME_PART + ')' + SP + RANGE_SUFFIX);
        }
        if (standalone)
            parts.push('(?<eraB>' + NAME_PART + ')');
        return new RegExp(parts.map(function (p) { return '(?:' + p + ')'; }).join('|'), 'g');
    }
    function hasCandidate(text) {
        return PREFILTER.test(text);
    }
    function contextNames(info) {
        const out = [];
        function push(s, allowShort) {
            const v = String(s || '').trim();
            if (!v)
                return;
            if (!allowShort && v.length < 2)
                return;
            if (out.indexOf(v) < 0)
                out.push(v);
        }
        const dynasty = String((info && info.dynasty) || '');
        push(dynasty);
        if (/朝$/.test(dynasty))
            push(dynasty.slice(0, -1));
        const alias = Object.prototype.hasOwnProperty.call(DYNASTY_ALIAS, dynasty)
            ? String(DYNASTY_ALIAS[dynasty] || '').trim()
            : '';
        if (alias) {
            push(alias, true);
            push(alias + '朝', true);
            push(alias + '代', true);
        }
        const emperor = String((info && info.emperor) || '');
        push(emperor);
        if (/帝$/.test(emperor))
            push(emperor.slice(0, -1));
        return out;
    }
    const TAIL_NOISE = /[的之於于\s·、，,。；;：:（）()「」『』《》]+$/;
    function endsWithName(before, name) {
        const tail = String(before || '').replace(TAIL_NOISE, '');
        if (tail.length < name.length)
            return false;
        return canonicalForm(tail.slice(-name.length)) === canonicalForm(name);
    }
    // ---- 高亮扩展：把紧挨在年号前面的「谁」（朝代 + 帝号）也圈进去 ----
    // 只在匹配本身带年号时用（见 content-scanner.js / canvas-adapter.js）：
    //   「唐廣明元年」→ 高亮「唐廣明元年」
    //   「唐僖宗廣明元年」→ 高亮「唐僖宗廣明元年」（朝代 + 帝号都要）
    //   「僖宗廣明元年」→ 也扩（只带帝号，没写朝代）
    //   「唐貞觀」（只有朝代 + 年号，独立年号那种）→ 不扩
    // 名字取自年号表：朝代值 + 简称（DYNASTY_ALIAS）+ 简称的「X朝 / X代」写法。
    const DYNASTY_NAMES = (function () {
        const set = new Set();
        const add = function (s) {
            const v = String(s || '').trim();
            if (v)
                set.add(v);
        };
        for (const e of ERAS) {
            const d = String(e.dynasty || '').trim();
            if (!d)
                continue;
            add(d);
            if (/朝$/.test(d))
                add(d.slice(0, -1));
            const alias = Object.prototype.hasOwnProperty.call(DYNASTY_ALIAS, d)
                ? String(DYNASTY_ALIAS[d] || '').trim()
                : '';
            if (alias) {
                add(alias);
                add(alias + '朝');
                add(alias + '代');
            }
        }
        // 长的优先：先试「南唐」再试「唐」
        return Array.from(set).sort(function (a, b) {
            return b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
        });
    })();
    // 帝号名（「僖宗」「太宗」「武帝」…）。**只收长度 >= 2 的**：
    // 年号表里夏商那 13 个单字王名（禹 / 啟 / 相 / 抒 / 槐 / 芒 / 泄 / 扃 / 廑 / 臯 / 發 / 桀 / 緡）
    // 当普通字用的概率太高，紧挨在年号前面也会误圈（「宰相廣明元年」会把「相」圈进去）。
    const EMPEROR_NAMES = (function () {
        const set = new Set();
        for (const e of ERAS) {
            const emp = String(e.emperor || '').trim();
            if (emp.length >= 2)
                set.add(emp);
            // 「光武帝」这类去掉末尾「帝」也常见（光武中元元年）；同样要求剩下 >= 2 字
            if (/帝$/.test(emp) && emp.length - 1 >= 2)
                set.add(emp.slice(0, -1));
        }
        return Array.from(set).sort(function (a, b) {
            return b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
        });
    })();
    // names 里最长的那个「正好落在 text 结尾」的名字有几个字；没有返回 0。
    function tailNameLength(text, names) {
        for (const name of names) {
            if (text.length < name.length)
                continue;
            if (canonicalForm(text.slice(text.length - name.length)) !== canonicalForm(name))
                continue;
            return name.length;
        }
        return 0;
    }
    // 结尾是朝代名（含紧贴在前面的「大」）几个字
    function dynastySuffixLength(text) {
        const len = tailNameLength(text, DYNASTY_NAMES);
        if (!len)
            return 0;
        const at = text.length - len;
        return len + (at > 0 && text.charAt(at - 1) === '大' ? 1 : 0);
    }
    // before 的结尾是「谁」？返回要往左扩几个字（0 = 不扩）。
    // 先认「朝代 + 帝号」（唐僖宗），再认「帝号」（僖宗），最后认「朝代」（唐）。
    // 每一段都必须紧挨着：中间有标点 / 空白就不算，这样「唐、貞觀五年」不会把标点也圈进去。
    function whoPrefixLength(before) {
        const text = String(before || '');
        if (!text)
            return 0;
        const emperor = tailNameLength(text, EMPEROR_NAMES);
        const rest = emperor ? text.slice(0, text.length - emperor) : text;
        return dynastySuffixLength(rest) + emperor;
    }
    const ANY_NAME_RE = new RegExp('(?:' + NAME_PART + ')', 'g');
    function contextFromEarlierEra(before) {
        const text = String(before || '');
        if (!text)
            return null;
        ANY_NAME_RE.lastIndex = 0;
        let m;
        let last = null;
        while ((m = ANY_NAME_RE.exec(text)) !== null)
            last = m[0];
        if (!last)
            return null;
        const eras = lookupEra(last);
        return eras.length === 1 ? eras[0] : null;
    }
    function pickByContext(candidates, before) {
        const list = Array.isArray(candidates) ? candidates : [];
        if (list.length < 2)
            return list[0] || null;
        if (!String(before || '').trim())
            return null;
        let best = 0;
        let hits = [];
        for (const info of list) {
            let len = 0;
            for (const n of contextNames(info)) {
                if (n.length > len && endsWithName(before, n))
                    len = n.length;
            }
            if (!len)
                continue;
            if (len > best) {
                best = len;
                hits = [info];
            }
            else if (len === best)
                hits.push(info);
        }
        if (hits.length === 1)
            return hits[0];
        if (hits.length > 1)
            return null;
        const anchor = contextFromEarlierEra(before);
        if (!anchor)
            return null;
        const byEmperor = list.filter(function (x) { return x.emperor === anchor.emperor; });
        const pool = byEmperor.length ? byEmperor
            : list.filter(function (x) { return x.dynasty === anchor.dynasty; });
        return pool.length === 1 ? pool[0] : null;
    }
    function lookupEra(name) {
        return BY_NAME.get(canonicalForm(name)) || [];
    }
    function toGregorian(start, n) {
        let g = start + n - 1;
        if (start < 0 && g >= 0)
            g += 1;
        return g;
    }
    // 在「没有公元 0 年」的年号轴上前后移动 delta 年（公元 1 年 的上一年是 前1 年）。
    function shiftYear(year, delta) {
        const idx = year >= 1 ? year - 1 : year;
        const moved = idx + delta;
        return moved >= 0 ? moved + 1 : moved;
    }
    // 纪年数 → 公元年。offset = 「start 那一年是这个年号的第几年」（默认 1，即 start 就是元年）。
    // 天會(968~973, offset 12)：eraYear(968, 12) = 968、eraYear(968, 1) = 957。
    // 注意 delta 可能为负（元年落在 start 之前），所以要过 shiftYear 而不是直接相加。
    function eraYear(start, n, offset) {
        if (!Number.isFinite(start) || !Number.isFinite(n) || n < 1)
            return null;
        const off = Number.isFinite(offset) && offset >= 1 ? Math.floor(offset) : 1;
        return shiftYear(start, n - off);
    }
    function formatYear(n) {
        if (!Number.isFinite(n))
            return '';
        return n < 0 ? '前' + (-n) : String(n);
    }

    const GONGHE_YEAR = -841;
    function isBeforeGonghe(year) {
        const n = Number(year);
        return Number.isFinite(n) && n < GONGHE_YEAR;
    }
    function approxMark(year) {
        return isBeforeGonghe(year) ? '约' : '';
    }
    function formatYearApprox(year) {
        if (!Number.isFinite(Number(year)))
            return '';
        return approxMark(year) + formatYear(Number(year));
    }
    // 「朝代 · 帝号 · 年号」的显示拼装 —— 卡片标题 / 卡片候选行、更正面板候选行、侧边栏结果行都用它。
    // 年号表里有「西漢·高祖·高祖」这种帝号与年号同名的条目（商朝那串王名同理），
    // 两个都写出来就是同一个名字连着出现两次，所以同名时只留一个（留帝号那一格）。
    // 只影响显示，不动任何数据 / 匹配。
    // 同名时**丢掉帝号那一格、留年号**：年号那格可能带纪年（「高祖五年」），
    // 帝号只是个名字，丢掉不损失信息。所以「西漢 · 高祖 · 高祖五年」→「西漢 · 高祖五年」。
    //   era     —— 这一处要显示的年号写法，可以带纪年（如「高祖五年」）
    //   eraName —— 拿它和帝号比对；不传就用 era 本身；传 '' 表示这一处不显示年号、只做去重
    function whoText(dynasty, emperor, era, eraName) {
        const who = emperor == null ? '' : String(emperor).trim();
        const raw = (eraName === undefined || eraName === null) ? era : eraName;
        const name = raw == null ? '' : String(raw).trim();
        const keepEmperor = !(name && name === who);
        return [dynasty, keepEmperor ? emperor : '', era].filter(Boolean).join(' · ');
    }
    function buildCandidate(era, n, matched, inputName) {
        const hasStart = Number.isFinite(era.start);
        const valid = Number.isFinite(n) && hasStart;
        const gregorian = valid ? eraYear(era.start, n, era.offset) : null;
        return {
            era: era.name,
            dynasty: era.dynasty,
            emperor: era.emperor,
            eraStart: hasStart ? era.start : null,
            eraEnd: Number.isFinite(era.end) ? era.end : null,
            eraOffset: Number.isFinite(era.offset) && era.offset >= 1 ? era.offset : 1,
            n: valid ? n : null,
            gregorian: gregorian,
            matched: matched,
            input: inputName || era.name,
            alias: inputName && inputName !== era.name ? era.name : null
        };
    }
    function resolve(m) {
        if (!m || !m.groups)
            return null;
        const g = m.groups;
        if (g.eraG)
            return resolveGanzhi(g.eraG, g.gz, m[0]);
        if (g.era)
            return resolveMatch(g.era, g.num, m[0]);
        if (g.eraR)
            return resolveRange(g.eraR, m[0]);
        if (g.eraM)
            return resolveRange(g.eraM, m[0]);
        if (g.eraB)
            return resolveStandalone(g.eraB, m[0]);
        if (g.eraC)
            return resolveStandalone(g.eraC, m[0]);
        return null;
    }
    function resolveMatch(name, numText, matched) {
        const eras = lookupEra(name);
        if (!eras.length)
            return null;
        const n = cnToNumber(numText);
        return eras.map(function (era) { return buildCandidate(era, n, matched, name); });
    }
    function resolveGanzhi(name, gz, matched) {
        const eras = lookupEra(name);
        if (!eras.length)
            return null;
        const out = [];
        for (const era of eras) {
            const off = ganzhiOffsetIn(era.start, era.end, gz);
            if (off < 0) {
                // 年号已经由正文明确写出，但干支不在该年号的有效范围内。
                // 不能退回上文寻找另一个年号；保留本年号，并把具体年份留作未知。
                const candidate = buildCandidate(era, NaN, matched, name);
                candidate.ganzhiOutOfRange = true;
                out.push(candidate);
                continue;
            }
            // 干支锚在真实年份上（与年号的计数起点无关），所以这一年的纪年数
            // 是「离 start 的偏移 + offset」——天會(offset 12)的甲子若是第 1 年，
            // 它显示的是天會十三年，不是天會二年。
            out.push(buildCandidate(era, off + (Number.isFinite(era.offset) && era.offset >= 1 ? era.offset : 1), matched, name));
        }
        return out.length ? out : null;
    }
    function resolveRange(name, matched) {
        const eras = lookupEra(name);
        if (!eras.length)
            return null;
        return eras.map(function (era) {
            const c = buildCandidate(era, NaN, matched, name);
            c.range = true;
            return c;
        });
    }
    function resolveStandalone(name, matched) {
        const eras = lookupEra(name);
        if (!eras.length)
            return null;
        return eras.map(function (era) { return buildCandidate(era, NaN, matched, name); });
    }
    function resolveByGregorianYear(year) {
        const target = Number(year);
        if (!Number.isFinite(target))
            return [];
        return ERAS.filter(function (era) {
            return Number.isFinite(era.start) && era.start === target;
        }).map(function (era) {
            // 这一年的纪年数就是它的 offset（start 那一年是第几年）。
            return buildCandidate(era, era.offset || 1, '', era.name);
        });
    }
    function rangeOf(eraName, dynasty) {
        const name = String(eraName || "").trim();
        if (!name)
            return null;
        const list = lookupEra(name);
        if (!list || !list.length)
            return null;
        const want = String(dynasty || "").trim();
        let pool = list;
        if (want) {
            const hit = list.filter(function (e) {
                const d = String(e.dynasty || "");
                return d === want || d.indexOf(want) >= 0 || want.indexOf(d) >= 0;
            });
            if (hit.length)
                pool = hit;
        }
        let best = null;
        for (const e of pool) {
            if (!Number.isFinite(e.start))
                continue;
            if (best === null || e.start < best.start)
                best = e;
        }
        if (!best)
            return null;
        return {
            start: best.start,
            end: Number.isFinite(best.end) ? best.end : best.start,
            offset: Number.isFinite(best.offset) && best.offset >= 1 ? best.offset : 1
        };
    }
    // RANGE_FORM 与 buildRegex 的 eraR/eraM 共用同一份 `RANGE_SUFFIX` 定义，定义在文件上方。
    global.EraData = {
        rangeOf: rangeOf,
        RANGE_FORM: RANGE_FORM,
        version: '1.1.0',
        TABLE: TABLE,
        ERAS: ERAS,
        NAMES: NAMES,
        VARIANT_GROUPS: VARIANT_GROUPS,
        CANONICAL_NAMES: CANONICAL_NAMES,
        canonicalForm: canonicalForm,
        patternOf: patternOf,
        escapeRe: escapeRe,
        cleanEraName: cleanEraName,
        cnToNumber: cnToNumber,
        CN_YEAR_PART: CN_YEAR_PART,
        ARABIC_YEAR_PART: ARABIC_YEAR_PART,
        YEAR_NUM_PART: YEAR_NUM_PART,
        YEAR_MARK: YEAR_MARK,
        ganzhiOf: ganzhiOf,
        ganzhiOffsetIn: ganzhiOffsetIn,
        GANZHI_PART: GANZHI_PART,
        ERA_G_EXCLUDED: ERA_G_EXCLUDED,
        excludedEraG: excludedEraG,
        DYNASTY_ALIAS: DYNASTY_ALIAS,
        contextNames: contextNames,
        whoPrefixLength: whoPrefixLength,
        pickByContext: pickByContext,
        contextFromEarlierEra: contextFromEarlierEra,
        toGregorian: toGregorian,
        shiftYear: shiftYear,
        eraYear: eraYear,
        formatYear: formatYear,
        GONGHE_YEAR: GONGHE_YEAR,
        isBeforeGonghe: isBeforeGonghe,
        approxMark: approxMark,
        formatYearApprox: formatYearApprox,
        whoText: whoText,
        buildRegex: buildRegex,
        hasCandidate: hasCandidate,
        lookupEra: lookupEra,
        resolve: resolve,
        resolveMatch: resolveMatch,
        resolveGanzhi: resolveGanzhi,
        resolveRange: resolveRange,
        resolveStandalone: resolveStandalone,
        resolveByGregorianYear: resolveByGregorianYear
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
