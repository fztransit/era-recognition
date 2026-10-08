# 年号纪年识别

Chrome Manifest V3 扩展：提取网页正文，识别中国历代年号，在原文里高亮，并通过悬浮卡片显示公历年、干支与候选年号；侧边栏提供「年号 ⇄ 公元年」的双向查询。

本文既是使用说明，也是**功能设计参考**。改代码前建议先看这两节：

- **四、更正如何影响后续纪年** —— 上下文传递在 DOM / Canvas 两条路径上各写了一套，最容易改坏
- **七、年号表的数据约定与坑** —— 好几个 bug 都源自这里的假设

## 安装

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 选择「加载已解压的扩展程序」，选本项目目录
4. 需要识别 `file://` 页面时，在扩展详情中开启「允许访问文件网址」

---

## 目录结构

```text
年号纪年识别/
├─ manifest.json
├─ icons/
├─ src/
│  ├─ html/
│  │  ├─ popup.html          弹窗（状态、识别/清除/文内标注、站点与模型设置入口）
│  │  ├─ options.html        详细设置页
│  │  └─ sidepanel.html      侧边栏「纪年查询」
│  ├─ css/
│  │  ├─ content.css         页面内：标记、文内标注、卡片、更正面板、canvas 覆盖层
│  │  ├─ popup.css
│  │  ├─ options.css
│  │  ├─ sidepanel.css
│  │  └─ settings-form.css   popup 与 options 共用的设置表单
│  └─ js/
│     ├─ content/            【content script】页面侧，隔离世界
│     │  ├─ content.js             入口：读设置 → 启动 canvas 适配 / 扫描 / 观察器
│     │  ├─ content-state.js       常量、DEFAULTS、runtime、站点规则、记录读写
│     │  ├─ content-marker.js      建标记 / 清除 / __eraKey / 「已清除」判定
│     │  ├─ content-annotation.js  候选解析、上下文链、文内标注
│     │  ├─ content-scanner.js     DOM 扫描（正则）
│     │  ├─ content-ai.js          AI 结果落地成标记
│     │  ├─ content-correction.js  更正面板
│     │  ├─ content-tooltip.js     卡片
│     │  ├─ content-observer.js    DOM 变化观察器
│     │  ├─ content-message.js     接收弹窗 / 后台消息
│     │  ├─ canvas-main.js         【MAIN world】钩 CanvasRenderingContext2D，把文字抛出来
│     │  └─ canvas-adapter.js      识典古籍：消费 canvas 文字、画覆盖标记
│     ├─ era-table.js       年号表（纯数据）
│     ├─ eras.js            年号表 API：正则、解析、干支、公元换算
│     ├─ era-search.js      搜索 / 补全
│     ├─ maintext.js        正文提取
│     ├─ ai-core.js         AI 提示词与调用
│     ├─ cache.js           AI 结果缓存
│     ├─ models.js          模型配置档
│     ├─ storage.js         chrome.storage 封装
│     ├─ background.js      service worker
│     ├─ popup.js  options.js  sidepanel.js  settings-form.js
│     └─ ai-log-panel.js    【仅开发测试用】设置页的「AI 调用记录」区块 —— 整份删掉不影响功能
└─ README.md
```

JavaScript、CSS、HTML 分目录；页面侧 JS 再按功能集中在 `src/js/content/`。

---

## 一、识别流程

### 1.1 本地正则（默认，不联网）

`content-scanner.js` 用 `eras.js` 的 `buildRegex()` 扫正文文本节点。`buildRegex` 拼出这些分支（命名捕获组）：

| 组名     | 形态                            | 例         |
| ------ | ----------------------------- | --------- |
| `era`  | 年号 + 纪年数字 + 年                 | 建元三年、建元3年 |
| `eraG` | 年号 + 干支 + 年                   | 建元甲子年     |
| `eraC` | 改元 + 年号（前置断言）                 | 改元永興      |
| `eraR` | 年号 + 年间 / 年間 / 中 / 初 / 末 | 永興年間      |
| `eraM` | 年号 + 中 / 初 / 末（要求后面是标点或行尾）    | 貞觀中       |
| `eraB` | 独立年号（仅 ~~`standalone` ~~开启时）  | 貞觀        |

纪年数字 `NUM_PART` 统一限制为：`元`、中文数字 **二～六十一**（含合文 **廿 / 卅 / 卌**）、阿拉伯数字 **1～61**。中文纪年不支持「一」「零」「〇」，也不支持百、千、万。第一年统一写作「元年」。

**省略年号的纪年**只认标准中文数字「元年」「二年」～「六十一年」，仍要求前面是标点、空白、段首或「诏 / 詔 / 其」；阿拉伯数字不走这一条，以免把普通公历年份误标成纪年。

> 中文数字直接按 1～61 的合法结构匹配：二～九、十～十九、二十～五十九、六十～六十一，外加 **廿～廿九 / 卅～卅九 / 卌～卌九**（合文，`[廿卅卌][一二三四五六七八九]?`）。因此「三三年」「一二三年」「六十二年」「一年」「零年」「〇年」均不会被识别。
> 合文那一段要写成**一个**分支（`[廿卅卌][一二三四五六七八九]?`），别拆成 `廿|廿[一二三四五六七八九]` —— 末尾「年」可选的地方（`era-search.js` / `sidepanel.js` / `content-annotation.js`）会先匹配上裸「廿」而不再回溯，把「廿一年」当成 20 年。
> ⚠️ **提示词里也写了一遍这个范围**（`ai-core.js` 的 `SYSTEM_PROMPT` 规则 45/46），改这里要同步改那边 —— 否则正则认廿、模型不认，AI 路径会漏标。

> `cnToNumber()` 现在只负责把已经符合上述结构的数字转换为数值；不合法或超出 1～61 返回 `NaN`。各识别入口共用 `eras.js` 导出的数字正则，避免 DOM、Canvas、侧边栏、搜索和纠错使用不同规则。干支纪年仍照常支持。

**上下文链（关键）**：`applyContextMatches()` 按正文顺序维护一条「上文年号链」：

- 遇到完整写法（建元三年）→ 链更新为它的候选；
- 遇到省略年号的纪年（三年）→ 候选直接继承链，于是卡片能显示「建元三年」而不是「无法判断」；
- 链为空时**仍然建标记**（文内标注显示 `（？）`），用户可以手工更正。

**跨节点续接**：行内元素常把「年号」和「纪年」拆到相邻两个文本节点（`<a>大業</a><span>二年…</span>`）。`seedCrossNodeEra()` 会把上一个节点结尾的年号补成一个「种子标记」（`__eraSeed = true`），后一个节点的「二年」就能接上。种子标记只负责高亮与承接，**不单独补年份**（否则会在「大業（605-618年）二年」中间插一段，把词组断开）。

**高亮带上「谁」（朝代 + 帝号）**：紧挨在「年号 + 纪年 / 范围写法」前面的朝代名、帝号也一起高亮 —— 「唐貞觀五年」「唐貞觀年間」「大唐貞觀中」整段高亮，「大唐貞觀五年」连「大」一起；带帝号的「唐僖宗廣明元年」「僖宗廣明元年」也整段高亮。规则：

- **带年号的写法都扩**：`era`（年号+纪年数字）、`eraG`（年号+干支年）、`eraR`（年号+年間 / 年間 / 年初 / 年末）、`eraM`（年号+中 / 初 / 末）。
- **不扩**：`eraB`（独立年号 —— 就是「只有朝代 + 年号」那种）、以及裸纪年（「只有朝代 + 纪年」，走 `applyContextMatches` 那条路）。
- **`eraC`（改元永興）实际也扩不到**：它的匹配是从年号开始的，前面挡着「改元」两个字，`whoPrefixLength()` 看到的是「元」，自然不扩 —— 所以没把它列进条件里。
- 判据是 `eras.js` 的 `D.whoPrefixLength(before)`（旧名 `dynastyPrefixLength`，已改名）。它按「**朝代 + 帝号** → **帝号** → **朝代**」三层依次往左吃，每一段都**必须紧挨着**：
  - **朝代名**取自年号表（朝代值 + `DYNASTY_ALIAS` 简称 + 简称的「X朝 / X代」），**长的优先**（先试「南唐」再试「唐」），再往前多带一个字如果那是「大」。
  - **帝号**取自年号表的 `emperor`（「僖宗」「太宗」…），末尾是「帝」的额外收一个去「帝」的写法（「漢武帝」→ 也认「武帝」）。
  - ⚠️ **帝号只收长度 ≥ 2 的**：年号表里夏商那 13 个单字王名（禹 / 啟 / 相 / 抒 / 槐 / 芒 / 泄 / 扃 / 廑 / 臯 / 發 / 桀 / 緡）当普通字用的概率太高，收进来会让「宰相廣明元年」把「相」圈进去。朝代名不受这条限制（单字朝代本来就得认）。
  - 中间有标点 / 空白就不算：「唐、貞觀五年」「唐僖宗、廣明元年」都不扩。
- 落地方式：匹配对象上多一个可选的 `hlIndex`（高亮起点），`index` / `end` 仍是「年号那一段」。`createMark()` 用 `hlIndex` 切高亮文字、用 `index`/`end` 算 `__eraKey`（**所以加了朝代前缀也不会让用户之前存的更正失效**）。
- **两条路要分别改**：DOM 侧 `runRegex()` 的正则**没开 `range`**，所以 `eraR`/`eraM` 不在那儿 —— 它们在 `applyContextMatches()` 里匹配（那里也算 `hlIndex`，创建标记的循环也按它切片）；`runRegex` 只算 `era`/`eraG`。canvas 侧 `findMatches()` 的正则**开了 `range`**，四种写法都在 `fullHits` 里，一处处理。`renderPage()` 用 `hlIndex` 取字符槽（框才盖得住朝代那几个字）。
- **AI 路径也一样**（`content-ai.js` 的 `applyMarks` 回调）：AI 命中同样算 `hlIndex`，所以「AI 识别」出来的也是「唐僖宗廣明元年」整段高亮，和正则模式看起来一致。判据用 `list.some(r => canonicalForm(match[0]).includes(canonicalForm(r.era)))` —— **只有匹配里含年号的才扩**，模型对省略年号的「二年」「三年」也会输出，那种跟正则的裸纪年一样不扩。
- 回归：`repro11-highlight.cjs`（单元 + DOM + standalone 排除 + 卡片/更正面板回归）、`repro13-regex-replace.cjs`（AI 路径整段高亮）、`repro-canvas.cjs`（canvas 侧「北漢乾祐二年」「唐貞觀年間」「唐僖宗廣明元年」）。

