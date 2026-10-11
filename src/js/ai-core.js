(function (global) {
    'use strict';
    const DEFAULT_API_BASE = 'https://api.openai.com/v1';
    const DEFAULT_MODEL = 'gpt-4o-mini';
    // 「连续使用」= 一个**次数**额度（以前是时长，已整体换成次数）：
    // 点「AI 识别」开一批（额度 = 这里选的那个数），之后每次 AI 识别扣一次，扣完自动停；
    // 想再来一批就再点一次「AI 识别」。
    const CONTINUOUS_OPTIONS = [
        { value: 'once', label: '单次', count: 0 },
        { value: '20', label: '20 次', count: 20 },
        { value: '100', label: '100 次', count: 100 },
        { value: '300', label: '300 次', count: 300 },
        { value: '999', label: '999 次', count: 999 }
    ];
    function continuousCount(value) {
        const hit = CONTINUOUS_OPTIONS.filter(function (o) { return o.value === value; })[0];
        return hit ? hit.count : 0;
    }
    function isContinuous(value) {
        return continuousCount(value) > 0;
    }
    function continuousLabel(value) {
        const hit = CONTINUOUS_OPTIONS.filter(function (o) { return o.value === value; })[0];
        return hit ? hit.label : '单次';
    }
    const SYSTEM_PROMPT = [
        '你是一个年号纪年识别助手。用户会给你一段网页正文。',
        '请找出正文中所有「年号」（中国历代年号，如 贞观/开元/康熙/乾隆 等）及其纪年。',
        '',
        '严格遵守以下要求：',
        '1. 只输出 JSON，不要任何解释、前言、markdown 代码块或多余字符。',
        '2. 输出格式：',
        '{"results":[{"text":"原文中出现的完整片段","era":"年号名","dynasty":"唐/宋/明/清/西漢 等","emperor":"漢武帝/光武帝/唐太宗 等","year":纪年数字(整数，元年=1),"gregorian":换算出的公历年(整数)}]}',
        '3. text 必须是原文中逐字出现的片段，包含年号、数字和「年」字，不要改写、不要增删空格。例如原文是「康熙二十三年」就输出「康熙二十三年」；原文是「貞觀廿一年」就照抄「貞觀廿一年」，**不要改写成「貞觀二十一年」**（廿/卅/卌 这类合文原样保留）。',
        '4. 只输出你确信属于年号纪年的片段。像「文明」「文化」「大同」「天平」这类词，如果不是在纪年语境（后面跟着数字和「年」），就不要输出。',
        '5. 换算规则：公历年 = 年号元年对应的公历年 + 纪年数字 - 1。例如康熙元年=1662，则康熙二十三年=1684。',
        '6. 公元前用负数表示，不要写「前」字：前140年写 -140。例如建元元年=前140，则建元元年写 -140，建元六年写 -135。',
        '7. 如果同一片段可能对应多个年号（例如「貞觀」唐朝和西夏都用过），只输出最可能的那一个。',
        '8. 没有找到任何年号时输出 {"results":[]}。',
        '9. era / dynasty / emperor 一律用**繁体正字**，并与下面【参考】表里的写法保持一致（参考表里出现过的年号，era 必须照抄它的写法）：',
        '   写「貞觀」不写「贞观」，「西漢」不写「西汉」，「漢武帝」不写「汉武帝」。',
        '   dynasty 和 emperor 也要用年号表里的写法，并且和 era 用同一套繁简 —— 程序会拿它们和年号表比对，简繁不一致会选错朝代。',
        '',
        '史书里还有一种写法：年号只写一次，后面的年份省掉年号，只写「二年」「三年」「其二年」「起二年」等。',
        '例如「建隆元年春正月乙巳……二年春正月丙申朔。三年……乾德元年」——',
        '这里的「二年」「三年」都是建隆纪年，「乾德元年」是新的年号。',
        '这类片段也要输出：text 就写原文里那两个字（如「二年」），era 填它所属的年号，',
        'year 填年数，gregorian 按第 5 条算出来（建隆元年=960，则建隆二年=961）。纪年数字只允许元、廿～廿九、卅～卅九、卌～卌九、二～六十一、或年号后面的阿拉伯数字1～61；不要把「一年」「零年」「〇年」或超过六十一年的错误写法当成有效纪年。',
        '注意：省略年号时只认中文（「二年」「三十三年」「廿一年」）；像「33年」这种没有年号、',
        '又是阿拉伯数字的，不要输出。但年号后面跟年份时，阿拉伯数字也算，',
        '「建元3年」与「建元三年」按同样方式处理。',
        '判断依据是「前面最近的完整纪年」；但如果那个年份其实是在说年数而不是纪年',
        '（「他在位二年」「二年之后」「历时三年」），不要输出。',
        '',
        '还有一种写法：年号后面不跟具体年份，而是跟「初」「末」「中」「年间」，',
        '表示「这个年号的某一段时期」。例如「贞观年间」「开元中」「开元初」「开元末」。',
        '这类也要输出：text 就写原文里那一段（如「贞观年间」「开元中」），',
        'era 填年号，year 填 null（没有具体年数），',
        'gregorian 填该年号的**元年**（也就是这段时期的起点），eraStart 也填元年。',
        '注意别和上面的「二年」「三年」混了 —— 这里说的是整段时期，不是某一年。'
    ].join('\n');
    function buildReference(text) {
        const D = global.EraData;
        if (!D || !D.ERAS)
            return '';
        const folded = text ? D.canonicalForm(String(text)) : '';
        const seen = new Set();
        const parts = [];
        for (const e of D.ERAS) {
            if (!Number.isFinite(e.start))
                continue;
            if (seen.has(e.name))
                continue;
            const key = D.canonicalForm(e.name);
            if (folded && folded.indexOf(key) === -1)
                continue;
            seen.add(e.name);
            // 参考表给的是「元年」公历年，不是年号表里的 start —— 表里第 6 列那种
            // 不从元年开始计数的条目（天會：968 是十二年），元年要往前挪。
            const first = D.eraYear ? D.eraYear(e.start, 1, e.offset) : e.start;
            if (!Number.isFinite(first))
                continue;
            parts.push(e.name + ':' + D.formatYear(first));
        }
        if (!parts.length)
            return '';
        return '\n\n【参考：年号 -> 元年公历年】\n' + parts.join('、');
    }
    function buildUserContent(text, title, url) {
        return [
            '网页标题：' + (title || '(无)'),
            '网页地址：' + (url || '(无)'),
            '',
            '正文如下（可能被截断）：',
            '-----',
            text,
            '-----'
        ].join('\n');
    }
    function buildEndpoint(apiBase) {
        let base = String(apiBase || '').trim().replace(/\/+$/, '');
        if (!base)
            base = DEFAULT_API_BASE;
        if (/\/chat\/completions$/.test(base))
            return base;
        return base + '/chat/completions';
    }
    const LOCAL_HOST = new RegExp('^https?://(' +
        'localhost|127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|\\[::1\\]|0\\.0\\.0\\.0|' +
        '10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|' +
        '192\\.168\\.\\d{1,3}\\.\\d{1,3}|' +
        '172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}' +
        ')(?::\\d+)?(?:/|$)', 'i');
    function isLocalEndpoint(apiBase) {
        return LOCAL_HOST.test(String(apiBase || '').trim());
    }
    function needsApiKey(apiBase) {
        return !isLocalEndpoint(apiBase);
    }
    function isConfigured(cfg) {
        if (!cfg)
            return false;
        if (cfg.apiKey)
            return true;
        return !needsApiKey(cfg.apiBase);
    }
    function stripFence(s) {
        return String(s || '')
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/```\s*$/, '')
            .trim();
    }
    function pickArray(data) {
        if (Array.isArray(data))
            return data;
        if (!data || typeof data !== 'object')
            return [];
        for (const key of ['results', 'data', 'eras', 'items', 'list']) {
            if (Array.isArray(data[key]))
                return data[key];
        }
        return [];
    }
    // 模型给的 era / dynasty / emperor 可能是简体、异体，或者加「朝」「代」「大」的写法
    // （「贞观」「西汉」「大金」「金朝」），而下游有好几处是**字面比较**：
    //   - `rangeOf(era, dynasty)`：朝代对不上就退回「同年号里取最早的那条」→ 公元年 / 范围静默选错；
    //   - `dynastyMatch()`（content-annotation.js）：严格相等 → 「沿用上一处朝代」失效；
    //   - 卡片标题里 `whoText()` 拼出来的朝代 / 帝号会跟正则路径不一致。
    // 所以在这里（**parseResults 里，早于 enrichRanges**）用年号表把它们归一成表里的写法。
    // 表里查不到、或者分不清是哪个朝代 → 返回 null，保持模型给的原样。
    function normalizeWho(era, dynasty, emperor) {
        const D = global.EraData;
        if (!D || typeof D.lookupEra !== 'function')
            return null;
        const rows = D.lookupEra(String(era || '').trim()) || [];
        if (!rows.length)
            return null;
        const fold = function (s) {
            const v = String(s == null ? '' : s);
            return typeof D.canonicalForm === 'function' ? D.canonicalForm(v) : v;
        };
        const want = fold(dynasty);
        let pool = rows;
        if (want) {
            const hit = rows.filter(function (r) {
                const names = (typeof D.contextNames === 'function' ? D.contextNames(r) : null) ||
                    [r && r.dynasty, r && r.emperor];
                return names.some(function (n) { return n && fold(n) === want; });
            });
            if (hit.length)
                pool = hit;
        }
        // 池子里必须只剩同一个朝代，否则宁可不改
        const dyn = String(pool[0].dynasty || '');
        if (!pool.every(function (r) { return String(r.dynasty || '') === dyn; }))
            return null;
        const out = { era: String(pool[0].name || ''), dynasty: dyn };
        // 只有一条时 emperor 也能定下来；多条（同名年号同朝代、不同帝号）就保留模型给的
        if (pool.length === 1 && pool[0].emperor)
            out.emperor = String(pool[0].emperor);
        return out;
    }
    function parseResults(content) {
        const text = stripFence(content);
        let data;
        try {
            data = JSON.parse(text);
        }
        catch (e) {
            const s = text.indexOf('{');
            const t = text.lastIndexOf('}');
            if (s >= 0 && t > s) {
                try {
                    data = JSON.parse(text.slice(s, t + 1));
                }
                catch (e2) {
                    throw new Error('AI 返回的内容不是合法 JSON');
                }
            }
            else {
                throw new Error('AI 返回的内容不是合法 JSON');
            }
        }
        const num = function (v) {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
        return pickArray(data)
            .filter(function (r) { return r && typeof r === 'object'; })
            .map(function (r) {
            const era = String(r.era || r.eraName || '').trim();
            const dynasty = String(r.dynasty || r.region || '').trim();
            const emperor = String(r.emperor || '').trim();
            const who = normalizeWho(era, dynasty, emperor);
            return {
                text: String(r.text || r.match || r.snippet || '').trim(),
                era: (who && who.era) || era,
                dynasty: (who && who.dynasty) || dynasty,
                emperor: (who && who.emperor) || emperor,
                year: num(r.year),
                gregorian: num(r.gregorian != null ? r.gregorian
                    : (r.gregorianYear != null ? r.gregorianYear : r.ad)),
                eraStart: num(r.eraStart)
            };
        })
            .filter(function (r) { return r.text && r.text.length >= 2; });
    }
    async function callChat(cfg, userContent, useJsonMode, plainText) {
        const endpoint = buildEndpoint(cfg.apiBase);
        const body = {
            model: cfg.model || DEFAULT_MODEL,
            temperature: 0,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT + buildReference(plainText) },
                { role: 'user', content: userContent }
            ]
        };
        if (useJsonMode)
            body.response_format = { type: 'json_object' };
        if (/deepseek\.com/i.test(cfg.apiBase || '')) {
            body.thinking = { type: 'enabled' };
            body.reasoning_effort = 'high';
            delete body.temperature;
        }
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.apiKey)
            headers.Authorization = 'Bearer ' + cfg.apiKey;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        const raw = await res.text();
        let json = null;
        try {
            json = JSON.parse(raw);
        }
        catch (e) { }
        if (!res.ok) {
            const msg = (json && json.error && (json.error.message || json.error.type)) ||
                raw.slice(0, 300) || ('HTTP ' + res.status);
            const err = new Error('接口返回 ' + res.status + '：' + msg +
                (json ? '' : '（原文：' + raw.slice(0, 200) + '）'));
            err.status = res.status;
            throw err;
        }
        const content = json && json.choices && json.choices[0] &&
            json.choices[0].message && json.choices[0].message.content;
        if (!content)
            throw new Error('接口返回内容为空');
        return {
            content: content,
            usage: (json && json.usage) || null,
            model: (json && json.model) || cfg.model
        };
    }
    async function analyze(cfg, text, title, url) {
        if (!isConfigured(cfg)) {
            return {
                ok: false,
                code: 'NO_API_KEY',
                error: '还没有配置 API Key。请在AI模型配置中填写。。'
            };
        }
        const userContent = buildUserContent(text, title, url);
        let lastErr = null;
        for (const useJson of [true, false]) {
            try {
                const r = await callChat(cfg, userContent, useJson, text);
                const results = parseResults(r.content);
                try {
                    enrichRanges(results);
                }
                catch (e) { }
                try {
                    recordAiCall(results, r, "");
                }
                catch (e) { }
                return { ok: true, results: results, raw: results.length, usage: r.usage, model: r.model };
            }
            catch (e) {
                lastErr = e;
                const retriable = useJson && e && (e.status === 400 || e.status === 422);
                if (!retriable)
                    break;
            }
        }
        return {
            ok: false,
            code: 'AI_ERROR',
            error: String((lastErr && lastErr.message) || lastErr || 'AI 调用失败')
        };
    }
    async function testConnection(cfg) {
        if (!isConfigured(cfg)) {
            const who = cfg.modelId || cfg.model || '当前模型';
            return {
                ok: false,
                code: 'NO_API_KEY',
                error: '「' + who + '」还没有 API Key（接口地址：' + (cfg.apiBase || '（空）') +
                    '）。每个模型各存各的 Key，请确认填的是下拉里当前选中的那一个。'
            };
        }
        try {
            const r = await callChat(cfg, '貞觀二十三年、康熙二十三年、乾隆六十年。', false, '貞觀二十三年、康熙二十三年、乾隆六十年。');
            const results = parseResults(r.content);
            try {
                enrichRanges(results);
            }
            catch (e) { }
            try {
                recordAiCall(results, r, "测试连接");
            }
            catch (e) { }
            return { ok: true, model: r.model, count: results.length, sample: results.slice(0, 3) };
        }
        catch (e) {
            return { ok: false, code: 'AI_ERROR', error: String((e && e.message) || e) };
        }
    }
    const FALLBACK_RANGE_FORM = /(?:年间|中|初|末)$/;
    function rangeForm() {
        const D = global.EraData || (typeof self !== "undefined" ? self.EraData : null);
        return (D && D.RANGE_FORM) || FALLBACK_RANGE_FORM;
    }
    function eraRangeOf(eraName, dynasty) {
        const D = global.EraData || (typeof self !== "undefined" ? self.EraData : null);
        return D && D.rangeOf ? D.rangeOf(eraName, dynasty) : null;
    }
    function enrichRanges(results) {
        for (const r of (results || [])) {
            if (!r || !rangeForm().test(String(r.text || "").trim()))
                continue;
            const rg = eraRangeOf(r.era, r.dynasty);
            if (!rg)
                continue;
            r.eraStart = rg.start;
            r.eraEnd = rg.end;
            r.range = true;
        }
    }
    const AI_LOG_KEY = 'eraAiCallLog';
    const AI_LOG_MAX = 30;
    function recordAiCall(results, resp, note) {
        if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local)
            return;
        const entry = {
            at: Date.now(),
            model: (resp && resp.model) || "",
            count: (results || []).length,
            note: note || "",
            sample: (results || []).slice(0, 20).map(function (x) {
                return {
                    text: x.text, era: x.era, dynasty: x.dynasty, emperor: x.emperor,
                    year: x.year, gregorian: x.gregorian,
                    eraStart: x.eraStart, eraEnd: x.eraEnd, range: x.range
                };
            })
        };
        chrome.storage.local.get({ [AI_LOG_KEY]: [] }, function (v) {
            const list = Array.isArray(v && v[AI_LOG_KEY]) ? v[AI_LOG_KEY] : [];
            list.unshift(entry);
            chrome.storage.local.set({ [AI_LOG_KEY]: list.slice(0, AI_LOG_MAX) });
        });
    }
    global.EraAI = {
        DEFAULT_API_BASE: DEFAULT_API_BASE,
        DEFAULT_MODEL: DEFAULT_MODEL,
        CONTINUOUS_OPTIONS: CONTINUOUS_OPTIONS,
        continuousCount: continuousCount,
        isContinuous: isContinuous,
        continuousLabel: continuousLabel,
        SYSTEM_PROMPT: SYSTEM_PROMPT,
        buildReference: buildReference,
        buildUserContent: buildUserContent,
        buildEndpoint: buildEndpoint,
        isLocalEndpoint: isLocalEndpoint,
        needsApiKey: needsApiKey,
        isConfigured: isConfigured,
        stripFence: stripFence,
        parseResults: parseResults,
        callChat: callChat,
        analyze: analyze,
        testConnection: testConnection,
        AI_LOG_KEY: AI_LOG_KEY,
        recordAiCall: recordAiCall
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
