(function (global) {
    'use strict';
    const C = global.EraHL;
    if (!C)
        return;
    const R = C.runtime;
    if (global.__ERA_HL_BOOTED__)
        return;
    global.__ERA_HL_BOOTED__ = true;
    async function boot() {
        R.settings = await C.syncGet(C.DEFAULTS);
        R.state.disabled = !R.settings.enabled;
        C.applyMarkTheme();
        R.state.blocked = C.matchesSiteList(location.href, R.settings.blockedSites);
        R.state.siteMode = C.siteModeOf(R.settings);
        R.state.autoAllowed = C.autoRunAllowed(location.href, R.settings);
        await C.loadOverrides();
        await C.loadAiQuota();
        if (typeof C.startCanvasSupport === 'function') {
            try {
                C.startCanvasSupport();
            }
            catch (e) { }
        }
        R.aiRescanLeft = 3;
        if (R.state.disabled || !R.state.autoAllowed) {
            C.stopObserver();
            if (R.state.disabled) {
                try {
                    C.clearMarks(document.body);
                }
                catch (e) { }
            }
            return;
        }
        if (C.aiWindowActive()) {
            setTimeout(function () { autoRecognize(); }, 500);
        }
        else {
            setTimeout(function () { autoRecognize(); }, 400);
        }
        C.startObserver();
    }
    // 打开页面时的自动识别（也用于设置变化后重新识别）。
    // 「AI 缓存优先」= 开：先只查这个页面的 AI 缓存 ——
    //   命中：用 AI 缓存结果（runAI 会把 mode 设成 'ai'），**不跑正则**；
    //   没命中：安静退回正则识别（和「不优先」时完全一样）。
    // 只在站点允许自动识别时才会走到这里（「全局禁用」/ 禁用网站 / 自定义名单外都不自动跑）。
    function autoRecognize() {
        if (C.aiWindowActive()) {
            if (!R.state.busy)
                C.runAI({ auto: true });
            return;
        }
        if (R.settings.regexReplace) {
            Promise.resolve(C.runAI({ auto: true, cacheOnly: true })).then(function (r) {
                if (!r || !r.ok)
                    safeRun();
            }, function () {
                safeRun();
            });
            return;
        }
        safeRun();
    }
    function safeRun() {
        try {
            R.scanRoot = null;
            C.runRegex();
        }
        catch (error) {
            R.state.lastError = String(error && error.message || error);
        }
    }
    function updateSiteState() {
        R.state.blocked = C.matchesSiteList(location.href, R.settings.blockedSites);
        R.state.siteMode = C.siteModeOf(R.settings);
        R.state.autoAllowed = C.autoRunAllowed(location.href, R.settings);
    }
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'sync') {
            let annotateChanged = false;
            let enabledChanged = false;
            let siteChanged = false;
            let regexReplaceChanged = false;
            Object.keys(changes || {}).forEach(function (key) {
                if (!(key in C.DEFAULTS))
                    return;
                R.settings[key] = changes[key].newValue;
                annotateChanged ||= key === 'annotate' || key === 'siteAnnotationMode';
                enabledChanged ||= key === 'enabled';
                siteChanged ||= key === 'siteMode' || key === 'blockedSites' || key === 'allowedSites';
                regexReplaceChanged ||= key === 'regexReplace';
                if (key === 'markTheme' || key === 'copyAnno')
                    C.applyMarkTheme();
                if (typeof C.refreshCanvasEraMarks === 'function' &&
                    ['standalone', 'enabled', 'siteMode', 'blockedSites', 'allowedSites', 'preRepublic', 'annotate', 'siteAnnotationMode', 'markTheme', 'regexReplace'].includes(key)) {
                    try {
                        C.refreshCanvasEraMarks();
                    }
                    catch (e) { }
                }
            });
            if (annotateChanged) {
                try {
                    C.refreshAnnotations(document.body);
                }
                catch (e) { }
            }
            if (siteChanged && !R.state.disabled) {
                updateSiteState();
                if (R.state.autoAllowed) {
                    try {
                        C.runRegex();
                    }
                    catch (e) { }
                    if (typeof C.refreshCanvasEraMarks === 'function') {
                        try { C.refreshCanvasEraMarks(); } catch (e) { }
                    }
                    C.startObserver();
                }
                else {
                    C.stopObserver();
                    try {
                        C.clearMarks(document.body);
                    }
                    catch (e) { }
                    if (typeof C.refreshCanvasEraMarks === 'function') {
                        try { C.refreshCanvasEraMarks(); } catch (e) { }
                    }
                    R.state.mode = 'idle';
                    try {
                        C.refreshAnnotations(document.body);
                    }
                    catch (e) { }
                }
            }
            if (enabledChanged) {
                R.state.disabled = !R.settings.enabled;
                if (R.state.disabled) {
                    C.stopObserver();
                    try {
                        C.clearMarks(document.body);
                    }
                    catch (e) { }
                }
                else {
                    R.state.userCleared = false;
                    updateSiteState();
                    if (R.state.autoAllowed) {
                        try {
                            C.runRegex();
                        }
                        catch (e) { }
                        C.startObserver();
                    }
                }
            }
            // 改了「AI 缓存优先」→ 当场按新设置重来一遍（开了就试 AI 缓存，关了就跑正则）。
            if (regexReplaceChanged && !R.state.disabled && R.state.autoAllowed && !enabledChanged) {
                R.state.userCleared = false;
                autoRecognize();
            }
            return;
        }
        if (area === 'local') {
            if (changes.aiQuotaTotal)
                R.aiQuotaTotal = Number(changes.aiQuotaTotal.newValue) || 0;
            if (changes.aiQuotaUsed)
                R.aiQuotaUsed = Number(changes.aiQuotaUsed.newValue) || 0;
            if (C.aiWindowActive())
                R.aiRescanLeft = 3;
        }
    });
    global.__eraIsBlockedSite = C.matchesSiteList;
    global.__eraAutoRunAllowed = C.autoRunAllowed;
    boot();
})(typeof globalThis !== 'undefined' ? globalThis : self);