### 1.2 AI 识别（可选，联网）

弹窗里的「AI 识别」把正文交给 `background.js` → `ai-core.js` 调模型。提示词里附一段「年号 → 元年公历年」参考表（`buildReference`，只列正文里出现过的年号），要求模型返回 `{text, era, dynasty, emperor, year, gregorian}`。

提示词（`ai-core.js` 的 `SYSTEM_PROMPT`）里几条**必须和代码保持一致**的约定：

- **`text` 必须逐字照抄原文**：AI 路径是拿 `result.text` 在页面正文里做**字面匹配**的（`content-ai.js` 用 `D.escapeRe` 拼正则），模型一「规范化」就匹配不上、高亮不上。所以规则 3 明确写了「原文是『貞觀廿一年』就照抄，不要改写成『貞觀二十一年』」。
- **纪年数字的范围要跟着 `CN_YEAR_PART` 走**：规则里写的是「元、廿～廿九、卅～卅九、卌～卌九、二～六十一、或阿拉伯数字 1～61」。**改 `eras.js` 的 `CN_YEAR_PART` 时，这里要同步改** —— 否则正则认廿、模型不认。
- **`era` / `dynasty` / `emperor` 必须和年号表一致**：提示词里要求用繁体正字（规则 9），**代码侧还有一道兜底** —— `parseResults()` 里调 `normalizeWho()`，用年号表把模型给的写法换回表里的（`lookupEra` 本身折简繁；再用 `contextNames()` 匹配朝代，只认「同一个朝代」的池子，分不清就不动）。
  - 为什么必须归一：`rangeOf()`（`eras.js`）比朝代是字面包含、`candidatesOf()` 的去重（`content-annotation.js`）和 `dynastyMatch()` 是**严格相等**。实测「太平 + 简体『辽』」对不上表里的「遼」→ 退回「同年号里取最早的那条」→ 给出 256（孫吳）而不是 1021（遼）；卡片上还会把同一个朝代的简体 / 繁体两行并排列出来。
  - 归一排在 `enrichRanges()` **之前**，所以范围 / 公元年、卡片候选、AI 调用记录、写进缓存的结果，拿到的都是表里的写法。
- 回归：`repro16-prompt-align.cjs`（提示词与 `CN_YEAR_PART` 对齐 + `parseResults` 归一 + 端到端「模型给简体 → 页面显示表里的写法」）。
- **`eraStart` / `eraEnd` 不用模型操心**：`analyze()` 之后的 `enrichRanges()` 会拿本地年号表重算并覆盖（`parseResults` 连 `eraEnd` 都不解析）。模型给的值只在表里查不到该年号时当兜底。
- **没有 `confidence` 字段**：以前提示词要求模型给置信度，但全项目没有任何地方用它，已从提示词和 `parseResults` 里删掉。
- ⚠️ **改提示词不会让旧缓存失效**：`cache.js` 的 key 只含「模型 + 归一化 URL」，正文没变就直接返回 7 天内的旧结果。改完提示词发版时，要么把 `cache.js` 的 `PREFIX` 升版本（**同时**改 `settings-form.js` 里写死的 `AI_CACHE_PREFIX`），要么接受老用户头 7 天仍读到老结果。
- **缓存**：`cache.js`，键 = 归一化 URL + 模型 + 正文哈希；`PREFIX = 'eraAiCache:'`，上限 80 条，TTL 7 天。URL 归一化会去掉 hash 与 utm/gclid/fbclid 之类的跟踪参数。
- **「AI 缓存优先」**（设置页的自定义设置里，默认不优先）：打开页面时先只查缓存，命中就用 AI 结果、不跑正则 —— 见 6.8。背景侧的 `AI_ANALYZE` 因此多了个 `cacheOnly` 参数（只查缓存、不调接口）。
- **连续使用 = 次数额度**（以前是时长，已整体换成次数）：弹窗里选 单次 / 20 次 / 100 次 / 300 次 / 999 次（`ai-core.js` 的 `CONTINUOUS_OPTIONS`）。点一次「AI 识别」就开一批（额度 = 选的那个数），之后**每真调一次接口才扣一次**（读缓存不算、接口报错不算、`cacheOnly` 只读探测不算）；额度用完自动停，页面回到正则识别，**想再来一批就再点一次「AI 识别」**。状态机在 `background.js` 的 `quotaState()` / `applyContinuous()` / `armContinuous()` / `consumeAiQuota()`，状态存在 `chrome.storage.local` 的 `aiQuotaTotal` / `aiQuotaUsed`；`content-state.js` 的 `aiWindowActive()` 就是「还有剩余次数」。详见 6.9。
- **AI 结果的形状**：`content-ai.js` 的 `aiResultToInfo()` 产出 `{era, dynasty, emperor, eraStart, eraEnd, n, gregorian, source:'ai'}`。**`eraStart/eraEnd` 只有「范围写法」才有，普通结果两者都是 `null`，只有 `gregorian`** —— 这一点直接影响「年份不确定」的判断，见 2.4。

### 1.3 两种页面形态：DOM 与 Canvas

|       | 普通网站                             | 识典古籍（`www.shidianguji.com`）                                                            |
| ----- | -------------------------------- | -------------------------------------------------------------------------------------- |
| 正文在哪  | DOM 文本节点                         | 画在 `<canvas>` 上                                                                        |
| 注入脚本  | `content-scanner.js` 等           | 额外注入 `canvas-main.js`（`world: "MAIN"`、`document_start`）                                |
| 取文字   | 遍历文本节点                           | 钩 `fillText` / `strokeText`，把「文字 + 坐标 + 字体 + 变换矩阵 + measureText 结果」用 `CustomEvent` 抛出来 |
| 画标记   | 直接包 `<span class="era-hl-mark">` | 绝对定位的 `<span class="era-hl-canvas-mark">` 覆盖层 + 每字一个 `.era-hl-canvas-char`             |
| 上下文链  | `applyContextMatches()`          | `canvas-adapter.js` 的 `findMatches()`（跨 canvas 页也带上下文）                                 |
| 正文扫描器 | 会启动                              | **不启动**（`runRegex()` / `startObserver()` 遇到 canvas 站点直接返回）                             |

canvas 侧另外几个要点：

- `canvas-main.js` 里同一位置同一轮绘制只留最后一个字符，避免重复 `fillText` 造成数据膨胀；`clearRect` 覆盖 80% 以上面积时发 `reset`。
- 适配端有 90ms 静默窗口：`reset` 后新数据先进 `pending`，静默结束才一次性提交，避免半页数据触发清空。
- 标记的框按 `measureText` 的实际边界算（`actualBoundingBox*`），再用 `transform` 映射回页面坐标。

### 1.4 站点规则

设置页「站点模式」三选一 + 两个名单（一行一个，可写 `www.example.com` 或 `www.example.com/path`）：

| 模式                  | 行为               |
| ------------------- | ---------------- |
| `restricted`（限制，默认） | 除**禁用网站**外都自动识别  |
| `custom`（自定义）       | 只识别**自定义网站**名单内的 |
| `global`（全局）        | 所有网站都自动识别（名单不生效） |

判定入口是 `content-state.js` 的 `autoRunAllowed()`，结果存在 `runtime.state.autoAllowed`。

> **默认 `blockedSites` 是空的。** 识典古籍**不在**默认禁用列表里 —— 它的正文在 canvas 上，DOM 扫描器本来就标不到，识别由 canvas 适配负责。想关掉它，用户自己加进「禁用网站」即可。
>
> **禁用 ≠ 不能手动识别。** 禁用只影响「自动识别」：弹窗点「正则识别」照样能标出来，标记留在页面上。DOM 路径的 `runRegex()` 没有站点检查；canvas 路径靠 `canvas-adapter.js` 的模块级 `forced`（手动点过 → 本次会话内继续认），点「清除」时复位。

---

## 二、标记与文内标注

### 2.1 标记

高亮是包在原文外的 `<span>`（`era-hl-mark` / canvas 的 `era-hl-canvas-mark`），**不改动原文一个字**。配色由 `markTheme`（amber / green / blue / pink / gray / none）控制，写成 `html[data-era-theme=...]`，CSS 里对应。

标记上挂的字段（`content-marker.js` 的 `createMark()`）：

| 字段             | 含义                       |
| -------------- | ------------------------ |
| `__eraInfo`    | 候选数组（可能多个，见 3.2）         |
| `__eraRange`   | 是否「年间 / 中 / 初 / 末」这类范围写法 |
| `__eraN`       | 这一处的纪年数（「三年」= 3，「元年」= 1） |
| `__eraGz`      | 干支（「甲子年」= 甲子）            |
| `__eraDynasty` | 已采用的朝代（用于下文沿用）           |
| `__eraKey`     | **记录用的键**，见 4.1          |
| `__eraPrevEl`  | 上文那处年号标记（DOM 路径专用，用于继承）  |
| `__eraSeed`    | 是否跨节点续接补出来的种子标记          |
| `__eraText`    | **年号那一段**（不含高亮圈进来的朝代前缀）—— 要解析年号就用 `C.eraTextOf(mark)`，别直接用 `mark.textContent` |
| `__eraPrefix`  | 高亮比年号多圈进来的那截（「唐貞觀五年」的「唐」/「大唐」），没扩就是空串；`precedingText()` 会把它拼回上文，见 4.2 |

> ⚠️ **`mark.textContent` 现在可能带朝代前缀**（「唐貞觀五年」）。凡是「读标记文字来解析年号 / 纪年」的地方都必须用 `C.eraTextOf(mark)`：`tipTitleFor()`、`completeEraInput()`、`chronologyOnly()`、`applyEraFix()` 都已经改成它了。只有「把标记还原成普通文本」的 `removeMark()` / `clearMarks()` 才该用 `mark.textContent`（那正是要还原整段高亮）。

