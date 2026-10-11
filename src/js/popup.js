(function () {
    'use strict';
    function contentAssets() {
        const manifest = chrome.runtime.getManifest();
        const entry = (manifest.content_scripts || []).find(function (item) {
            return Array.isArray(item.js) && item.js.some(function (file) { return /content\/content\.js$/.test(file); });
        });
        return {
            js: entry ? entry.js.slice() : [],
            css: entry && Array.isArray(entry.css) ? entry.css.slice() : []
        };
    }
    const $ = function (id) { return document.getElementById(id); };
    let tab = null;
    let userActed = false;
    function injectable(url) {
        return /^(https?|file):/i.test(url || '');
    }
    async function ensureInjected(tabId) {
        const assets = contentAssets();
        if (!assets.js.length)
            throw new Error('找不到页面脚本配置');
        if (assets.css.length) {
            try {
                await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: assets.css });
            }
            catch (e) { }
        }
        await chrome.scripting.executeScript({ target: { tabId: tabId }, files: assets.js });
    }
    async function send(msg) {
        if (!tab || tab.id == null)
            throw new Error('找不到当前标签页');
        if (!injectable(tab.url)) {
            throw new Error('当前页面不支持（浏览器内部页面 / 扩展商店页面等无法支持）');
        }
        try {
            const r = await chrome.tabs.sendMessage(tab.id, msg);
            if (r)
                return r;
            throw new Error('页面没有响应');
        }
        catch (e) {
            await ensureInjected(tab.id);
            return await chrome.tabs.sendMessage(tab.id, msg);
        }
    }
    function syncGet(defaults) {
        return new Promise(function (resolve) {
            try {
                chrome.storage.sync.get(defaults, function (v) {
                    resolve(Object.assign({}, defaults, v || {}));
                });
            }
            catch (e) {
                resolve(Object.assign({}, defaults));
            }
        });
    }
    async function bg(msg) {
        try {
            return await chrome.runtime.sendMessage(msg);
        }
        catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    }
    let alertOwner = '';
    function setAlert(text, kind) {
        const el = $('pp-alert');
        if (!text) {
            // 不隐藏 —— 留一个空位（高度由 CSS 的 min-height 撑住），
            // 否则「清空 → 再填上」会让下面的内容上下跳一下。
            el.hidden = false;
            el.className = 'pp-alert';
            el.textContent = '';
            if (alertOwner !== 'continuous')
                alertOwner = '';
            return;
        }
        alertOwner = 'event';
        el.hidden = false;
        el.className = 'pp-alert pp-alert-' + (kind || 'warn');
        el.textContent = text;
    }
    function setContinuousAlert(text, kind) {
        if (alertOwner === 'event')
            return;
        const el = $('pp-alert');
        alertOwner = 'continuous';
        el.hidden = false;
        el.className = 'pp-alert pp-alert-' + (kind || 'warn');
        el.textContent = text;
    }
    const REGEX_MODE_NOTE = '当前使用正则识别：本地匹配。';
    function syncModeNote(stats) {
        if (!stats)
            return;
        if (!stats.autoAllowed && stats.mode === 'idle') {
            if (stats.siteMode === 'disabled')
                setAlert('已全局禁用自动识别：所有网页都需要在弹窗里点「正则识别」手动识别。', 'warn');
            else if (stats.blocked)
                setAlert('此站点在禁用列表中，不会自动识别。可以点击"正则识别"单次识别。', 'warn');
            else
                setAlert('自定义模式：该网站不在「自定义网站」名单里，仍可手动点击"正则识别"单次识别。', 'warn');
            return;
        }
        if (stats.mode === 'ai')
            return;
        setAlert(REGEX_MODE_NOTE, 'warn');
    }
    function render(stats, extra) {
        if (!stats)
            return;
        const mode = stats.mode || 'idle';
        const badge = $('pp-mode');
        const note = $('pp-note');
        if (stats.disabled) {
            $('pp-count').textContent = '–';
            badge.className = 'pp-stat-badge';
            badge.textContent = '已关闭';
            note.textContent = '插件已关闭';
            $('btn-ai').setAttribute('aria-pressed', 'false');
            $('btn-regex').setAttribute('aria-pressed', 'false');
            if (extra)
                setAlert(extra.text, extra.kind);
            return;
        }
        if (!stats.autoAllowed && mode === 'idle') {
            $('pp-count').textContent = '–';
            badge.className = 'pp-stat-badge';
            badge.textContent = stats.siteMode === 'disabled' ? '全局禁用' : (stats.blocked ? '已禁用' : '未启用');
            note.textContent = stats.siteMode === 'disabled'
                ? '全局禁用 · 需手动识别'
                : (stats.blocked ? '禁用网站 · 未识别' : '自定义模式 · 未识别');
            $('btn-ai').setAttribute('aria-pressed', 'false');
            $('btn-regex').setAttribute('aria-pressed', 'false');
            if (extra)
                setAlert(extra.text, extra.kind);
            return;
        }
        $('pp-count').textContent = mode === 'idle' ? '–' : String(stats.count || 0);
        const aiMode = mode === 'ai';
        $('btn-ai').setAttribute('aria-pressed', aiMode ? 'true' : 'false');
        const regexOn = mode === 'regex' ||
            (mode === 'idle' && stats.autoAllowed && !stats.userCleared);
        $('btn-regex').setAttribute('aria-pressed', regexOn ? 'true' : 'false');
        badge.className = 'pp-stat-badge';
        if (mode === 'ai') {
            badge.textContent = stats.cached ? 'AI · 缓存' : 'AI 识别';
            badge.classList.add('is-ai');
            note.textContent = stats.cached
                ? (stats.cacheExact ? '正文未变，直接读缓存' : '正文有更新，复用缓存片段')
                : '本次调用了接口';
        }
        else if (mode === 'regex') {
            badge.textContent = '正则识别';
            badge.classList.add('is-regex');
            note.textContent = '识别成功 · 已标注';
        }
        else {
            badge.textContent = '未分析';
            note.textContent = '点击识别按钮分析';
        }
        if (extra)
            setAlert(extra.text, extra.kind);
    }
    async function refresh() {
        try {
            const stats = await send({ type: 'GET_STATS' });
            render(stats);
            syncModeNote(stats);
        }
        catch (e) {
            render({ mode: 'idle', count: 0 });
            setAlert(String((e && e.message) || e), 'err');
        }
    }
    function busy(btn, on) {
        if (!btn)
            return;
        btn.disabled = !!on;
        btn.classList.toggle('loading', !!on);
    }
    // ---- 「连续使用」= 次数额度（以前是倒计时，已整体换掉）----
    // 状态在 background 里算：off（单次）/ armed（选了次数、还没点「AI 识别」）/
    // active（批次进行中）/ exhausted（用完了，再点一次「AI 识别」开新批次）。
    // extra：紧跟在「已使用：x/N次」后面的补充说明（识别完那一刻才知道这次是不是读的缓存）。
    function quotaText(s, extra) {
        if (!s)
            return '';
        const head = (s.usedText || '') + (extra || '');
        if (s.phase === 'exhausted')
            return head + ' · 次数已用完，重新点「AI 识别」可再开一批';
        return head;
    }
    function paintContinuous(s) {
        const phase = (s && s.phase) || 'off';
        if (phase === 'active' || phase === 'exhausted') {
            // 计数状态优先于「当前用正则」那类模式说明 —— 用户要看的就是已用次数。
            // 直接写，不走 setContinuousAlert（它会因为 alertOwner==='event' 让路）。
            const el = $('pp-alert');
            alertOwner = 'continuous';
            el.hidden = false;
            el.className = 'pp-alert pp-alert-err';
            el.textContent = quotaText(s);
            return;
        }
        if (phase === 'armed') {
            setContinuousAlert('已选 ' + (s.settingLabel || '次数') +
                ' · 点「AI 识别」后开始计数，在那之前页面仍默认用正则', 'warn');
            return;
        }
        if (alertOwner === 'continuous') {
            alertOwner = '';
            setAlert('');
        }
    }
    async function refreshContinuous() {
        const s = await bg({ type: 'AI_CONTINUOUS_GET' });
        if (s && s.ok)
            paintContinuous(s);
        return s;
    }
    // 点「AI 识别」时先调用：没有批次就按当前选项开一批；已经在计数中就不动额度（这一次照常扣 1）。
    // ⚠️ 这里**不画界面** —— 刚开批时 used 还是 0，画出来就是「已使用：0/100次」，
    // 紧接着识别完又会变成「已使用：1/100次」，用户看到的是闪一下。调用方（runAi）
    // 在识别完成后统一 refreshContinuous() 一次就够了。
    async function maybeStartContinuous() {
        const value = $('sel-continuous').value || 'once';
        const s = await bg({ type: 'AI_CONTINUOUS_SET', value: value });
        if (!s || !s.ok)
            return null;
        if (s.phase === 'active') {
            try {
                await send({ type: 'AI_WINDOW_CHANGED' });
            }
            catch (e) { }
        }
        return s;
    }

    function paintAnnotate(on) {
        const btn = $('btn-annotate');
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    // 色卡菜单：两行 —— 第一行适用浅色网页，第二行是「对应」的深色网页变体
    // （同一色系，底色更深更饱和、下划线更亮，免得浅色变体在深色页面上被页面底色吃掉）。
    // 最后一格「透明」跨上下两行（grid-row: 1 / span 2）。
    // row / col 是显式网格坐标（不靠自动排布，省得 span 那一格把后面挤错行）。
    const DARK_PAGE = '#14161b';   // 第二行色块的预览底：假装它贴在深色网页上
    const MARK_THEMES = [
        { id: 'amber', name: '琥珀', color: '#ffd047', row: 1, col: 1 },
        { id: 'green', name: '绿', color: '#66d68c', row: 1, col: 2 },
        { id: 'blue', name: '蓝', color: '#60b4ff', row: 1, col: 3 },
        { id: 'pink', name: '粉', color: '#ff82b4', row: 1, col: 4 },
        { id: 'gray', name: '灰', color: '#b4bac4', row: 1, col: 5 },
        { id: 'none', name: '透明', color: 'transparent', slash: true, row: 1, col: 6, spanRows: 2 },
        { id: 'amber-dark', name: '琥珀', fill: 'rgba(255, 178, 0, 0.40)', underline: 'rgba(255, 214, 92, 1)', row: 2, col: 1 },
        { id: 'green-dark', name: '绿', fill: 'rgba(38, 198, 118, 0.38)', underline: 'rgba(126, 232, 176, 1)', row: 2, col: 2 },
        { id: 'blue-dark', name: '蓝', fill: 'rgba(74, 152, 255, 0.40)', underline: 'rgba(140, 200, 255, 1)', row: 2, col: 3 },
        { id: 'pink-dark', name: '粉', fill: 'rgba(255, 84, 160, 0.38)', underline: 'rgba(255, 162, 206, 1)', row: 2, col: 4 },
        { id: 'gray-dark', name: '灰', fill: 'rgba(176, 188, 210, 0.34)', underline: 'rgba(214, 222, 238, 1)', row: 2, col: 5 }
    ];
    function buildThemeMenu(current) {
        const menu = $('pp-theme-menu');
        const swatch = $('pp-theme-swatch');
        if (!menu || !swatch)
            return;
        // 深色变体：把「深色网页底 + 该色淡涂 + 亮下划线」一起画出来，菜单里看到的就是页面上的样子。
        // 用 background-color + background-image 分开写，别用 `background: a, b` 那种多层简写 ——
        // 简写的解析在不同实现里不一致（有的会把最后一层的颜色丢掉，色块直接变透明）。
        function paint(el, t) {
            el.style.backgroundColor = t.slash ? 'transparent' : (t.fill ? DARK_PAGE : t.color);
            el.style.backgroundImage = t.fill ? 'linear-gradient(' + t.fill + ', ' + t.fill + ')' : '';
            el.style.boxShadow = t.underline ? 'inset 0 -3px 0 0 ' + t.underline : '';
            el.classList.toggle('pp-theme-none', !!t.slash);
            el.classList.toggle('pp-theme-dark', !!t.fill);
        }
        const curTheme = MARK_THEMES.filter(function (x) { return x.id === current; })[0] || MARK_THEMES[0];
        paint(swatch, curTheme);
        $('btn-theme').title = '标注颜色样式 · 当前：' + curTheme.name + (curTheme.fill ? '（深色网页）' : (curTheme.slash ? '（只标注不高亮）' : '（浅色网页）'));
        menu.textContent = '';
        for (const t of MARK_THEMES) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'pp-theme-item';
            item.setAttribute('role', 'option');
            item.setAttribute('data-theme', t.id);
            item.setAttribute('data-row', String(t.row));
            item.setAttribute('aria-selected', String(t.id === current));
            item.style.gridColumn = String(t.col);
            item.style.gridRow = t.spanRows ? t.row + ' / span ' + t.spanRows : String(t.row);
            item.title = t.name + '：' + (t.slash
                ? '只标注，不高亮'
                : (t.fill ? '适用深色网页背景' : '适用浅色网页背景'));
            paint(item, t);
            menu.appendChild(item);
        }
    }
    const SITE_MODES = ['restricted', 'custom', 'global', 'disabled'];
    function paintEnabled(on) {
        const btn = $('btn-power');
        if (!btn)
            return;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        const t = $('pp-power-text');
        if (t)
            t.textContent = '启用';
    }
    // 识别模式只在「站点设置」里选（主面板那个下拉已删），这里只负责把值同步过去
    function paintSiteMode(mode) {
        const m = SITE_MODES.indexOf(mode) >= 0 ? mode : 'restricted';
        const side = document.querySelector('#pp-sites-mount [data-k="siteMode"]');
        if (side)
            side.value = m;
    }
    // AI 识别失败时统一成「本次识别失败（原因）：原始信息」。
    // 原因是从 code / 原始文案里猜出来的一句人话 —— 接口那边返回的
    // 「接口返回 402：Insufficient Balance」太原始，光看不知道该怎么办；
    // 原始信息仍然拼在后面，方便排查（不想看可以只留前面那半句）。
    function aiFailText(r, err) {
        const code = String((r && r.code) || '');
        const raw = String((r && r.error) || (err && err.message) || err || '');
        const hit = function (re) { return re.test(code) || re.test(raw); };
        let why = '';
        if (code === 'NO_API_KEY' || /API Key/.test(raw))
            why = '还没填 API Key';
        else if (hit(/402|Insufficient|balance|余额|欠费|额度/i))
            why = '额度不足';
        else if (hit(/401|403|Unauthorized|Forbidden|invalid[_ ]?api[_ ]?key/i))
            why = 'API Key 无效或没权限';
        else if (hit(/404|model.*not.*found|does not exist/i))
            why = '模型名或接口地址不对';
        else if (hit(/429|rate.?limit|too many requests/i))
            why = '请求太频繁';
        else if (hit(/Failed to fetch|NetworkError|net::|timeout|超时/i))
            why = '网络不通或超时';
        else if (code === 'NO_TEXT' || hit(/未能从当前页面提取/))
            why = '没能从页面提取到正文';
        else if (code === 'DISABLED' || hit(/插件已关闭/))
            why = '插件已关闭';
        else if (hit(/不是合法 JSON|接口返回内容为空/))
            why = '模型返回的内容读不懂';
        const head = '本次识别失败' + (why ? '（' + why + '）' : '');
        return raw ? head + '：' + raw : head;
    }
    async function runAi(btn, noCache) {
        userActed = true;
        busy(btn, true);
        // 先把「次数」批次开起来（选「单次」则清掉），这样**这一次**识别也计入已用次数。
        await maybeStartContinuous();
        // 「正在调用…」**不要立刻写**：命中缓存时接口根本没被调用，这句会一闪而过
        // （黄色闪一下再变红色的次数提示，用户反馈过）。拖过 500ms 还没回来才显示 ——
        // 真调接口时该有的进度提示还在，读缓存就看不到闪烁。
        // 按钮本身也有 loading 态（busy()），所以这段时间并不是完全没反馈。
        const hintTimer = setTimeout(function () {
            setAlert(noCache ? '正在重新识别（跳过缓存）…' : '正在调用 AI 分析正文，请稍候…', 'warn');
        }, 500);
        try {
            const r = await send({ type: 'RUN_AI', noCache: !!noCache });
            clearTimeout(hintTimer);
            if (r && r.ok) {
                render(r);
                // background 在识别成功时已经扣过一次，这里读回扣减后的次数。
                // 计数模式下就把 pp-alert 换成「已使用：x/N次」（用户要求的提示），
                // 读缓存的那一次再补一句「（本次读取缓存，不消耗token）」——读缓存不扣次数。
                const cont = await refreshContinuous();
                const counting = cont && (cont.phase === 'active' || cont.phase === 'exhausted');
                if (counting) {
                    // 这次是读缓存的话补一句说明 —— 读缓存不扣次数，用户能看出来为什么没涨。
                    setAlert(quotaText(cont, r.cached ? '（本次读取缓存，不消耗token）' : ''), 'err');
                }
                else {
                    let msg;
                    if (r.cached) {
                        msg = r.cacheExact
                            ? '这个页面已经识别过，直接读的缓存，没有调用接口。'
                            : '正文有更新，复用了缓存里仍然存在的 ' + r.count + ' 处（' +
                                (r.cacheDropped || 0) + ' 处已失效）。';
                    }
                    else {
                        msg = r.count
                            ? 'AI 识别完成，页面命中 ' + r.count + ' 处（模型返回 ' + (r.raw || 0) + ' 条）。'
                            : 'AI 没有在当前页面找到年号。';
                    }
                    if (cont && cont.phase === 'off')
                        msg += ' 当前是「单次」模式，新页面仍默认使用正则识别。';
                    setAlert(msg, 'ok');
                }
            }
            else {
                render(r);
                setAlert(aiFailText(r), 'err');
            }
        }
        catch (e) {
            clearTimeout(hintTimer);
            setAlert(aiFailText(null, e), 'err');
        }
        finally {
            clearTimeout(hintTimer);
            busy(btn, false);
        }
    }
    function bind() {
        $('btn-regex').addEventListener('click', async function () {
            const btn = this;
            userActed = true;
            busy(btn, true);
            setAlert('');
            try {
                const r = await send({ type: 'RUN_REGEX' });
                render(r);
                if (r.ok === false) {
                    setAlert(r.error || '正则识别失败', 'err');
                }
                else {
                    const tail = r.siteMode === 'disabled'
                        ? ' 当前为「全局禁用」，每次都要手动点。'
                        : (r.blocked ? ' 此站点在禁用列表中，每次都要手动点。' : '');
                    setAlert((r.count ? '正则识别完成，命中 ' + r.count + ' 处。' : '正则没有在当前页面找到年号。') + tail, r.count ? 'ok' : 'warn');
                }
            }
            catch (e) {
                setAlert(String((e && e.message) || e), 'err');
            }
            finally {
                busy(btn, false);
            }
        });
        $('btn-ai').addEventListener('click', function () { runAi(this, false); });
        $('btn-ai-reset').addEventListener('click', function () { runAi(this, true); });
        $('btn-clear').addEventListener('click', async function () {
            const btn = this;
            userActed = true;
            busy(btn, true);
            try {
                const r = await send({ type: 'CLEAR' });
                render(r);
                setAlert(r.ok === false ? (r.error || '清除失败') : '已清除页面上的高亮标记。', r.ok === false ? 'err' : 'ok');
            }
            catch (e) {
                setAlert(String((e && e.message) || e), 'err');
            }
            finally {
                busy(btn, false);
            }
        });
        $('btn-regex-reset').addEventListener('click', async function () {
            const btn = this;
            userActed = true;
            busy(btn, true);
            setAlert('正在清除本页更正，并用正则重新识别…', 'warn');
            try {
                const r = await send({ type: 'RUN_REGEX', reset: true });
                render(r);
                if (r && r.ok === false) {
                    setAlert(r.error || '正则重置失败', 'err');
                }
                else {
                    const cleared = Number(r && r.clearedCorrections) || 0;
                    const head = cleared
                        ? '已清除本页 ' + cleared + ' 处更正，'
                        : '本页没有需要清除的更正，';
                    setAlert(head + (r && r.count
                        ? '正则重置完成，命中 ' + r.count + ' 处。'
                        : '正则重置完成，当前页面没有找到年号。'), r && r.count ? 'ok' : 'warn');
                }
            }
            catch (e) {
                setAlert(String((e && e.message) || e), 'err');
            }
            finally {
                busy(btn, false);
            }
        });
        $('btn-annotate').addEventListener('click', async function () {
            const btn = this;
            userActed = true;
            const next = btn.getAttribute('aria-pressed') !== 'true';
            busy(btn, true);
            try {
                await chrome.storage.sync.set({ annotate: next });
                paintAnnotate(next);
                let r = null;
                try {
                    r = await send({ type: 'SET_ANNOTATE', value: next });
                }
                catch (e) {
                    setAlert(next ? '文内标注已开启。当前页面无法注入脚本，新打开的网页会生效。'
                        : '文内标注已关闭。当前页面无法注入脚本，新打开的网页会生效。', 'warn');
                    return;
                }
                render(r);
                if (!next) {
                    setAlert('已关闭文内标注，页面上的公历年已全部摘除，原文恢复原样。', 'ok');
                }
                else {
                    const n = (r && r.annoCount) || 0;
                    setAlert(n ? '已开启文内标注，页面补上 ' + n + ' 处公历年（原文未改动）。'
                        : '已开启文内标注。当前页面还没有高亮，先识别一次才会出现标注。', n ? 'ok' : 'warn');
                }
            }
            catch (e) {
                setAlert('切换文内标注失败：' + String((e && e.message) || e), 'err');
            }
            finally {
                busy(btn, false);
            }
        });
        $('sel-continuous').addEventListener('change', async function () {
            const value = this.value;
            const label = this.options[this.selectedIndex].textContent.trim();
            // 只换选项、还没点「AI 识别」→ 把上一批额度清掉、回到「armed」
            // （否则会出现「界面选 300 次、额度还是上一批 100」这种对不上的状态）
            await bg({ type: value === 'once' ? 'AI_CONTINUOUS_SET' : 'AI_CONTINUOUS_ARM', value: value });
            setAlert(value === 'once'
                ? '已设为「单次」：不计数，页面默认用正则识别，点「AI 识别」才用 AI。'
                : '已选「' + label + '」。点「AI 识别」后开始计数；在此之前页面仍默认用正则识别。', 'ok');
            await refreshContinuous();
        });
        [['btn-toggle-settings', 'pp-settings-body'], ['btn-toggle-sites', 'pp-sites-body'],
            ['btn-toggle-custom', 'pp-custom-body'], ['btn-toggle-data', 'pp-data-body']]
            .forEach(function (pair) {
            const t = $(pair[0]);
            const b = $(pair[1]);
            if (!t || !b)
                return;
            t.addEventListener('click', function () {
                const open = b.hidden;
                b.hidden = !open;
                t.setAttribute('aria-expanded', String(open));
            });
        });
        $('btn-sidepanel').addEventListener('click', async function () {
            if (!tab || tab.id == null)
                return;
            const btn = this;
            btn.disabled = true;
            try {
                if (!chrome.sidePanel || !chrome.sidePanel.open)
                    throw new Error('当前浏览器不支持侧边栏');
                await chrome.sidePanel.open({ tabId: tab.id });
                window.close();
            }
            catch (e) {
                setAlert(String((e && e.message) || e), 'err');
            }
            finally {
                btn.disabled = false;
            }
        });
        $('btn-power').addEventListener('click', async function () {
            userActed = true;
            const next = this.getAttribute('aria-pressed') !== 'true';
            paintEnabled(next);
            try {
                await chrome.storage.sync.set({ enabled: next });
                const stats = await send({ type: 'GET_STATS' });
                render(stats);
                syncModeNote(stats);
                setAlert(next
                    ? '插件已启用，正在重新识别当前页面。'
                    : '插件已关闭：所有网站都不再自动识别，手动点识别也会被挡住。再点一下开关就能恢复。', next ? 'ok' : 'warn');
            }
            catch (e) {
                setAlert(String((e && e.message) || e), 'err');
            }
        });
        // 色卡菜单：鼠标移出就收起（留 150ms，方便从按钮挪到下面的菜单上）
        let themeHideTimer = 0;
        function closeThemeMenu() {
            clearTimeout(themeHideTimer);
            themeHideTimer = 0;
            const menu = $('pp-theme-menu');
            if (!menu || menu.style.display === 'none')
                return;
            menu.style.display = 'none';
            $('btn-theme').setAttribute('aria-expanded', 'false');
        }
        $('pp-theme').addEventListener('mouseenter', function () {
            clearTimeout(themeHideTimer);
            themeHideTimer = 0;
        });
        $('pp-theme').addEventListener('mouseleave', function () {
            clearTimeout(themeHideTimer);
            themeHideTimer = setTimeout(closeThemeMenu, 150);
        });
        $('btn-theme').addEventListener('click', function (e) {
            e.stopPropagation();
            const menu = $('pp-theme-menu');
            if (menu.style.display !== 'none') {
                closeThemeMenu();
                return;
            }
            clearTimeout(themeHideTimer);
            themeHideTimer = 0;
            // 色卡菜单是 grid（两行）：这里必须写 'grid'，写 'flex' 会把第二行挤成一列。
            menu.style.display = 'grid';
            this.setAttribute('aria-expanded', 'true');
        });
        $('pp-theme-menu').addEventListener('click', async function (e) {
            const item = e.target.closest('.pp-theme-item');
            if (!item)
                return;
            e.stopPropagation();
            const id = item.getAttribute('data-theme');
            buildThemeMenu(id);
            closeThemeMenu();
            try {
                await chrome.storage.sync.set({ markTheme: id });
            }
            catch (err) {
                setAlert(String((err && err.message) || err), 'err');
            }
        });
        document.addEventListener('click', function () {
            closeThemeMenu();
        });
        // 主面板的「识别模式」下拉已删 —— 改模式统一走下面的「站点设置」面板
        // （那里的下拉由 settings-form.js 自己保存并同步）。
        $('btn-options').addEventListener('click', function (e) {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
        });
    }
    async function init() {
        try {
            const info = await bg({ type: 'ERA_TABLE_INFO' });
            if (info && info.ok)
                $('pp-era-total').textContent = '内置年号 ' + info.total + ' 条';
        }
        catch (e) {
            if (window.EraData)
                $('pp-era-total').textContent = '内置年号 ' + window.EraData.ERAS.length + ' 条';
        }
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = tabs && tabs[0];
        const titleEl = $('pp-page-title');
        if (titleEl && tab && tab.title)
            titleEl.textContent = tab.title;
        const cfg = await syncGet({
            aiContinuous: 'once', annotate: false, siteMode: 'restricted',
            enabled: true, markTheme: 'amber'
        });
        const sel = $('sel-continuous');
        if (cfg.aiContinuous && sel.querySelector('option[value="' + cfg.aiContinuous + '"]')) {
            sel.value = cfg.aiContinuous;
        }
        else if (cfg.aiContinuous && cfg.aiContinuous !== 'once') {
            // 老版本存的是时长（'15m' / '1h'…），现在只有次数选项了 → 归一到「单次」
            await bg({ type: 'AI_CONTINUOUS_SET', value: 'once' });
            sel.value = 'once';
        }
        paintAnnotate(!!cfg.annotate);
        paintSiteMode(cfg.siteMode);
        paintEnabled(cfg.enabled !== false);
        buildThemeMenu(cfg.markTheme);
        // 四个局部挂载各挂一块；留个句柄，方便「导出数据」导入后把另外几块同步过来。
        const sitesApi = window.EraSettings.mount($('pp-sites-mount'), {
            compact: true,
            only: 'sites',
            onChange: async function () {
                try {
                    paintSiteMode((await syncGet({ siteMode: 'restricted' })).siteMode);
                }
                catch (e) { }
                try {
                    const stats = await send({ type: 'GET_STATS' });
                    render(stats);
                    syncModeNote(stats);
                }
                catch (e) { }
            }
        });
        window.EraSettings.mount($('pp-settings-mount'), {
            compact: true,
            only: 'model',
            onChange: async function () {
                try {
                    const back = await syncGet({
                        annotate: false, siteMode: 'restricted', enabled: true
                    });
                    paintAnnotate(!!back.annotate);
                    paintSiteMode(back.siteMode);
                    paintEnabled(back.enabled !== false);
                }
                catch (e) { }
                try {
                    const stats = await send({ type: 'GET_STATS' });
                    render(stats);
                    syncModeNote(stats);
                }
                catch (e) { }
            }
        });
        const customApi = window.EraSettings.mount($('pp-custom-mount'), {
            compact: true,
            only: 'custom',
            onChange: async function () {
                try {
                    const stats = await send({ type: 'GET_STATS' });
                    render(stats);
                    syncModeNote(stats);
                }
                catch (e) { }
            }
        });
        // 「导出数据」：导出 / 导入 / 清空。只有导入会触发 onChange ——
        // 导入包里带着站点设置和自定义设置，所以要把上面那两块重新读一遍。
        window.EraSettings.mount($('pp-data-mount'), {
            compact: true,
            only: 'data',
            onChange: async function () {
                try {
                    if (sitesApi)
                        sitesApi.reload();
                }
                catch (e) { }
                try {
                    if (customApi)
                        customApi.reload();
                }
                catch (e) { }
                try {
                    const back = await syncGet({
                        annotate: false, siteMode: 'restricted', enabled: true
                    });
                    paintAnnotate(!!back.annotate);
                    paintSiteMode(back.siteMode);
                    paintEnabled(back.enabled !== false);
                }
                catch (e) { }
                try {
                    const stats = await send({ type: 'GET_STATS' });
                    render(stats);
                    syncModeNote(stats);
                }
                catch (e) { }
            }
        });
        bind();
        await refresh();
        await refreshContinuous();
        setTimeout(async function () {
            if (userActed)
                return;
            try {
                const stats = await send({ type: 'GET_STATS' });
                if (stats && stats.mode !== 'idle')
                    render(stats);
            }
            catch (e) { }
        }, 900);
    }
    document.addEventListener('DOMContentLoaded', init);
})();
