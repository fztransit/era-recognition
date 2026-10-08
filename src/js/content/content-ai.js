(function (global) {
    'use strict';
    const C = global.EraHL;
    if (!C)
        return;
    const D = C.D;
    const MT = C.MT;
    const R = C.runtime;
    const RANGE_FORM = D.RANGE_FORM;
    function aiResultToInfo(result) {
        const gregorian = Number(result && result.gregorian);
        const year = Number(result && result.year);
        const range = RANGE_FORM.test(String(result && result.text || '').trim())
            ? (Number.isFinite(result.eraStart)
                ? { start: result.eraStart, end: result.eraEnd }
                : D.rangeOf(result.era, result.dynasty))
            : null;
        return {
            era: result.era || result.text || '年号',
            dynasty: result.dynasty || result.region || 'AI',
            emperor: result.emperor || '',
            eraStart: range ? range.start : null,
            eraEnd: range ? range.end : null,
            // 年号表里「不从元年开始计数」的条目（第 6 列），范围写法要带上这个偏移。
            eraOffset: range && Number.isFinite(range.offset) && range.offset >= 1 ? range.offset : 1,
            range: !!range,
            n: Number.isFinite(year) ? year : null,
            gregorian: Number.isFinite(gregorian) ? gregorian : null,
            matched: result.text,
            source: 'ai'
        };
    }
    async function runAI(options) {
        const opts = options || {};
        if (R.state.busy)
            return C.resp({ ok: false, error: '正在分析中，请稍候…' });
        R.state.busy = true;
        R.state.userCleared = false;
        try {
            C.stripAnnotations(document.body);
            const extracted = MT.extractPlainText(R.settings.maxChars);
            const text = extracted && extracted.text;
            if (!text || text.length < 10) {
                R.state.lastError = '未能从当前页面提取到正文文本';
                return C.resp({ ok: false, error: R.state.lastError, code: 'NO_TEXT' });
            }
            const response = await chrome.runtime.sendMessage({
                type: 'AI_ANALYZE',
                text,
                title: extracted.title,
                url: extracted.url,
                noCache: !!opts.noCache,
                // 「AI 缓存优先」用：只查缓存、不调接口（背景里命中就直接返回，没命中回 NO_CACHE）
                cacheOnly: !!opts.cacheOnly
            });
            if (!response || !response.ok) {
                const code = (response && response.code) || 'AI_ERROR';
                // 「只查缓存」没查到是**正常情况**（这页还没缓存），不是错误 ——
                // 不写 lastError，让调用方安静地退回正则识别。
                if (opts.cacheOnly && code === 'NO_CACHE')
                    return C.resp({ ok: false, code: 'NO_CACHE' });
                R.state.lastError = response && response.error || 'AI 调用失败';
                return C.resp({ ok: false, error: R.state.lastError, code: code });
            }
            const results = Array.isArray(response.results) ? response.results : [];
            const root = extracted.el || C.getScanRoot(true) || document.body;
            C.clearMarks(root);
            const byText = new Map();
            results.forEach(function (result) {
                const key = String(result && result.text || '').trim();
                if (key.length < 2)
                    return;
                if (!byText.has(key))
                    byText.set(key, []);
                byText.get(key).push(result);
            });
            R.state.mode = 'ai';
            R.state.aiRaw = results.length;
            R.state.scannedAt = Date.now();
            R.state.cached = !!response.cached;
            R.state.cacheExact = !!response.exact;
            const meta = {
                cached: !!response.cached,
                cacheExact: !!response.exact,
                cacheDropped: response.dropped || 0,
                cacheAge: response.age || 0,
                auto: !!opts.auto
            };
            if (!byText.size) {
                R.state.count = 0;
                R.state.lastError = '';
                return C.resp(Object.assign({ count: 0, raw: results.length }, meta));
            }
            const keys = Array.from(byText.keys()).sort(function (a, b) { return b.length - a.length; });
            const re = new RegExp('(' + keys.map(D.escapeRe).join('|') + ')', 'g');
            const count = C.applyMarks(root, function (value) {
                re.lastIndex = 0;
                const matches = [];
                let match;
                while ((match = re.exec(value)) !== null) {
                    const list = byText.get(match[0]);
                    if (!list)
                        continue;
                    // 和正则路径保持一致：紧挨在「年号 + 纪年 / 范围写法」前面的朝代、帝号
                    // 也一起圈进高亮（「唐僖宗廣明元年」整段高亮）。
                    // 只有匹配里**含年号**的才扩 —— 模型对省略年号的「二年」「三年」也会输出，
                    // 那种情况和正则的裸纪年一样不扩（见 content-scanner.js 的注释）。
                    // 注意 index/end 仍是「年号那一段」：__eraKey、更正记录、卡片标题都不受影响，
                    // 只有切高亮文字用 hlIndex（见 content-marker.js 的 createMark）。
                    const hasEra = list.some(function (r) {
                        const era = String(r && r.era || '').trim();
                        return !!era && D.canonicalForm(match[0]).indexOf(D.canonicalForm(era)) >= 0;
                    });
                    matches.push({
                        index: match.index,
                        end: match.index + match[0].length,
                        hlIndex: hasEra
                            ? match.index - D.whoPrefixLength(value.slice(0, match.index))
                            : match.index,
                        info: list.map(aiResultToInfo),
                        range: RANGE_FORM.test(match[0])
                    });
                }
                return matches;
            }, 'ai');
            C.refreshEraContext(root);
            C.refreshAnnotations(root);
            C.reanchorTooltip();
            R.state.count = count;
            R.state.lastError = '';
            return C.resp(Object.assign({ count, raw: results.length }, meta));
        }
        catch (error) {
            R.state.lastError = String(error && error.message || error);
            return C.resp({ ok: false, error: R.state.lastError, code: 'EXCEPTION' });
        }
        finally {
            R.state.busy = false;
        }
    }
    C.aiResultToInfo = aiResultToInfo;
    C.runAI = runAI;
})(typeof globalThis !== 'undefined' ? globalThis : self);