### 2.2 文内标注

开启「文内标注」后，在每个高亮后面补一段（`content-annotation.js` 的 `annotateText()`）：

| 情况           | 标注           |
| ------------ | ------------ |
| 有具体纪年        | `（683）`      |
| 年号 + 范围写法    | `（605-618年）` |
| 认得出是纪年但算不出年份 | `（？）`        |
| 已清除 / 不满足条件  | 空（不标）        |

重复抑制：后面的原文已经写了这个年份就不再补（`alreadyStated()`）。

### 2.3 「约」与前 841 年（共和）

`eras.js` 里 `GONGHE_YEAR = -841`，`isBeforeGonghe(year) = year < -841`。**前 841 年（不含）之前的年份一律加「约」**，由 `formatYearApprox()` = `approxMark()` + `formatYear()` 统一处理：

- 文内标注、卡片的候选行、卡片的 foot、侧边栏 —— **全都用 `formatYearApprox()`**
- 只有 `ai-core.js` 拼给模型看的参考表用 `formatYear()`（那是给模型的数据，不是界面）

> 曾经候选行漏用 `formatYearApprox()`，结果 foot 写「约前1046」而行里写「前1046」。改的时候别只看一处。

设置页的「共和前纪年」：选「不识别」时，前 841 年之前**能算出年份**的纪年不标注、不显示范围。

### 2.4 年份不确定 → 「？」

年号表里起止年**任一端为 `null`** 的条目（夏商那批只有王名、年份不可考的），一律不拿已知的那一端去推算年份：

| 位置          | 显示                           |
| ----------- | ---------------------------- |
| 文内标注        | `（？）`                        |
| 卡片候选行的公历年   | `？`                          |
| 卡片 foot 的范围 | `？`                          |
| 卡片头部干支      | **不显示**（干支和「？」是同一份信息，不能自相矛盾） |
| 侧边栏的公历年列    | `未知`                         |

判定统一走 `content-annotation.js` 的 `eraYearsKnown(info)`：

```js
function eraYearsKnown(info) {
    if (!info) return false;
    if (!Number.isFinite(info.eraStart))
        return Number.isFinite(info.gregorian);   // ← AI 结果的例外
    return Number.isFinite(info.eraEnd);
}
```

> **AI 结果的例外**：AI 候选不带 `eraStart/eraEnd`，但自带具体 `gregorian`。若一律按「null 就不显示」，AI 那条路会被整条压掉。所以「start 不可考时看 `gregorian`」：表里的条目 `gregorian` 也是 null，照样判为不可考。

`annotateText()` 里这个判断必须放在 `mark.__eraSeed` **之后**，否则跨节点续接的种子标记会在「大業（？）二年」中间插一段。

> 副作用：`（？）` 的判断在 `preRepublic` 检查**之前**，所以 `preRepublic` 关闭时，**算不出年份**的条目会标「（？）」，而**算得出年份**的（如武王元年）仍按 `preRepublic` 不标。

> **「超出起止年」不再加「？」（用户要求）。** 这一节说的「年份不确定」只指**表里起止年本身不可考**（`eraStart` / `eraEnd` 为 `null`）。另一种情况——算得出公元年、但它落在该年号的起止年之外（如「天會十二年」算到 968，而北漢睿宗的 天會 只到 967）——原先靠 `buildCandidate()` / `candidateOf()` 里的 `yearOutOfRange` 在标注和卡片年份后面补一个「？」，**这套代码已经删掉了**：那只是个「这个年号到底有没有第 n 年」的猜测，让用户看卡片里的起止年自己判断。**别再加回来。**

---

## 三、卡片（悬浮弹框）

### 3.1 触发方式

设置页「弹框触发方式」：`hover` 悬浮 / `click` 单击（默认）/ `longpress` 长按（按住约 450ms）。

- `click` / `longpress` 模式下，触发过年号后进入「跟随悬浮」状态：鼠标停在年号或卡片上就保持，**移开才消失**（不是再点一次才收起）。
- **长按为什么取代了双击**（老版本有个 `dblclick`，已下线）：浏览器里「双击」不是独立动作，而是**两次完整 click 之后才补一个 `dblclick`**（`mousedown→mouseup→click→mousedown→mouseup→click→dblclick`）。第一次 `click` 到来时还不知道会不会有第二次，没法拦 —— 所以 `<a href="#">三年</a>` 这种链接双击照样跳转（还是跳两次）。长按没有这个歧义：`mousedown` 之后过了阈值就**已经确定**是长按，等随后的 `click` 来时直接 `preventDefault()` + `stopPropagation()` 吞掉它，单击完全不受影响，也不用「延迟 300ms 再重放合成事件」那套。
  - 参数在 `content-tooltip.js` 顶部：`LONGPRESS_MS = 450`、`LONGPRESS_SLOP = 6`（按住时位移超过 6px 就当「按住拖选文字」，取消长按）。
  - 松手时还没到阈值 → 取消（那就是普通单击）；已经触发过长按 → `pressFired` 保留，等 `click` 来了吞掉再清零；下一次 `mousedown` 也会重置它（防止「长按后拖到外面松手、没有 click」时把后面某次点击误吞）。
  - 老设置里的 `'dblclick'` 会当成 `longpress`（`triggerMode()` 和 `settings-form.js` 的 `load()` 各做了一次映射），不会静默掉回「单击」。
  - ⚠️ 触屏上长按会弹系统菜单，所以这个模式基本只适合桌面端。
  - **卡片内部的双击候选行切换不受影响**（那是我们自己的 UI，见 3.4）。
- **更正面板打开时，鼠标扫过别的年号不会抢走焦点** —— 否则从卡片移向面板的途中会扫到其它年号，`showTooltip()` 判定「目标换了」就把面板关掉（canvas 上正文全是覆盖层标记，几乎必扫到）。
- **卡片和更正面板是「一起显示、一起消失」的**：面板开着的时候，**鼠标移出「卡片 + 面板」的共同区域 → 两个一起收**；**再点一下卡片（含「更正」按钮本身）只收起更正面板，卡片留着**（`closeFixPanelOnly()`）。见 3.5。

### 3.2 卡片内容

```text
┌ [正|AI] 标题（年号+纪年，如「貞觀三年」）  干支 ┐
│ 候选行：朝代 · 帝号 · 年号       公历年      │  ← 多候选时双击某行切换
│ …                                          │
├ 年号：范围                       清除 更正 ┤
└────────────────────────────────────────────┘
```

- **「正 / AI」来源角标在标题左侧**（`head` 的第一个子元素）；`head` 里还可能有「↺」（见 3.6）。
- **「清除」紧挨在「更正」左侧，两个按钮一起靠右，任何情况都出现**（见 3.6）。
- 候选按公历年排序；未选中的行用浅色（`era-hl-tip-year-alt`）。
- 标题和行里的年号统一用**年号表里的写法**（正体），原文是简体 / 异体时会转换（`withTableEra()`）。
- 头部右侧是这一年的干支（`ganzhiOf()`），年份不可考时不显示。
- **标题只写「年号+纪年」**（`content-annotation.js` 的 `tipTitleFor()`），不带朝代 / 帝号 —— 别按老的注释以为标题里有「朝代 · 帝号」。
- **候选行的「朝代 · 帝号 · 年号」走 `D.whoText()`**：帝号与年号同名时只写一个，见 3.3。

### 3.3 「朝代 · 帝号 · 年号」的显示约定 ★

年号表里有 **334 条帝号与年号同名的条目**（`西漢·高祖·高祖`、`夏·禹·禹`、周 / 春秋战国那一大批王名、`遼·太祖·太祖`…）。三个字段直接拼起来就是同一个名字连着出现两次，所以统一走 `eras.js` 的 **`D.whoText(dynasty, emperor, era, eraName)`**：

| 场景 | 结果 |
|---|---|
| 帝号 ≠ 年号 | 原样三段：`唐 · 太宗 · 貞觀` |
| 帝号 = 年号 | **丢掉帝号那一格、留年号**：`西漢 · 高祖` |
| 年号带纪年（按公元年查那一行） | `西漢 · 高祖五年` —— **纪年不能跟着一起丢** |
| 这一处不显示年号、只想去重（`era` 传 `''`） | `西漢` |

- `eraName` 是拿来做比对的**年号名**（`era` 可能带纪年，如 `高祖五年`，两者不能直接比）；不传就用 `era`。
- **同名时留年号、丢帝号**：年号那格可能带纪年（`高祖五年`），帝号只是个名字，丢掉不损失信息。
- 只影响显示，**不动任何数据 / 匹配 / 存储**。
- 用到的地方：卡片候选行（`content-tooltip.js`）、更正面板候选行（`content-correction.js`）、侧边栏结果行 / 建议项 / 「没有第 n 年」的列表（`sidepanel.js`）。
- 回归：`repro9-who.cjs`（单元 + 全表扫描：334 条同名不再重复、1010 条不同名逐字未变）、`repro10-who-render.cjs`（卡片与侧边栏实际渲染）。

> ⚠️ `content-tooltip.js` 里的 `tipTitle(info)`（导出成 `C.tipTitle`）**当前没有任何调用点**，卡片标题实际走 `content-annotation.js` 的 `tipTitleFor()`。改标题别改错地方。

### 3.4 双击候选行 = 切换

双击某个候选年份 → `applyPick()` → 把该行在候选数组里的下标存进 `runtime.overrides[__eraKey]`。

### 3.5 「更正」面板

点「更正」→ `prepareFixInput()`：

- 完整写法（「建元三年」）→ 把年号填进输入框并直接查；
- 只有纪年（「三年」「甲子年」）→ 列出**上文出现过的年号**供点选；
- 年号后面跟的是**空**或**范围写法**（「改元永興」「永興年間」「貞觀中」）→ 也算完整写法，填进输入框并查。

