(() => {
    'use strict';
    const C = globalThis.EraHL;
    if (!C) return;
    const D = C.D;
    const R = C.runtime;
    const DATA_EVENT = 'era-hl-shidian-canvas-data-v1';
    const HELLO_EVENT = 'era-hl-shidian-canvas-hello-v1';
    const pages = new Map();
    const pageEls = new Map();
    let started = false;
    let refreshTimer = 0;
    // 用户在「禁用网站」上手动点过识别按钮：本次会话内继续识别。
    // 和普通网站一致 —— 禁用只是「不自动识别」，手动点一次还是能标出来，标记留在页面上。
    let forced = false;

    const BARE_GZ = /([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])年/g;
    const BARE_YEAR = new RegExp('(' + D.CN_YEAR_PART + ')年', 'g');
    const BEFORE_PUNCT = /[\s。．，、；;,：:？！?!…—～~「」『』“”‘’"'（）()〈〉《》【】\[\]{}·]/;
    const BEFORE_WORDS = new Set(['诏', '詔', '其']);

    function isCanvasSite() {
        return location.hostname.toLowerCase() === 'www.shidianguji.com';
    }

    function siteAllowed() {
        if (!isCanvasSite() || !R.settings.enabled || !R.settings.autoRegex)
            return false;
        // 站点规则照常生效：识别模式（限制 / 全局 / 自定义）+ 禁用网站 / 自定义网站。
        // 这里以前在「限制」模式下直接 return true，等于把识典从 blockedSites 里豁免了 ——
        // 用户把识典加进「禁用网站」也不生效。默认值里也不再预置识典（见 content-state.js）。
        // forced：禁用网站上手动点过识别按钮，本次会话内继续认（见 runCanvasRegex）。
        return forced || !!R.state.autoAllowed;
    }

    function pageState(pageId) {
        let p = pages.get(pageId);
        if (!p) {
            p = {
                records: [],
                recordMap: new Map(),
                pendingRecords: [],
                pendingRecordMap: new Map(),
                collecting: false,
                renderedMarks: new Map(),
                renderSignature: '',
                dirty: true
            };
            pages.set(pageId, p);
        }
        return p;
    }

    function getPageElement(pageId) {
        if (!pageId) return null;
        const cached = pageEls.get(pageId);
        if (cached && cached.isConnected) return cached;
        const nodes = document.querySelectorAll('[data-reader-page-id]');
        for (const node of nodes) {
            if (String(node.getAttribute('data-reader-page-id') || '') === pageId) {
                pageEls.set(pageId, node);
                return node;
            }
        }
        return null;
    }

    function clearCanvasMarks() {
        document.querySelectorAll('.' + C.CANVAS_MARK).forEach(mark => {
            if (mark.__eraCanvasAnno && mark.__eraCanvasAnno.isConnected)
                mark.__eraCanvasAnno.remove();
            mark.__eraCanvasAnno = null;
            mark.remove();
        });
        document.querySelectorAll('.era-hl-canvas-anno').forEach(anno => anno.remove());
        R.state.count = document.querySelectorAll('.' + C.CANVAS_MARK).length;
        // 清掉就结束「手动识别」状态：禁用网站上下一次重绘不该又标回来。
        forced = false;
    }

    // 上文年号链：用户在这一处更正过 / 切换过候选，下文就得跟着变
    //（和 DOM 路径里 __eraPrevEl → candidatesOf(prev) 是一个意思）。
    // 没更正过时原样返回，所以正常识别完全不受影响。
    function effectiveChain(text, hit, info) {
        const list = Array.isArray(info) ? info : [];
        const key = C.eraKeyFor(text, hit.index, hit.end);
        const fix = key && R.eraFixes ? R.eraFixes[key] : null;
        if (fix && fix.era) {
            const rows = (D.lookupEra(fix.era) || []).filter(function (r) {
                return (!fix.dynasty || r.dynasty === fix.dynasty) && (!fix.emperor || r.emperor === fix.emperor);
            });
            const mapped = rows.map(function (r) {
                return C.candidateOf(r, null);
            }).filter(Boolean);
            if (mapped.length)
                return mapped;
        }
        const picked = key && R.overrides ? R.overrides[key] : null;
        if (typeof picked === 'number' && list[picked])
            return [copyCandidate(list[picked])];
        return list;
    }

    function copyCandidate(candidate) {
        return candidate ? Object.assign({}, candidate) : null;
    }

    function isBoundary(text, index) {
        if (index <= 0) return true;
        const ch = String(text || '').charAt(index - 1);
        return BEFORE_PUNCT.test(ch) || BEFORE_WORDS.has(ch);
    }

    function makeGanzhiContext(list, gz, matched) {
        const out = [];
        for (const info of Array.isArray(list) ? list : []) {
            if (!Number.isFinite(info && info.eraStart)) continue;
            const off = D.ganzhiOffsetIn(info.eraStart, info.eraEnd, gz);
            if (off < 0) continue;
            // 干支锚在真实年份上，与年号的计数起点无关：这一年的纪年数 = 离 start 的偏移 + offset。
            const eraOff = Number.isFinite(info.eraOffset) && info.eraOffset >= 1 ? info.eraOffset : 1;
            const n = off + eraOff;
            const item = copyCandidate(info);
            item.matched = matched;
            item.n = n;
            item.gregorian = D.eraYear(info.eraStart, n, eraOff);
            out.push(item);
        }
        return out;
    }

    function findMatches(text, contextList) {
        const fullHits = [];
        const bareHits = [];
        const full = D.buildRegex({ standalone: !!R.settings.standalone, range: true });
        full.lastIndex = 0;
        let m;

        // 第一层完全复用原插件的 buildRegex + resolve：
        // 完整纪年、干支纪年、年号范围、独立年号都先按原规则识别。
        while ((m = full.exec(text)) !== null) {
            if (!m[0]) {
                full.lastIndex++;
                continue;
            }
            const groups = m.groups || {};
            const info = D.resolve(m);
            if (!info || !info.length) continue;
            // 带年号的写法（era 年号+纪年 / eraG 年号+干支年 / eraR 年号+年间等 / eraM 年号+中初末）
            // 都把紧挨在前面的朝代（含「大」）一起圈进来 —— 和 DOM 扫描器同一套规则；
            // eraB（独立年号）不算。
            const hlIndex = (groups.era || groups.eraG || groups.eraR || groups.eraM)
                ? m.index - D.whoPrefixLength(text.slice(0, m.index))
                : m.index;
            fullHits.push({
                index: m.index,
                end: m.index + m[0].length,
                hlIndex,
                info,
                n: groups.num
                    ? (groups.num === '元' ? 1 : D.cnToNumber(groups.num))
                    : (info.length === 1 && Number.isFinite(info[0].n) ? info[0].n : null),
                gz: groups.gz || null,
                range: !!(groups.eraR || groups.eraM),
                kind: 'full'
            });
        }

        // 第二层沿用原 content-scanner.js 的“上下文纪年”规则。
        // 这里只先收集候选，真正继承哪个年号在后面的顺序扫描中决定。
        BARE_GZ.lastIndex = 0;
        while ((m = BARE_GZ.exec(text)) !== null) {
            bareHits.push({
                index: m.index,
                end: m.index + m[0].length,
                gz: m[1],
                kind: 'gz'
            });
        }

        BARE_YEAR.lastIndex = 0;
        while ((m = BARE_YEAR.exec(text)) !== null) {
            const raw = m[1];
            const n = raw === '元' ? 1 : D.cnToNumber(raw);
            if (!Number.isFinite(n) || n < 1 || n > 61)
                continue;
            if (m.index > 0 && (text.charAt(m.index - 1) === '积' || text.charAt(m.index - 1) === '積'))
                continue;
            const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
            const gzAfter = /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/.test(after);
            if (!gzAfter && !isBoundary(text, m.index)) continue;
            bareHits.push({
                index: m.index,
                end: m.index + m[0].length,
                n,
                kind: 'year'
            });
        }

        // 与普通 DOM 扫描器一样按正文顺序维护“上文年号链”。
        // 这样「貞觀」之后的「七年」、以及跨 Canvas 页的「七年」都会继承貞觀候选，
        // 而不是得到空候选后在卡片中显示“无法判断”。
        const all = fullHits.concat(bareHits).sort((a, b) => {
            if (a.index !== b.index) return a.index - b.index;
            if (a.kind === 'full' && b.kind !== 'full') return -1;
            if (b.kind === 'full' && a.kind !== 'full') return 1;
            return (b.end - b.index) - (a.end - a.index);
        });

        const out = [];
        let cursor = -1;
        let chain = Array.isArray(contextList) && contextList.length ? contextList : null;

        for (const hit of all) {
            if (hit.index < cursor) continue;

            if (hit.kind === 'full') {
                out.push(hit);
                cursor = hit.end;
                if (Array.isArray(hit.info) && hit.info.length)
                    chain = effectiveChain(text, hit, hit.info);
                continue;
            }

            if (hit.kind === 'gz') {
                if (!chain || !chain.length) continue;
                const info = makeGanzhiContext(chain, hit.gz, text.slice(hit.index, hit.end));
                if (!info.length) continue;
                out.push({
                    index: hit.index,
                    end: hit.end,
                    info,
                    gz: hit.gz,
                    n: null,
                    kind: 'gz'
                });
                cursor = hit.end;
                chain = effectiveChain(text, hit, info);
                continue;
            }

            // 原插件即使暂时没有上文年号，也会保留「七年」这种纪年标记，
            // 让卡片显示“无法判断”并可手工更正；有上文年号时则直接继承候选。
            out.push({
                index: hit.index,
                end: hit.end,
                info: chain ? chain.map(copyCandidate) : [],
                n: hit.n,
                kind: 'year'
            });
            cursor = hit.end;
            // 这一处自己也成了「上文」：下一处（哪怕在下一个 canvas 上）要继承它的候选 ——
            // 用户在这一处更正过（如把「三年」改成别的年号）时才跟着变。
            chain = effectiveChain(text, hit, chain);
        }

        // 连 hits 一起把**处理完之后的链**返回：跨 canvas 传上下文时要用它，
        // 用某一条命中的原始候选会把更正丢掉（三年/四年 分处两页时就不跟随了）。
        return { hits: out, chain: chain };
    }

    function mergeInto(p, records, targetRecords, targetMap) {
        for (const rec of records || []) {
            if (!rec || typeof rec.text !== 'string' || !rec.text) continue;
            const key = `${rec.x}|${rec.y}`;
            if (targetMap.has(key)) {
                const i = targetMap.get(key);
                targetRecords[i] = rec;
            } else {
                targetMap.set(key, targetRecords.length);
                targetRecords.push(rec);
            }
        }
    }

    function addBatch(pageId, records) {
        const p = pageState(pageId);
        if (p.collecting) {
            mergeInto(p, records, p.pendingRecords, p.pendingRecordMap);
        } else {
            mergeInto(p, records, p.records, p.recordMap);
        }
        p.dirty = true;
    }

    function resetPage(pageId) {
        if (!pageId) return;
        const p = pageState(pageId);

        // 识典开始一次新的 Canvas 重绘时，不碰当前已经显示的标注。
        // 新一轮 fillText 数据先进入 pending，待 90ms 静默窗口结束后一次性提交。
        p.collecting = true;
        p.pendingRecords.length = 0;
        p.pendingRecordMap.clear();
        p.dirty = false;
    }

    function finalizePending(pageId) {
        const p = pages.get(pageId);
        if (!p || !p.collecting) return false;
        if (!p.pendingRecords.length) return false;

        p.records = p.pendingRecords;
        p.recordMap = p.pendingRecordMap;
        p.pendingRecords = [];
        p.pendingRecordMap = new Map();
        p.collecting = false;
        p.dirty = true;
        return true;
    }

    function fontPx(font) {
        const m = /(?:^|\s)(\d+(?:\.\d+)?)px\b/i.exec(String(font || ''));
        const n = m ? Number(m[1]) : 16;
        return Number.isFinite(n) && n > 0 ? n : 16;
    }

    function transformPoint(x, y, matrix) {
        const m = matrix || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        return {
            x: m.a * x + m.c * y + m.e,
            y: m.b * x + m.d * y + m.f
        };
    }

    function userTextBox(rec) {
        const size = fontPx(rec.font);
        const metrics = rec.metrics || {};

        // Canvas 的实际文字边界相对于 fillText(x, y) 的锚点定义，
        // 比简单按字号估算准确得多，尤其能修正 middle/alphabetic 等 baseline。
        const hasActualBounds = Number.isFinite(metrics.actualBoundingBoxLeft) &&
            Number.isFinite(metrics.actualBoundingBoxRight) &&
            Number.isFinite(metrics.actualBoundingBoxAscent) &&
            Number.isFinite(metrics.actualBoundingBoxDescent);

        if (hasActualBounds) {
            return {
                left: rec.x - metrics.actualBoundingBoxLeft,
                top: rec.y - metrics.actualBoundingBoxAscent,
                right: rec.x + metrics.actualBoundingBoxRight,
                bottom: rec.y + metrics.actualBoundingBoxDescent
            };
        }

        const width = Number(metrics.width) > 0 ? Number(metrics.width) : size;
        let left = rec.x - width * 0.5;
        if (rec.textAlign === 'left' || rec.textAlign === 'start') left = rec.x;
        if (rec.textAlign === 'right' || rec.textAlign === 'end') left = rec.x - width;

        let top = rec.y - size * 0.68;
        let bottom = rec.y + size * 0.4;
        if (rec.textBaseline === 'alphabetic') {
            top = rec.y - size * 0.9;
            bottom = rec.y + size * 0.15;
        }
        else if (rec.textBaseline === 'top' || rec.textBaseline === 'hanging') {
            top = rec.y;
            bottom = rec.y + size * 1.05;
        }
        else if (rec.textBaseline === 'bottom' || rec.textBaseline === 'ideographic') {
            top = rec.y - size;
            bottom = rec.y;
        }
        return { left, top, right: left + width, bottom };
    }

    function transformedBoxForRecord(rec, pad = 1) {
        const box = userTextBox(rec);
        const p1 = transformPoint(box.left - pad, box.top - pad, rec.transform);
        const p2 = transformPoint(box.right + pad, box.top - pad, rec.transform);
        const p3 = transformPoint(box.right + pad, box.bottom + pad, rec.transform);
        const p4 = transformPoint(box.left - pad, box.bottom + pad, rec.transform);
        return {
            minX: Math.min(p1.x, p2.x, p3.x, p4.x),
            minY: Math.min(p1.y, p2.y, p3.y, p4.y),
            maxX: Math.max(p1.x, p2.x, p3.x, p4.x),
            maxY: Math.max(p1.y, p2.y, p3.y, p4.y)
        };
    }

    function boxForRecords(records, canvas, page) {
        if (!records.length || !canvas || !page) return null;
        const canvasRect = canvas.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        const sx = canvas.width ? canvas.clientWidth / canvas.width : 1;
        const sy = canvas.height ? canvas.clientHeight / canvas.height : 1;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const rec of records) {
            const b = transformedBoxForRecord(rec);
            minX = Math.min(minX, b.minX);
            minY = Math.min(minY, b.minY);
            maxX = Math.max(maxX, b.maxX);
            maxY = Math.max(maxY, b.maxY);
        }
        const originX = canvasRect.left - pageRect.left;
        const originY = canvasRect.top - pageRect.top;
        return {
            left: originX + minX * sx,
            top: originY + minY * sy,
            width: Math.max(1, (maxX - minX) * sx),
            height: Math.max(1, (maxY - minY) * sy),
            minX, minY, sx, sy, originX, originY
        };
    }

    function addCharBox(parent, rec, box) {
        const b = transformedBoxForRecord(rec);
        const left = (b.minX - box.minX) * box.sx;
        const top = (b.minY - box.minY) * box.sy;
        const width = Math.max(1, (b.maxX - b.minX) * box.sx);
        const height = Math.max(1, (b.maxY - b.minY) * box.sy);
        const el = document.createElement('span');
        el.className = 'era-hl-canvas-char';
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.width = width + 'px';
        el.style.height = height + 'px';
        parent.appendChild(el);
    }

    function buildCharSlots(records) {
        const slots = [];
        let text = '';
        const list = (Array.isArray(records) ? records : [])
            .filter(rec => rec && typeof rec.text === 'string' && rec.text);

        // Canvas 的 fillText 调用顺序不一定等于页面阅读顺序。
        // 识典当前页面是横排，因此按 y 从上到下、同一行按 x 从左到右恢复阅读顺序。
        list.sort((a, b) => {
            const ay = Number(a.y) || 0;
            const by = Number(b.y) || 0;
            const dy = ay - by;
            if (Math.abs(dy) > 4)
                return dy;

            const ax = Number(a.x) || 0;
            const bx = Number(b.x) || 0;
            return ax - bx;
        });

        const cnDigits = new Set('〇零一二三四五六七八九十百千万億亿兩两廿卅卌'.split(''));
        let rowY = null;
        let previousValue = '';

        for (const rec of list) {
            const value = rec.text;
            const y = Number(rec.y) || 0;
            const newRow = rowY !== null && Math.abs(y - rowY) > 4;

            if (newRow) {
                const previousChar = previousValue.slice(-1);
                const currentChar = value.charAt(0);
                const wrappedNumber =
                    cnDigits.has(previousChar) && cnDigits.has(currentChar);

                // 古籍 Canvas 常把一个数字短语硬折到下一行，例如：
                //   ……占曰：“主有疾。”二
                //   十二年八月……
                // 这里的“二”与“十二年”属于同一个纪年词，不能插入换行；
                // 其他换行仍保留为边界，使新行的“四年”之类能够正常识别。
                if (!wrappedNumber) {
                    text += '\n';
                    slots.push(null);
                }
            }

            text += value;
            // findMatches() 使用 JavaScript 字符串的 UTF-16 index，
            // 因此按 code unit 建槽位，确保命中位置与 slots 完全一致。
            for (let i = 0; i < value.length; i++)
                slots.push(rec);

            if (rowY === null || newRow)
                rowY = y;
            previousValue = value;
        }

        return { text, slots };
    }

    function makeCanvasMark(text, hit) {
        if (!hit)
            return null;
        const mark = C.createMark(text, hit, 'regex');
        if (!mark)
            return null;
        mark.classList.remove(C.MARK);
        mark.classList.add(C.CANVAS_MARK);
        return mark;
    }

    function markerKey(text, index, end) {
        return C.eraKeyFor(text, index, end);
    }

    function annotationText(mark) {
        if (!R.settings.annotate) return '';
        if (!C.inlineAnnotationAllowed(location.href)) return '';

        const list = Array.isArray(mark && mark.__eraInfo) ? mark.__eraInfo : [];
        // 注意：这里**不能**因为 __eraInfo 为空就提前返回「（？）」。
        // 「二年」这类省略年号的纪年第一次出现时上文链为空，__eraInfo 是空的；
        // 用户点「更正」填了年号后，候选只存在于 eraFixes[__eraKey] 里，必须经过
        // candidatesOf() 才能取到（卡片走的就是这条路）。提前 return 会造成
        // 「卡片更新了、文内标注却永远停在（？）」。真正的「认不出」由下面的
        // info 为空兜底，结果与原来一致。

        // Canvas 比较阶段传入的是普通对象，不能走会 stampDynasty()/setAttribute() 的 pickInfo()。
        // 但候选选择仍复用原插件的 candidatesOf()/pickIndex() 规则。
        const candidates = C.candidatesOf(mark);
        const index = C.pickIndex(mark);
        const info = index >= 0 && candidates[index]
            ? candidates[index]
            : (candidates[0] || list[0] || null);

        if (!info)
            return Number.isFinite(mark && mark.__eraN) ? '（？）' : '';

        // 起止年任一端不可考（表里为 null）→ 标「（？）」，认得出是纪年但给不出公元年。
        // 判断统一走 content-annotation.js 的 eraYearsKnown()（它另带 AI 结果的例外）。
        if (!C.eraYearsKnown(info))
            return '（？）';

        // 完整纪年 / 继承纪年 / 干支纪年：优先标具体公历年。
        if (!mark.__eraRange) {
            const year = C.yearOf(info, mark.__eraN, mark.__eraGz);
            if (Number.isFinite(year)) {
                if (!R.settings.preRepublic && typeof D.isBeforeGonghe === 'function' && D.isBeforeGonghe(year)) return '';
                return '（' + D.formatYearApprox(year) + '）';
            }
        }

        // 关键：原插件对「貞觀」这种只有年号、没有具体第几年数字的标记，
        // 会退回显示这个年号的起讫范围；Canvas 适配也必须复用同一规则。
        if (Number.isFinite(info.eraStart)) {
            if (!R.settings.preRepublic && typeof D.isBeforeGonghe === 'function' && D.isBeforeGonghe(info.eraStart)) return '';
            const range = C.fmtRange(info);
            if (range) return '（' + range + '）';
        }

        return '';
    }

    function recordSignature(rec) {
        const t = rec.transform || {};
        const m = rec.metrics || {};
        return [
            rec.text, rec.x, rec.y, rec.font, rec.textAlign, rec.textBaseline,
            rec.canvasWidth, rec.canvasHeight,
            t.a, t.b, t.c, t.d, t.e, t.f,
            m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxRight,
            m.actualBoundingBoxAscent, m.actualBoundingBoxDescent
        ].join(',');
    }

    function hitSignature(built, hit, slotRecords, annotation, preceding) {
        const chars = slotRecords.map(recordSignature).join('||');
        const info = Array.isArray(hit.info) ? hit.info.map(item => ({
            name: item && item.name,
            matched: item && item.matched,
            eraStart: item && item.eraStart,
            eraEnd: item && item.eraEnd,
            n: item && item.n,
            gregorian: item && item.gregorian,
            dynasty: item && item.dynasty
        })) : [];
        return [
            hit.index, hit.end, built.text.slice(hit.index, hit.end),
            hit.range ? 1 : 0, hit.n ?? '', hit.gz ?? '',
            JSON.stringify(info), annotation, preceding || '', chars
        ].join('@@');
    }

    function syncCanvasAnnotation(mark, text, page, box) {
        if (!mark || !page) return;

        // 文内标注不能作为 mark 的子元素，否则 mark.textContent 会把“（605-618年）”
        // 一并算进 Tooltip 标题，导致标题从“大業中”变成“大業中（605-618年）”。
        // 因此把 Canvas 文内标注放在 mark 外部，作为 page 的直接子元素。
        let label = mark.__eraCanvasAnno;

        // 兼容旧结构：如果热更新/旧版本留下了嵌套标注，先移出。
        const nested = mark.querySelector(':scope > .era-hl-canvas-anno');
        if (nested) nested.remove();

        if (!text) {
            if (label && label.isConnected) label.remove();
            mark.__eraCanvasAnno = null;
            return;
        }

        if (!label || !label.isConnected || label.parentNode !== page) {
            label = document.createElement('span');
            label.className = 'era-hl-canvas-anno';
            label.setAttribute('aria-hidden', 'true');
            page.appendChild(label);
            mark.__eraCanvasAnno = label;
        }

        label.textContent = text;
        if (box) {
            const firstChar = mark.querySelector(':scope > .era-hl-canvas-char');
            const cw = firstChar ? parseFloat(firstChar.style.width || '0') : 0;
            const ch = firstChar ? parseFloat(firstChar.style.height || '0') : 0;

            const wrapped = cw > 0 && ch > 0 && box.width > cw * 1.6 && box.height > ch * 1.6;

            let aLeft = box.left, aWidth = box.width, aTop = box.top;
            if (wrapped) {
                aLeft  = box.left + parseFloat(firstChar.style.left || '0');
                aWidth = cw;
                aTop   = box.top  + parseFloat(firstChar.style.top  || '0');
            }
            label.style.left = (aLeft + aWidth / 2) + 'px';
            label.style.top = Math.max(0, aTop - 1) + 'px';
            label.style.bottom = 'auto';
            label.style.transform = 'translate(-50%, -100%)';
            label.style.marginBottom = '0';
        }


    }

    function applyMarkBox(mark, slotRecords, box) {
        mark.style.left = box.left + 'px';
        mark.style.top = box.top + 'px';
        mark.style.width = box.width + 'px';
        mark.style.height = box.height + 'px';

        const chars = mark.querySelectorAll(':scope > .era-hl-canvas-char');
        chars.forEach(char => char.remove());
        for (const rec of slotRecords) addCharBox(mark, rec, box);
    }

    function markKeyForHit(hit) {
        return `${hit.index}|${hit.end}`;
    }

    function renderPage(pageId, contextList) {
        if (!siteAllowed()) {
            clearCanvasMarks();
            return { count: 0, context: contextList };
        }

        const p = pages.get(pageId);
        const page = getPageElement(pageId);
        if (!p || !page) return { count: 0, context: contextList };

        // clearRect 之后先保留上一轮标注；新的字符全部进入 pending，
        // scheduleRefresh() 的 90ms 静默窗口结束后才一次性提交，避免半页数据触发清空。
        if (p.collecting) finalizePending(pageId);

        const canvas = page.querySelector('canvas');
        if (!canvas || !canvas.width || !canvas.height || !p.records.length)
            return { count: page.querySelectorAll('.' + C.CANVAS_MARK).length, context: contextList };

        const built = buildCharSlots(p.records);
        const found = findMatches(built.text, contextList);
        const matches = found.hits;
        const desired = new Map();
        let count = 0;

        for (const hit of matches) {
            const slotRecords = [];
            const seen = new Set();
            // 高亮起点可能比年号起点靠左（把「唐」/「大唐」圈进来了）—— 框要盖住那几个字。
            const hlStart = Number.isFinite(hit.hlIndex) && hit.hlIndex < hit.index ? hit.hlIndex : hit.index;
            for (let i = hlStart; i < hit.end && i < built.slots.length; i++) {
                const rec = built.slots[i];
                if (!rec || seen.has(rec)) continue;
                seen.add(rec);
                slotRecords.push(rec);
            }
            if (!slotRecords.length) continue;

            const box = boxForRecords(slotRecords, canvas, page);
            if (!box) continue;

            const text = built.text.slice(hit.index, hit.end);
            // 这一处前面的画布文字：pickIndex() 靠它认出正文里点名的朝代
            //（「北漢乾祐二年」要选北漢，不能因为表里第一条是後漢就选後漢）。
            const preceding = built.text.slice(Math.max(0, hit.index - 200), hit.index);
            const tempInfo = {
                __eraInfo: Array.isArray(hit.info) ? hit.info : [],
                __eraRange: !!hit.range,
                __eraN: hit.n,
                __eraGz: hit.gz,
                __eraPreceding: preceding,
                // 让 candidatesOf()/pickIndex() 能按 __eraKey 查到用户记录：
                // fixes[__eraKey] = 更正面板选的年号，OVERRIDE()[__eraKey] = 双击候选切换的条目。
                // 缺了它，Canvas 的文内标注永远停在默认候选，且 hitSignature 不变导致标记不重建。
                __eraKey: markerKey(built.text, hit.index, hit.end)
            };

            // annotationText() 只依赖 mark 上的几个 __era* 字段；
            // 这里先用最小临时对象计算文内标注，避免为了比较而创建 DOM。
            const anno = annotationText(tempInfo);
            const key = markKeyForHit(hit);
            const sig = hitSignature(built, hit, slotRecords, anno, preceding);
            desired.set(key, { hit, text, slotRecords, box, annotation: anno, signature: sig, preceding });
        }

        const signature = [...desired.entries()]
            .map(([key, spec]) => key + '##' + spec.signature)
            .join('\n');

        const renderedMarksConnected = [...p.renderedMarks.values()].every(mark => mark && mark.isConnected && mark.closest('[data-reader-page-id]') === page);
        if (p.renderSignature === signature && renderedMarksConnected) {
            if (!p.dirty)
                return { count: p.renderedMarks.size, context: found.chain };
            p.dirty = false;
            return { count: p.renderedMarks.size, context: found.chain };
        }

        const oldMarks = p.renderedMarks;
        const nextMarks = new Map();

        for (const [key, spec] of desired) {
            let mark = oldMarks.get(key);
            const canReuse = mark && mark.isConnected && mark.closest('[data-reader-page-id]') === page && mark.dataset.eraCanvasSignature === spec.signature;

            if (!canReuse) {
                if (mark && mark.isConnected) {
                    if (mark.__eraCanvasAnno && mark.__eraCanvasAnno.isConnected)
                        mark.__eraCanvasAnno.remove();
                    mark.__eraCanvasAnno = null;
                    mark.remove();
                }
                mark = makeCanvasMark(built.text, spec.hit);
                if (!mark) continue;
                mark.dataset.eraCanvasSignature = spec.signature;
                // 卡片点开时也走 pickIndex()，那里同样要靠这段上文认朝代（画布标记没有 DOM 邻接文本）。
                mark.__eraPreceding = spec.preceding;
                applyMarkBox(mark, spec.slotRecords, spec.box);
                syncCanvasAnnotation(mark, spec.annotation, page, spec.box);
            }

            if (mark)
                syncCanvasAnnotation(mark, spec.annotation, page, spec.box);

            nextMarks.set(key, mark);
            count++;
        }

        for (const [key, mark] of oldMarks) {
            if (!nextMarks.has(key) && mark && mark.isConnected) {
                if (mark.__eraCanvasAnno && mark.__eraCanvasAnno.isConnected)
                    mark.__eraCanvasAnno.remove();
                mark.__eraCanvasAnno = null;
                mark.remove();
            }
        }

        for (const mark of nextMarks.values()) {
            if (!mark.parentNode || mark.parentNode !== page)
                page.appendChild(mark);
        }

        p.renderedMarks = nextMarks;
        p.renderSignature = signature;
        p.dirty = false;
        return { count, context: found.chain };
    }

    function pageOrder() {
        return Array.from(document.querySelectorAll('[data-reader-page-id]'))
            .map(node => String(node.getAttribute('data-reader-page-id') || ''))
            .filter(Boolean);
    }

    function refreshAll() {
        refreshTimer = 0;
        if (!isCanvasSite()) return;
        if (!siteAllowed()) {
            clearCanvasMarks();
            return;
        }
        let context = null;
        let count = 0;
        const seen = new Set();
        for (const pageId of pageOrder()) {
            if (seen.has(pageId)) continue;
            seen.add(pageId);
            const result = renderPage(pageId, context);
            count += result.count;
            context = result.context;
        }
        // 数据里有但 DOM 尚未出现在视口的页面，暂不绘制；进入 DOM 后下一批 Canvas 数据会再次刷新。
        R.state.count = count;
        R.state.mode = count ? 'regex' : R.state.mode;
        R.state.scannedAt = Date.now();
    }

    function scheduleRefresh() {
        if (refreshTimer) return;
        refreshTimer = setTimeout(refreshAll, 90);
    }

    function handshake() {
        try {
            window.dispatchEvent(new CustomEvent(HELLO_EVENT));
        } catch (e) { }
    }

    function removeCanvasMark(mark) {
        if (!mark || !mark.isConnected) return false;
        if (mark.__eraCanvasAnno && mark.__eraCanvasAnno.isConnected)
            mark.__eraCanvasAnno.remove();
        mark.__eraCanvasAnno = null;
        mark.remove();
        R.state.count = document.querySelectorAll('.' + C.CANVAS_MARK).length;
        return true;
    }

    window.addEventListener(DATA_EVENT, event => {
        const detail = event && event.detail;
        if (!detail || !isCanvasSite()) return;
        if (detail.type === 'reset') {
            resetPage(String(detail.pageId || ''));
            scheduleRefresh();
            return;
        }
        if (detail.type === 'batch') {
            addBatch(String(detail.pageId || ''), detail.records || []);
            scheduleRefresh();
        }
    });

    const observer = new MutationObserver(() => scheduleRefresh());
    function startCanvasSupport() {
        if (started || !isCanvasSite()) return;
        started = true;
        const root = document.querySelector('#canvas-reader') || document.body;
        if (root) observer.observe(root, { childList: true, subtree: true });
        handshake();
        setTimeout(handshake, 250);
        setTimeout(handshake, 750);
        scheduleRefresh();
    }

    C.isCanvasSite = isCanvasSite;
    C.startCanvasSupport = startCanvasSupport;
    C.refreshCanvasEraMarks = refreshAll;
    C.runCanvasRegex = function () {
        // 手动点识别：禁用网站上也认，并且标记留着（和 DOM 路径的手动识别一致）。
        forced = true;
        refreshAll();
        return C.resp({ count: R.state.count, canvas: true });
    };
    C.clearCanvasMarks = clearCanvasMarks;
    C.removeCanvasMark = removeCanvasMark;
    C.CANVAS_MARK = C.CANVAS_MARK || 'era-hl-canvas-mark';

    // content.js 会在加载设置后调用 startCanvasSupport；这里不主动绕过用户自定义站点白名单。
})();
