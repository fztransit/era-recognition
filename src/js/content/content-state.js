(function (global) {
    'use strict';
    if (global.EraHL)
        return;
    const D = global.EraData;
    const MT = global.EraMainText;
    const storage = global.EraStorage;
    if (!D || !MT)
        return;
    const MARK = 'era-hl-mark';
    const AI_CLASS = 'era-hl-ai';
    const TIP_CLASS = 'era-hl-tip';
    const FIX_CLASS = 'era-hl-fix';
    // 卡片与更正面板之间那块透明的「桥接」区域（鼠标从卡片移到面板的途中不至于掉出去）。
    const POPUP_GROUP_CLASS = 'era-hl-popup-group';
    const ANNO_CLASS = 'era-hl-anno';
    // Canvas 阅读器的覆盖标记：与普通 DOM 年号标记分开，避免 clearMarks() 把覆盖层还原成正文文本。
    const CANVAS_MARK = 'era-hl-canvas-mark';
    // 浅色变体（amber/green/blue/pink/gray）+ 深色网页变体（*-dark）。白名单漏一个，
    // applyMarkTheme() 就会把用户选的色卡当成非法值退回 amber —— 加色卡时这里必须同步加。
    const MARK_THEMES = [
        'amber', 'green', 'blue', 'pink', 'gray', 'none',
        'amber-dark', 'green-dark', 'blue-dark', 'pink-dark', 'gray-dark'
    ];
    // 「限制」模式下默认禁用的网站。识典古籍**不在这里** —— 它的正文画在 canvas 上，
    // DOM 扫描器本来就标不到（见 content-scanner.js 的 runRegex），
    // 识别由 canvas-adapter 负责；用户想关掉它，自己加进「禁用网站」即可。
    const DEFAULT_BLOCKED_SITES = [];
    // 仅这些网站受「文内标注限制」控制；网站列表固定写在 JS 中，不在设置页面展示。
    const INLINE_ANNOTATION_LIMIT_SITES = ['www.shidianguji.com'];
    const DEFAULTS = Object.freeze({
        // 「AI 缓存优先」：true = 打开页面时先看这个页面有没有 AI 缓存，
        // 有就用 AI 缓存结果、不跑正则；没有才退回正则。false（默认）= 照常跑正则。
        regexReplace: false,
        standalone: false,
        annotate: false,
        // 复制页面文字时是否带上文内标注（「弘道元年（683）」里的「（683）」）。
        // 默认 false：标注不进选区，复制出来仍是原文。
        copyAnno: false,
        // 共和（前 841）之前的纪年：默认「不识别」—— 那段年份只能算「约」，先不标注。
        // true = 识别：照常标注，且前 841 年（不含）之前的年份带「约」字。
        preRepublic: false,
        // 标注 = 指定网站允许文内标注；不标注 = 指定网站始终不显示文内标注。
        siteAnnotationMode: 'annotate',
        maxChars: 12000,
        markTheme: 'amber',
        enabled: true,
        siteMode: 'restricted',
        allowedSites: [],
        blockedSites: DEFAULT_BLOCKED_SITES,
        // 卡片（悬浮弹框）的触发方式：hover=鼠标移上去 / click=单击 / longpress=按住约半秒。
        // （老版本还有个 dblclick，因为「双击 = 两次 click + dblclick」在链接上没法拦，已下线。）
        // 默认单击：不用把鼠标精确停在年号上，点一下就行。
        tooltipTrigger: 'click',
        apiBase: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
        aiContinuous: 'once'
    });
    const SKIP_TAGS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
        'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED',
        'TITLE', 'HEAD', 'META', 'LINK', 'MAP', 'AREA', 'AUDIO', 'VIDEO'
    ]);
    const runtime = {
        settings: Object.assign({}, DEFAULTS),
        state: {
            mode: 'idle', count: 0, busy: false, lastError: '', aiRaw: 0, scannedAt: 0,
            userCleared: false, cached: false, cacheExact: false, disabled: false,
            blocked: false, siteMode: 'restricted', autoAllowed: true
        },
        scanRoot: null,
        tooltipEl: null,
        activeMark: null,
        fixEl: null,
        fixOpen: false,
        popupGroupEl: null,
        popupGroupHovered: false,
        fixMark: null,
        observer: null,
        scanTimer: null,
        scanBudget: 0,
        aiRescanLeft: 0,
        lastSelfMutation: 0,
        aiQuotaTotal: 0,
        aiQuotaUsed: 0,
        overrides: {},
        eraFixes: {},
        // 被用户点「清除」的片段（key 同 __eraKey）：这些不是纪年，重新识别时不再标记。
        eraIgnores: {},
        overrideSaveTimer: null,
        hideTimer: null,
        tooltipHovered: false,
        pointerX: -1,
        pointerY: -1,
        repositionRaf: 0
    };
    function syncGet(defaults) {
        if (storage && storage.sync) {
            return storage.sync.getAll().then(function (value) {
                return Object.assign({}, defaults, value || {});
            }).catch(function () {
                return Object.assign({}, defaults);
            });
        }
        return new Promise(function (resolve) {
            try {
                chrome.storage.sync.get(defaults, function (value) {
                    resolve(Object.assign({}, defaults, value || {}));
                });
            }
            catch (e) {
                resolve(Object.assign({}, defaults));
            }
        });
    }
    function localGet(key, fallback) {
        if (storage && storage.local)
            return storage.local.getValue(key, fallback).catch(function () { return fallback; });
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get(key, function (value) {
                    resolve(value && value[key] !== undefined ? value[key] : fallback);
                });
            }
            catch (e) {
                resolve(fallback);
            }
        });
    }
    function syncSet(values) {
        if (storage && storage.sync)
            return storage.sync.set(values).catch(function () { });
        try {
            chrome.storage.sync.set(values);
        }
        catch (e) { }
        return Promise.resolve();
    }
    function localSet(values) {
        if (storage && storage.local)
            return storage.local.set(values).catch(function () { });
        try {
            chrome.storage.local.set(values);
        }
        catch (e) { }
        return Promise.resolve();
    }
    function siteModeOf(source) {
        const mode = String((source && source.siteMode) || 'restricted');
        return mode === 'global' || mode === 'custom' || mode === 'disabled' ? mode : 'restricted';
    }
    function normalizeSiteRule(value) {
        let rule = String(value == null ? '' : value).trim().toLowerCase();
        if (!rule)
            return '';
        rule = rule.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        if (rule.indexOf('www.') === 0)
            rule = rule.slice(4);
        return rule;
    }
    function matchesSiteList(href, list) {
        if (!Array.isArray(list) || !list.length)
            return false;
        let url;
        try {
            url = new URL(href);
        }
        catch (e) {
            return false;
        }
        if (!/^https?:$/.test(url.protocol))
            return false;
        const host = url.hostname.toLowerCase();
        const path = (url.pathname + url.search).toLowerCase();
        for (const raw of list) {
            const rule = normalizeSiteRule(raw);
            if (!rule)
                continue;
            const slash = rule.indexOf('/');
            if (slash < 0) {
                if (host === rule || host.endsWith('.' + rule))
                    return true;
                continue;
            }
            const ruleHost = rule.slice(0, slash);
            const rulePath = rule.slice(slash);
            if ((host === ruleHost || host.endsWith('.' + ruleHost)) && path.indexOf(rulePath) === 0)
                return true;
        }
        return false;
    }
    function autoRunAllowed(href, source) {
        const cfg = source || runtime.settings;
        const mode = siteModeOf(cfg);
        if (mode === 'global')
            return true;
        if (mode === 'custom')
            return matchesSiteList(href, cfg.allowedSites);
        // 「全局禁用」：所有网页都不自动识别，只能在弹窗里手动点识别按钮。
        if (mode === 'disabled')
            return false;
        return !matchesSiteList(href, cfg.blockedSites);
    }
    function inlineAnnotationAllowed(href, source) {
        const cfg = source || runtime.settings;
        if (String(cfg.siteAnnotationMode || 'annotate') !== 'no-annotate')
            return true;
        return !matchesSiteList(href || location.href, INLINE_ANNOTATION_LIMIT_SITES);
    }
    function applyMarkTheme() {
        const value = MARK_THEMES.includes(String(runtime.settings.markTheme))
            ? String(runtime.settings.markTheme)
            : 'amber';
        try {
            document.documentElement.setAttribute('data-era-hl', '1');
            document.documentElement.setAttribute('data-era-theme', value);
            // 文内标注默认不进选区（user-select: none，复制时不带它）；
            // 打开「复制标注纪年」时挂上这个属性，CSS 把它变回可选中。
            if (runtime.settings.copyAnno)
                document.documentElement.setAttribute('data-era-anno-copy', '1');
            else
                document.documentElement.removeAttribute('data-era-anno-copy');
        }
        catch (e) { }
    }
    // 「连续使用」的次数额度（以前是 aiUntil / aiDurationMs 两个时间戳，已删除）。
    // aiQuotaTotal = 这一批总次数（0 = 没开批次）；aiQuotaUsed = 已用几次。
    async function loadAiQuota() {
        runtime.aiQuotaTotal = Number(await localGet('aiQuotaTotal', 0)) || 0;
        runtime.aiQuotaUsed = Number(await localGet('aiQuotaUsed', 0)) || 0;
    }
    // 批次还开着（还有剩余次数）→ 新页面自动走 AI。
    function aiWindowActive() {
        return runtime.aiQuotaTotal > 0 && runtime.aiQuotaUsed < runtime.aiQuotaTotal;
    }
    const OVERRIDE_STORE = 'eraPickOverrides';
    const OVERRIDE_MAX_PAGES = 200;
    async function loadOverrides() {
        try {
            const all = await localGet(OVERRIDE_STORE, {});
            const entry = all && all[location.href];
            runtime.overrides = entry && entry.picks && typeof entry.picks === 'object' ? entry.picks : {};
            runtime.eraFixes = entry && entry.eras && typeof entry.eras === 'object' ? entry.eras : {};
            runtime.eraIgnores = entry && entry.ignores && typeof entry.ignores === 'object' ? entry.ignores : {};
        }
        catch (e) {
            runtime.overrides = {};
            runtime.eraFixes = {};
            runtime.eraIgnores = {};
        }
    }
    function saveOverrides() {
        clearTimeout(runtime.overrideSaveTimer);
        runtime.overrideSaveTimer = setTimeout(async function () {
            runtime.overrideSaveTimer = null;
            try {
                const all = await localGet(OVERRIDE_STORE, {});
                const data = all && typeof all === 'object' ? all : {};
                data[location.href] = {
                    at: Date.now(),
                    picks: runtime.overrides,
                    eras: runtime.eraFixes,
                    ignores: runtime.eraIgnores
                };
                const keys = Object.keys(data);
                if (keys.length > OVERRIDE_MAX_PAGES) {
                    keys.sort(function (a, b) { return (data[b].at || 0) - (data[a].at || 0); });
                    keys.slice(OVERRIDE_MAX_PAGES).forEach(function (key) { delete data[key]; });
                }
                await localSet({ [OVERRIDE_STORE]: data });
            }
            catch (e) { }
        }, 200);
    }
    // 清空本页保存的「更正」：内存里的候选选择（picks）、手动指定的年号（eras）、
    // 以及点「清除」记下的非纪年片段（ignores），连同本地存储里这一页的记录。
    // 返回被清掉的条数，供提示文案使用。
    function clearPageOverrides() {
        clearTimeout(runtime.overrideSaveTimer);
        runtime.overrideSaveTimer = null;
        const had = Object.keys(runtime.overrides || {}).length
            + Object.keys(runtime.eraFixes || {}).length
            + Object.keys(runtime.eraIgnores || {}).length;
        runtime.overrides = {};
        runtime.eraFixes = {};
        runtime.eraIgnores = {};
        return localGet(OVERRIDE_STORE, {}).then(function (all) {
            const data = all && typeof all === 'object' ? all : {};
            const entry = data[location.href];
            const stored = entry
                ? Object.keys(entry.picks || {}).length
                + Object.keys(entry.eras || {}).length
                + Object.keys(entry.ignores || {}).length
                : 0;
            if (entry) {
                delete data[location.href];
                return localSet({ [OVERRIDE_STORE]: data }).then(function () {
                    return Math.max(had, stored);
                });
            }
            return had;
        }).catch(function () {
            return had;
        });
    }
    function snapshot() {
        const s = runtime.settings;
        const state = runtime.state;
        return {
            mode: state.mode,
            count: state.count,
            busy: state.busy,
            aiRaw: state.aiRaw,
            lastError: state.lastError,
            scannedAt: state.scannedAt,
            userCleared: !!state.userCleared,
            cached: !!state.cached,
            cacheExact: !!state.cacheExact,
            disabled: !!state.disabled,
            markTheme: MARK_THEMES.includes(String(s.markTheme)) ? String(s.markTheme) : 'amber',
            blocked: !!state.blocked,
            siteMode: state.siteMode,
            autoAllowed: !!state.autoAllowed,
            allowedSites: Array.isArray(s.allowedSites) ? s.allowedSites.slice() : [],
            standalone: !!s.standalone,
            annotate: !!s.annotate,
            annoCount: document.querySelectorAll('.' + ANNO_CLASS).length,
            apiKeySet: !!s.apiKey,
            apiBase: s.apiBase || '',
            aiContinuous: s.aiContinuous || 'once',
            aiWindowActive: aiWindowActive(),
            aiQuotaTotal: runtime.aiQuotaTotal,
            aiQuotaUsed: runtime.aiQuotaUsed,
            url: location.href,
            title: document.title,
            eraTotal: Array.isArray(D.ERAS) ? D.ERAS.length : 0
        };
    }
    function resp(extra) {
        return Object.assign({ ok: true }, snapshot(), extra || {});
    }
    global.EraHL = {
        D,
        MT,
        storage,
        MARK,
        AI_CLASS,
        TIP_CLASS,
        FIX_CLASS,
        POPUP_GROUP_CLASS,
        ANNO_CLASS,
        CANVAS_MARK,
        MARK_THEMES,
        DEFAULTS,
        SKIP_TAGS,
        runtime,
        syncGet,
        syncSet,
        localGet,
        localSet,
        siteModeOf,
        matchesSiteList,
        autoRunAllowed,
        inlineAnnotationAllowed,
        INLINE_ANNOTATION_LIMIT_SITES,
        applyMarkTheme,
        loadAiQuota,
        aiWindowActive,
        loadOverrides,
        saveOverrides,
        clearPageOverrides,
        snapshot,
        resp,
        OVERRIDE_STORE,
        DEFAULT_BLOCKED_SITES
    };
})(typeof globalThis !== 'undefined' ? globalThis : self);