选中一条 → `applyEraFix()` → 存进 `runtime.eraFixes[__eraKey]`。**选中之后面板不关**，可以接着改下一处。

面板与卡片的显示 / 收起：

| 操作                   | 结果                 |
| -------------------- | ------------------ |
| 点「更正」                | 打开面板（卡片保持显示）       |
| 选中候选 / 输入后选中         | 面板**保持打开**         |
| 再点「更正」或卡片上任意位置       | **只收面板**，卡片继续显示    |
| 鼠标移出「卡片 + 面板」的共同区域   | 两者一起收起             |
| 鼠标还在共同区域内（从卡片走向面板）   | 都不收                |
| 点页面别处 / Esc / 点另一处年号 | 一起收起（点另一处年号时面板换目标） |

**共同区域 = `era-hl-popup-group` 那块透明外接矩形**（`positionPopupGroup()` 按卡片和面板的并集铺好）。判据只有一份：`content-correction.js` 的 `pointerOutsidePopupGroup(event)`，三处 `mouseleave` 都来问它 —— 卡片自己的、面板自己的、以及桥接分组的。

> **别只靠桥接分组的 `mouseleave`。** group 的 `z-index` 比卡片/面板低，指针停在卡片上时 group 根本不算被「进入」，**从卡片直接移到正文不会触发它的 `mouseleave`** —— 面板就赖着不走。所以卡片和面板各自的 `mouseleave` 也必须走同一份判断（`hideFixPanel()` = 面板 + 卡片一起收）。

> **面板认的是「哪一处纪年」，不是某个 DOM 节点。** 重扫（`runRegex`）和 canvas 重绘会把标记**整批重建**，元素换了但 `__eraKey` 不变；`showTooltip()` 里必须按 `__eraKey` 判断（`fixPanelAnchoredTo()`），只比较元素（曾经的 `R.fixMark !== mark`）会让面板在重建后的第一次 `showTooltip()` 被误关 —— 表现就是「点了更正，面板有时会消失、有时不消失」，取决于那几百毫秒里有没有发生重建。

### 3.6 清除 / 重置

- 卡片上的「清除」（**紧挨「更正」左侧，任何情况都出现**，见 3.2）→ 记进 `runtime.eraIgnores[__eraKey]` 并摘掉标记；以后重新识别不再标它。
  - **单击就弹浏览器原生 `window.confirm` 确认框**（`confirmClearMark()`），确认了才清除；取消则什么都不做。这个动作不可撤销，只能靠下面的「正则重置」找回，所以文案里把这点写明了。
  - 实现注意：`confirm()` 是**阻塞**的。双击「清除」会派发两次 `click`，第二次排在 `confirm` 返回之后才执行 —— 所以确认后要再查一次 `R.activeMark` 是否还是原来那个标记，否则会弹两次确认框。
- 卡片上的 `↺`（改过之后才出现）→ 删掉这一处的 `eraFixes` 和 `overrides`，恢复默认识别。
- 弹窗的「正则重置」→ 清空本页**全部**记录（`clearPageOverrides()`）再重新识别。



---

## 四、更正如何影响后续纪年 ★

这是最容易改坏的部分 —— 两条路径（DOM / Canvas）各写了一套上下文传递。

### 4.1 记录的键：`__eraKey`

`eraKeyFor(text, index, end)` = **匹配到的文本** + `\u0001` + **它前面 6 个字**：

```text
'三年' + '\u0001' + '觀二年八月。'
```

用「前 6 字」是为了区分同一段里多处同名的年号。三类记录都挂在这个键上（存 `chrome.storage.local`，按 `location.href` 分页，见 6.1）：

| 记录 | 存在哪 | 含义 |
|---|---|---|
| `overrides[key]` | `runtime.overrides` | 双击候选行切换到的下标 |
| `eraFixes[key]` | `runtime.eraFixes` | 更正面板指定的年号 `{era, dynasty, emperor}` |
| `eraIgnores[key]` | `runtime.eraIgnores` | 点过「清除」的片段，不再标记 |

canvas 侧用 `canvas-adapter.js` 的 `markerKey()` 算同一个键（内部就是调 `eraKeyFor`），只是文本来自「本页 canvas 文字的拼接串」而不是 DOM 文本节点。

> ⚠️ **这个键在 canvas 上不稳定**（已知问题，见第九节）：canvas 的文字是每次重绘现拼出来的，阅读器边滚边重绘 / 只画可见部分时，紧邻前一条记录会变，「前 6 字」跟着变 → 键一变，用户在这一处的更正就查不到了。曾经试过改成「页 + 版面坐标 + 文本」的稳定键，验证有效但已按用户要求撤回。

`content-annotation.js` 的 `candidatesOf()` / `pickIndex()` 都按这个键取记录。**任何地方想复用「用户的更正」，都必须先拿到 `__eraKey`** —— canvas 侧早期就是因为临时对象少了这个字段，导致切换/更正完全不生效。

### 4.2 DOM 路径的传递

两条机制叠加：

1. **`__eraPrevEl` 链** —— 省略年号的纪年标记，候选直接从「上文那处年号标记」拿：
   ```js
   if (!mark.__eraRange && mark.__eraPrevEl && mark.__eraPrevEl.isConnected)
       return candidatesOf(mark.__eraPrevEl);
   ```
   所以上文那处年号**被更正过**时，下文这处跟着拿到更正后的候选。
2. **`refreshEraContext()` 携带朝代** —— 按文档顺序走一遍所有标记，把上一处**实际采用**的朝代传给下一处（`pickInfo(mark, dynasty)` → `pickIndex(mark, contextDynasty)` 优先选同朝代的候选）。
3. **正文里紧挨着的朝代 / 帝号** —— `pickIndex()` 里的 `contextDynastyOf(list, precedingText(mark, 200))`：从候选的 `D.contextNames()`（朝代、朝代简称、帝号）里找**最长的末尾匹配**，命中的那条候选的朝代优先。**这一步排在 `mark.__eraDynasty` 前面**，因为后者是 `createMark()` 用 `__eraInfo[0]` 预先写死的。
   > 踩过：`乾祐` 在表里第一条是**後漢高祖**，于是 `mark.__eraDynasty` = 後漢，`pickIndex()` 又优先用它 → 「北漢乾祐二年」会高亮 後漢，正文里的「北漢」根本轮不到起作用。加了这一步之后按正文选北漢；没有正文线索时行为不变（仍取候选[0]）。回归脚本：`check-dynasty.cjs`。
   > ⚠️ **高亮带上朝代 / 帝号之后**（见 1.1）：那几字现在在标记**内部**，`adjacentText()` 走不到，所以 `precedingText()` 会把 `mark.__eraPrefix` 拼回上文 —— 少了这一步「北漢乾祐二年」立刻退回选 後漢、「唐僖宗廣明元年」也认不出僖宗。改 `precedingText()` 时别把这个拼回去的逻辑删了。

`runRegex()` / `applyEraFix()` / `applyPick()` 之后都会调 `refreshEraContext()` + `refreshAnnotations()`。

### 4.3 Canvas 路径的传递

canvas 没有 `__eraPrevEl`（标记是覆盖层，不在正文流里），对应机制是 `canvas-adapter.js` 的「上文年号链」：

- `findMatches()` 维护 `chain`：完整写法 → 链更新为它的候选；省略年号的纪年 → 继承链。**链的更新都要过 `effectiveChain(text, hit, info)`** —— 它按这一处的 `eraKeyFor` 键取 `eraFixes`（更正）或 `overrides`（切换），有就作为下文的新链；没更正过时原样返回，所以正常识别零影响。
- **跨 canvas 传的是「处理完之后的链」，不是某一条命中的原始候选。** `findMatches()` 返回 `{ hits, chain }`，`renderPage()` 把 `chain` 当作这一页交出去的上下文（`refreshAll()` 按页面顺序依次传下去）。
  > 这里踩过坑：早先 `renderPage` 用的是「最后一条命中的 `hit.info`」，那是**处理前**的候选，所以更正在**同一个 canvas 内**能传下去、一跨到下一个 canvas 就丢了 —— 表现就是「三年/四年 在同一页生效、不在同一页不生效」。改成传 `chain` 之后两边都通。
- **画布标记没有 DOM 邻接文本**，`precedingText()` 在 canvas 上拿不到正文，4.2 里那条「按正文里的朝代选」就会失效。所以 `renderPage()` 把这一处前面的画布文字切下来（`built.text.slice(hit.index - 200, hit.index)`）塞进 `__eraPreceding`，临时对象和建出来的标记都带上它；`content-annotation.js` 的 `precedingText()` 见到这个字段就直接用。它进了 `hitSignature()`，所以上文变了会重建标记。

效果：把「三年」更正成「永興」后，紧跟的「四年」会变成「永興四年」。

> **文内标注也必须走 `candidatesOf()`。** 「二年」这类省略年号的纪年第一次出现时上文链为空，标记的 `__eraInfo` 是**空数组**；用户点「更正」后，候选只存在于 `eraFixes[__eraKey]` 里。`canvas-adapter.js` 的 `annotationText()` 一度因为「`__eraInfo` 为空就 return `（？）`」提前退出，结果**卡片更新了、文内标注却永远停在 `（？）`**。改这块时注意：`annotationText()` 里不能有「`__eraInfo` 为空就提前返回」的分支，真正的「认不出」要靠 `info` 为空兜底（`refreshAnnotations()` 那条 DOM 路径本来就没这个问题）。回归脚本：`canvas-anno-fix.cjs`。

### 4.4 边界

- **只在「上文链」范围内传播。** 中间隔了一处完整年号（「貞觀五年」），链就从那里重新起算。canvas 上「上文链」是**跨 canvas 页**连着走的（`refreshAll()` 按页面顺序传），所以更正能跨页生效。
- **换到完全不同的年号时**，只保证「下文继承到的候选」里若存在同名 / 同朝代的条目就选中它；如果下文那处的候选根本不含新选的年号，它不会凭空改（DOM 与 Canvas 行为一致）。
- canvas 侧更正后靠 `refreshCanvasEraMarks()` 重建覆盖标记；`eraFixes` / `overrides` 会参与渲染签名（`hitSignature()`），签名一变才重建。
- **仍有一个已知问题**：canvas 的记录键在阅读器重绘时会变（见 4.1），所以更正**偶尔**会失效（尤其是重绘后紧邻前一条记录变了的时候）。见第九节。

