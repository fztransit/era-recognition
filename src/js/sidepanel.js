(function () {
    'use strict';
    const D = window.EraData;
    const qEl = document.getElementById('sp-q');
    const outEl = document.getElementById('sp-out');
    const prevBtn = document.getElementById('sp-prev');
    const nextBtn = document.getElementById('sp-next');
    function cnNum(n) {
        const v = Number(n);
        if (!Number.isFinite(v) || v < 1 || v > 99)
            return String(n);
        const D1 = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
        if (v < 10)
            return D1[v];
        if (v === 10)
            return "十";
        if (v < 20)
            return "十" + D1[v - 10];
        const t = Math.floor(v / 10);
        const o = v % 10;
        return D1[t] + "十" + (o ? D1[o] : "");
    }
    // yearLabel：第 1 年返回特例字符（不是「一」），其余走 cnNum 转中文数。
    function yearLabel(n) {
        return Number(n) === 1 ? '元' : cnNum(n);
    }
    const GANZHI_PART = '[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]';
    // 年份标记认「年」也认「載 / 载」（见 eras.js 的 YEAR_MARK）。
    const YEAR_MARK = D.YEAR_MARK;

    // ---- 朝代 / 帝号 / 年号词表 ----
    // 侧边栏输入按「朝代 → 帝号 → 年号」识别，但名称必须整段匹配，不能用包含关系猜角色。
    // 朝代同时接受年号表里的本名、DYNASTY_ALIAS 简称，以及常见的「X朝 / X代」写法。
    let LEXICON = null;
    function lexicon() {
        if (LEXICON)
            return LEXICON;
        const dyn = Object.create(null);
        const emp = Object.create(null);
        const era = Object.create(null);
        const actualDyn = Object.create(null);
        const addDyn = function (name, value, overwrite) {
            const key = EraSearch.fold(name);
            if (!key)
                return;
            if (overwrite || !Object.prototype.hasOwnProperty.call(dyn, key))
                dyn[key] = value;
        };
        for (const e of (D.ERAS || [])) {
            if (e.dynasty) {
                const key = EraSearch.fold(e.dynasty);
                actualDyn[key] = e.dynasty;
                addDyn(e.dynasty, e.dynasty, true);
            }
            if (e.emperor)
                emp[EraSearch.fold(e.emperor)] = 1;
            if (e.name)
                era[EraSearch.fold(e.name)] = 1;
        }
        const aliases = D.DYNASTY_ALIAS || {};
        for (const name of Object.keys(aliases)) {
            const key = EraSearch.fold(name);
            // 年号表中真实存在的朝代名优先；仅把非本名作为简称处理。
            if (!Object.prototype.hasOwnProperty.call(actualDyn, key))
                addDyn(name, String(aliases[name] || name), false);
        }
        for (const e of (D.ERAS || [])) {
            if (!e.dynasty)
                continue;
            const short = EraSearch.shortDynasty(e.dynasty);
            addDyn(short, short, false);
        }
        // 为词表中的朝代名和简称生成「朝 / 代」后缀形式，值仍保留为用于筛选的规范朝代名。
        const dynastyTokens = Object.keys(dyn).map(function (key) {
            return { token: key, value: dyn[key] };
        });
        for (const item of dynastyTokens) {
            addDyn(item.token + '朝', item.value, false);
            addDyn(item.token + '代', item.value, false);
        }
        LEXICON = { dyn: dyn, emp: emp, era: era };
        return LEXICON;
    }
    function dynWordValue(s) {
        const dict = lexicon().dyn;
        const key = EraSearch.fold(s);
        return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : '';
    }
    function isDynWord(s) { return !!dynWordValue(s); }
    function isEmpWord(s) { return !!lexicon().emp[EraSearch.fold(s)]; }
    function isEraWord(s) { return !!lexicon().era[EraSearch.fold(s)]; }

    // 整段切分，不做子串猜测。角色可省略，但顺序固定为朝代 → 帝号 → 年号。
    // 先尝试前面的角色，且每一格优先尝试较长的词，保证「元世祖至元」能切成三格。
    function segmentWho(text, preferEraIfWhole) {
        const s = String(text || '');
        if (!s)
            return null;
        // 后面已经有纪年 / 干支时，前面的完整名称首先按年号理解。
        // 例如「元王」既是帝号也是年号：「元王元年」应查年号的元年，而不是帝号列表。
        if (preferEraIfWhole && isEraWord(s))
            return { has: true, dynasty: '', emperor: '', era: s };
        const KINDS = [
            { key: 'dynasty', test: isDynWord },
            { key: 'emperor', test: isEmpWord },
            { key: 'era', test: isEraWord }
        ];
        function walk(rest, k, acc) {
            if (!rest)
                return acc.has ? acc : null;
            if (k >= KINDS.length)
                return null;
            const kind = KINDS[k];
            for (let len = rest.length; len >= 1; len--) {
                const head = rest.slice(0, len);
                if (!kind.test(head))
                    continue;
                const next = Object.assign({}, acc, { has: true });
                next[kind.key] = kind.key === 'dynasty' ? dynWordValue(head) : head;
                const got = walk(rest.slice(len), k + 1, next);
                if (got)
                    return got;
            }
            return walk(rest, k + 1, acc);
        }
        return walk(s, 0, { has: false });
    }

    function parseQuery(q) {
        const raw = String(q || '').trim();
        if (!raw)
            return null;
        // 纯公元年：333 / 333年 / BC104 / 前104。
        const bc = raw.match(/^(?:公元前|前|-|BC|bc)\s*(\d{1,4})\s*年?$/);
        if (bc) {
            const n = Number(bc[1]);
            if (Number.isFinite(n) && n >= 1)
                return { gregorian: -n, era: '', year: null, who: '' };
        }
        const gy = raw.match(/^(?:公元)?\s*(\d{1,4})\s*年?$/);
        if (gy) {
            const n = Number(gy[1]);
            if (Number.isFinite(n) && n >= 1)
                return { gregorian: n, era: '', year: null, who: '' };
        }

        // 统一去掉分隔符后解析。年份与干支必须从输入末尾识别，不能先把「元」等字当作名称吞掉。
        const clean = raw.replace(/[\s·、,，]/g, '');
        let body = clean;
        let year = null;
        let ganzhi = '';
        let seg = null;
        const yearGuard = '(?<![一二三四五六七八九十百千万廿卅卌0-9０-９])';
        const yearPattern = new RegExp(yearGuard + '(' + D.YEAR_NUM_PART + ')' + YEAR_MARK + '$');
        const ganzhiMarkedPattern = new RegExp('(' + GANZHI_PART + ')' + YEAR_MARK + '$');
        const ganzhiBarePattern = new RegExp('(' + GANZHI_PART + ')$');

        // 明写「元年 / 十二年 / 12載」时，纪年标记优先；「元年」中的元是第一年，不是元朝。
        let tail = body.match(yearPattern);
        if (tail) {
            year = tail[1] === '元' ? 1 : D.cnToNumber(tail[1]);
            body = body.slice(0, tail.index);
        } else {
            // 没写纪年标记时，先保留整串确实存在的名称：单独输入「元」应识别为朝代，
            // 「元王」等重名词也不应被拆成一个虚构的「元年」。
            seg = segmentWho(clean);
            if (seg)
                return makeParsedIdentity(seg, null, '');

            // 干支可带「年」，也可省略；例如「康熙甲子年 / 康熙甲子」。
            tail = body.match(ganzhiMarkedPattern) || body.match(ganzhiBarePattern);
            if (tail) {
                ganzhi = tail[1];
                body = body.slice(0, tail.index);
            }
            // 「雍正十二年甲子」这类写法中，干支后面还可能带一个纪年。
            const markedYear = body.match(yearPattern);
            if (markedYear) {
                year = markedYear[1] === '元' ? 1 : D.cnToNumber(markedYear[1]);
                body = body.slice(0, markedYear.index);
            } else {
                // 允许省略「年」：只有当前缀本身能完整识别为名称时，末尾的「元 / 十二 / 12」才算纪年。
                // 因而「元」仍会按朝代识别，而「至元元」才会识别成至元元年。
                const bareYear = body.match(new RegExp(yearGuard + '(' + D.YEAR_NUM_PART + ')$'));
                if (bareYear) {
                    const prefix = body.slice(0, bareYear.index);
                    const prefixSeg = segmentWho(prefix, true);
                    if (prefixSeg && prefixSeg.era) {
                        year = bareYear[1] === '元' ? 1 : D.cnToNumber(bareYear[1]);
                        body = prefix;
                    } else if (prefixSeg) {
                        // 前缀只识别成朝代 / 帝号时，不能把末尾「元」当元年；
                        // 也不能再把整串交给模糊帝号搜索（「唐元」会误中「南唐·元宗」）。
                        return { era: '', year: null, ganzhi: '', who: clean,
                            dynasty: '', emperor: '', invalidQuery: true };
                    }
                }
            }
        }

        // 纪年或干支剥离后，再严格切分前面的朝代、帝号、年号。
        seg = segmentWho(body, year !== null || !!ganzhi);
        // 纪年 / 干支必须依附于明确的年号。否则「唐元」「唐元年」会被
        // 截成朝代「唐」，「元元」会被截成朝代「元」，进而误出看似正确的结果。
        // 遇到这种输入时把整串留给未命中提示，不降级成朝代或帝号查询。
        if ((year !== null || ganzhi) && (!seg || !seg.era)) {
            if (seg && (seg.dynasty || seg.emperor)) {
                return { era: '', year: null, ganzhi: '', who: clean,
                    dynasty: '', emperor: '', invalidQuery: true };
            }
            return makeParsedIdentity(null, null, '', clean);
        }
        return makeParsedIdentity(seg, year, ganzhi, body);
    }
    function makeParsedIdentity(seg, year, ganzhi, fallbackBody) {
        const era = seg && seg.era ? seg.era : '';
        const dynasty = seg && seg.dynasty ? seg.dynasty : '';
        const emperor = seg && seg.emperor ? seg.emperor : '';
        const body = String(fallbackBody == null ? '' : fallbackBody);
        // 完整切分成功时使用规范化后的朝代 / 帝号；否则把剩余输入留给现有的候选提示逻辑。
        const who = seg ? (dynasty + emperor) : body;
        return { era: era, year: year, ganzhi: ganzhi, who: who, dynasty: dynasty, emperor: emperor };
    }
    // 这条年号到底有没有「第 n 年」——按表里记的起止年判断。
    // 用 D.eraYear() 而不是 start + n - 1：一是跨前后分界不差一年，
    // 二是表里第 6 列那种「start 不是第 1 年」的条目能算对（offset 语义见 `eras.js` 的 `eraYear`）。
    // 起止年任一端不可考（表里为 null）或数据颠倒（end < start）时判断不了，
    // 一律放行，不把本来收录了的年号误判成不存在；这类条目公历年显示「未知」。
    function hasNthYear(row, n) {
        // 注意必须拿原值判断：Number(null) === 0，一旦先转数字就绕过 Number.isFinite 了。
        const start = row && row.start;
        const end = row && row.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
            return true;
        return D.eraYear(start, n, row.offset) <= end;
    }
    // 覆盖某个年份的全部年号（一个年份可能同时有好几个政权在用的年号）。
    // 返回 [{ row, n }]，n = 该年是这条年号的第几年。
    function erasCoveringYear(year) {
        const out = [];
        const seen = Object.create(null);
        for (const e of (D.ERAS || [])) {
            if (!Number.isFinite(e.start))
                continue;
            const end = Number.isFinite(e.end) ? e.end : e.start;
            if (year < e.start || year > end)
                continue;
            const key = [e.dynasty, e.emperor, e.name, e.start].join('|');
            if (seen[key])
                continue;
            seen[key] = 1;
            // 这一年的纪年数 = 离 start 的偏移 + offset（offset 语义见 `eras.js` 的 `eraYear`）。
            const off = Number.isFinite(e.offset) && e.offset >= 1 ? e.offset : 1;
            out.push({ row: e, n: year - e.start + off });
        }
        out.sort(function (a, b) {
            const d = (a.row.start || 0) - (b.row.start || 0);
            return d !== 0 ? d : String(a.row.name).localeCompare(String(b.row.name));
        });
        return out;
    }
    // 这个输入能匹配到几个「朝代」（朝代名里包含输入，折简繁后比）。表序去重。
    // 「西漢」→ 只有 1 个；「汉」→ 西漢/玄漢/漢其他/東漢/蜀漢… 11 个；「唐」→ 唐其他/唐/後唐/南唐 4 个。
    // 用来决定「要不要弹朝代选择框」—— 只有一个朝代就直接出结果，多个才弹（用户 2026-10-12 要求）。
    function matchingDynasties(text) {
        const raw = String(text || '').trim().replace(/[朝]$/, '');
        if (!raw)
            return [];
        const q = EraSearch.fold(raw);
        const out = [];
        const seen = Object.create(null);
        for (const e of (D.ERAS || [])) {
            const dy = e.dynasty;
            if (!dy || seen[dy])
                continue;
            if (EraSearch.fold(dy).indexOf(q) < 0)
                continue;
            seen[dy] = 1;
            out.push(dy);
        }
        return out;
    }
    // 多个朝代时，面板默认显示哪个：「XX其他」是兜底归类（唐其他 = 沈法興/李重福…），不作默认。
    // 所以取表序里第一个**不带「其他」**的；全是兜底归类时才退回第一个。
    function defaultDynasty(text) {
        const dyns = matchingDynasties(text);
        if (!dyns.length)
            return '';
        return dyns.filter(function (dy) { return dy.indexOf('其他') < 0; })[0] || dyns[0];
    }
    // 「要不要弹朝代选择框」的判据：匹配到**多于一个**朝代。
    // ⚠️ 不算「XX其他」这种兜底归类 —— 否则「清」会因为「清其他」被判成多朝代，
    // 弹框问「清 / 清其他」，而用户只是想看清朝。
    function multiDynasty(text) {
        return matchingDynasties(text).filter(function (dy) {
            return dy.indexOf('其他') < 0;
        }).length > 1;
    }
    // 整串输入（去掉末尾的「朝」）是否**正好**是一个朝代名。
    // 用「完全相等」而不是「包含」—— 否则「武」会因为「武周」被判成朝代查询，
    // 把 5.6 的帝号建议框抢掉（「武」要的是「商 · 武丁」那种帝号建议）。
    // 判据直接扫年号表，不走 `dynasties()` 的 12 条上限，免得「漢」这种被截掉。
    function isDynastyQuery(text) {
        const raw = String(text || '').trim().replace(/[朝]$/, '');
        if (!raw)
            return false;
        const q = EraSearch.fold(raw);
        return (D.ERAS || []).some(function (e) {
            return !!e.dynasty && EraSearch.fold(e.dynasty) === q;
        });
    }
    function search(q) {
        const p = parseQuery(q);
        if (!p)
            return { kind: 'idle' };
        if (p.invalidQuery)
            return { kind: 'no-era', strictInvalid: true };
        if (p.gregorian) {
            const rows = erasCoveringYear(p.gregorian);
            return rows.length
                ? { kind: 'year', year: p.gregorian, rows: rows }
                : { kind: 'year-none', year: p.gregorian };
        }
        if (!p.era) {
            const who = p.who || "";
            if (who) {
                const pick = pickEmperor(who);
                if (pick) {
                    const rows = EraSearch.erasOfEmperor(pick.dynasty, pick.emperor);
                    if (rows.length)
                        return { kind: "emperor", who: pick, rows: rows };
                }
                const all = EraSearch.emperors(who, 30);
                // 整串就是某个**朝代名**（「西漢」「唐」「秦」）→ 面板列该朝代的帝号，每行点开看年号。
                //   只匹配到一个朝代（「西漢」）→ 直接出结果，不弹框。
                //   匹配到多个朝代（「唐」= 唐其他/唐/後唐/南唐）→ 面板默认显示第一个朝代的帝号，
                //   同时弹「朝代选择框」让用户挑（`multiDyn`，见 input 处理）。
                // 帝号查询（「武帝」「太宗」）不走这条路，保持 5.6 原样。
                if (all.length > 1 && isDynastyQuery(q)) {
                    const dyns = matchingDynasties(q);
                    const first = defaultDynasty(q);
                    const mine = first ? all.filter(function (x) { return x.dynasty === first; }) : [];
                    return {
                        kind: "who-list",
                        list: mine.length ? mine : all,
                        multiDyn: multiDynasty(q),
                        dyns: dyns
                    };
                }
                if (all.length) {
                    const rows = EraSearch.erasOfEmperor(all[0].dynasty, all[0].emperor);
                    if (rows.length) {
                        return { kind: "emperor", who: all[0], rows: rows, list: all };
                    }
                }
                return { kind: "no-era" };
            }
            return { kind: "no-era" };
        }
        let rows = D.lookupEra(p.era);
        if (!rows.length)
            return { kind: 'none', era: p.era };
        // 朝代 / 帝号是 parseQuery **严格切分**出来的（就是表里那一条的名字），所以这里直接
        // 用折简繁后的**完全相等**去筛。按「包含」挑会挑错：朝代「明」会匹配到「前燕·文明帝」
        //（'文明帝'.indexOf('明') ≥ 0）。
        // 朝代额外认「简称」（`shortDynasty`：西漢/東漢/蜀漢 → 漢，北宋/南宋 → 宋）：
        // 用户打「汉武帝太初」，朝代写的是「汉」，而表里那条是「西漢」。
        if (p.dynasty || p.emperor) {
            const fd = p.dynasty ? EraSearch.fold(p.dynasty) : '';
            const fe = p.emperor ? EraSearch.fold(p.emperor) : '';
            const hit = rows.filter(function (r) {
                if (fd) {
                    const dy = EraSearch.fold(r.dynasty || '');
                    const short = EraSearch.fold(EraSearch.shortDynasty(r.dynasty || ''));
                    if (dy !== fd && short !== fd)
                        return false;
                }
                if (fe && EraSearch.fold(r.emperor || '') !== fe)
                    return false;
                return true;
            });
            if (hit.length)
                rows = hit;
            else
                return { kind: 'none-who', era: p.era, who: p.who };
        }
        // 指定了干支：只接受该干支确实落在该年号有效范围内的条目。
        // 「雍正甲子年」这类超出范围的明确输入直接报错，绝不回溯上文或换算成别的年号。
        if (p.ganzhi) {
            const hits = [];
            for (const r of rows) {
                const offset = D.ganzhiOffsetIn(r.start, r.end, p.ganzhi);
                if (offset < 0 || !Number.isFinite(r.start))
                    continue;
                // 干支锚在真实年份上，与年号的计数起点无关：这一年的纪年数
                // = 离 start 的偏移 + offset（天會 offset 12，甲子在 start 那年就是十三年）。
                const eraOff = Number.isFinite(r.offset) && r.offset >= 1 ? r.offset : 1;
                hits.push({ row: r, n: offset + eraOff });
            }
            if (!hits.length)
                return { kind: 'ganzhi-out', era: p.era, ganzhi: p.ganzhi, who: p.who, rows: rows };
            const hitYear = function (h) { return D.eraYear(h.row.start, h.n, h.row.offset); };
            hits.sort(function (a, b) { return hitYear(a) - hitYear(b); });
            return { kind: 'year', year: hitYear(hits[0]), rows: hits, ganzhiQuery: true };
        }
        // 指定了纪年，就只留「真的有第 n 年」的年号：
        // 太初在西漢名下只用了 4 年，不该查得出「太初五年」；
        // 但前秦用了 9 年、西秦 13 年，它们的太初五年要照常留下。
        if (Number.isFinite(p.year) && p.year >= 1) {
            const inRange = rows.filter((r) => hasNthYear(r, p.year));
            // rows 留给报错文案列出各条年号的起止年；同时它让结果面板认为
            // 「已经认出来了」（rows 非空），于是不会再弹出建议下拉（「太初五年」不该再提示别的年号）。
            if (!inRange.length)
                return { kind: 'year-out', era: p.era, year: p.year, who: p.who, rows: rows };
            rows = inRange;
        }
        return { kind: 'ok', era: p.era, year: p.year, rows: rows };
    }
    // sp-out 的未完成输入预览只按「年号名称」匹配，不把朝代 / 帝号命中当作结果。
    // 搜索建议框仍使用原来的 search() 与 showSug()，所以提示框规则不受影响。
    function partialEraRows(q) {
        const fragment = EraSearch.fragmentOf(q);
        if (!fragment)
            return [];
        const folded = EraSearch.fold(fragment);
        if (!folded)
            return [];
        // 沿用提示框已有的末尾片段识别规则，但结果只允许由年号名称命中。
        const rows = (D.ERAS || []).filter(function (row) {
            return row && row.name && EraSearch.fold(row.name).indexOf(folded) >= 0;
        });
        if (!rows.length)
            return [];
        // 年号名以输入片段开头的优先，其余包含匹配随后；同等相关时保留年号表顺序。
        rows.sort(function (a, b) {
            const aPrefix = EraSearch.fold(a.name).indexOf(folded) === 0 ? 0 : 1;
            const bPrefix = EraSearch.fold(b.name).indexOf(folded) === 0 ? 0 : 1;
            return aPrefix - bPrefix;
        });
        return rows.slice(0, 12);
    }
    function searchOutput(q) {
        const result = search(q);
        const raw = String(q || '').trim();
        if (!raw || (result && result.strictInvalid))
            return result;
        const parsed = parseQuery(q);
        // 明确的年号、纪年、公元年查询照旧；只有尚未解析成具体年号 / 年份的输入，
        // 才把 sp-out 切换为「年号名称」预览。
        // 朝代 / 帝号的完整名称查询必须保留原结果（例如搜「唐」显示唐朝帝号列表），
        // 不能被下方「未完成年号片段」预览覆盖。
        if (!parsed || parsed.gregorian || parsed.era || parsed.year !== null || parsed.ganzhi ||
            parsed.dynasty || parsed.emperor)
            return result;
        const rows = partialEraRows(q);
        if (rows.length === 1)
            return { kind: 'ok', era: '', year: null, rows: rows, autoEraPreview: true };
        if (rows.length > 1)
            return { kind: 'preview-multiple', autoEraPreview: true };
        return { kind: 'no-era', autoEraPreview: true };
    }
    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls)
            n.className = cls;
        if (text != null)
            n.textContent = text;
        return n;
    }
    // 起止年任一端不确定（表里为 null）→ 一律显示「未知」。
    // 不能拿已知的那一端当整段（夏商那些只留下王名、年份不可考的条目）。
    function yearsUnknown(r) {
        return !Number.isFinite(r && r.start) || !Number.isFinite(r && r.end);
    }
    function fmtRange(r) {
        if (yearsUnknown(r))
            return '未知';
        // 前 841 年（共和纪年起点）之前的年份各加「约」
        const a = D.formatYearApprox(r.start);
        const b = D.formatYearApprox(r.end);
        if (b === a)
            return a + '年';
        return a + '-' + b + '年';
    }
    // 表里第 6 列：这个年号在 start 那一年已经是第几年。缺省 1（start 就是第 1 年）时返回空串。
    // 显示成「起12年」放在公历年下面，免得把「968-973年」误读成 968 就是第 1 年。
    function epochLabel(row) {
        const off = Number(row && row.offset);
        return Number.isFinite(off) && off > 1 ? '起' + Math.floor(off) + '年' : '';
    }
    // 「这个年号下每一年」：从第 1 年开始逐个数，直到超过表里的 end。
    // 表里第 6 列 offset = 「start 那一年已经是第几年」（天會：968 是十二年 → 第 1 年 = 957），
    // 所以最大年数 = offset + (end - start)。start / end 不可知（夏商那些只有王名的 44 条）→
    // 返回 null，那一行不给展开。全表最长的年号是 64 年（齊·前莊公），逐条枚举很便宜。
    function yearListOf(row) {
        if (yearsUnknown(row))
            return null;
        const off = Number.isFinite(row.offset) && row.offset >= 1 ? Math.floor(row.offset) : 1;
        const max = off + (row.end - row.start);
        if (!Number.isFinite(max) || max < 1)
            return null;
        const out = [];
        for (let n = 1; n <= max; n++) {
            const year = D.eraYear(row.start, n, off);
            if (!Number.isFinite(year) || year > row.end)
                break;
            out.push({ n: n, year: year, gz: D.ganzhiOf(year) });
        }
        return out.length ? out : null;
    }
    // 点一下年号行 → 在它下面插入「该年号每一年」：左边纪年，右边「年份 + 干支」（两者隔 1em）。
    // 再点一下收起。展开块用 insertAdjacentElement 插在行后面，所以同时展开好几行也不会串位。
    function makeExpandable(rowEl, row, eraName) {
        const list = yearListOf(row);
        if (!list)
            return;
        rowEl.classList.add('sp-row-expand');
        rowEl.setAttribute('role', 'button');
        rowEl.setAttribute('aria-expanded', 'false');
        let box = null;
        rowEl.addEventListener('click', function () {
            if (rowEl.getAttribute('aria-expanded') === 'true') {
                rowEl.setAttribute('aria-expanded', 'false');
                if (box) {
                    box.remove();
                    box = null;
                }
                return;
            }
            rowEl.setAttribute('aria-expanded', 'true');
            if (box)
                return;
            box = el('div', 'sp-yearlist');
            for (const it of list) {
                const line = el('div', 'sp-yearlist-item');
                line.appendChild(el('span', 'sp-yearlist-era', eraName + yearLabel(it.n) + '年'));
                const right = el('span', 'sp-yearlist-val');
                right.appendChild(el('span', 'sp-yearlist-greg', D.formatYearApprox(it.year)));
                right.appendChild(el('span', 'sp-yearlist-gz', it.gz));
                line.appendChild(right);
                box.appendChild(line);
            }
            rowEl.insertAdjacentElement('afterend', box);
        });
    }
    // 一条「年号」行：左边年号，右边起止年（+「起 N 年」）。行本身可以再点开看这个年号的每一年。
    function eraRow(r) {
        const row = el('div', 'sp-row');
        const left = el('div', 'sp-row-left');
        left.appendChild(el('span', 'sp-era', r.name));
        row.appendChild(left);
        const right = el('div', 'sp-year');
        right.appendChild(document.createTextNode(fmtRange(r)));
        const epoch = epochLabel(r);
        if (epoch)
            right.appendChild(el('span', 'sp-epoch', epoch));
        row.appendChild(right);
        makeExpandable(row, r, r.name);
        return row;
    }
    // 帝号行：点开 = 列出该帝号下的**所有年号**（那些年号行本身还能再点开看每年）。
    // 搜朝代（「西漢」）或重名帝号（「武帝」）时，结果面板列的就是这些行。
    function makeEmperorExpandable(rowEl, it) {
        const eras = EraSearch.erasOfEmperor(it.dynasty, it.emperor);
        if (!eras.length)
            return;
        rowEl.classList.add('sp-row-expand');
        rowEl.setAttribute('role', 'button');
        rowEl.setAttribute('aria-expanded', 'false');
        let box = null;
        rowEl.addEventListener('click', function () {
            if (rowEl.getAttribute('aria-expanded') === 'true') {
                rowEl.setAttribute('aria-expanded', 'false');
                if (box) {
                    box.remove();
                    box = null;
                }
                return;
            }
            rowEl.setAttribute('aria-expanded', 'true');
            if (box)
                return;
            box = el('div', 'sp-eralist');
            for (const r of eras)
                box.appendChild(eraRow(r));
            rowEl.insertAdjacentElement('afterend', box);
        });
    }
    function render(res) {
        // 放在最前面：下面大多数分支都会提前 return，挂末尾会有分支漏掉。
        updateStepButtons(res);
        outEl.textContent = '';
        if (res.kind === 'idle') {
            const hint = el('div', 'sp-empty');
            hint.appendChild(el('div', '', '输入支持：'));

            // 列表容器
            const ul = document.createElement('ul');
            ul.style.marginTop = '6px';
            ul.style.paddingLeft = '20px';

            function addItem(label, value) {
                const li = document.createElement('li');

                const strong = document.createElement('strong');
                strong.textContent = label + '：';

                li.appendChild(strong);
                li.appendChild(document.createTextNode(value));

                ul.appendChild(li);
            }

            addItem('公元年', '104、104年、BC104、bc104、前104、公元前104');
            addItem('年号', '太初、太初元年、武帝太初元年、汉武帝太初元年、康熙甲子年');
            addItem('帝号', '武帝、汉武帝');
            addItem('朝代', '汉、西汉');

            hint.appendChild(ul);
            outEl.appendChild(hint);
            return;
        }
        if (res.kind === 'preview-multiple') {
            // 未完成输入匹配到多个年号时不自动展示候选；让用户继续输入或通过提示框选择。
            return;
        }
        if (res.kind === 'no-era') {
            outEl.appendChild(el('div', 'sp-empty', res.autoEraPreview
                ? '没有匹配的年号名称。'
                : '未查询到该年号，请重新输入。'));
            return;
        }
        if (res.kind === "who-list") {
            // 搜朝代 / 重名帝号：列出所有匹配的帝号，点开看该帝号下的年号。
            // 同一朝代时行里只写帝号（朝代在输入框里已经写了）；跨朝代（「武帝」）才带上朝代。
            const sameDyn = res.list.length > 0 && res.list.every(function (x) {
                return x.dynasty === res.list[0].dynasty;
            });
            for (const it of res.list) {
                const row = el("div", "sp-row");
                row.setAttribute("data-dynasty", it.dynasty);
                row.setAttribute("data-emperor", it.emperor);
                const left = el("div", "sp-row-left");
                left.appendChild(el("span", "sp-era",
                    sameDyn ? it.emperor : it.dynasty + " · " + it.emperor));
                row.appendChild(left);
                const eras = EraSearch.erasOfEmperor(it.dynasty, it.emperor);
                const right = el("div", "sp-year");
                if (eras.length)
                    right.appendChild(el("span", "sp-era-count", eras.length + " 个年号"));
                row.appendChild(right);
                outEl.appendChild(row);
                makeEmperorExpandable(row, it);
            }
            return;
        }
        if (res.kind === "none") {
            outEl.appendChild(el('div', 'sp-err', '年号表里没有「' + res.era + '」。'));
            return;
        }
        if (res.kind === 'none-who') {
            outEl.appendChild(el('div', 'sp-err', '输入错误，未查询到相关纪年。'));
            return;
        }
        if (res.kind === 'year-out') {
            // 帝号和这一处的年号同名时不再重复写（见 D.whoText）
            const spans = res.rows.map(function (r) {
                return D.whoText(r.dynasty, r.emperor, '', r.name) + '：' + fmtRange(r);
            });
            outEl.appendChild(el('div', 'sp-err',
                '「' + res.era + '」' + (res.who ? '在「' + res.who + '」名下' : '') +
                '没有第' + yearLabel(res.year) + '年。请重新输入'));
            return;
        }
        if (res.kind === 'year-none') {
            outEl.appendChild(el('div', 'sp-empty',
                '公元 ' + D.formatYear(res.year) + ' 年没有对应的年号（可能超出年号表的范围）。'));
            return;
        }
        if (res.kind === 'ganzhi-out') {
            outEl.appendChild(el('div', 'sp-err', '输入错误，未查询到相关纪年。'));
            return;
        }
        if (res.kind === 'year') {
            // 第一行之前先给一条提示：年份 - 干支
            const head = el('div', 'sp-year-head');
            head.appendChild(el('b', 'sp-year-num', D.formatYear(res.year) + '年'));
            head.appendChild(el('span', 'sp-year-sep', '-'));
            head.appendChild(el('span', 'sp-year-gz', D.ganzhiOf(res.year)));
            outEl.appendChild(head);
            for (const item of res.rows) {
                const r = item.row;
                const row = el('div', 'sp-row');
                // 一行读完：朝代 · 帝号 · 年号+纪年（如「唐 · 太宗 · 貞觀五年」）。
                // 查的就是这个年份，表头已经写了，行里不再重复年份；
                // 该年号的起止年放到 title 里，需要时悬停看。
                row.title = fmtRange(r);
                // 朝代只去掉末尾的「朝」（唐朝→唐）；不用 EraSearch.shortDynasty ——
                // 那个是给匹配用的简称（東晉→晉、前涼→涼），显示太短。
                const dynasty = String(r.dynasty || '').replace(/[朝]$/, '');
                const yearNum = yearLabel(item.n);   // 第 1 年走特例，见 yearLabel
                const left = el('div', 'sp-row-left');
                left.appendChild(el('span', 'sp-era',
                    D.whoText(dynasty, r.emperor, r.name + yearNum + '年', r.name) || '（无朝代信息）'));
                row.appendChild(left);
                outEl.appendChild(row);
                // 已经精确到某一年时，结果行不再展开整条年号的逐年列表。
            }
            return;
        }
        if (res.kind === "emperor") {
            for (const r of res.rows)
                outEl.appendChild(eraRow(r));
            return;
        }
        for (const r of res.rows) {
            const row = el('div', 'sp-row');
            if (res.year)
                row.title = fmtRange(r);
            const left = el('div', 'sp-row-left');
            left.appendChild(el('span', 'sp-era', r.name + (res.year ? yearLabel(res.year) + '年' : '')));
            // 上面 sp-era 已经写了年号，帝号跟它同名时这一行只留朝代
            left.appendChild(el('span', 'sp-meta', D.whoText(r.dynasty, r.emperor, '', r.name) || '（无朝代信息）'));
            row.appendChild(left);
            const right = el('div', 'sp-year');
            // 起止年任一端不确定 → 不换算公历年，直接显示「未知」。
            if (res.year && !yearsUnknown(r)) {
                const y = D.eraYear(r.start, res.year, r.offset);
                right.appendChild(document.createTextNode(D.formatYearApprox(y)));
                right.appendChild(el('span', 'sp-greg', D.ganzhiOf(y)));
            }
            else {
                right.appendChild(document.createTextNode(fmtRange(r)));
            }
            const epoch = epochLabel(r);
            if (epoch)
                right.appendChild(el('span', 'sp-epoch', epoch));
            row.appendChild(right);
            outEl.appendChild(row);
            // 有明确纪年时结果已经精确到某一年；只有单查年号时才允许展开逐年列表。
            if (!res.year)
                makeExpandable(row, r, r.name);
        }
    }
    const sugEl = document.getElementById("sp-sug");
    let sugItems = [];
    let sugOn = -1;
    // applySug() 刚被调用过 → 下一次 input 不要弹框（见 applySug 里的注释）。
    let sugSuppress = false;
    function pickEmperor(text) {
        const raw = EraSearch.stripYearTail(text);
        if (!raw)
            return null;
        const list = EraSearch.emperors(raw, 30);
        if (!list.length)
            return null;
        const folded = EraSearch.fold(raw);
        const withDyn = list.filter(function (x) {
            const dy = EraSearch.fold(x.dynasty);
            const short = EraSearch.fold(EraSearch.shortDynasty(x.dynasty));
            return (dy && folded.indexOf(dy) >= 0) || (short && folded.indexOf(short) >= 0);
        });
        const pool = withDyn.length ? withDyn : list;
        return pool.length === 1 ? pool[0] : null;
    }
    function hideSug() {
        if (sugEl) {
            sugEl.hidden = true;
            sugEl.textContent = "";
        }
        sugItems = [];
        sugOn = -1;
    }
    // 把「年号候选」画进建议框：先列 search() 的结果，再补上「更长的同前缀年号」。
    // 「天授」→「天授禮法延祚」：search() 按「包含」匹配，一般已经把它们带上了，
    // 这里补一遍主要是兜底 —— 免得同前缀的短年号条数把 12 条上限占满、更长的那个被截掉。
    //
    // 每一项带一个 `value` = 点下去要写进输入框的东西。
    // **什么时候要把朝代拼进去**（两个条件满足其一，且这一项有朝代）：
    //   · 这一项的名字**就是用户当前输入的那一段**（`name === frag`）—— 光写年号名点下去
    //     输入框一字不变，等于没点。这一条不论该年号在表里有几条都成立，所以不能只留后面那条。
    //   · 或者同名年号在表里有多条 —— 不拼朝代收窄不到那一条（太初有 5 个朝代）。
    // **其余情况只写年号名**，保住「武周天授 点天授禮法延祚 → 武周天授禮法延祚」的前缀保留
    // （README 5.5）：`applySug` 是「替换末尾片段」拼的，若写成「西夏天授禮法延祚」会拼成
    // 「武周西夏天授禮法延祚」。
    function pickValue(name, dynasty, frag) {
        if (!dynasty)
            return name;
        const needDynasty = name === frag || D.lookupEra(name).length > 1;
        return needDynasty ? dynasty + name : name;
    }
    function renderEraPicks(rows, frag) {
        sugEl.textContent = "";
        const picks = rows.map(function (r) {
            const name = String(r.name || '');
            const dynasty = String(r.dynasty || '');
            return { name: name, dynasty: r.dynasty, emperor: r.emperor, value: pickValue(name, dynasty, frag) };
        });
        const haveName = Object.create(null);
        for (const it of picks)
            haveName[EraSearch.fold(it.name)] = 1;
        for (const nm of EraSearch.extensions(frag, 12)) {
            const key = EraSearch.fold(nm);
            if (haveName[key])
                continue;
            haveName[key] = 1;
            const row = D.lookupEra(nm)[0];
            const dynasty = row ? String(row.dynasty || '') : '';
            picks.push({
                name: nm,
                dynasty: row ? row.dynasty : '',
                emperor: row ? row.emperor : '',
                value: pickValue(nm, dynasty, frag)
            });
        }
        sugItems = picks.map(function (it) { return it.value; });
        sugOn = -1;
        picks.forEach(function (it, i) {
            const item = el("div", "sp-sug-item");
            item.appendChild(el("b", null, it.name));
            // 前面 <b> 已经写了年号名，帝号跟它同名时这里只留朝代
            const meta = D.whoText(it.dynasty, it.emperor, '', it.name);
            if (meta)
                item.appendChild(el("span", "sp-sug-meta", meta));
            item.addEventListener("mousedown", function (e) {
                e.preventDefault();
                applySug(picks[i].value);
            });
            item.setAttribute("data-i", String(i));
            sugEl.appendChild(item);
        });
        try {
            const b = qEl.getBoundingClientRect();
            const h = document.body.getBoundingClientRect();
            sugEl.style.top = (b.bottom - h.top + 4) + "px";
        }
        catch (e) { }
        sugEl.hidden = false;
    }
    // 输入的年号片段「正好落在输入末尾」时，返回它还作为前缀的更长年号
    // （「天授」→「天授禮法延祚」、「太平」→「太平真君」）。三个前提：
    //   1) 片段落在输入末尾 —— 后面还跟着纪年 / 干支（「建武三年」）不算：用户已经把年号定下来了，
    //      而且 applySug 是按「替换末尾片段」拼的，片段不在末尾会把纪年拼坏。
    //   2) **按「输入词优先当年号」处理**（用户 2026-10-12 明确要求）：
    //      输入本身是完整年号（建武 / 太平），**或者**它确实是一个更长年号的开头（天授 是 天授禮法延祚 的开头），
    //      都算「用户在打年号」，弹年号候选框。
    //      ⚠️ 唯一的例外：这个片段同时还能对上帝号（`emperors()` 非空）时让位给帝号建议。
    //      全表有 308 个「不是完整年号但是年号前缀」的串，其中 221 个能对上帝号 ——
    //      全是「武」「太」「貞」「文」「成」这种半截字。不放这个闸，「武」会从
    //      「西漢 · 武帝…」变成一串年号（用户反馈过这个 bug）。
    //   3) 确实存在更长的同前缀年号。
    function extensionPicks(frag) {
        const cur = String(qEl.value || '');
        if (!frag || cur.slice(-frag.length) !== frag)
            return [];
        if (!D.lookupEra(frag).length && EraSearch.emperors(frag, 5).length)
            return [];
        return EraSearch.extensions(frag, 12);
    }
    function showSug(frag) {
        if (!sugEl)
            return;
        const rawForWho = EraSearch.stripYearTail(qEl.value);
        // 朝代选择框：只在**匹配到多个朝代**时弹（「唐」→ 唐/唐其他/後唐/南唐）。
        // 只匹配到一个（「西漢」）就不弹，直接看结果（用户 2026-10-12 要求）。
        const dyns = matchingDynasties(rawForWho);
        if (dyns.length > 1) {
            sugEl.textContent = "";
            sugItems = [];
            sugOn = -1;
            for (const dy of dyns) {
                const item = el("div", "sp-sug-item");
                item.appendChild(el("b", null, dy));
                item.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    applySug(dy, true);
                });
                item.setAttribute("data-i", String(sugItems.length));
                sugItems.push(dy);
                sugEl.appendChild(item);
            }
            try {
                const bd = qEl.getBoundingClientRect();
                const hd = document.body.getBoundingClientRect();
                sugEl.style.top = (bd.bottom - hd.top + 4) + "px";
            }
            catch (e) { }
            sugEl.hidden = false;
            return;
        }
        const emps = EraSearch.emperors(rawForWho, 8);
        const rows = EraSearch.search(frag, 12);
        const rawText = EraSearch.fold(EraSearch.stripYearTail(qEl.value));
        const specific = !!pickEmperor(qEl.value);
        // 「天授」这类：输入本身是个**完整年号**，但它还是别的更长年号的开头（天授禮法延祚）。
        // 这时给「年号候选」框让用户挑，排在帝号建议之前 —— 否则「太平」会先命中
        // 「太平天國」的帝号（洪秀全），弹出一串帝号反而没有年号可选。
        // 注意半截输入（「武」「太」）不会走到这里：extensionPicks 要求 lookupEra(frag) 命中。
        if (extensionPicks(frag).length) {
            renderEraPicks(rows, frag);
            return;
        }
        if (emps.length && !specific) {
            sugEl.textContent = "";
            sugItems = [];
            sugOn = -1;
            const addItem = function (label, sub, value) {
                const item = el("div", "sp-sug-item");
                item.appendChild(el("b", null, label));
                if (sub)
                    item.appendChild(el("span", "sp-sug-meta", sub));
                item.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    applySug(value, true);
                });
                item.setAttribute("data-i", String(sugItems.length));
                sugItems.push(value);
                sugEl.appendChild(item);
            };
            for (const x of emps)
                addItem(x.dynasty + " · " + x.emperor, "", x.dynasty + x.emperor);
            try {
                const b2 = qEl.getBoundingClientRect();
                const h2 = document.body.getBoundingClientRect();
                sugEl.style.top = (b2.bottom - h2.top + 4) + "px";
            }
            catch (e) { }
            sugEl.hidden = false;
            return;
        }
        if (specific) {
            const one = emps[0];
            const mine = EraSearch.erasOfEmperor(one.dynasty, one.emperor);
            if (mine.length) {
                sugEl.textContent = "";
                sugItems = mine.map(function (x) { return x.name; });
                sugOn = -1;
                mine.forEach(function (x, i) {
                    const item = el("div", "sp-sug-item");
                    item.appendChild(el("b", null, x.name));
                    item.appendChild(el("span", "sp-sug-meta", fmtRange(x)));
                    item.addEventListener("mousedown", function (e) {
                        e.preventDefault();
                        applySug(x.name, true);
                    });
                    item.setAttribute("data-i", String(i));
                    sugEl.appendChild(item);
                });
                try {
                    const b3 = qEl.getBoundingClientRect();
                    const h3 = document.body.getBoundingClientRect();
                    sugEl.style.top = (b3.bottom - h3.top + 4) + "px";
                }
                catch (e) { }
                sugEl.hidden = false;
                return;
            }
        }
        if (!rows.length) {
            const emps = EraSearch.emperors(frag, 12);
            if (!emps.length) {
                hideSug();
                return;
            }
            sugEl.textContent = "";
            sugItems = emps.map(function (x) { return x.dynasty + x.emperor; });
            sugOn = -1;
            emps.forEach(function (x, i) {
                const item = el("div", "sp-sug-item");
                item.appendChild(el("b", null, x.dynasty + " · " + x.emperor));
                item.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    applySug(x.dynasty + x.emperor, true);
                });
                item.setAttribute("data-i", String(i));
                sugEl.appendChild(item);
            });
            try {
                const b = qEl.getBoundingClientRect();
                const h = document.body.getBoundingClientRect();
                sugEl.style.top = (b.bottom - h.top + 4) + "px";
            }
            catch (e) { }
            sugEl.hidden = false;
            return;
        }
        renderEraPicks(rows, frag);
    }
    function applySug(name, clearFirst) {
        const cur = qEl.value || "";
        if (clearFirst) {
            qEl.value = name;
        }
        else {
            const frag = EraSearch.fragmentOf(cur);
            qEl.value = frag ? cur.slice(0, cur.length - frag.length) + name : name;
        }
        hideSug();
        qEl.focus();
        // 用户刚**明确点过一项**：紧接着这次 input 不要再把建议框弹回来。
        // 少了这句，「太平」点第一条 → 输入变「吳太平」→ 末尾片段还是「太平」、仍有
        // 「太平真君」可提示 → 框立刻又弹出来，用户看到的是「提示框没消失」。
        // 只挡这一次；后面真的打字（新的 input 事件）照常能弹。
        sugSuppress = true;
        qEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function moveSug(d) {
        if (!sugItems.length)
            return;
        sugOn = (sugOn + d + sugItems.length) % sugItems.length;
        Array.prototype.forEach.call(sugEl.children, function (c, i) {
            if (i === sugOn)
                c.classList.add("sp-sug-on");
            else
                c.classList.remove("sp-sug-on");
        });
    }
    function renderQuery() {
        try {
            render(searchOutput(qEl.value));
        }
        catch (e) {
            outEl.textContent = '';
            outEl.appendChild(el('div', 'sp-err', '查询出错：' + ((e && e.message) || e)));
        }
    }
    let timer = null;
    function run() {
        clearTimeout(timer);
        timer = setTimeout(renderQuery, 120);
    }
    qEl.addEventListener('input', function () {
        run();
        // 刚点过建议项：这次输入是 applySug() 触发的，别再弹框（结果面板照常刷新，run() 已经在上面了）。
        if (sugSuppress) {
            sugSuppress = false;
            hideSug();
            return;
        }
        // 判断「要不要弹帝号选择框」时**不能只看 search() 返回的 kind**。
        // 「太宗」「太祖」「高祖」这些既是帝号、又恰好是表里某些条目的**年号名**
        // （蒙古·太宗·太宗、遼·太祖·太祖、西漢·高祖·高祖…），parseQuery 会先把它当年号，
        // search() 于是走年号分支，返回的 kind 不是 'emperor' —— 建议框就被下面那句 hideSug() 吞掉了。
        // 直接数帝号候选：多于一个就说明用户多半是想挑「哪个朝代的太宗」。
        // 注意顺序仍由 showSug() 决定：输入本身是完整年号且有更长的同前缀年号（天授→天授禮法延祚）时，
        // 那里会先渲染「年号候选」框，不受这里影响。
        //
        // ⚠️ 例外：结果面板本身已经是「帝号列表」（`kind === 'who-list'`，搜朝代 / 重名帝号）时不再弹框 ——
        // 框里列的和面板里列的是同一批帝号，而且框是绝对定位、正好盖在面板顶上（把前几行挡住）。
        let res = null;
        try {
            res = search(qEl.value);
        }
        catch (e) {
            res = null;
        }
        if (res && res.strictInvalid) {
            hideSug();
            return;
        }
        // ⚠️ `who-list` 只有 `list`、没有 `rows`，两边都要看，否则会把它当成「没结果」。
        const hasRows = !!(res && ((res.rows && res.rows.length > 0) || (res.list && res.list.length > 0)));
        const isWhoList = !!(res && res.kind === 'who-list');
        // 匹配到多个朝代（「唐」）→ 弹朝代选择框；面板已经默认显示第一个朝代的帝号了。
        const multiDyn = !!(res && res.multiDyn);
        const isWho = !isWhoList && !multiDyn && EraSearch.emperors(EraSearch.stripYearTail(qEl.value), 30).length > 1;
        const onlyDyn = multiDyn;
        const frag = EraSearch.fragmentOf(qEl.value);
        // 「天授」这类：输入本身就是一个年号，但它还是别的更长年号的开头（天授禮法延祚）。
        // 这时即使已经有结果，也要弹建议框，让用户能选到更长的那个。
        const exts = extensionPicks(frag);
        if (!isWho && !onlyDyn && !exts.length && hasRows) {
            hideSug();
            return;
        }
        if (frag)
            showSug(frag);
        else
            hideSug();
    });
    qEl.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            moveSug(1);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveSug(-1);
            return;
        }
        if (e.key === 'Escape') {
            hideSug();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (sugOn >= 0 && sugItems[sugOn])
                applySug(sugItems[sugOn]);
            else {
                hideSug();
                run();
            }
        }
    });
    qEl.addEventListener('blur', function () { setTimeout(hideSug, 120); });
    let outsideTimer = null;
    document.addEventListener('mousemove', function (e) {
        if (sugEl.hidden)
            return;
        const t = e.target;
        const inside = (t && (t === qEl || (t.closest && t.closest('#sp-sug')))) ||
            (t === qEl) || (sugEl.contains(t));
        if (inside) {
            if (outsideTimer) {
                clearTimeout(outsideTimer);
                outsideTimer = null;
            }
            return;
        }
        if (outsideTimer)
            return;
        outsideTimer = setTimeout(function () {
            outsideTimer = null;
            hideSug();
        }, 200);
    });
    // ---- 输入框右侧的 < / >：按年跳转 ----
    // 年份直接 ±1。年号按「同年号 → 同帝号 → 同朝代」找上/下一个，到朝代边界就停。
    // 该年号的最后一年（年份不可考 / 数据颠倒时算不出，返回 null）。
    function lastYearOf(row) {
        const start = row && row.start;
        const end = row && row.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
            return null;
        let n = 1;
        while (D.eraYear(start, n + 1, row.offset) <= end)
            n++;
        return n;
    }
    // 一个分组内的年号按时间先后排。表里主朝代的顺序本来就对，只有十六國 / 南北朝
    // 这类合称朝代内部有十来处逆序，而且夏商那些 start 是 null。
    // 做法：start 为 null 的沿用「它前面最近一个已知 start」，再按这个键稳定排序 ——
    // 这样夏商那串王名不会被排乱，逆序的也能纠正过来。
    function orderedEras(list) {
        let last = -Infinity;
        const keyed = list.map(function (row, i) {
            const known = Number.isFinite(row.start);
            const key = known ? row.start : last;
            if (known)
                last = row.start;
            return { row: row, key: key, i: i };
        });
        keyed.sort(function (a, b) { return a.key === b.key ? a.i - b.i : a.key - b.key; });
        return keyed.map(function (x) { return x.row; });
    }
    function siblings(row, sameEmperor) {
        return orderedEras(D.ERAS.filter(function (e) {
            return e.dynasty === row.dynasty && (!sameEmperor || e.emperor === row.emperor);
        }));
    }
    // 同一分组里往前 / 往后一格（按身份找，年号重名的行也能分清）；没有就 null。
    function neighbour(row, sameEmperor, dir) {
        const list = siblings(row, sameEmperor);
        const i = list.indexOf(row);
        if (i < 0)
            return null;
        return list[i + dir] || null;
    }
    // 跳过去之后输入框里写什么：朝代简称 + 帝号 + 年号 + 纪年（如「唐太宗贞观四年」）。
    // 这套写法 sidepanel 的 parseQuery 认，能原样查回来。
    function eraQuery(row, year) {
        const short = EraSearch.shortDynasty(row.dynasty) || row.dynasty || '';
        return short + (row.emperor || '') + row.name + yearLabel(year) + '年';
    }
    // 当前停在哪：{ gregorian } 或 { row, year }；认不出就 null（按钮置灰）。
    function positionOf(res) {
        if (!res)
            return null;
        if (res.kind === 'year' && Number.isFinite(res.year))
            return { gregorian: res.year };
        if (res.kind === 'ok' && res.rows && res.rows.length && Number.isFinite(res.year) && res.year >= 1)
            return { row: res.rows[0], year: res.year };
        return null;
    }
    // dir = -1 上一年 / +1 下一年；跳不动返回 null。
    function stepPosition(pos, dir) {
        if (!pos)
            return null;
        if (Number.isFinite(pos.gregorian)) {
            const y = pos.gregorian;
            // 公历没有 0 年：前1年 的下一年是 1年，1年 的上一年是前1年。
            const next = dir > 0 ? (y === -1 ? 1 : y + 1) : (y === 1 ? -1 : y - 1);
            return { query: D.formatYear(next) };
        }
        const row = pos.row;
        const last = lastYearOf(row);
        if (dir < 0) {
            if (pos.year > 1)
                return { query: eraQuery(row, pos.year - 1) };
            // 本年年号到头 → 同帝号的上一个年号（最后一年）→ 同朝代的上一个年号。
            const prev = neighbour(row, true, -1) || neighbour(row, false, -1);
            if (!prev)
                return null;                                  // 这个朝代已经到第一年
            return { query: eraQuery(prev, lastYearOf(prev) || 1) };
        }
        if (last !== null && pos.year < last)
            return { query: eraQuery(row, pos.year + 1) };
        const next = neighbour(row, true, 1) || neighbour(row, false, 1);
        if (!next)
            return null;                                      // 这个朝代已经到最后一年
        return { query: eraQuery(next, 1) };
    }
    function stepBy(dir) {
        const next = stepPosition(positionOf(search(qEl.value)), dir);
        if (!next)
            return false;
        qEl.value = next.query;
        hideSug();
        renderQuery();          // 长按连续跳转要立刻看到结果，不能走 120ms 防抖
        return true;
    }
    function updateStepButtons(res) {
        if (!prevBtn && !nextBtn)
            return;
        const pos = positionOf(res);
        if (prevBtn)
            prevBtn.disabled = !stepPosition(pos, -1);
        if (nextBtn)
            nextBtn.disabled = !stepPosition(pos, 1);
    }
    // 按下先走一步；按住 400ms 后每 90ms 再走一步（长按连续跳转）。
    function bindStepButton(btn, dir) {
        if (!btn)
            return;
        let delayTimer = 0;
        let repeatTimer = 0;
        function stop() {
            clearTimeout(delayTimer);
            clearInterval(repeatTimer);
            delayTimer = 0;
            repeatTimer = 0;
        }
        btn.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            stop();
            stepBy(dir);
            delayTimer = setTimeout(function () {
                delayTimer = 0;
                repeatTimer = setInterval(function () { stepBy(dir); }, 90);
            }, 400);
        });
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
        window.addEventListener('blur', stop);
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            // pointerdown 已经处理过鼠标点击；只有键盘触发的 click（detail === 0）补一步。
            if (e.detail === 0)
                stepBy(dir);
        });
    }
    bindStepButton(prevBtn, -1);
    bindStepButton(nextBtn, 1);
    render({ kind: 'idle' });
    qEl.focus();
})();
