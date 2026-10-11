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
    const GANZHI_PART = '(?:[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])';
    const SP = '[ \\t\\u3000]*';
    const RANGE_TAIL = '(?=[，,\\n\\r]|$)';
    function buildRegex(opts) {
        const standalone = !!(opts && opts.standalone);
        const parts = [
            '(?<eraG>' + NAME_PART + ')' + SP + '(?<gz>' + GANZHI_PART + ')' + SP + '年',
            '(?<era>' + NAME_PART + ')' + SP + '(?<num>' + NUM_PART + ')' + SP + '年',
        ];
        // 改元 + 年号
        parts.push('(?<=改元)' + SP + '(?<eraC>' + NAME_PART + ')');
        if (opts && opts.range) {
            parts.push('(?<eraR>' + NAME_PART + ')' + SP + '年(?:间|間|中|初|末)', '(?<eraM>' + NAME_PART + ')' + SP + '(?:中|初|末)' + RANGE_TAIL);
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
    // 与 buildRegex 的 eraR/eraM 分支保持一致：简繁两种「间」都要算范围写法。
    const RANGE_FORM = /(?:年[间間]|中|初|末)$/;
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
        ganzhiOf: ganzhiOf,
        ganzhiOffsetIn: ganzhiOffsetIn,
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