---

## 五、侧边栏「纪年查询」

### 5.1 输入格式

| 类型 | 例 |
|---|---|
| 公元年 | `104`、`104年`、`公元104年`、`前104`、`公元前104`、`BC104` |
| 年号 | `太初`、`太初二年`、`武帝太初元年`、`汉武帝建元三年` |
| 帝号 | `武帝`、`汉武帝` |
| 朝代 | `汉`、`西汉` |

`parseQuery()` 的顺序：先试纯公元年 → 再**找年号**（从长到短）→ 剩下的部分当「纪年 + 帝号 / 朝代」。

> **顺序不能反过来。** 年号表里有 23 个以「元」结尾的年号（建元 / 開元 / 至元 / 永元…），先摘纪年会把年号末尾的「元」一起摘掉 ——「建元元年」就只剩「建」。
>
> **还要优先取「后面紧跟着纪年」的那个匹配。** 帝号在表里也可能是一条年号（`西漢·高祖·高祖`，商朝那串王名同理），不加这条偏好，「唐高祖武德元年」会被认成 年号=高祖、帝号=唐武德 而报错。实现见 `parseQuery` 里的 `CHRONO_AFTER`。
>
> **剩下的「帝号 / 朝代」部分按 `fold()` 折叠后比**（`whoMatch()`）。表里存的是正体（北漢 / 後漢），用户输入简体（北汉 / 后汉）时原始 `indexOf` 一条都匹配不上 → 退回「请选朝代」的建议框。`fold()` 之外还要**判空串**：`'北汉'.indexOf('')` 是 0，不判空的话朝代字段为空的条目会全部命中。

### 5.1.1 结果行的「朝代 · 帝号 · 年号」也走去重

侧边栏三处结果行同样走 `D.whoText()`（见 3.3）：

- 按公元年查：`唐 · 太宗 · 貞觀六年`；帝号 = 年号时 → `西漢 · 高祖五年`（纪年保留）。
- 按年号 / 帝号查：`.sp-era` 写年号，`.sp-meta` 写「朝代 · 帝号」—— 帝号和年号同名时 `.sp-meta` 只留朝代（`西漢`），不再出现「高祖」两遍。
- 输入框的建议项、「没有第 n 年」的错误列表同理。

### 5.2 第一纪年统一用「元年」

**约定：纪年第 1 年一律写「元年」，绝不识别「一年」。**

- **输入**：`元` 算一个纪年数字（= 1）；`EraSearch.stripYearTail()` 统一负责「截掉结尾的纪年」，含「元」。
- **输出**：`sidepanel.js` 的 `yearLabel(n)` = `n === 1 ? '元' : cnNum(n)`，两处拼接都用它；`content-annotation.js` 的两处拼接同样把数值 1 写成「元」。
- 页面识别侧：规则本身不包含「一」，所以「一年」从匹配阶段就不会进入后续解析。

### 5.3 纪年范围校验

按年号查询时，只保留**真的有第 n 年**的条目（`hasNthYear()`：`D.eraYear(start, n, offset) <= end`；用 `eraYear` 而不是 `start + n - 1`，一是跨公元前后不差一年，二是表里第 6 列那种「不从元年开始计数」的条目能算对）。

- 「太初五年」→ 西漢（只到前101年，共 4 年）消失，前秦（9 年）/ 西秦（13 年）留下；
- 「汉武帝太初五年」→ 帝号已收窄到西漢 → 报「没有第五年」并列出表里收录的起止年；
- 起止年任一端不可考（null）或数据颠倒 → 判断不了，放行（这类条目公历年显示「未知」）。
- **年号不从元年开始计数时（表里第 6 列），公历年那一列的下面补一行「起n年」**（`epochLabel()`，挂 `.sp-epoch`）：查「天會」三行里，北漢英武帝那行显示 `968-973年` + `起12年`，睿宗那行（offset 1）没有这一行。挂在 `.sp-year` 里的「ok」和「emperor」两个分支；「year」（按公元年查）那个分支没有右侧年份列，所以不加。

### 5.4 输入框右侧的 `<` / `>` 按年跳转

- **公元年**：直接 ±1。注意**没有公元 0 年**（前1 → 1，1 → 前1）。
- **年号**：按「同年号 → 同帝号 → 同朝代」找上 / 下一个，**到朝代边界就停，不跨朝代**。
  - `<` 在「贞观元年」→ 同朝代的上一个年号（武德）的**最后一年** → 「唐高祖武德九年」；
  - `>` 在「贞观二十三年」→ 同朝代的下一个年号（永徽）的**第一年** → 「唐高宗永徽元年」。
- 跳不动时按钮**置灰**；按住 400ms 后每 90ms 走一步（长按连续跳转）。
- 生成的输入写法 = `朝代简称 + 帝号 + 年号 + 纪年`（如「唐太宗貞觀四年」），年号用表里的正体，和 `applySug` 一致。
- 排序用 `orderedEras()`：**「start 为 null 的沿用前面最近一个已知 start」当排序键再稳定排序** —— 既纠正表里按朝代的十来处时序逆序，又不会把夏商那串 null 王名排乱。

> 复制页面文字自动查询的功能**已移除**，不要再加回来。

---

## 六、存储与备份

### 6.1 存在哪

| 键 | 位置 | 内容 |
|---|---|---|
| 各项设置 | `chrome.storage.sync` | 见 6.2 |
| `eraPickOverrides` | `chrome.storage.local` | `{ [href]: { at, picks, eras, ignores } }`，最多 200 页（按 `at` 淘汰） |
| `aiQuotaTotal` / `aiQuotaUsed` | `chrome.storage.local` | 「连续使用」的次数额度：这一批总次数 / 已用几次（用完不清零，留着给弹窗显示「已使用：100/100次」） |
| `eraAiCache:*` | `chrome.storage.local` | AI 结果缓存 |

### 6.2 设置项

「在哪改」列：**弹窗** = 点扩展图标后的那个小窗；**设置页** = 「打开详细设置」（options）；**无 UI** = 只能改存储或改代码。

| 键 | 默认 | 在哪改 | 说明 |
|---|---|---|---|
| `enabled` | `true` | 弹窗 | 总开关。关掉后所有网站都不自动识别，手动识别也被挡 |
| `autoRegex` | `true` | 设置页 | 正则识别方式：自动 / 点击（设置页里显示为 `regexMode`） |
| `regexReplace` | `false` | 设置页 | AI 缓存优先：页面有 AI 缓存就用缓存结果、不跑正则（设置页里显示为 `regexReplace`，见 6.8） |
| `annotate` | `false` | 弹窗 | 文内标注 |
| `markTheme` | `'amber'` | 弹窗 | 标注配色（色卡） |
| `aiContinuous` | `'once'` | 弹窗 | 「连续使用」的次数：`once` / `20` / `100` / `300` / `999`（见 6.9）。老版本存的时长值（`'1h'` 之类）会被当作「单次」 |
| `siteMode` / `allowedSites` / `blockedSites` | `restricted` / `[]` / `[]` | 设置页（弹窗也有折叠区） | 站点规则 |
| `tooltipTrigger` | `'click'` | 设置页 | 卡片触发方式 |
| `copyAnno` | `false` | 设置页 | 复制时是否带上文内标注（设置页里显示为 `annoCopy`） |
| `siteAnnotationMode` | `'annotate'` | 设置页 | 「文内标注限制」：对固定名单（识典）标注 / 不标注 |
| `preRepublic` | `false` | 设置页 | 是否识别共和（前841）之前的纪年 |
| `apiBase` / `apiKey` / `model` / `apiProfiles` / `activeModelId` | `models.js` 的第一个预设（DeepSeek Flash，`https://api.deepseek.com`） | 设置页 / 弹窗 | AI 配置；安装时由 `background.js` 的 `seedSettings()` 写入。`content-state.js` 里的 OpenAI 值只是读不到存储时的兜底 |
| `standalone` | `false` | **无 UI** | 是否把独立年号（没有纪年）也标出来。想要的话得改存储或加设置项 |
| `maxChars` | `12000` | **无 UI** | 交给 AI 的正文上限 |
| `dataPicks` | `['picks','sites','cache']` | 设置页「导出数据」的勾选框 | 那三个勾选框的状态（只作用于「清空」，见 6.3） |

### 6.3 导出 / 导入

设置页「导出数据」点「导出」，存下一个 JSON（`version: 3`）：

| 段 | 内容 |
|---|---|
| `overrides` | 更正记录 |
| `sites` | 站点设置（模式 + 两个名单） |
| `aiCache` | AI 识别缓存 |
| `settings` | **除模型配置外的所有设置**（`SETTINGS_KEYS`）：自定义设置那几项、文内标注开关 `annotate`、总开关 `enabled`、`standalone` / `maxChars` / `markTheme` / `aiContinuous`、以及「导出数据」三个勾选框的状态 `dataPicks` |

- **模型配置一律不导出** —— `apiProfiles` / `customModels` / `activeModelId` / `apiBase` / `apiKey` / `model` 全都不在 `SETTINGS_KEYS` 里（里面有 API Key，不该跟着文件走）。
- `settings` 按**有效值**导出：存储里从没存过的键也按 `SETTINGS_FALLBACK` 写进去，所以文件是一份完整快照，而不是「只记了改过的那几项」。
- **导入是合并式**：`overrides` 逐页合并、站点名单取并集、AI 缓存按 key 覆盖；`settings` 走 `sanitizeSettings()`（**只认白名单里的键 + 类型粗筛**，脏值/未知键一律丢弃 —— 手改过的文件也写不坏设置）。旧版（v1/v2，没有 `settings` 段）的文件照旧可导入。
- 界面上的三个勾选框**只作用于「清空」**，不影响导出 / 导入；但它们自己的状态存在 `dataPicks` 里，会跟着 `settings` 一起进出文件。
- 回归：`repro14-settings-export.cjs`（导出内容 + 不含 Key + 导入恢复 + 脏值被挡）。

