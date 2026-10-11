importScripts('era-table.js', 'eras.js', 'ai-core.js', 'cache.js', 'models.js');
const EraData = self.EraData;
const EraAI = self.EraAI;
const EraCache = self.EraCache;
const EraModels = self.EraModels;
const READ_DEFAULTS = {
    standalone: false,
    annotate: false,
    maxChars: 12000,
    aiContinuous: 'once',
    enabled: true,
    siteMode: 'restricted',
    allowedSites: [],
    blockedSites: []
};
function seedSettings() {
    const profiles = EraModels.emptyProfiles();
    const flat = EraModels.flatten(profiles, EraModels.DEFAULT_ID);
    return Object.assign({}, READ_DEFAULTS, {
        activeModelId: EraModels.DEFAULT_ID,
        apiProfiles: profiles,
        apiBase: flat.apiBase,
        apiKey: flat.apiKey,
        model: flat.model
    });
}
const cache = EraCache.create(EraCache.chromeStore());
function loadSettings() {
    return new Promise(function (resolve) {
        chrome.storage.sync.get(null, function (v) {
            const raw = Object.assign({}, READ_DEFAULTS, v || {});
            const norm = EraModels.normalize(raw);
            const flat = EraModels.flatten(norm.profiles, norm.activeId);
            resolve({
                apiBase: flat.apiBase,
                apiKey: flat.apiKey,
                model: flat.model,
                modelId: norm.activeId,
                maxChars: Number(raw.maxChars) > 0 ? Number(raw.maxChars) : READ_DEFAULTS.maxChars
            });
        });
    });
}
function localGet(key, fallback) {
    return new Promise(function (resolve) {
        chrome.storage.local.get(key, function (v) {
            const got = v && v[key];
            resolve(got === undefined ? fallback : got);
        });
    });
}
function localSet(obj) {
    return new Promise(function (resolve) {
        chrome.storage.local.set(obj, function () { resolve(); });
    });
}
function syncGet(key, fallback) {
    return new Promise(function (resolve) {
        chrome.storage.sync.get({ [key]: fallback }, function (v) {
            const got = v && v[key];
            resolve(got === undefined ? fallback : got);
        });
    });
}
function syncSet(obj) {
    return new Promise(function (resolve) {
        chrome.storage.sync.set(obj, function () { resolve(); });
    });
}
function fail(e) {
    return { ok: false, code: 'AI_ERROR', error: String((e && e.message) || e) };
}
// 「连续使用」现在是**次数**额度，不再是时长（`aiUntil` / `aiDurationMs` 已删除）。
//   aiQuotaTotal —— 这一批的总次数（0 = 没开批次）
//   aiQuotaUsed  —— 这一批已经用掉几次
// 状态：
//   off       = 选项是「单次」，不计数
//   armed     = 选了次数但还没点「AI 识别」（total 还是 0）
//   active    = 批次进行中（used < total）
//   exhausted = 批次用完（used >= total），再点一次「AI 识别」开新批次
async function quotaState() {
    const total = Number(await localGet('aiQuotaTotal', 0)) || 0;
    const used = Number(await localGet('aiQuotaUsed', 0)) || 0;
    const setting = await syncGet('aiContinuous', 'once');
    const cap = EraAI.continuousCount(setting);
    const left = Math.max(0, total - used);
    const active = total > 0 && left > 0;
    const phase = active ? 'active'
        : (total > 0 ? 'exhausted' : (cap > 0 ? 'armed' : 'off'));
    return {
        active: active,
        phase: phase,
        setting: setting,
        settingLabel: EraAI.continuousLabel(setting),
        total: total,
        used: used,
        left: left,
        // 弹窗直接拿这个显示：「已使用：15/100次」
        usedText: total > 0 ? '已使用：' + used + '/' + total + '次' : ''
    };
}
// 点「AI 识别」时调用：
//   已经在计数中 → 不动额度（这一次识别会照常再扣 1），只把设置存下来；
//   否则 → 按当前选项开一批新的（已用清零）。
// 选项是「单次」→ 清掉额度，不进入计数模式。
async function applyContinuous(value) {
    const v = value || 'once';
    await syncSet({ aiContinuous: v });
    const cap = EraAI.continuousCount(v);
    if (!cap) {
        await localSet({ aiQuotaTotal: 0, aiQuotaUsed: 0 });
        return Object.assign({ started: false }, await quotaState());
    }
    const cur = await quotaState();
    if (cur.active)
        return Object.assign({ started: true, resumed: true }, cur);
    await localSet({ aiQuotaTotal: cap, aiQuotaUsed: 0 });
    return Object.assign({ started: true }, await quotaState());
}
// 只改选项（还没点「AI 识别」）→ 把额度清掉，回到「armed」，
// 免得「界面选的是 300 次、额度还是上一批的 100」这种对不上的状态。
async function armContinuous(value) {
    await syncSet({ aiContinuous: value || 'once' });
    await localSet({ aiQuotaTotal: 0, aiQuotaUsed: 0 });
    return quotaState();
}
// 一次**真的调了接口**的 AI 识别扣一次。
// 读缓存**不扣**（没花 token）—— 所以反复打开同一个页面不会吃掉次数；
// 接口报错也不扣（下面 analyzeWithCache 里只在成功分支调）。
// 用完不清零 —— 留着让弹窗能显示「已使用：100/100次」。
async function consumeAiQuota() {
    const total = Number(await localGet('aiQuotaTotal', 0)) || 0;
    if (total <= 0)
        return null;
    const used = Math.min(total, (Number(await localGet('aiQuotaUsed', 0)) || 0) + 1);
    await localSet({ aiQuotaUsed: used });
    return { total: total, used: used };
}
async function analyzeWithCache(cfg, text, title, url, noCache, cacheOnly) {
    if (!noCache) {
        const hit = await cache.lookup(url, cfg.model, text);
        if (hit) {
            // 命中缓存 → 直接用存下来的结果，**不扣次数**（没调接口、没花 token）。
            // 「AI 缓存优先」那种只读探测（cacheOnly）也不扣 —— 它本来就不调接口。
            return {
                ok: true,
                results: hit.results,
                raw: hit.results.length,
                cached: true,
                exact: hit.exact,
                dropped: hit.dropped,
                age: Date.now() - hit.entry.ts,
                model: hit.entry.model
            };
        }
    }
    // 「AI 缓存优先」用的只读探测：只要缓存，不调接口 —— 没有就明确告诉调用方，
    // 让它自己决定退回正则（这样不会因为一次探测白花 token）。
    if (cacheOnly)
        return { ok: false, code: 'NO_CACHE', error: '这个页面还没有 AI 缓存' };
    const r = await EraAI.analyze(cfg, text, title, url);
    if (!r.ok)
        return Object.assign({ cached: false }, r);
    try {
        await cache.save(url, cfg.model, text, r.results, title);
    }
    catch (e) { }
    await consumeAiQuota();
    return Object.assign({ cached: false }, r);
}
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    const type = msg && msg.type;
    if (type === 'AI_ANALYZE') {
        loadSettings()
            .then(function (cfg) {
            return analyzeWithCache(cfg, msg.text, msg.title, msg.url, !!msg.noCache, !!msg.cacheOnly);
        })
            .then(sendResponse)
            .catch(function (e) { sendResponse(fail(e)); });
        return true;
    }
    if (type === 'AI_TEST') {
        loadSettings()
            .then(function (cfg) { return EraAI.testConnection(cfg); })
            .then(sendResponse)
            .catch(function (e) { sendResponse(fail(e)); });
        return true;
    }
    if (type === 'AI_CACHE_STATS') {
        cache.stats()
            .then(function (s) { sendResponse(Object.assign({ ok: true }, s)); })
            .catch(function (e) { sendResponse(fail(e)); });
        return true;
    }
    if (type === 'AI_CACHE_CLEAR') {
        cache.clear()
            .then(function (n) {
            return cache.stats().then(function (s) {
                return Object.assign({ ok: true, removed: n }, s);
            });
        })
            .then(sendResponse)
            .catch(function (e) { sendResponse(fail(e)); });
        return true;
    }
    if (type === 'AI_CACHE_DROP') {
        cache.drop(msg.url, msg.model)
            .then(function () { return cache.stats(); })
            .then(function (s) { sendResponse(Object.assign({ ok: true }, s)); })
            .catch(function (e) { sendResponse(fail(e)); });
        return true;
    }
    if (type === 'AI_CONTINUOUS_GET') {
        quotaState()
            .then(function (s) { sendResponse(Object.assign({ ok: true }, s)); })
            .catch(function (e) { sendResponse(fail(e)); });
        return true;
    }
    if (type === 'AI_CONTINUOUS_SET') {
        applyContinuous(msg.value)
            .then(function (s) { sendResponse(Object.assign({ ok: true }, s)); })
            .catch(function (e) { sendResponse(fail(e)); });
        return true;
    }
    if (type === 'AI_CONTINUOUS_ARM') {
        // 只换选项、还没点「AI 识别」：清掉上一批额度，回到 armed
        armContinuous(msg.value)
            .then(function (s) { sendResponse(Object.assign({ ok: true }, s)); })
            .catch(function (e) { sendResponse(fail(e)); });
        return true;
    }
    if (type === 'ERA_TABLE_INFO') {
        sendResponse({
            ok: true,
            total: EraData ? EraData.ERAS.length : 0,
            names: EraData ? EraData.NAMES.length : 0
        });
        return false;
    }
    return false;
});
chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason === 'install') {
        const seed = seedSettings();
        chrome.storage.sync.get(null, function (v) {
            chrome.storage.sync.set(Object.assign({}, seed, v || {}));
        });
    }
    cache.prune().catch(function () { });
});
