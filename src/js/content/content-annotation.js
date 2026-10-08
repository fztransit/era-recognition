(function (global) {
    'use strict';
    const C = global.EraHL;
    if (!C)
        return;
    const D = C.D;
    const R = C.runtime;
    const OVERRIDE = function () { return R.overrides || (R.overrides = {}); };
    const FIXES = function () { return R.eraFixes || (R.eraFixes = {}); };
    // 这条候选的「纪年起点偏移」：start 那一年是第几年（表里第 6 列，缺省 1）。
    // 天會(968~973, offset 12)：十二年 = 968。
    function eraOffsetOf(info) {
        const off = Number(info && info.eraOffset);
        return Number.isFinite(off) && off >= 1 ? off : 1;
    }
    // 由「公元年」反推「纪年数」：n = year - start + offset。
    function eraCountOf(info, year) {
        if (!info || !Number.isFinite(year) || !Number.isFinite(info.eraStart))
            return NaN;
        return year - info.eraStart + eraOffsetOf(info);
    }
    function yearOf(info, n, gz) {
        if (gz && info && Number.isFinite(info.eraStart)) {
            const offset = D.ganzhiOffsetIn(info.eraStart, info.eraEnd, gz);
            return offset < 0 ? null : info.eraStart + offset;
        }
        if (info && Number.isFinite(info.eraStart) && Number.isFinite(n) && n >= 1) {
            return D.eraYear(info.eraStart, n, eraOffsetOf(info));
        }
        return info && Number.isFinite(info.gregorian) ? info.gregorian : null;
    }
    // 这条候选有没有可用的年份信息（能不能算出公元年）。
    // 年号表里起止年任一端不可考（null）→ 没有，标注和卡片都显示「？」。
    // 例外：AI 结果不带年号起止年，但自带一个具体公历年，那种照常显示年份。
    // 注意 Number.isFinite(null) === false，所以 null / undefined / NaN 都能挡住。
    function eraYearsKnown(info) {
        if (!info)
            return false;
        // 年号明确，但所写干支不在该年号有效范围内：
        // 年号本身仍有起止年，具体这一年的公元年却不能确定。
        if (info.ganzhiOutOfRange)
            return false;
        if (!Number.isFinite(info.eraStart))
            return Number.isFinite(info.gregorian);
        return Number.isFinite(info.eraEnd);
    }
    function candidateOf(era, n) {
        if (!era)
            return null;
        const hasStart = Number.isFinite(era.start);
        const offset = Number.isFinite(era.offset) && era.offset >= 1 ? era.offset : 1;
        const gregorian = hasStart && Number.isFinite(n) && n >= 1 ? D.eraYear(era.start, n, offset) : null;
        return {
            era: era.name,
            dynasty: era.dynasty,
            emperor: era.emperor,
            input: era.name,
            alias: null,
            n: Number.isFinite(n) ? n : null,
            eraStart: hasStart ? era.start : null,
            eraEnd: Number.isFinite(era.end) ? era.end : null,
            eraOffset: offset,
            gregorian: gregorian
        };
    }
    function candidatesOf(mark) {
        if (!mark)
            return [];
        const stamp = function (list) {
            if (!mark.__eraRange)
                return list;
            return list.map(function (item) {
                return item && item.range ? item : Object.assign({}, item, { range: true });
            });
        };
        const fixes = FIXES();
        const fix = fixes[mark.__eraKey];
        if (fix) {
            const rows = D.lookupEra(fix.era) || [];
            if (rows.length)
                return stamp(rows.map(function (row) { return candidateOf(row, mark.__eraN); }));
        }
        if (!mark.__eraRange && mark.__eraPrevEl && mark.__eraPrevEl.isConnected) {
            return candidatesOf(mark.__eraPrevEl);
        }
        const own = Array.isArray(mark.__eraInfo) ? mark.__eraInfo : [];
        if (own.length && mark.getAttribute && mark.getAttribute('data-era-source') === 'ai') {
            if (mark.__eraRange) {
                const rows = D.lookupEra(own[0].era) || [];
                if (rows.length) {
                    const wanted = String(own[0].dynasty || '').trim();
                    let pool = rows;
                    if (wanted) {
                        const filtered = rows.filter(function (row) {
                            const dynasty = String(row.dynasty || '');
                            return dynasty === wanted || dynasty.indexOf(wanted) >= 0 || wanted.indexOf(dynasty) >= 0;
                        });
                        if (filtered.length)
                            pool = filtered;
                    }
                    return pool.map(function (row) {
                        const item = candidateOf(row, null);
                        item.range = true;
                        return item;
                    });
                }
            }
            const name = own[0].era;
            const rows = name ? D.lookupEra(name) : [];
            if (rows.length > 1) {
                const extra = rows.filter(function (row) {
                    return !own.some(function (item) {
                        return item.dynasty === row.dynasty && Number(item.gregorian) === Number(row.start);
                    });
                }).map(function (row) { return candidateOf(row, null); });
                return own.concat(extra);
            }
        }
        return stamp(own);
    }
    function overrideOf(mark) {
        if (!mark || !mark.__eraKey)
            return null;
        const index = OVERRIDE()[mark.__eraKey];
        return typeof index === 'number' ? index : null;
    }
    function cnNum(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 1 || n > 99)
            return String(value);
        const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        if (n < 10)
            return digits[n];
        if (n === 10)
            return '十';
        if (n < 20)
            return '十' + digits[n - 10];
        return digits[Math.floor(n / 10)] + '十' + (n % 10 ? digits[n % 10] : '');
    }
    // 年号后面那一截（纪年 / 「年间」/ 干支）里，只有「间、闰」有简繁差异，
    // 其余（年、元、中、初、末、数字、干支）简繁同形，不需要动。
    const TAIL_TRAD = { '间': '間', '闰': '閏' };
    function tradTail(text) {
        let out = '';
        for (const ch of String(text || ''))
            out += (TAIL_TRAD[ch] || ch);
        return out;
    }
    // 把标题开头那段年号换成「表里的写法」：原文可能是简体或异体（贞观 / 啓 / 顯慶），
    // 表里存的是 貞觀 / 啟 / 顯慶。后面的部分（纪年、「年间」等）原样保留。
    function withTableEra(raw, era) {
        const text = String(raw || '');
        if (!era || !text)
            return text;
        if (text.indexOf(era) === 0)
            return era + tradTail(text.slice(era.length));
        const target = D.canonicalForm(era);
        for (let len = Math.min(8, text.length); len >= 2; len--) {
            const rows = D.lookupEra(text.slice(0, len));
            if (rows && rows.length && D.canonicalForm(rows[0].name) === target)
                return era + tradTail(text.slice(len));
        }
        return era;
    }
    function tipTitleFor(mark, info) {
        // 用「年号那一段」而不是 mark.textContent —— 高亮可能把前面的朝代也圈进来了。
        const raw = C.eraTextOf(mark);
        if (!info)
            return raw || '年号';
        const era = String(info.era || '').trim();
        if (!era)
            return raw || '年号';
        const hasEra = D.lookupEra(raw.slice(0, 2)).length > 0 || D.lookupEra(raw.slice(0, 3)).length > 0;
        const num = raw.match(new RegExp('(?<![二三四五六七八九十0-9０-９])(' + D.YEAR_NUM_PART + ')\\s*年\\s*$'));
        const hasCount = !!num;
        if (hasEra && hasCount) {
            const count = num ? D.cnToNumber(num[1]) : NaN;
            if (Number.isFinite(count) && count >= 1)
                return era + (count === 1 ? '元' : cnNum(count)) + '年';
            return withTableEra(raw, era) || era;
        }
        let n = null;
        const gz = mark && mark.__eraGz;
        if (gz) {
            const year = yearOf(info, null, gz);
            if (Number.isFinite(year))
                n = eraCountOf(info, year);
        }
        if (!Number.isFinite(n))
            n = mark && mark.__eraN;
        if (!Number.isFinite(n))
            n = info.n;
        if (!Number.isFinite(n) && Number.isFinite(info.eraStart)) {
            const year = yearOf(info, info.n, null);
            if (Number.isFinite(year))
                n = eraCountOf(info, year);
        }
        return Number.isFinite(n) && n >= 1
            ? era + (n === 1 ? '元' : cnNum(n)) + '年'
            : (withTableEra(raw, era) || era);
    }
    function dynastyMatch(item, dynasty) {
        const want = String(dynasty || '').trim();
        const got = String(item && item.dynasty || '').trim();
        return !!want && !!got && got === want;
    }
    function stampDynasty(mark, info) {
        const dynasty = String(info && info.dynasty || '').trim();
        mark.__eraDynasty = dynasty;
        if (dynasty)
            mark.setAttribute('data-era-dynasty', dynasty);
        else
            mark.removeAttribute('data-era-dynasty');
        return info;
    }
    function pickIndex(mark, contextDynasty) {
        const list = candidatesOf(mark);
        if (!list.length)
            return -1;
        const override = overrideOf(mark);
        if (override !== null && list[override])
            return override;
        const fix = FIXES()[mark.__eraKey];
        if (fix) {
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (item.era === fix.era && item.dynasty === fix.dynasty && item.emperor === fix.emperor)
                    return i;
            }
        }
        if (!mark.__eraRange && mark.__eraPrevEl && mark.__eraPrevEl.isConnected) {
            const inherited = String(mark.__eraPrevEl.__eraDynasty || contextDynasty || '').trim();
            if (inherited) {
                const inheritedIndex = list.findIndex(function (item) { return dynastyMatch(item, inherited); });
                if (inheritedIndex >= 0)
                    return inheritedIndex;
            }
            const previousIndex = pickIndex(mark.__eraPrevEl);
            if (previousIndex >= 0) {
                const previousInfo = candidatesOf(mark.__eraPrevEl)[previousIndex];
                const previousDynasty = previousInfo && previousInfo.dynasty;
                const inheritedIndex = list.findIndex(function (item) { return dynastyMatch(item, previousDynasty); });
                if (inheritedIndex >= 0)
                    return inheritedIndex;
            }
        }
        // 正文里**紧挨着**的朝代 / 帝号优先于「候选[0] 的朝代」：
        // 「北漢乾祐二年」的候选[0] 是後漢（表里第一条），正文写的却是北漢。
        // 只认末尾匹配，所以远处提过的同名朝代不会误伤。
        const textDynasty = contextDynastyOf(list, precedingText(mark, 200));
        if (textDynasty) {
            const textIndex = list.findIndex(function (item) { return dynastyMatch(item, textDynasty); });
            if (textIndex >= 0)
                return textIndex;
        }
        const preferred = String(contextDynasty || mark.__eraDynasty || '').trim();
        if (preferred) {
            const preferredIndex = list.findIndex(function (item) { return dynastyMatch(item, preferred); });
            if (preferredIndex >= 0)
                return preferredIndex;
        }
        const picked = D.pickByContext(list, precedingText(mark, 200));
        return picked ? Math.max(0, list.indexOf(picked)) : 0;
    }
    function pickInfo(mark, contextDynasty) {
        const list = candidatesOf(mark);
        const index = pickIndex(mark, contextDynasty);
        const info = index >= 0 ? list[index] : null;
        return stampDynasty(mark, info);
    }
    function refreshEraContext(root) {
        const scope = root || document.body;
        if (!scope)
            return 0;
        const marks = Array.from(scope.querySelectorAll('.' + C.MARK));
        if (!marks.length)
            return 0;
        let dynasty = '';
        for (const mark of marks) {
            const info = pickInfo(mark, dynasty);
            const current = String(info && info.dynasty || '').trim();
            if (current)
                dynasty = current;
        }
        return marks.length;
    }
    function adjacentText(node, limit, direction) {
        const cap = limit || 16;
        let out = '';
        let current = node;
        for (let hop = 0; hop < 2 && out.length < cap; hop++) {
            let sibling = direction < 0 ? current.previousSibling : current.nextSibling;
            while (sibling && out.length < cap) {
                if (sibling.nodeType === 3) {
                    const value = sibling.nodeValue || '';
                    out = direction < 0 ? value + out : out + value;
                }
                else if (sibling.nodeType === 1 && !sibling.classList.contains(C.ANNO_CLASS)) {
                    const value = sibling.textContent || '';
                    out = direction < 0 ? value + out : out + value;
                }
                sibling = direction < 0 ? sibling.previousSibling : sibling.nextSibling;
            }
            const parent = current.parentElement;
            if (!parent || parent === document.body)
                break;
            current = parent;
        }
        return direction < 0 ? out.slice(-cap) : out.slice(0, cap);
    }
    function precedingText(node, limit) {
        // canvas 侧传进来的是普通对象（没有 DOM 邻接文本），由 canvas-adapter 预先切好
        // 塞在 __eraPreceding 上 —— 这样「北漢乾祐二年」在画布上也能按正文里的朝代选。
        if (node && typeof node.__eraPreceding === 'string')
            return node.__eraPreceding.slice(-(limit || 16));
        // 标记身上带的朝代前缀（「唐貞觀五年」的「唐」）本来就在正文里、紧挨着年号，
        // 所以拼回上文里 —— 不然 pickIndex() 的「按正文里的朝代选候选」就看不到它了
        //（它现在在标记内部，adjacentText 走不到）。
        const own = String((node && node.__eraPrefix) || '');
        const before = adjacentText(node, limit, -1);
        if (!own)
            return before;
        return (before + own).slice(-(limit || 16));
    }
    const CTX_TAIL_NOISE = /[\s\u3000·、，,。．；;：:（）()「」『』“”‘’《》〈〉【】\[\]{}]+$/;
    // 标记前面紧挨着的朝代 / 帝号（「北漢」「北漢世祖」）指向哪一条候选的朝代。
    // 用 D.contextNames() 拿到这条候选的朝代、朝代简称、帝号等写法，取**最长**的末尾匹配；
    // 匹配不到返回 ''，后面的规则照旧。只看末尾，所以远处提过的同名朝代不会误伤。
    function contextDynastyOf(list, before) {
        const tail = String(before || '').replace(CTX_TAIL_NOISE, '');
        if (!tail)
            return '';
        let best = 0;
        let dynasty = '';
        for (const item of list) {
            const names = typeof D.contextNames === 'function'
                ? D.contextNames(item)
                : [item && item.dynasty, item && item.emperor];
            for (const raw of names) {
                const name = String(raw || '');
                if (!name || name.length <= best || tail.length < name.length)
                    continue;
                if (D.canonicalForm(tail.slice(-name.length)) !== D.canonicalForm(name))
                    continue;
                best = name.length;
                dynasty = String((item && item.dynasty) || '');
            }
        }
        return dynasty;
    }
    function followingText(node, limit) {
        return adjacentText(node, limit, 1);
    }
    function alreadyStated(mark, years) {
        const after = followingText(mark, 12);
        return years.some(function (year) {
            const num = year < 0 ? '(?:公元前|前|BC)?\\s*' + (-year) : String(year);
            return new RegExp('^[\\s\\u3000，。、,.;:：；]*[（(]?\\s*' + num + '\\s*年?').test(after);
        });
    }
    function candidateYears(infoList) {
        const years = [];
        for (const item of Array.isArray(infoList) ? infoList : []) {
            const year = Number.isFinite(item.gregorian) ? item.gregorian : item.eraStart;
            if (Number.isFinite(year) && !years.includes(year))
                years.push(year);
        }
        return years;
    }
    // preInfo 可选：调用方已经算过 pickInfo 时直接传进来，省一次重算。
    function annotateText(mark, preInfo) {
        if (typeof C.inlineAnnotationAllowed === 'function' && !C.inlineAnnotationAllowed(location.href))
            return '';
        const info = preInfo !== undefined ? preInfo : pickInfo(mark);
        if (!info)
            return Number.isFinite(mark.__eraN) ? '（？）' : '';
        // 跨节点续接补出来的「年号」标记只负责高亮与承接下文，不单独补年份 ——
        // 否则会在「大業（605-618年）二年」中间插一段，把词组断开。
        if (mark.__eraSeed)
            return '';
        // 起止年任一端不可考（表里为 null）→ 标「（？）」：
        // 认得出是纪年，但给不出公元年（夏商那些只留下王名、年份不可考的条目）。
        if (!eraYearsKnown(info))
            return '（？）';
        if (!mark.__eraRange) {
            const year = yearOf(info, mark.__eraN, mark.__eraGz);
            if (Number.isFinite(year)) {
                // 「共和前纪年」选「不识别」时，前 841 年（不含）之前的年份不标注。
                if (!R.settings.preRepublic && D.isBeforeGonghe(year))
                    return '';
                // 算出来的年份超出该年号的起止范围时**不再加「？」**：那只是个「这年号到底有没有
                // 第 n 年」的猜测，交给用户看卡片里的起止年自己判断（用户要求）。
                return '（' + D.formatYearApprox(year) + '）';
            }
        }
        if (Number.isFinite(info.eraStart)) {
            if (!R.settings.preRepublic && D.isBeforeGonghe(info.eraStart))
                return '';
            const range = C.fmtRange ? C.fmtRange(info) : '';
            if (range)
                return '（' + range + '）';
        }
        return '';
    }
    function refreshAnnotations(root) {
        const scope = root || document.body;
        if (!scope)
            return 0;
        const marks = scope.querySelectorAll('.' + C.MARK);
        if (!marks.length)
            return 0;
        let added = 0;
        C.markSelfMutation();
        for (const mark of marks) {
            const sibling = mark.nextElementSibling;
            const hasAnno = !!(sibling && sibling.classList.contains(C.ANNO_CLASS));
            let wanted = '';
            if (R.settings.annotate) {
                const info = pickInfo(mark);
                wanted = annotateText(mark, info);
                if (wanted) {
                    // 「后面是不是已经写了这个年份」要比对**这个标记自己算出来的年份**。
                    // 候选列表里的年份属于上文那条年号（续接来的纪年带着上文的年数），
                    // 拿它去比对会漏判，于是插出「大业二年（606）（606年）」这种重复。
                    const years = candidateYears(candidatesOf(mark));
                    const own = yearOf(info, mark.__eraN, mark.__eraGz);
                    if (Number.isFinite(own) && years.indexOf(own) < 0)
                        years.push(own);
                    if (years.length && alreadyStated(mark, years))
                        wanted = '';
                }
            }
            if (!wanted) {
                if (hasAnno)
                    sibling.remove();
                continue;
            }
            if (hasAnno) {
                if (sibling.textContent !== wanted)
                    sibling.textContent = wanted;
                continue;
            }
            if (!mark.parentNode)
                continue;
            const anno = document.createElement('span');
            anno.className = C.ANNO_CLASS;
            anno.setAttribute('data-era-source', mark.getAttribute('data-era-source') || '');
            anno.textContent = wanted;
            mark.parentNode.insertBefore(anno, mark.nextSibling);
            added++;
        }
        return added;
    }
    function stripAnnotations(root) {
        const scope = root || document.body;
        if (!scope)
            return 0;
        const annos = Array.from(scope.querySelectorAll('.' + C.ANNO_CLASS));
        if (!annos.length)
            return 0;
        const parents = new Set();
        C.markSelfMutation();
        annos.forEach(function (anno) {
            if (!anno.parentNode)
                return;
            parents.add(anno.parentNode);
            anno.remove();
        });
        parents.forEach(function (parent) {
            try {
                parent.normalize();
            }
            catch (e) { }
        });
        return annos.length;
    }
    C.yearOf = yearOf;
    C.eraYearsKnown = eraYearsKnown;
    C.candidateOf = candidateOf;
    C.candidatesOf = candidatesOf;
    C.overrideOf = overrideOf;
    C.cnNum = cnNum;
    C.tipTitleFor = tipTitleFor;
    C.pickIndex = pickIndex;
    C.refreshEraContext = refreshEraContext;
    C.pickInfo = pickInfo;
    C.precedingText = precedingText;
    C.followingText = followingText;
    C.candidateYears = candidateYears;
    C.alreadyStated = alreadyStated;
    C.annotateText = annotateText;
    C.refreshAnnotations = refreshAnnotations;
    C.stripAnnotations = stripAnnotations;
})(typeof globalThis !== 'undefined' ? globalThis : self);