### 6.4 设置页上的破坏性按钮

设置页有 **三个「恢复默认」**（一个区块一个），都先用浏览器原生 `window.confirm` 说清这一块要清什么、用户确认后才动。实现见 `settings-form.js` 的 `data-act="reset"` 分支，靠按钮上的 `data-scope` 区分。

| 按钮 | 位置 | 清掉什么 | 不碰什么 |
|---|---|---|---|
| 恢复默认（`data-scope="sites"`） | 站点设置区块 | 站点模式回「限制」+ 两个名单清空 | 模型配置（含 Key）、自定义设置、更正记录、AI 缓存 |
| 恢复默认（`data-scope="custom"`） | 自定义设置区块的**右栏提示框里** | 弹框触发方式、正则识别方式、AI 缓存优先、复制标注纪年、文内标注限制、共和前纪年 回到默认值 | 站点设置、模型配置、更正记录、AI 缓存 |
| 恢复默认（`data-scope="model"`） | AI 模型配置区块 | 所有模型配置**含已填的 API Key**、自定义模型，回到内置预设 | 站点设置、自定义设置、更正记录、AI 缓存 |

三个作用域分别对应 `resetSiteSettings()` / `resetCustomSettings()` / `resetModelSettings()`；`resetAll()` = 三个一起（对外保留的名字）。**更正记录与 AI 缓存都在 `chrome.storage.local`，这三个按钮一个都不碰。**

> **清 AI 缓存只有一个入口：「导出数据 → 清空」**（勾选「AI 识别缓存」那项，弹框里会带条数）。原先模型区块上那个独立的「清除缓存」按钮功能重复，已删除；`background.js` 的 `AI_CACHE_CLEAR` 消息保留（`clearPickedData()` 还在用）。

### 6.5 提示：区块底部没有状态行，改成按钮行右侧的即时提示

设置页原来每个区块底部有一条 `.esf-status` 状态行（保存成功 / 失败 / 正在测试…）。它会随写入改 DOM、顶动布局，已按用户要求**整体删除**：DOM 元素、`setStatus()` / `setDataStatus()`、以及全部调用点、CSS 规则。

- **成功类提示一律不再显示**（保存成功、已加进禁用网站、已导出…）。
- **失败类走 `warn()`**（`settings-form.js` 里 mount 内的小工具，`console.warn('[年号纪年识别·设置] …')`），不再有界面反馈。要恢复可见提示，把 `warn()` 换成 `window.alert()` 即可。
- **例外：「测试连接」的结果用 `window.alert()` 弹出来**（成功 / 失败都弹）。它是个一次性动作，静默等于按钮坏了；`alert` 不动 DOM、不影响布局。

**破坏性操作的反馈改成了「按钮行右侧的即时提示」**：`.esf-actions` 行末尾有个 `<span class="esf-action-note" data-role="action-note">`（`margin-left: auto` 顶到行右端，`font-size: 12px`、`color: var(--esf-ok)`）。写入靠 `setActionNote(btn, text)`（按按钮找到自己那一行）。

| 操作 | 提示 |
|---|---|
| 站点设置 / 模型配置 的「保存设置」成功 | `已保存` |
| 站点设置 / 模型配置 的「恢复默认」确认 | `已恢复` |
| 导出数据的「清空」确认 | `已清空` |
| 上面两个取消 | `已取消` |

> 「保存设置」只在**真的存下去**时才写 `已保存` —— `doSave()` 在校验没过（新增模型但模型名和接口地址都没填）时返回 `null`，那种情况提示会被清空，不留一个假的「已保存」。保存抛异常同理。

> 这三处是「就地一行」，不新增状态行、不顶动布局；自定义设置那个恢复默认按钮（在右栏提示框里、不在 `.esf-actions` 行里）不写提示。

### 6.6 「AI 调用记录」是独立的、可整份删除的调试面板

设置页最后那块「AI 调用记录」**不在 settings-form.js / settings-form.css 里**，全部集中在 `src/js/ai-log-panel.js` 一个文件（区块 HTML + 样式 + 渲染 + 清空逻辑），文件开头写了「仅开发测试用」的说明。它由 `options.html` 用一行 `<script>` 引入。

**删掉它不影响任何功能**：把 `ai-log-panel.js` 删掉、再把 `options.html` 里那行 script 删掉，设置页就少一块 UI，别的照旧 —— `settings-form.js` 里只有一处调用，且是带判断的：

```js
if (!only && global.EraAiLogPanel && typeof global.EraAiLogPanel.mount === 'function')
    global.EraAiLogPanel.mount(root);
```

几点约定：

- **记录本身不在这里**。写记录的是 `ai-core.js` 的 `recordAiCall()`（`chrome.storage.local` 的 `eraAiCallLog`，最多 30 条）。所以删掉面板只是「看不到」，记录照旧在写、AI 识别功能完全不受影响。
- **样式是运行时注入的**（`<style id="era-ailog-style">`，删文件时样式也一起消失），所以 `settings-form.css` 里查不到 `.esf-ailog*` —— 别以为漏了。
- 面板自己监听 `chrome.storage.onChanged` 刷新、自己处理「清空记录」按钮（`data-act="clear-ailog"`），**不掺进 settings-form.js 的按钮委托**。
- 弹窗里的局部挂载（`only: 'sites'` / `only: 'model'` / `only: 'custom'`）不显示这一块，`mount()` 里靠 `opts.only` 跳过。
- 回归：`repro12-ailog.cjs`（面板功能 + **「不加载这个文件」的降级**两段）。

### 6.7 「自定义设置」的两栏布局

设置页的「自定义设置」是**左 : 右 两栏**（`.esf-split`，`grid-template-columns: 3fr 2fr`，可调；别改成 flex 的 `flex: 3/2` —— `flex-basis` 分的是内容盒，右栏的 padding/border 会让视觉比例偏掉）：

- 左栏 `.esf-split-main` 里是 6 个 `esf-field`（弹框触发方式 / 正则识别方式 / AI 缓存优先 / 复制标注纪年 / 文内标注限制 / 共和前纪年）；
- 右栏 `.esf-tipbox` **高度跟着左栏走**（grid 默认 `align-items: stretch`，所以右栏始终和左栏那一行等高，不要加 `align-items: start` 或 `position: sticky`）；内部是竖向 flex，按钮用 `margin-top: auto` 顶到**右下角**。

右栏两种状态**互斥**（靠 `aside` 上的 `is-idle` 切换，见 `renderOptionTip()`）：

```html
<aside class="esf-tipbox is-idle">          <!-- is-idle：提示框本体不显示 -->
  <div class="esf-tipbox-body"></div>       <!-- 说明区：is-idle 时 display:none -->
  <div class="esf-tipbox-actions">          <!-- 按钮区：is-idle 时显示，贴在右下角 -->
    <button data-act="reset" data-scope="custom">恢复默认</button>
  </div>
</aside>
```

- **没点过任何选项 / label（`.is-idle`）**：提示框本体不显示（边框透明 + 背景透明，占位尺寸不变），只显示右下角的「恢复默认」按钮。
- **点过任意 `esf-label` 或它那一行的单选** → 去掉 `is-idle`：`.esf-tipbox-body` 里填上 `.esf-tipbox-title`（这一项的名字）+ `.esf-tipbox-desc`（每个选项一行，`<strong>选项名：</strong>说明`，用 `<br>` 分行）。**「恢复默认」按钮在提示框下面，一直都在**，不受这个切换影响。例如：

```text
弹框触发方式
悬浮：鼠标悬浮在高亮位置时弹出
单击：鼠标点击高亮位置后弹出
长按：鼠标按住高亮位置不放，约半秒后弹出（不会触发链接跳转）
```

说明文案在 `settings-form.js` 顶部的 `CUSTOM_TIPS`（key = 控件的 `data-k`，值 = `{选项值: 说明}`）；**标题和每个选项的名字都直接取界面上的 `esf-label` / `esf-radio` 文字**，不在这里重复维护。渲染逻辑是 `renderOptionTip()`（只重填 body + 去掉 `is-idle`），靠 `custom-sec` 上一个 `click` 委托触发。窄屏（≤760px）自动摞成一栏。

**弹窗里的同一块**（`mount(..., { compact: true, only: 'custom' })`，挂在 `#pp-custom-mount`，弹窗底部「自定义设置」折叠条下）布局不一样，全部靠 `.esf-compact` 前缀的几条覆盖规则实现（见 `settings-form.css` 末尾），**不改 HTML 结构、不改任何功能**：

- `.esf-compact .esf-split` 强制一栏：上面一行是各项设置（`.esf-split-main`），下面一行是提示区（`.esf-split-side`）；
- `.esf-compact .esf-split-side` 改成 `flex-direction: row`：提示框（`.esf-tipbox`，装着 `.esf-tipbox-body`）在左、`恢复默认` 按钮在右；
- `.esf-compact .esf-tipbox` 由固定 `119px` 改成 `height: auto` + `flex: 1 1 auto`，高度贴内容走；
- `.esf-compact [data-role="custom-sec"] > h1` 隐藏 —— 弹窗自己的折叠条已经写了「自定义设置」，不重复。

> ⚠️ **已知取舍**：两种状态互斥且**没有「回到 idle」的路径** —— 点过任何一个 label / 单选之后，「恢复默认」按钮就一直收着，想再点它只能刷新页面（或重开设置页）。要让它回来的最自然做法是加一条：点空白处 / 再点同一个 label 就把 `is-idle` 加回去。目前按用户要求没做。

### 6.8 「AI 缓存优先」

「自定义设置」里的第 3 项，存储键 **`regexReplace`**（默认 `false` = 不优先）。

| 选 | 打开页面时 |
|---|---|
| **优先** | 先**只查**这个页面的 AI 缓存：命中就用缓存结果高亮（`mode = 'ai'`），**不跑正则**；没命中就安静退回正则识别 |
| **不优先**（默认） | 照常跑正则识别，压根不碰 AI 缓存 |

实现分三层，缺一层都不成立：

