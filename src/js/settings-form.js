(function (global) {
    'use strict';
    const M = global.EraModels;
    const DEFAULTS = {
        autoRegex: true,
        // 「AI 缓存优先」：true = 页面有 AI 缓存就用缓存结果、不跑正则；false（默认）= 照常跑正则。
        regexReplace: false,
        standalone: false,
        enabled: true,
        siteMode: 'restricted',
        allowedSites: [],
        blockedSites: [],
        annotate: false,
        copyAnno: false,
        preRepublic: false,
        siteAnnotationMode: 'annotate',
        maxChars: 12000,
        activeModelId: M.DEFAULT_ID,
        apiProfiles: null,
        tooltipTrigger: 'click'
    };
    const FIELD_KINDS = {
        siteMode: 'select',
        allowedSites: 'lines',
        blockedSites: 'lines',
        activeModelId: 'select',
        apiBase: 'text',
        apiKey: 'text',
        model: 'text',
        autoRegex: 'check',
        standalone: 'check',
        enabled: 'check',
        tooltipTrigger: 'select'
    };
    const PROFILE_KEYS = ['apiBase', 'apiKey', 'model'];
    const SITE_MODES = ['restricted', 'custom', 'global'];
    const TOOLTIP_TRIGGERS = ['hover', 'click', 'longpress'];
    // 「自定义设置」右栏（提示框）的文案：key = 控件上的 data-k，值 = { 选项值: 说明 }。
    // 标题和每个选项的名字都取界面上的文字（esf-label / esf-radio），这里只写说明。
    const CUSTOM_TIPS = {
        tooltipTrigger: {
            hover: '鼠标悬浮在高亮位置时弹出',
            click: '鼠标点击高亮位置后弹出',
            longpress: '鼠标长按高亮位置后弹出'
        },
        regexMode: {
            auto: '打开页面自动使用正则识别',
            click: '在扩展弹窗里点「正则识别」识别'
        },
        regexReplace: {
            replace: '计算使用正则识别，当页面有AI缓存时，优先用缓存结果',
            keep: '照常使用正则识别'
        },
        annoCopy: {
            keep: '复制页面文字时包含标注',
            strip: '只复制原文，不含标注'
        },
        siteAnnotationMode: {
            annotate: '特殊页面（不能插入文内标注的页面）仍然显示文内标注',
            'no-annotate': '特殊页面不显示文内标注'
        },
        preRepublic: {
            on: '识别公元前841之前的纪年，可能只标注？',
            off: '不识别共和之前的纪年'
        }
    };
    const KEY_MASK = '******';
    const OVERRIDE_KEY = 'eraPickOverrides';
    // AI 识别缓存的键前缀，与 cache.js 的 PREFIX 保持一致（这里不加载 cache.js，故写死）。
    const AI_CACHE_PREFIX = 'eraAiCache:';
    const SITE_KEYS = ['siteMode', 'allowedSites', 'blockedSites'];
    // 导出时额外带上的「除模型配置外的所有设置」。
    // ⚠️ 模型配置（apiProfiles / customModels / activeModelId / apiBase / apiKey / model）
    // **故意不在内** —— 里面是 API Key，不该跟着导出文件走。
    // 站点三项（siteMode / allowedSites / blockedSites）也不在这里：它们由 bundle 的 `sites` 段负责，
    // 免得同一份数据在两处各写一遍、导入时互相打架。
    const SETTINGS_KEYS = [
        'autoRegex', 'regexReplace', 'standalone', 'annotate', 'copyAnno', 'preRepublic',
        'siteAnnotationMode', 'maxChars', 'markTheme', 'enabled', 'tooltipTrigger', 'aiContinuous',
        // 「导出数据」那几个勾选框的状态（用户要求：它也属于「所有设置」）
        'dataPicks'
    ];
    // 上面这些键「没存过」时用什么值（和 content-state.js 的 DEFAULTS 对齐）。
    // 导出时按「有效值」写：存储里没有的键也写进去，导出的文件才是完整的一份设置快照。
    const SETTINGS_FALLBACK = {
        autoRegex: true,
        regexReplace: false,
        standalone: false,
        annotate: false,
        copyAnno: false,
        preRepublic: false,
        siteAnnotationMode: 'annotate',
        maxChars: 12000,
        markTheme: 'amber',
        enabled: true,
        tooltipTrigger: 'click',
        aiContinuous: 'once',
        dataPicks: ['picks', 'sites', 'cache']
    };
    function raw() {
        return new Promise(function (resolve) {
            // ⚠️ chrome.storage.get(默认值对象) 只返回**这个对象里列出的键**，不是整个 storage。
            // 模型相关的几个键（apiProfiles / customModels / activeModelId / apiBase / apiKey / model）
            // 以前没列进来，于是 load() 永远读不到已保存的模型配置：save() 拿 cur.apiProfiles 是空的，
            // 写回去就把 apiProfiles、customModels 和扁平 apiKey 一起清空 ——
            // 表现是「在设置页随便改个开关，AI 的 API Key 就没了」。新增模型键时必须同步加到这里。
            chrome.storage.sync.get({
                autoRegex: true, regexReplace: false, standalone: false, annotate: false, maxChars: 12000,
                enabled: DEFAULTS.enabled,
                siteMode: DEFAULTS.siteMode,
                allowedSites: DEFAULTS.allowedSites,
                blockedSites: DEFAULTS.blockedSites,
                tooltipTrigger: DEFAULTS.tooltipTrigger,
                copyAnno: DEFAULTS.copyAnno,
                preRepublic: DEFAULTS.preRepublic,
                siteAnnotationMode: DEFAULTS.siteAnnotationMode,
                activeModelId: '',
                apiProfiles: null,
                customModels: [],
                apiBase: '',
                apiKey: '',
                model: '',
                // 「导出数据」那几个勾选框的状态（null = 还没存过 → 全勾）
                dataPicks: null
            }, function (v) { resolve(v || {}); });
        });
    }
    async function load() {
        const src = await raw();
        const norm = M.normalize(src);
        const flat = M.flatten(norm.profiles, norm.activeId);
        return {
            autoRegex: src.autoRegex !== false,
            regexReplace: src.regexReplace === true,
            standalone: !!src.standalone,
            annotate: !!src.annotate,
            enabled: src.enabled !== false,
            siteMode: SITE_MODES.indexOf(String(src.siteMode)) >= 0 ? String(src.siteMode) : DEFAULTS.siteMode,
            allowedSites: parseBlocked(src.allowedSites),
            blockedSites: parseBlocked(src.blockedSites),
            // 老版本存的 'dblclick' 已下线 → 当成 longpress（别让老设置静默掉回「单击」）
            tooltipTrigger: (function () {
                const raw = String(src.tooltipTrigger) === 'dblclick' ? 'longpress' : String(src.tooltipTrigger);
                return TOOLTIP_TRIGGERS.indexOf(raw) >= 0 ? raw : DEFAULTS.tooltipTrigger;
            })(),
            copyAnno: src.copyAnno === true,
            preRepublic: src.preRepublic === true,
            siteAnnotationMode: String(src.siteAnnotationMode) === 'no-annotate' ? 'no-annotate' : DEFAULTS.siteAnnotationMode,
            maxChars: Number(src.maxChars) > 0 ? Number(src.maxChars) : 12000,
            activeModelId: norm.activeId,
            apiProfiles: norm.profiles,
            customs: norm.customs || [],
            // null = 存储里没有这个键（从没改过勾选）→ 界面上三个框全勾
            dataPicks: Array.isArray(src.dataPicks) ? src.dataPicks.map(String) : null,
            apiBase: flat.apiBase,
            apiKey: flat.apiKey,
            model: flat.model
        };
    }
    function syncSet(obj) {
        return new Promise(function (resolve, reject) {
            chrome.storage.sync.set(obj, function () {
                const err = chrome.runtime && chrome.runtime.lastError;
                if (err) {
                    reject(new Error('保存失败：' + (err.message || '存储写入被拒绝')));
                    return;
                }
                resolve();
            });
        });
    }
    async function save(patch) {
        const cur = await load();
        const customs = (cur.customs || []).slice();
        const profiles = Object.assign({}, cur.apiProfiles);
        let activeId;
        if (patch && patch.__add) {
            activeId = 'custom-' + Date.now().toString(36);
            customs.push({ id: activeId, label: String(patch.__add.label || '').trim() || '自定义模型' });
            profiles[activeId] = { apiBase: '', apiKey: '', model: '' };
        }
        else {
            activeId = M.byId(patch.activeModelId, customs) ? patch.activeModelId : cur.activeModelId;
        }
        const next = Object.assign({}, profiles[activeId] || M.defaultProfile(activeId));
        for (const k of PROFILE_KEYS) {
            if (k in patch)
                next[k] = String(patch[k] == null ? '' : patch[k]).trim();
        }
        profiles[activeId] = next;
        const flat = M.flatten(profiles, activeId, customs);
        const out = Object.assign({}, patch, {
            activeModelId: activeId,
            apiProfiles: profiles,
            customModels: customs,
            apiBase: flat.apiBase,
            apiKey: flat.apiKey,
            model: flat.model
        });
        delete out.__add;
        await syncSet(out);
        out.customs = customs;
        return out;
    }
    // 「站点设置」区块的恢复默认：只把站点设置写回默认值（限制模式 + 两个名单清空）。
    // 更正记录（eraPickOverrides）和 AI 缓存都在 chrome.storage.local 里，这里一概不碰；
    // 自定义设置那几项、模型配置也不动。
    async function resetSiteSettings() {
        await syncSet({
            siteMode: DEFAULTS.siteMode,
            allowedSites: DEFAULTS.allowedSites.slice(),
            blockedSites: DEFAULTS.blockedSites.slice()
        });
        return load();
    }
    // 「AI 模型配置」区块的恢复默认：清掉之前保存的所有模型配置，**含已填的 API Key**，
    // 自定义模型也一并清掉（customModels 不清的话 normalize() 会把它们当空壳读回来），
    // 回到内置预设。站点设置、自定义设置、本地记录都不动。
    async function resetModelSettings() {
        const profiles = M.emptyProfiles();
        const flat = M.flatten(profiles, M.DEFAULT_ID);
        await syncSet({
            activeModelId: M.DEFAULT_ID,
            apiProfiles: profiles,
            customModels: [],
            apiBase: flat.apiBase,
            apiKey: flat.apiKey,
            model: flat.model
        });
        return load();
    }
    // 「自定义设置」区块的恢复默认（按钮在右栏提示框里）：把那一栏 6 项写回默认值。
    // regexMode ↔ autoRegex、annoCopy ↔ copyAnno，写存储用的是后者。
    async function resetCustomSettings() {
        await syncSet({
            tooltipTrigger: DEFAULTS.tooltipTrigger,
            autoRegex: DEFAULTS.autoRegex,
            regexReplace: DEFAULTS.regexReplace,
            copyAnno: DEFAULTS.copyAnno,
            siteAnnotationMode: DEFAULTS.siteAnnotationMode,
            preRepublic: DEFAULTS.preRepublic
        });
        return load();
    }
    // 三个区块合起来 = 设置整体恢复默认（对外保留的名字；界面上三个按钮各管一块）。
    async function resetAll() {
        await resetSiteSettings();
        await resetCustomSettings();
        return resetModelSettings();
    }
    function parseBlocked(rawVal) {
        if (Array.isArray(rawVal)) {
            return rawVal.map(function (x) { return String(x == null ? '' : x).trim(); })
                .filter(Boolean);
        }
        return String(rawVal == null ? '' : rawVal)
            .split(/[\n,，]/)
            .map(function (x) { return x.trim(); })
            .filter(Boolean);
    }
    // 从 URL 取域名 —— 站点列表里存的就是域名（如 www.example.com）。
    function hostOf(url) {
        try {
            const u = new URL(String(url || ''));
            return /^https?:$/.test(u.protocol) ? (u.hostname || '') : '';
        }
        catch (e) {
            return '';
        }
    }
    // 取「当前网站」：在弹窗里就是弹窗所属的那个标签页；
    // 选项页自己也是扩展页（chrome-extension://…），拿不到就退回到最近访问过的普通网页。
    function currentSiteHost() {
        return new Promise(function (resolve) {
            if (!chrome.tabs || typeof chrome.tabs.query !== 'function') {
                resolve('');
                return;
            }
            function pick(tabs) {
                const list = (tabs || []).filter(function (t) { return hostOf(t && t.url); });
                list.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); });
                return list.length ? hostOf(list[0].url) : '';
            }
            try {
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    const err = chrome.runtime && chrome.runtime.lastError;
                    const host = err ? '' : pick(tabs);
                    if (host) {
                        resolve(host);
                        return;
                    }
                    chrome.tabs.query({}, function (all) {
                        chrome.runtime && chrome.runtime.lastError;
                        resolve(pick(all));
                    });
                });
            }
            catch (e) {
                resolve('');
            }
        });
    }
    function readLocal(keys) {
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get(keys, function (v) { resolve(v || {}); });
            }
            catch (e) {
                resolve({});
            }
        });
    }
    function readSync(keys) {
        return new Promise(function (resolve) {
            try {
                chrome.storage.sync.get(keys, function (v) { resolve(v || {}); });
            }
            catch (e) {
                resolve({});
            }
        });
    }
    function writeLocal(obj) {
        return new Promise(function (resolve, reject) {
            chrome.storage.local.set(obj, function () {
                const err = chrome.runtime && chrome.runtime.lastError;
                if (err)
                    reject(new Error('写入失败：' + (err.message || '存储写入被拒绝')));
                else
                    resolve();
            });
        });
    }
    function writeSync(obj) {
        return new Promise(function (resolve, reject) {
            chrome.storage.sync.set(obj, function () {
                const err = chrome.runtime && chrome.runtime.lastError;
                if (err)
                    reject(new Error('写入失败：' + (err.message || '存储写入被拒绝')));
                else
                    resolve();
            });
        });
    }
    // 导出数据包：① 更正记录 ② 站点设置 ③ AI 识别缓存 ④ 除模型配置外的所有设置。
    // **始终全量** —— 界面上的三个勾选框只作用于「清空」，不影响导出 / 导入。
    async function collectDataBundle() {
        const local = await readLocal(null);
        const sync = await readSync(SITE_KEYS);
        const aiCache = {};
        for (const key of Object.keys(local)) {
            if (key.indexOf(AI_CACHE_PREFIX) === 0)
                aiCache[key] = local[key];
        }
        return {
            version: 3,
            app: 'era-recognition',
            exportedAt: new Date().toISOString(),
            overrides: (local && local[OVERRIDE_KEY]) || {},
            sites: {
                siteMode: SITE_MODES.indexOf(String(sync.siteMode)) >= 0 ? String(sync.siteMode) : DEFAULTS.siteMode,
                allowedSites: parseBlocked(sync.allowedSites),
                blockedSites: parseBlocked(sync.blockedSites)
            },
            aiCache: aiCache,
            // ④ 点「导出」时一并存下：站点设置以外的所有设置（自定义设置那几项、文内标注开关、
            //    导出勾选框状态…），但**不含模型配置**。导入时按原样写回去。
            settings: await collectSettingsBundle()
        };
    }
    // 「除模型配置外的所有设置」：按**有效值**导出（存储里没存过的键用 SETTINGS_FALLBACK），
    // 这样导出的文件是一份完整的设置快照，而不是「只记了改过的几项」。
    async function collectSettingsBundle() {
        const sync = (await readSync(SETTINGS_KEYS)) || {};
        const out = {};
        for (const key of SETTINGS_KEYS) {
            let v = (Object.prototype.hasOwnProperty.call(sync, key) && sync[key] !== undefined)
                ? sync[key] : SETTINGS_FALLBACK[key];
            if (Array.isArray(v))
                v = v.slice();
            out[key] = v;
        }
        return out;
    }
    function bundleCounts(bundle) {
        const src = bundle || {};
        const sites = src.sites || {};
        return {
            pages: Object.keys(src.overrides || {}).length,
            allowed: (sites.allowedSites || []).length,
            blocked: (sites.blockedSites || []).length,
            cache: Object.keys(src.aiCache || {}).length
        };
    }
    // 兼容旧格式：早期只导出 { version: 1, store: { url: entry } } 的更正记录。
    function normalizeBundle(parsed) {
        const src = parsed && typeof parsed === 'object' ? parsed : {};
        return {
            overrides: (src.overrides && typeof src.overrides === 'object') ? src.overrides
                : (src.store && typeof src.store === 'object' ? src.store : {}),
            sites: src.sites && typeof src.sites === 'object' ? src.sites : null,
            aiCache: src.aiCache && typeof src.aiCache === 'object' ? src.aiCache : null,
            settings: src.settings && typeof src.settings === 'object' ? src.settings : null
        };
    }
    // 导入时按白名单 + 类型粗筛：文件可能是旧版本、也可能被人手改过，
    // 不能让一个乱七八糟的值把设置写坏。**只认 SETTINGS_KEYS 里的键。**
    function sanitizeSettings(src) {
        const out = {};
        if (!src || typeof src !== 'object')
            return out;
        for (const key of SETTINGS_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(src, key))
                continue;
            const v = src[key];
            if (key === 'dataPicks') {
                if (Array.isArray(v))
                    out[key] = v.map(function (x) { return String(x); });
                continue;
            }
            if (key === 'maxChars') {
                const n = Number(v);
                if (n > 0)
                    out[key] = n;
                continue;
            }
            if (key === 'siteAnnotationMode') {
                if (v === 'annotate' || v === 'no-annotate')
                    out[key] = v;
                continue;
            }
            if (key === 'tooltipTrigger') {
                if (TOOLTIP_TRIGGERS.indexOf(String(v)) >= 0)
                    out[key] = String(v);
                continue;
            }
            if (typeof v === 'boolean' || typeof v === 'string')
                out[key] = v;
        }
        return out;
    }
    function unionList(a, b) {
        const out = [];
        const push = function (x) {
            const v = String(x == null ? '' : x).trim();
            if (v && out.indexOf(v) < 0)
                out.push(v);
        };
        parseBlocked(a).forEach(push);
        parseBlocked(b).forEach(push);
        return out;
    }
    async function importDataBundle(parsed) {
        const bundle = normalizeBundle(parsed);
        const parts = [];
        const urlKeys = Object.keys(bundle.overrides);
        if (urlKeys.length) {
            const v = await readLocal(OVERRIDE_KEY);
            const all = (v && v[OVERRIDE_KEY]) || {};
            let added = 0;
            let merged = 0;
            for (const url of urlKeys) {
                const row = bundle.overrides[url];
                if (!row || typeof row !== 'object')
                    continue;
                if (all[url])
                    merged++;
                else
                    added++;
                all[url] = Object.assign({}, all[url], row);
            }
            await writeLocal({ [OVERRIDE_KEY]: all });
            parts.push('更正记录 ' + added + ' 新增 / ' + merged + ' 合并');
        }
        if (bundle.sites) {
            const cur = await readSync(SITE_KEYS);
            const next = {};
            const mode = String(bundle.sites.siteMode || '');
            if (SITE_MODES.indexOf(mode) >= 0)
                next.siteMode = mode;
            if (Array.isArray(bundle.sites.allowedSites))
                next.allowedSites = unionList(cur.allowedSites, bundle.sites.allowedSites);
            if (Array.isArray(bundle.sites.blockedSites))
                next.blockedSites = unionList(cur.blockedSites, bundle.sites.blockedSites);
            if (Object.keys(next).length) {
                await writeSync(next);
                parts.push('站点设置已更新');
            }
        }
        if (bundle.aiCache) {
            const obj = {};
            let n = 0;
            for (const key of Object.keys(bundle.aiCache)) {
                if (key.indexOf(AI_CACHE_PREFIX) !== 0)
                    continue;
                obj[key] = bundle.aiCache[key];
                n++;
            }
            if (n) {
                await writeLocal(obj);
                parts.push('AI 缓存 ' + n + ' 条');
            }
        }
        if (bundle.settings) {
            // ④ 「除模型配置外的所有设置」：按导出时的样子写回去（只认白名单里的键）。
            const next = sanitizeSettings(bundle.settings);
            const keys = Object.keys(next);
            if (keys.length) {
                await writeSync(next);
                parts.push('设置 ' + keys.length + ' 项已恢复（不含模型配置）');
            }
        }
        if (!parts.length)
            return '文件里没有可导入的数据';
        return parts.join(' · ');
    }
    function coerce(key, rawVal) {
        if (FIELD_KINDS[key] === 'check')
            return !!rawVal;
        if (FIELD_KINDS[key] === 'lines')
            return parseBlocked(rawVal);
        return String(rawVal == null ? '' : rawVal).trim();
    }
    function mount(root, opts) {
        const o = opts || {};
        root.classList.add('esf-root');
        if (o.compact)
            root.classList.add('esf-compact');
        const modelOptions = M.options().map(function (op) {
            return '<option value="' + op.value + '">' + (op.model || op.label) + '</option>';
        }).join('');
        const modelBlock = [
            '<label class="esf-field">',
            '  <span class="esf-label">模型</span>',
            '  <select data-k="activeModelId">' + modelOptions + '</select>',
            '</label>',
            '<label class="esf-field">',
            '  <span class="esf-label">模型名</span>',
            '  <input type="text" data-k="model" spellcheck="false" autocomplete="off" placeholder="gpt-4o-mini">',
            '  <span class="esf-hint" data-role="model-name-hint">预设已填好，可改成同一服务商下的其它模型 ID</span>',
            '</label>',
            '<label class="esf-field">',
            '  <span class="esf-label">接口地址</span>',
            '  <input type="text" data-k="apiBase" spellcheck="false" autocomplete="off" placeholder="https://api.deepseek.com">',
            '</label>',
            '<label class="esf-field">',
            '  <span class="esf-label">API Key</span>',
            '  <input type="password" data-k="apiKey" spellcheck="false" autocomplete="off" placeholder="sk-...">',
            '</label>',
        ].join('\n');
        const sitesBlock = [
            '<label class="esf-field">',
            '  <span class="esf-label">站点模式</span>',
            '  <select data-k="siteMode">',
            '    <option value="restricted">限制 —— 除禁用网站外都自动识别</option>',
            '    <option value="custom">自定义 —— 只识别名单内网站</option>',
            '    <option value="global">全局 —— 所有网站都自动识别</option>',
            '  </select>',
            '</label>',
            '<label class="esf-field" data-role="allowed-field">',
            '  <span class="esf-label">自定义网站</span>',
            '  <textarea data-k="allowedSites" rows="3" spellcheck="false" autocomplete="off"',
            '    placeholder="www.example.com"></textarea>',
            '  <span class="esf-hint">一行一个。只识别指定网站。</span>',
            '</label>',
            '<label class="esf-field" data-role="blocked-field">',
            '  <span class="esf-label">禁用网站</span>',
            '  <textarea data-k="blockedSites" rows="3" spellcheck="false" autocomplete="off"',
            '    placeholder="www.example.com"></textarea>',
            '  <span class="esf-hint">一行一个。支持全站或指定路径下页面禁用。</span>',
            '</label>',
        ].join('\n');
        function actionsBlock(withModel) {
            // 站点那一组按钮带 data-role="site-action"：切到「全局」时整组藏起来
            // （站点列表在全局模式下不生效，留着保存/恢复/添加没意义）。
            const site = withModel ? '' : ' data-role="site-action"';
            const btns = [
                '<button type="button" class="esf-btn esf-btn-primary" data-act="save"' + site + '>保存设置</button>'
            ];
            if (withModel) {
                btns.push('<button type="button" class="esf-btn" data-act="test">测试连接</button>');
            }
            // data-scope 决定这个「恢复默认」重置哪一半：站点设置 / AI 模型配置（见 resetSiteSettings）。
            btns.push('<button type="button" class="esf-btn esf-btn-ghost" data-act="reset" data-scope="'
                + (withModel ? 'model' : 'sites') + '"' + site + ' >恢复默认</button>');
            if (!withModel) {
                btns.push('<button type="button" class="esf-btn" data-act="add-site" data-role="site-action">添加当前站点</button>');
            }
            return [
                '<div class="esf-actions">',
                btns.map(function (b) { return '  ' + b; }).join('\n'),
                // 行右侧的即时提示（已恢复 / 已取消），由 setActionNote() 填
                '  <span class="esf-action-note" data-role="action-note"></span>',
                '</div>'
            ].join('\n');
        }
        const only = o.only || '';
        const parts = [];
        // 三项数据各配一个复选框：导出按勾选打包，「清空」也只清勾选项。
        const DATA_KINDS = [
            { key: 'picks', label: '更正记录', desc: '手动指定的年号、切换过的候选' },
            { key: 'sites', label: '站点设置', desc: '识别模式、自定义网站、禁用网站' },
            { key: 'cache', label: 'AI 识别缓存', desc: '已识别页面的结果' }
        ];
        const dataBlock = [
            '<section class="esf-sec">',
            '<h1>导出数据</h1>',
            '<div class="esf-checks">',
            DATA_KINDS.map(function (k) {
                return '  <label class="esf-check">' +
                    '<input type="checkbox" data-role="data-pick" value="' + k.key + '" checked>' +
                    '<span><strong>' + k.label + '</strong>：' + k.desc + '</span></label>';
            }).join('\n'),
            '</div>',
            '<p class="esf-hint">导出会包含全部数据，上面的勾选只作用于「清空」。</p>',
            '<div class="esf-data-stats" data-role="data-stats"></div>',
            '<div class="esf-actions">',
            '  <button type="button" class="esf-btn esf-btn-primary" data-act="export-data">导出</button>',
            '  <button type="button" class="esf-btn esf-btn-primary" data-act="import-data">导入</button>',
            '  <button type="button" class="esf-btn esf-btn-ghost" data-act="clear-data">清空</button>',
            '  <input type="file" accept="application/json,.json" data-role="import-file" hidden>',
            '  <span class="esf-action-note" data-role="action-note"></span>',
            '</div>',
            '</section>'
        ].join('\n');
        // 左 2 : 右 1 两栏。左边是各个 esf-field，右边是提示框：
        // 点左边任意一个 esf-label，右栏就显示那一项是做什么的（见 renderOptionTip）。
        // 没点过（或点了「其他区域」）时，提示框里是这句占位文字。
        const TIP_IDLE_HTML = '<div class="esf-tipbox-empty">点击标签或选项提示。</div>';
        const customBlock = [
            '<section class="esf-sec" data-role="custom-sec">',
            '<h1>自定义设置</h1>',
            '<div class="esf-split">',
            '  <div class="esf-split-main">',
            '    <div class="esf-field">',
            '      <span class="esf-label">弹框触发方式</span>',
            '      <div class="esf-radios" role="radiogroup" aria-label="弹框触发方式">',
            '        <label class="esf-radio"><input type="radio" name="tooltipTrigger" data-k="tooltipTrigger" value="hover"><span>悬浮</span></label>',
            '        <label class="esf-radio"><input type="radio" name="tooltipTrigger" data-k="tooltipTrigger" value="click"><span>单击</span></label>',
            '        <label class="esf-radio"><input type="radio" name="tooltipTrigger" data-k="tooltipTrigger" value="longpress"><span>长按</span></label>',
            '      </div>',
            '    </div>',
            '    <div class="esf-field">',
            '      <span class="esf-label">正则识别方式</span>',
            '      <div class="esf-radios" role="radiogroup" aria-label="正则识别方式">',
            '        <label class="esf-radio"><input type="radio" name="regexMode" data-k="regexMode" value="auto"><span>自动</span></label>',
            '        <label class="esf-radio"><input type="radio" name="regexMode" data-k="regexMode" value="click"><span>点击</span></label>',
            '      </div>',
            '    </div>',
            '    <div class="esf-field">',
            '      <span class="esf-label">AI 缓存优先</span>',
            '      <div class="esf-radios" role="radiogroup" aria-label="AI 缓存优先">',
            '        <label class="esf-radio"><input type="radio" name="regexReplace" data-k="regexReplace" value="replace"><span>优先</span></label>',
            '        <label class="esf-radio"><input type="radio" name="regexReplace" data-k="regexReplace" value="keep"><span>不优先</span></label>',
            '      </div>',
            '    </div>',
            '    <div class="esf-field">',
            '      <span class="esf-label">复制标注纪年</span>',
            '      <div class="esf-radios" role="radiogroup" aria-label="复制标注纪年">',
            '        <label class="esf-radio"><input type="radio" name="annoCopy" data-k="annoCopy" value="keep"><span>复制</span></label>',
            '        <label class="esf-radio"><input type="radio" name="annoCopy" data-k="annoCopy" value="strip"><span>不复制</span></label>',
            '      </div>',
            '    </div>',
            '    <div class="esf-field">',
            '      <span class="esf-label">文内标注限制</span>',
            '      <div class="esf-radios" role="radiogroup" aria-label="文内标注限制">',
            '        <label class="esf-radio"><input type="radio" name="siteAnnotationMode" data-k="siteAnnotationMode" value="annotate"><span>标注</span></label>',
            '        <label class="esf-radio"><input type="radio" name="siteAnnotationMode" data-k="siteAnnotationMode" value="no-annotate"><span>不标注</span></label>',
            '      </div>',
            '    </div>',
            '    <div class="esf-field">',
            '      <span class="esf-label">共和前纪年</span>',
            '      <div class="esf-radios" role="radiogroup" aria-label="共和前纪年">',
            '        <label class="esf-radio"><input type="radio" name="preRepublic" data-k="preRepublic" value="on"><span>识别</span></label>',
            '        <label class="esf-radio"><input type="radio" name="preRepublic" data-k="preRepublic" value="off"><span>不识别</span></label>',
            '      </div>',
            '    </div>',
            '  </div>',
            // 右栏：上面是提示框（一直都在，没点过就是里面空的），下面是常驻的「恢复默认」按钮。
            // is-idle = 还没点过任何选项 / label 的状态标记（见 renderOptionTip）。
            '  <div class="esf-split-side">',
            '    <aside class="esf-tipbox is-idle" data-role="option-tip">',
            // 说明区：没点过任何选项 / label 时显示一句占位，点过之后被 renderOptionTip 整块换掉。
            '      <div class="esf-tipbox-body" data-role="tip-body">' + TIP_IDLE_HTML + '</div>',
            '    </aside>',
            '    <div class="esf-tipbox-actions">',
            '      <button type="button" class="esf-btn esf-btn-ghost esf-btn-sm" data-act="reset" data-scope="custom">恢复默认</button>',
            '    </div>',
            '  </div>',
            '</div>',
            '</section>'
        ].join('\n');
        if (!only || only === 'sites') {
            if (!only)
                parts.push('<section class="esf-sec">', '<h1>站点设置</h1>');
            parts.push(sitesBlock, actionsBlock(false));
            if (!only)
                parts.push('</section>');
        }
        if (only === 'model') {
            parts.push(modelBlock, actionsBlock(true));
        }
        // 弹窗里的局部挂载：只挂「自定义设置」那一块（恢复默认按钮在它自己的提示框里）。
        if (only === 'custom') {
            parts.push(customBlock);
        }
        // 弹窗里的局部挂载：只挂「导出数据」那一块。
        if (only === 'data') {
            parts.push(dataBlock);
        }
        if (!only) {
            parts.push('<section class="esf-sec">', '<h1>AI 模型配置</h1>');
            parts.push(modelBlock, actionsBlock(true));
            parts.push('</section>');
            parts.push(customBlock, dataBlock);
        }
        root.innerHTML = parts.join('\n');
        // 「AI 调用记录」整块（HTML + 样式 + 渲染 + 清空）都在独立的 ai-log-panel.js 里，
        // 那个文件**仅开发测试用**：删掉它 + options.html 里那行 script 就少一块 UI，
        // 程序其它功能不受影响（记录照旧由 ai-core.js 写进 storage.local，只是看不到）。
        if (!only && global.EraAiLogPanel && typeof global.EraAiLogPanel.mount === 'function')
            global.EraAiLogPanel.mount(root);
        bindSiteTextarea(root.querySelector('[data-k="allowedSites"]'));
        bindSiteTextarea(root.querySelector('[data-k="blockedSites"]'));
        const hintEl = root.querySelector('[data-role="model-hint"]');
        const nameHintEl = root.querySelector('[data-role="model-name-hint"]');
        const selEl = root.querySelector('[data-k="activeModelId"]');
        let state = null;
        let keyMasked = false;
        let currentId = null;
        let addMode = false;
        // 页面上不再有状态行（它每次写入都会改 DOM / 顶动布局）。失败只留在控制台，
        // 成功不再提示 —— 要恢复可见提示就加回一条状态行或改成 window.alert()。
        const warn = function (what, err) {
            try {
                console.warn('[年号纪年识别·设置] ' + what, err || '');
            }
            catch (e) { }
        };
        // 按钮行右侧的即时提示：确认恢复默认 →「已恢复」、确认清空 →「已清空」、取消 →「已取消」。
        // 只写这一行自己的 span，不新增状态行（见 README 6.5）。
        function setActionNote(btn, text) {
            const row = btn && btn.closest ? btn.closest('.esf-actions') : null;
            const note = row ? row.querySelector('[data-role="action-note"]') : null;
            if (note)
                note.textContent = text || '';
        }
        // 「导出数据」区块的统计行（只在设置页出现）。
        const dataStatsEl = root.querySelector('[data-role="data-stats"]');
        // ---- 「自定义设置」右栏的提示框 ----
        // 点左侧的 esf-label（或它那一行的任意单选）→ 右栏显示这一项：标题 + 一行说明。
        // 右栏是「提示框 + 常驻恢复默认按钮」的竖排；提示框高度贴内容走，不会把按钮挤出去。
        const tipBoxEl = root.querySelector('[data-role="option-tip"]');
        const tipBodyEl = root.querySelector('[data-role="tip-body"]');
        const customSecEl = root.querySelector('[data-role="custom-sec"]');
        function renderOptionTip(field) {
            if (!tipBodyEl || !field)
                return;
            // 有说明了：填进 body、去掉 is-idle。提示框和下面的按钮一直都在。
            if (tipBoxEl)
                tipBoxEl.classList.remove('is-idle');
            const control = field.querySelector('[data-k]');
            const key = control ? String(control.getAttribute('data-k') || '') : '';
            const tips = CUSTOM_TIPS[key] || {};
            const titleEl = field.querySelector('.esf-label');
            const title = titleEl ? String(titleEl.textContent || '').trim() : key;
            const lines = Array.prototype.slice.call(field.querySelectorAll('.esf-radio')).map(function (item) {
                const input = item.querySelector('input');
                const nameEl = item.querySelector('span');
                const value = input ? String(input.value) : '';
                const name = nameEl ? String(nameEl.textContent || '').trim() : value;
                if (!tips[value])
                    return '';
                return '<strong>' + name + '：</strong>' + tips[value];
            }).filter(Boolean);
            tipBodyEl.innerHTML =
                '<div class="esf-tipbox-title">' + title + '</div>' +
                '<div class="esf-tipbox-desc">' + lines.join('<br>') + '</div>';
            // 左边标出「正在解释的是哪一项」
            Array.prototype.slice.call(root.querySelectorAll('.esf-field-tip-on')).forEach(function (el) {
                el.classList.remove('esf-field-tip-on');
            });
            field.classList.add('esf-field-tip-on');
        }
        // 回到「还没点过」的状态：占位文字 + is-idle + 去掉左侧那一项的高亮。
        // 已经是占位时不再写 innerHTML —— 免得每次点空白处都重排一遍（会闪、也会把滚动位置顶回去）。
        function resetOptionTip() {
            if (!tipBodyEl)
                return;
            if (!tipBodyEl.querySelector('.esf-tipbox-empty'))
                tipBodyEl.innerHTML = TIP_IDLE_HTML;
            if (tipBoxEl)
                tipBoxEl.classList.add('is-idle');
            Array.prototype.slice.call(root.querySelectorAll('.esf-field-tip-on')).forEach(function (el) {
                el.classList.remove('esf-field-tip-on');
            });
        }
        if (tipBodyEl && customSecEl) {
            // label 和单选都落在这个分支里：点哪个单选，就显示它所在那一项的说明。
            customSecEl.addEventListener('click', function (e) {
                const field = e.target && e.target.closest ? e.target.closest('.esf-field') : null;
                if (!field || !customSecEl.contains(field))
                    return;
                renderOptionTip(field);
            });
            // 点「其他区域」（不在这一块的任何 esf-field 里）→ 恢复默认的占位提示。
            // 挂在 document 上而不是 customSecEl 上：点设置页别处、弹窗别处都算「其他区域」。
            // 冒泡顺序上 customSecEl 的那个监听先跑，所以点 label / 单选时这里能判出来、不会误清。
            document.addEventListener('click', function (e) {
                const t = e.target;
                const field = t && t.closest ? t.closest('.esf-field') : null;
                if (field && customSecEl.contains(field))
                    return;
                resetOptionTip();
            });
        }
        // 勾选了哪几项（'picks' / 'sites' / 'cache'），顺序按界面上的顺序。
        function pickedDataKinds() {
            return Array.prototype.slice.call(root.querySelectorAll('[data-role="data-pick"]'))
                .filter(function (el) { return !!el.checked; })
                .map(function (el) { return el.value; });
        }
        // 只清勾选项：更正记录 / 站点设置 / AI 缓存。
        async function clearPickedData(picked) {
            const done = [];
            if (picked.indexOf('picks') >= 0) {
                // local.set 是合并写，别的 local 键（AI 缓存、aiQuotaTotal）不受影响
                await writeLocal({ [OVERRIDE_KEY]: {} });
                done.push('更正记录');
            }
            if (picked.indexOf('sites') >= 0) {
                await writeSync({ siteMode: DEFAULTS.siteMode, allowedSites: [], blockedSites: [] });
                done.push('站点设置');
            }
            if (picked.indexOf('cache') >= 0) {
                const r = await chrome.runtime.sendMessage({ type: 'AI_CACHE_CLEAR' });
                done.push('AI 缓存 ' + ((r && r.removed) || 0) + ' 条');
            }
            return done;
        }
        async function refreshDataStats() {
            if (!dataStatsEl)
                return;
            try {
                const c = bundleCounts(await collectDataBundle());
                dataStatsEl.textContent = '当前：' + c.pages + ' 个页面的更正 · ' + c.allowed +
                    ' 个自定义网站 · ' + c.blocked + ' 个禁用网站 · ' + c.cache + ' 条 AI 缓存';
            }
            catch (e) {
                dataStatsEl.textContent = '';
            }
        }
        function field(key) {
            return root.querySelector('[data-k="' + key + '"]');
        }
        function setVal(key, v) {
            const el = field(key);
            if (el)
                el.value = v;
        }
        // 单选组：按 name 读写
        function setRadio(name, value) {
            Array.from(root.querySelectorAll('input[name="' + name + '"]')).forEach(function (r) {
                r.checked = r.value === value;
            });
        }
        function radioValue(name) {
            const el = root.querySelector('input[name="' + name + '"]:checked');
            return el ? el.value : '';
        }
        function fillProfileFields(id) {
            const p = M.resolve(state.apiProfiles, id, state.customs);
            currentId = p.id;
            setVal('apiBase', p.apiBase);
            keyMasked = !!p.apiKey;
            setVal('apiKey', p.apiKey ? KEY_MASK : '');
            setVal('model', p.model);
            const nameEl = field('model');
            if (nameEl)
                nameEl.placeholder = p.label && p.label !== p.model ? p.label : 'gpt-4o-mini';
            const preset = M.byId(id);
            if (hintEl) {
                hintEl.textContent = preset && preset.custom
                    ? '自定义：接口地址和模型名都自己填。'
                    : '每个模型单独保存接口地址与 Key，切换时互不覆盖。';
            }
            if (nameHintEl) {
                nameHintEl.textContent = '填写服务商文档里的模型 ID';
            }
        }
        function rebuildModelOptions(customs, selectedId) {
            if (!selEl)
                return;
            selEl.innerHTML = M.options(customs).map(function (op) {
                return '<option value="' + op.value + '">' + (op.model || op.label) + '</option>';
            }).join('');
            selEl.value = selectedId;
        }
        function setAddMode(on) {
            addMode = on;
        }
        function bindSiteTextarea(el) {
            if (!el)
                return;
            function ensureTrailingNewline() {
                const value = String(el.value || '');
                if (value && !/\n$/.test(value))
                    el.value = value + '\n';
            }
            el.addEventListener('blur', ensureTrailingNewline);
            el.addEventListener('change', ensureTrailingNewline);
            el.addEventListener('paste', function () {
                requestAnimationFrame(ensureTrailingNewline);
            });
        }
        function syncSiteFields(mode) {
            const m = SITE_MODES.indexOf(mode) >= 0 ? mode : DEFAULTS.siteMode;
            const allow = root.querySelector('[data-role="allowed-field"]');
            const block = root.querySelector('[data-role="blocked-field"]');
            if (allow)
                allow.style.display = m === 'custom' ? '' : 'none';
            if (block)
                block.style.display = m === 'restricted' ? '' : 'none';
            // 「全局」下站点列表不生效：保存设置 / 恢复默认 / 添加当前站点 都收起来。
            const hideActions = m === 'global';
            Array.from(root.querySelectorAll('[data-role="site-action"]')).forEach(function (el) {
                el.style.display = hideActions ? 'none' : '';
            });
        }
        function labelForNewModel(model, apiBase) {
            const m = String(model || '').trim();
            if (m)
                return m;
            const host = String(apiBase || '').replace(/^https?:\/\//, '').split('/')[0];
            return host || '自定义模型';
        }
        function fill(values) {
            state = values;
            setAddMode(false);
            if (selEl)
                rebuildModelOptions(values.customs, values.activeModelId);
            if (field('apiBase') || field('model'))
                fillProfileFields(values.activeModelId);
            const mode = values.siteMode || DEFAULTS.siteMode;
            setVal('siteMode', mode);
            syncSiteFields(mode);
            setVal('allowedSites', (values.allowedSites || []).join('\n'));
            setVal('blockedSites', (values.blockedSites || []).join('\n'));
            const trigger = TOOLTIP_TRIGGERS.indexOf(String(values.tooltipTrigger)) >= 0
                ? String(values.tooltipTrigger) : DEFAULTS.tooltipTrigger;
            setRadio('tooltipTrigger', trigger);
            setRadio('regexMode', values.autoRegex === false ? 'click' : 'auto');
            setRadio('regexReplace', values.regexReplace === true ? 'replace' : 'keep');
            setRadio('annoCopy', values.copyAnno === true ? 'keep' : 'strip');
            setRadio('siteAnnotationMode', values.siteAnnotationMode === 'no-annotate' ? 'no-annotate' : 'annotate');
            setRadio('preRepublic', values.preRepublic === true ? 'on' : 'off');
            applyDataPicks(values.dataPicks);
        }
        // 「导出数据」那三个勾选框的状态也当设置存起来（sync 的 dataPicks）——
        // 这样它才能跟着「导出」一起进文件、导入时恢复。
        function applyDataPicks(list) {
            const keys = Array.isArray(list) ? list : DATA_KINDS.map(function (k) { return k.key; });
            Array.prototype.slice.call(root.querySelectorAll('[data-role="data-pick"]')).forEach(function (el) {
                el.checked = keys.indexOf(el.value) >= 0;
            });
        }
        function collect() {
            const out = {};
            if (selEl)
                out.activeModelId = addMode ? currentId : selEl.value;
            for (const key of PROFILE_KEYS) {
                const el = field(key);
                if (!el)
                    continue;
                if (key === 'apiKey' && keyMasked && el.value === KEY_MASK)
                    continue;
                out[key] = coerce(key, el.value);
            }
            const sm = field('siteMode');
            if (sm)
                out.siteMode = SITE_MODES.indexOf(sm.value) >= 0 ? sm.value : DEFAULTS.siteMode;
            const as = field('allowedSites');
            if (as)
                out.allowedSites = parseBlocked(as.value);
            const bs = field('blockedSites');
            if (bs)
                out.blockedSites = parseBlocked(bs.value);
            const tt = radioValue('tooltipTrigger');
            if (tt)
                out.tooltipTrigger = TOOLTIP_TRIGGERS.indexOf(tt) >= 0 ? tt : DEFAULTS.tooltipTrigger;
            const rm = radioValue('regexMode');
            if (rm)
                out.autoRegex = rm !== 'click';
            const rr = radioValue('regexReplace');
            if (rr)
                out.regexReplace = rr === 'replace';
            const ac = radioValue('annoCopy');
            if (ac)
                out.copyAnno = ac === 'keep';
            const sam = radioValue('siteAnnotationMode');
            if (sam)
                out.siteAnnotationMode = sam === 'no-annotate' ? 'no-annotate' : 'annotate';
            const pr = radioValue('preRepublic');
            if (pr)
                out.preRepublic = pr === 'on';
            return out;
        }
        function stashCurrent() {
            if (!state || !currentId)
                return;
            if (!field('apiBase') && !field('apiKey') && !field('model'))
                return;
            const keyEl = field('apiKey');
            const masked = keyMasked && keyEl && keyEl.value === KEY_MASK;
            const prev = state.apiProfiles[currentId] || {};
            state.apiProfiles[currentId] = {
                apiBase: coerce('apiBase', field('apiBase') ? field('apiBase').value : ''),
                apiKey: masked ? (prev.apiKey || '') : coerce('apiKey', keyEl ? keyEl.value : ''),
                model: coerce('model', field('model') ? field('model').value : '')
            };
        }
        async function doSave(silent) {
            const values = collect();
            if (addMode) {
                if (!String(values.model || '').trim() && !String(values.apiBase || '').trim()) {
                    warn('新增模型：模型名和接口地址都没填，没有保存');
                    return null;
                }
                values.__add = { label: labelForNewModel(values.model, values.apiBase) };
            }
            const saved = await save(values);
            state = Object.assign({}, state, saved);
            if (addMode) {
                setAddMode(false);
                rebuildModelOptions(state.customs, saved.activeModelId);
                fillProfileFields(saved.activeModelId);
            }
            if (o.onChange)
                o.onChange(saved);
            return saved;
        }
        const importFile = root.querySelector('[data-role="import-file"]');
        if (importFile) {
            importFile.addEventListener('change', async function () {
                const f = this.files && this.files[0];
                if (!f)
                    return;
                try {
                    const parsed = JSON.parse(await f.text());
                    const summary = await importDataBundle(parsed);
                    await refreshDataStats();
                    // 导入可能改了「设置」（bundle.settings）→ 把上面的表单同步过来。
                    const fresh = await load();
                    fill(fresh);
                    if (o.onChange)
                        o.onChange(fresh);
                    warn('导入完成：' + summary);
                }
                catch (err) {
                    warn('导入失败（文件格式不对？）', err);
                }
                this.value = '';
            });
        }
        // 「AI 调用记录」的渲染逻辑在 ai-log-panel.js（仅开发测试用，见文件开头）。
        root.addEventListener("click", async function (e) {
            const btn = e.target.closest('[data-act]');
            if (!btn)
                return;
            const act = btn.getAttribute('data-act');
            if (act === 'save') {
                btn.disabled = true;
                try {
                    // doSave() 在校验没过时返回 null（新增模型没填模型名/接口地址），那种不算保存成功。
                    const saved = await doSave(false);
                    setActionNote(btn, saved ? '已保存' : '');
                }
                catch (err) {
                    warn('保存设置失败', err);
                    setActionNote(btn, '');
                }
                finally {
                    btn.disabled = false;
                }
                return;
            }
            if (act === 'reset') {
                // 三个「恢复默认」各管一个区块，先用原生确认框说清这一块要清什么。
                const raw = btn.getAttribute('data-scope');
                const scope = raw === 'model' || raw === 'custom' ? raw : 'sites';
                const RESET_SCOPES = {
                    model: {
                        title: '模型配置',
                        lines: [
                            '之前保存的所有模型配置都会清空（含已填的 API Key）',
                            '自定义模型一并清掉，回到内置预设，需要重新填 Key 才能用 AI 识别',
                            '站点设置、自定义设置、更正记录、AI 缓存都不受影响'
                        ]
                    },
                    custom: {
                        title: '自定义设置',
                        lines: [
                            '弹框触发方式、正则识别方式、AI 缓存优先、复制标注纪年、文内标注限制、共和前纪年都回到默认值',
                            '站点设置、模型配置、更正记录、AI 缓存都不受影响'
                        ]
                    },
                    sites: {
                        title: '站点设置',
                        lines: [
                            '站点模式恢复为「限制」',
                            '自定义网站 / 禁用网站两个名单清空',
                            '模型配置、自定义设置、更正记录、AI 缓存都不受影响'
                        ]
                    }
                };
                const spec = RESET_SCOPES[scope];
                if (!window.confirm('确定恢复默认' + spec.title + '吗？\n\n· ' + spec.lines.join('\n· '))) {
                    setActionNote(btn, '已取消');
                    return;
                }
                btn.disabled = true;
                try {
                    const out = scope === 'model' ? await resetModelSettings()
                        : scope === 'custom' ? await resetCustomSettings()
                            : await resetSiteSettings();
                    fill(out);
                    setActionNote(btn, '已恢复');
                    if (o.onChange)
                        o.onChange(out);
                }
                finally {
                    btn.disabled = false;
                }
                return;
            }
            if (act === 'add-site') {
                btn.disabled = true;
                try {
                    const host = await currentSiteHost();
                    const modeEl = field('siteMode');
                    const mode = modeEl ? modeEl.value : DEFAULTS.siteMode;
                    // 每个模式下只有一个列表在生效：自定义 → 自定义网站；限制 → 禁用网站。
                    const key = mode === 'custom' ? 'allowedSites' : 'blockedSites';
                    const label = key === 'allowedSites' ? '自定义网站' : '禁用网站';
                    if (!host) {
                        warn('添加当前站点：拿不到当前网站 —— 请先切到那个网页，或在弹窗里点这个按钮');
                        return;
                    }
                    const box = field(key);
                    if (!box) {
                        warn('添加当前站点：这个模式下没有可填的站点列表');
                        return;
                    }
                    const list = parseBlocked(box.value);
                    if (list.indexOf(host) >= 0) {
                        warn('「' + host + '」已经在' + label + '里了');
                        return;
                    }
                    list.push(host);
                    box.value = list.join('\n');
                    const patch = {};
                    patch[key] = list;
                    const saved = await save(patch);
                    state = Object.assign({}, state, saved);
                    if (o.onChange)
                        o.onChange(saved);
                }
                catch (err) {
                    warn('添加当前站点失败', err);
                }
                finally {
                    btn.disabled = false;
                }
                return;
            }
            if (act === 'export-data') {
                btn.disabled = true;
                try {
                    const bundle = await collectDataBundle();
                    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'era-data-' + new Date().toISOString().slice(0, 10) + '.json';
                    a.click();
                    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
                }
                catch (err) {
                    warn('导出失败', err);
                }
                finally {
                    btn.disabled = false;
                }
                return;
            }
            if (act === 'clear-data') {
                const picked = pickedDataKinds();
                if (!picked.length) {
                    warn('清空：一项都没勾选，什么都没做');
                    return;
                }
                // 确认框里把「要清掉什么、有多少」写清楚，别让用户盲点
                const c = bundleCounts(await collectDataBundle());
                const lines = [];
                if (picked.indexOf('picks') >= 0)
                    lines.push('更正记录：' + c.pages + ' 个页面');
                if (picked.indexOf('sites') >= 0)
                    lines.push('站点设置：恢复为默认（限制模式，两个名单清空）');
                if (picked.indexOf('cache') >= 0)
                    lines.push('AI 识别缓存：' + c.cache + ' 条');
                if (!window.confirm('确定清空以下内容吗？此操作不可撤销。\n\n· ' + lines.join('\n· '))) {
                    setActionNote(btn, '已取消');
                    return;
                }
                btn.disabled = true;
                try {
                    await clearPickedData(picked);
                    setActionNote(btn, '已清空');
                    await refreshDataStats();
                    if (picked.indexOf('sites') >= 0)
                        fill(await load());     // 站点设置变了，把上面的表单同步过来
                }
                catch (err) {
                    warn('清空失败', err);
                }
                finally {
                    btn.disabled = false;
                }
                return;
            }
            if (act === 'import-data') {
                const fileEl = root.querySelector('[data-role="import-file"]');
                if (fileEl)
                    fileEl.click();
                return;
            }
            if (act === 'test') {
                // 页面上没有状态行了，「测试连接」的结果必须让用户看见 ——
                // 用原生弹框（不动 DOM、不用额外布局），成功失败都弹。
                btn.disabled = true;
                try {
                    await doSave(true);
                    const resp = await chrome.runtime.sendMessage({ type: 'AI_TEST' });
                    if (resp && resp.ok)
                        window.alert('连接成功 · ' + (resp.model || '') + ' · 识别到 ' + resp.count + ' 处');
                    else
                        window.alert('连接失败：' + ((resp && resp.error) || '未知错误'));
                }
                catch (err) {
                    window.alert('连接失败：' + String((err && err.message) || err));
                }
                finally {
                    btn.disabled = false;
                }
                return;
            }
        });
        root.addEventListener('change', async function (e) {
            const el = e.target;
            if (!el || !el.getAttribute)
                return;
            // 「导出数据」的勾选框：它的状态也算「设置」，随手存进 sync（见 applyDataPicks）。
            if (el.getAttribute('data-role') === 'data-pick') {
                try {
                    const savedPicks = await save({ dataPicks: pickedDataKinds() });
                    state = Object.assign({}, state, savedPicks);
                }
                catch (err) {
                    warn('保存设置失败', err);
                }
                return;
            }
            const key = el.getAttribute('data-k');
            if (!key)
                return;
            if (key === 'apiKey')
                keyMasked = false;
            if (key === 'siteMode') {
                syncSiteFields(el.value);
                const patchMode = { siteMode: SITE_MODES.indexOf(el.value) >= 0 ? el.value : DEFAULTS.siteMode };
                try {
                    const savedMode = await save(patchMode);
                    state = Object.assign({}, state, savedMode);
                }
                catch (err) {
                    warn('保存设置失败', err);
                }
                return;
            }
            if (key === 'regexMode') {
                // 「自动」= autoRegex true；「点击」= false（每次要在弹窗里手动点「正则识别」）
                const patchMode = { autoRegex: radioValue('regexMode') !== 'click' };
                try {
                    const savedMode = await save(patchMode);
                    state = Object.assign({}, state, savedMode);
                    if (o.onChange)
                        o.onChange(savedMode);
                }
                catch (err) {
                    warn('保存设置失败', err);
                }
                return;
            }
            if (key === 'regexReplace') {
                // 「优先」= regexReplace true（页面有 AI 缓存就用缓存结果、不跑正则）；「不优先」= false
                const patchMode = { regexReplace: radioValue('regexReplace') === 'replace' };
                try {
                    const savedMode = await save(patchMode);
                    state = Object.assign({}, state, savedMode);
                    if (o.onChange)
                        o.onChange(savedMode);
                }
                catch (err) {
                    warn('保存设置失败', err);
                }
                return;
            }
            if (key === 'annoCopy') {
                // 「复制」= copyAnno true（复制页面文字时带上文内标注）；「不复制」= false
                const patchMode = { copyAnno: radioValue('annoCopy') === 'keep' };
                try {
                    const savedMode = await save(patchMode);
                    state = Object.assign({}, state, savedMode);
                    if (o.onChange)
                        o.onChange(savedMode);
                }
                catch (err) {
                    warn('保存设置失败', err);
                }
                return;
            }
            if (key === 'siteAnnotationMode') {
                // 「标注」= 指定网站允许文内标注；「不标注」= 即使全局开启文内标注，指定网站也不显示。
                const patchMode = { siteAnnotationMode: radioValue('siteAnnotationMode') === 'no-annotate' ? 'no-annotate' : 'annotate' };
                try {
                    const savedMode = await save(patchMode);
                    state = Object.assign({}, state, savedMode);
                    if (o.onChange)
                        o.onChange(savedMode);
                }
                catch (err) {
                    warn('保存设置失败', err);
                }
                return;
            }
            if (key === 'preRepublic') {
                // 「识别」= preRepublic true（前841前的纪年照常标注，年份带「约」）；「不识别」= false
                const patchMode = { preRepublic: radioValue('preRepublic') === 'on' };
                try {
                    const savedMode = await save(patchMode);
                    state = Object.assign({}, state, savedMode);
                    if (o.onChange)
                        o.onChange(savedMode);
                }
                catch (err) {
                    warn('保存设置失败', err);
                }
                return;
            }
            if (key === 'activeModelId') {
                if (el.value === M.ADD_ID) {
                    stashCurrent();
                    setAddMode(true);
                    field('apiBase').value = '';
                    field('apiKey').value = '';
                    field('model').value = '';
                    if (hintEl)
                        hintEl.textContent = '填好接口地址、Key 和模型名，点「保存设置」加进列表 —— 下拉里就用模型名显示。';
                    return;
                }
                const wasAdd = addMode;
                setAddMode(false);
                const nextId = M.byId(el.value, state.customs) ? el.value : M.DEFAULT_ID;
                if (wasAdd) {
                    fillProfileFields(nextId);
                    try {
                        const saved = await save({ activeModelId: nextId });
                        state = Object.assign({}, state, saved);
                        if (o.onChange)
                            o.onChange(saved);
                    }
                    catch (err) {
                        warn('切换模型失败', err);
                    }
                    return;
                }
                stashCurrent();
                fillProfileFields(nextId);
                try {
                    const saved = await save(Object.assign({}, collect(), { activeModelId: nextId }));
                    state = Object.assign({}, state, saved);
                    if (o.onChange)
                        o.onChange(saved);
                }
                catch (err) {
                    warn('切换模型失败', err);
                }
                return;
            }
            const patch = {};
            patch[key] = coerce(key, FIELD_KINDS[key] === 'check' ? el.checked : el.value);
            if (state && currentId && PROFILE_KEYS.indexOf(key) >= 0) {
                if (!state.apiProfiles[currentId])
                    state.apiProfiles[currentId] = M.defaultProfile(currentId);
                state.apiProfiles[currentId][key] = patch[key];
            }
            try {
                const saved = await save(patch);
                state = Object.assign({}, state, saved);
                if (o.onChange)
                    o.onChange(saved);
            }
            catch (err) { }
        });
        load().then(fill);
        refreshDataStats();
        if (dataStatsEl && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener(function (ch, area) {
                const keys = Object.keys(ch || {});
                if (area === 'local' && (ch[OVERRIDE_KEY] || keys.some(function (k) { return k.indexOf(AI_CACHE_PREFIX) === 0; })))
                    refreshDataStats();
                if (area === 'sync' && SITE_KEYS.some(function (k) { return ch[k]; }))
                    refreshDataStats();
            });
        }
        return {
            collect: collect,
            fill: fill,
            syncSiteFields: syncSiteFields,
            reload: function () { return load().then(fill); }
        };
    }
    global.EraSettings = {
        DEFAULTS: DEFAULTS,
        load: load,
        save: save,
        resetAll: resetAll,
        resetSiteSettings: resetSiteSettings,
        resetModelSettings: resetModelSettings,
        resetCustomSettings: resetCustomSettings,
        mount: mount
    };
})(typeof window !== 'undefined' ? window : self);