1. **`content.js` 的 `autoRecognize()`**：`aiWindowActive()` → 照旧走 AI；否则 `autoRegex && regexReplace` 时先 `C.runAI({ auto: true, cacheOnly: true })`，返回 `ok:false` 才 `safeRun()`（= 正则）。它只在「正则识别方式 = 自动」时起作用 —— 方式是「点击」时本来就不自动识别，优先也无从谈起。改设置时（`storage.onChanged` 收到 `regexReplace`）会当场重来一遍。
2. **`background.js` 的 `analyzeWithCache(cfg, text, title, url, noCache, cacheOnly)`**：`cacheOnly` 时缓存没命中直接回 `{ ok:false, code:'NO_CACHE' }`，**不调接口**（否则一次探测白花 token）。
3. **`content-ai.js`**：把 `cacheOnly` 透传给背景；收到 `NO_CACHE` 时**不写 `lastError`** —— 缓存没命中是正常情况，不是错误。

> 两个已知后果：① 用了 AI 缓存结果后 `R.state.mode = 'ai'`，而 `content-observer.js` 对「mode = ai 且不在连续使用窗口内」的页面**不再增量重扫**（页面后来新加的内容不会被标）—— 这是沿用 AI 模式原有的行为；② 「优先」只在**自动**识别那一步生效，弹窗里手动点「正则识别」永远是正则。

回归：`repro13-regex-replace.cjs`（背景 cacheOnly 的三种情形 + 页面上「优先/不优先 × 有缓存/没缓存」四种组合）。

### 6.9 「连续使用」= 次数额度

弹窗里那个下拉：**单次 / 20 次 / 100 次 / 300 次 / 999 次**（存储键 `aiContinuous`，默认 `once`）。
以前是时长（5 分钟…12 小时，靠 `aiUntil` + `aiDurationMs` 两个时间戳 + 倒计时），**已整体删除**。

**规则**

| 动作 | 结果 |
|---|---|
| 选一个次数（还没点识别） | `armed`：只存设置，额度清 0；弹窗提示「已选 100 次 · 点「AI 识别」后开始计数」 |
| 点「AI 识别」 | 没有进行中的批次 → 按当前选项开一批（`total = N`，`used = 0`）；**已经在计数中 → 不动额度**（这一次照常扣 1，不会把计数清零） |
| 每**真调一次接口** | `used++`。**读缓存不扣**（没花 token）；接口报错不扣；`cacheOnly` 只读探测不扣（见 6.8） |
| `used` 追上 `total` | `exhausted`：页面回到正则识别；弹窗显示「已使用：100/100次 · 次数已用完，重新点「AI 识别」可再开一批」 |
| 再点「AI 识别」 | 开新一批（`used` 归零） |

**四态**（`background.js` 的 `quotaState()` 返回 `phase`）：`off`（单次）/ `armed`（选了次数、还没点）/ `active`（进行中）/ `exhausted`（用完）。

**扣次数在哪扣**：`background.js` 的 `analyzeWithCache()` —— 只有**调完接口成功**那条分支调 `consumeAiQuota()`（缓存命中那条分支**不调**，见下）。放在这里是因为「一次识别」在内容脚本、弹窗、自动识别三条路上都会汇到 `AI_ANALYZE`，只有这儿是唯一的收口。**用完不清零**（保留 `total`/`used`），否则弹窗就没法显示「已使用：100/100次」。

> **读缓存不扣次数**（用户 2026-10-08 定的规则）：额度管的是「花掉的 token」，命中缓存没花 token 就不该扣。所以反复打开同一个页面不会吃次数；额度只被「没缓存、真调了接口」的页面消耗。实现上就是 `cache.lookup()` 命中那条 `return` 之前**不再调** `consumeAiQuota()`。

**弹窗提示**：`paintContinuous()` 对 `active` / `exhausted` 直接写 `pp-alert` 并加 `pp-alert-err`（不走 `setContinuousAlert()` —— 那个会因为 `alertOwner === 'event'` 给「正在调用…」让路）。文案就是 `已使用：15/100次`。计数模式下**不再**显示「AI 识别完成，命中 N 处」那句。

两条「别让它闪」的约定（都是用户反馈过才改的）：

- **「正在调用 AI 分析正文，请稍候…」延后 500ms 才显示**（`runAi()` 里的 `hintTimer`）：命中缓存时接口根本没被调用，立刻显示会「黄闪一下再变红」。真调接口（慢）时照旧会出现，按钮本身也有 `loading` 态兜着。
- **`maybeStartContinuous()` 不画界面**：刚开批时 `used` 还是 0，画出来是「已使用：0/100次」，紧接着识别完又变 1 —— 同样是一闪。识别完由 `runAi()` 统一 `refreshContinuous()` 画一次。

回归里两件都钉住了（`repro15` 的 1 段）：用 `MutationObserver` 盯着 `pp-alert` 记下每一次变化，断言读缓存那次**没有**「正在调用…」和「已使用：0/…」的中间态；反过来再用一个 1200ms 的慢请求断言黄色进度提示**仍然会出现**。

**换选项**：走 `AI_CONTINUOUS_ARM`（不是 `SET`）—— 只存设置 + 清额度，回到 `armed`，免得出现「界面选 300 次、额度还是上一批 100」这种对不上的状态。

> 顺带：`popup.js` 里那一整套倒计时（`continuousTimer` / `fmtRemaining` / `tickContinuous` / `startCountdown` / `AI_CONTINUOUS_STOP`）和 `ai-core.js` 的 `continuousMs()` / `formatDuration()` 都已删除。

回归：`repro15-continuous-count.cjs`（选项表 + 状态机 12 项 + 弹窗端到端 14 项 + 页面自动识别扣次数/用完退回正则）。

---

## 七、年号表的数据约定与坑 ★

`era-table.js` 是纯数据，`TABLE` 每行 = `[朝代, 帝号, 年号, 起始年, 结束年, 纪年起点?]`，公元前用负数；`eras.js` 把它包成 `ERAS = [{dynasty, emperor, name, start, end, offset}]`。

**改数据或写新逻辑前，先确认这几点：**

1. **年号外面可能包一层括号**（`["吳", "太祖", "（天復）", 902, 903, 2]`）—— 那只是个标记，与程序无关。`eras.js` 的 `cleanEraName()` 在读表时统一去掉，所以 `ERAS` / `NAMES` / 识别正则 / 界面里都不带括号。**别在别处再依赖原始字符串。**
2. **第 6 列 = 纪年起点偏移**：`start` 那一年是这个年号的第几年（缺省 1，也就是 `start` 就是元年）。
   `["北漢", "英武帝", "天會", 968, 973, 12]` → 968 是天會十二年 → 天會元年 = 957。
   **所有「纪年数 → 公元年」的换算都要走 `D.eraYear(start, n, offset)`**，不要再写 `toGregorian(start, n)` 或 `start + n - 1`（`toGregorian` 只保留给外部，内部已无人调用）。反过来「公元年 → 纪年数」是 `n = year - start + offset`。
   - 唯一例外是**干支**：干支锚在真实年份上，与年号的计数起点无关，所以仍用 `ganzhiOffsetIn()`，得到的那一年对应的纪年数是「偏移 + offset」。
   - 表里 36 条带第 6 列，最大 offset 43（前涼建興），最大纪年数 49 —— 都在纪年上限 61 之内，但**以后加数据要留意这个上限**。
   - **两处显示约定**（都只为「别把起点年误读成元年」）：
     - 卡片：起止年写成「起点年(偏移)-结束年」，如 `968(12)-973年`（`content-tooltip.js` 的 `epochMark()` / `rangeText()`；offset 为 1 时不加括号）。
     - 侧边栏：在公历年那一列的**下面**补一行「起n年」，如 `968-973年` + `起12年`（`sidepanel.js` 的 `epochLabel()`，挂在 `.sp-epoch`）。
3. **年份可以是 `null`**（不确定）。任一端为 null → 不推算公元年，显示「？」/「未知」（见 2.4）。
4. **`Number(null) === 0`。判断 null 一定用原值 + `Number.isFinite()`，不要先 `Number()`。** 踩过：`hasNthYear()` 写成 `Number(row.start)` 后 null 变 0，绕过 `isFinite`，双 null 的条目被范围校验误拦。
5. **帝号可能本身就是一条年号。** `西漢·高祖·高祖`、商朝那一串王名都是这样，所以「找年号」要优先取后面跟着纪年的那个（见 5.1）。
6. **同 `(朝代, 帝号, 年号)` 可能重复**（如 `荊南(南平)·平文獻王·天福` 两条）。要定位某一行就用**对象引用 / 下标**，别用名字 —— `D.lookupEra()` 返回的是 `D.ERAS` 里的**引用**，所以 `indexOf(row)` 可靠。
7. **按朝代分组的表顺序不是严格时序**（十六國 / 南北朝 / 漢其他 有十来处逆序），按 `(朝代, 帝号)` 分组则是。需要时序就用 `orderedEras()`（见 5.4）。
8. **`start` 可以是 `null` 而 `end` 有值**（小乙），反之亦然（盤庚 / 祖庚）。别假设「start 有值 ⇒ end 也有值」。
9. **表里年号一般用正体**（貞觀 / 後元），但个别条目本身用简体字形（如景帝的「后元」）。界面统一显示表里的写法；输入是简体 / 异体时靠 `canonicalForm()` 归一匹配。

---

## 八、开发与测试

改完代码在 `chrome://extensions/` 点「重新加载」，再刷新目标页面。content script 改动要刷新页面；`canvas-main.js` 跑在 MAIN world，同样要刷新。

### 8.1 本地测试台

`.workbuddy/test/` 下有一套 Playwright 测试台：用 route 把 `www.shidianguji.com/**` 或 `example.com/**` 指到本地 HTML、`/src/**` 指到项目源码，从而在真 Chromium 里跑 content script / 侧边栏。


```bash
NODE_PATH=<托管 node_modules> node <脚本>
# chromium 用 ~/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe
```

| 文件 | 作用 |
|---|---|
| `canvas-harness.html` | 模拟识典 canvas 阅读器。查询串开关：`?pre=1` 开共和前纪年、`?blocked=1` 禁用本站、`?mode=global\|custom`、`?off=1` 关总开关 |
| `dom-harness.html` | 普通网站 DOM 对照组（同一套用例可比对两条路径） |
| `check-site.cjs` | 站点规则 5 组（默认 / 禁用 / 全局 / 自定义 / 关总开关），同时数 canvas 覆盖标记与 DOM 标记 |
| `check-tip.cjs` | 逐条打印卡片标题 / 候选行 / foot / 干支 / 本条文内标注（`HOST` + `HARNESS` 切换路径） |
| `check-chain.cjs` | 同一 canvas 内：禁用站点手动识别（①）、更正「三年」后「四年」是否跟随（②） |
| `check-cross.cjs` | **跨 canvas**：`canvas2-harness.html` 两页，「三年」在第 1 页、「四年」在第 2 页 |
| `check-key.cjs` | 重绘后 canvas 更正是否还在，**当前预期失败**（记录键不稳定，见第九节） |
| `canvas-anno-fix.cjs` | canvas 文内标注：省略年号的「二年」更正后标注是否跟着更新（含修复前代码的 A/B 对照）。用 jsdom 直跑，不需要 Chromium |
| `check-tip-layout.cjs` | 卡片位置契约 + 「清除」行为：`head = [正/AI] [标题] [↺?] [干支]`、`foot = [年号：范围?] [清除] [更正]`；「清除」单击弹原生确认框，取消不动、确认才清。用 jsdom 直跑 |
| `check-era-offset.cjs` | 年号表的两处数据约定：年号外层括号要清掉、第 6 列纪年起点偏移要参与换算；以及卡片「起点年(偏移)」和侧边栏「起n年」的显示约定。覆盖数据层 / DOM 标注 / canvas 标注 / 侧边栏四段。用 jsdom 直跑 |
| `check-dynasty.cjs` | 正文里点名的朝代要认得出：侧边栏 `whoMatch()` 的简繁折叠、DOM 与 canvas 按正文朝代选候选（「北漢乾祐二年」不能高亮 後漢）。用 jsdom 直跑 |
| `check-badnum.cjs` | 中文数字合法性：`badnum-harness.html` 在 canvas 与 DOM 两条路径各跑一遍 |
| `compare.cjs` / `run.cjs` | 卡片抢焦点、双击切换、更正面板、重建回归 |
| `run-sidepanel.cjs` / `check-range.cjs` / `check-unknown.cjs` / `check-step.cjs` / `sweep-sidepanel.cjs` | 侧边栏：用例表、范围校验、未知年份、`<`/`>` 跳转、全量扫描 |
| `check-options.cjs` | 设置页冒烟 |

`.workbuddy-ai/repro/` 下另有一套「卡片 + 更正面板」的回归台（用 `playwright-core` + 本机 Chromium，直接注入 `src/` 源码，不需要装扩展）：

```bash
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro3.cjs   # DOM：重扫后选候选，面板应还在
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro4.cjs   # DOM：真实正文变化触发重扫 / 点另一处年号
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro5-smoke.cjs  # 更正 / 点卡片收面板 / 清除（带断言）
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro6-leave.cjs  # 共同区域：移出一起收、区域内都不收、点卡片只收面板
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro-canvas.cjs  # canvas：覆盖标记整批重建
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro7-options.cjs       # 设置页：两栏布局 / 提示框 / 两个恢复默认 / 清空里的清缓存（带断言）
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro8-popup-mount.cjs   # 弹窗里 only:'sites' / only:'model' 两种挂载
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/probe-storage-get.cjs    # 真扩展实测 chrome.storage.get 的语义
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro9-who.cjs           # whoText 单元 + 全表扫描（同名去重 / 不同名逐字未变）
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro10-who-render.cjs   # 卡片候选行 + 侧边栏结果行的实际渲染
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro11-highlight.cjs    # 高亮带朝代（含「大」）+ 卡片/更正面板/清除回归
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro12-ailog.cjs        # 「AI 调用记录」面板 + 删掉 ai-log-panel.js 的降级
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro13-regex-replace.cjs # 「AI 缓存优先」：背景 cacheOnly + 页面四种组合
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro14-settings-export.cjs # 导出带上设置（不含 Key）+ 导入恢复 + 脏值被挡
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro15-continuous-count.cjs # 「连续使用」次数：选项表 + 状态机 + 弹窗提示 + 页面自动识别
NODE_PATH=<托管 node_modules> node .workbuddy-ai/repro/repro16-prompt-align.cjs     # 提示词与代码对齐 + parseResults 按年号表归一
```

### 8.2 三个容易踩的实现坑

- **`updateStepButtons()` 必须放在 `render()` 最前面** —— `render()` 大多数分支都会提前 `return`（公元年、报错、idle…），挂末尾会漏掉。
- **加字段时想想它要不要进渲染签名。** canvas 侧靠 `hitSignature()` 判断要不要重建标记，签名里没有的东西改了不会重建；DOM 侧同理，靠 `refreshAnnotations()` / `refreshEraContext()`。
- **`mark.textContent` 不再等于「年号那一段」。** 高亮会把紧挨在年号前面的朝代（含「大」）一起圈进来（见 1.1），所以「读标记文字解析年号」的地方一律用 `C.eraTextOf(mark)`（= `mark.__eraText`）；只有「把标记还原成普通文本」的 `removeMark()` / `clearMarks()` 才该用 `mark.textContent`。匹配对象上 `index`/`end` 是年号范围、`hlIndex` 才是高亮起点，`__eraKey` 用的是前者 —— 别把这两个概念混了，混了要么丢更正记录、要么把朝代那两个字在正文里切两遍。
- **`chrome.storage.get(默认值对象)` 只返回对象里列出的键，不是整个 storage！** 想读的键必须写进那个对象。`settings-form.js` 的 `raw()` 曾经漏掉 `apiProfiles` / `customModels` / `activeModelId` / `apiBase` / `apiKey` / `model`，于是 `load()` 永远读不到已保存的模型配置，`save()` 拿到的 `cur.apiProfiles` 是空的，**写回去就把 apiProfiles、customModels 和扁平 apiKey 一起清空** —— 表现是「在设置页随便改个开关，AI 的 API Key 就没了」。真机行为见 `.workbuddy-ai/repro/probe-storage-get.cjs`（加载一个真扩展实测）。**以后新增模型相关的存储键，记得同步加进 `raw()` 的默认值对象。**
- **插件自己生成的节点不能被当成「正文变了」。** 卡片 / 更正面板 / 桥接分组 / 标记 / 文内标注插进页面时同样产生 `MutationRecord`；`content-observer.js` 必须用 `C.isGeneratedNode()`（`content-marker.js`）把这些记录滤掉。少了这一步，**打开卡片就会在 900ms 后触发一次整页重扫**：所有标记被重建，正在看的那一处变成游离节点，更正面板随即被误关 —— 这是「点了更正，面板有时会自己消失」的根源。滤的时候只看 `addedNodes` / `removedNodes`（`target` 会是 `body`，它不算生成节点），并保留原有的 `markSelfMutation()` 200ms 宽限。
- **纪年数字的正则分支必须从长到短排。** `CN_YEAR_PART` / `ARABIC_YEAR_PART` 里把 `[二三四五六七八九]` 放在 `[二三四五]十…` 前面时，凡是写成 `(NUM_PART)\s*年?`（末尾的「年」**可选**）的地方都会吃下「二十三年」里的「二」而不再回溯 —— 侧边栏的 `parseQuery()` 就栽在这上面，纪年被截成 2。`buildRegex()` 里「年」是必需的，靠回溯侥幸没露馅。**改这两个常量时先想清楚顺序。**

---

## 九、已知限制

- **canvas（识典古籍）上「更正偶尔会失效」。**
  - 记录键 `__eraKey` 在 canvas 上不稳定（见 4.1）：它用的是「本页 canvas 文字拼接串里的前 6 字」，而阅读器重绘 / 只画可见部分时，紧邻前一条记录会变 → 键变 → 那一处的 `eraFixes` / `overrides` 查不到，标记退回默认识别。
  - 复现脚本：`check-key.cjs`（强制重绘后更正丢失）。
  - 曾经把键换成「页 + 版面坐标 + 文本」（重绘/裁剪/滚动都不变）验证有效，但真机上用户反馈仍不稳定，已按用户要求撤回。**再动这块之前先想清楚键的稳定性，并在真机上验证。**
- **更正的向下传播已经通了**（含跨 canvas）：靠 `effectiveChain()` + 把「处理完之后的链」交给下一页。回归脚本 `check-chain.cjs` ② / `check-cross.cjs`。
- 卡片双击候选切换存的是**候选数组下标**，如果候选来源变了（例如先更正年号再切换），语义以当时的候选为准。
- **同年号多候选时，「上文没给线索」的那一处会取表里的第一条**（候选[0]）。
  - `createMark()` 会把候选[0] 的朝代预先写进 `mark.__eraDynasty`，`pickIndex()` 又优先用它 —— 但**正文里紧挨着的朝代 / 帝号现在排它前面**（见 4.2 第 3 条），所以「北漢乾祐二年」这类能按正文选对。只有当正文确实没提朝代时才会落到候选[0]。
  - 剩下的表现：「天會十二年」正文无线索 → 取到北漢睿宗 → 968（超出睿宗的 967，但按 2.4 的约定不标「？」）；「建興三十四年」→ 取到蜀漢後主 → 256，而前涼那三条算出来是 346。
  - 想继续改就得让 `precedingText` 的线索更宽（比如认「同段落里提过的朝代」），但那会误伤；注意 `applyContextMatches()` 给下文种子链提供朝代的正是 `chain.dynasty = holder.__eraDynasty`，**动之前先想清楚对下文继承的影响**。
- 按公元年查询时，起止年不可考的条目只按起始年匹配。
- `ai-core.js` 拼给模型的参考表用 `formatYear()`，不带「约」；年号那一列给的是**元年**（`eraYear(start, 1, offset)`），不是表里的 `start`。
