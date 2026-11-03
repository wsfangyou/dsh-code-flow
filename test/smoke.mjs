/**
 * dsh-code-flow 冒烟测试：纯契约 + 结构校验（无网络、无浏览器）。
 * 覆盖：配置默认与响亮校验、0.2.0 volatile 配置字段 + 页面策略（configure
 * {auto:false}）延迟注入、纪律段三档（gating/流水线各段/档位差异/自激防护/
 * 自定义规则）、`system-prompt/assemble` waterfall 契约（关闭恒等 / 命中
 * 追加且只追加 / 计数 / 干净恒等 / 非字符串跳过 / sanitize 关断）、客户端
 * 设置行（渲染驱动开关/三档按钮/持久化/幂等/归一化/字典对齐/快照净化）、
 * 包清单与 patch 一致性、README 成因文档。
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const results = [];
const ok = (label) => { results.push(`[OK] ${label}`); console.log(`[OK] ${label}`); };
const parse = (schema, data) => schema["~standard"].validate(data);

// ── 1) 宿主半边（lib/index.js） ────────────────────────────────────────────
const host = await import("../lib/index.js");
{
	const defaults = parse(host.Config, {}).value;
	assert.deepEqual(
		{ sectionOrder: defaults.sectionOrder, sanitize: defaults.sanitize, extraRules: defaults.extraRules },
		{ sectionOrder: 2190, sanitize: true, extraRules: [] },
		"structural config defaults: order 2190 / sanitize on / no extra rules"
	);
	assert.equal(defaults[host.ENABLED_FIELD].get(), false, "volatile default: enabled=false (ref via Config({}))");
	assert.equal(defaults[host.MODE_FIELD].get(), "balanced", "volatile default: mode=balanced (ref via Config({}))");
	assert.equal(host.Config.dict[host.ENABLED_FIELD].meta?.volatile, true, "enabled declared .volatile() (0.2.0 form model)");
	assert.equal(host.Config.dict[host.MODE_FIELD].meta?.volatile, true, "mode declared .volatile() (0.2.0 form model)");
	assert.equal(host.Config.dict.sectionOrder.meta?.volatile, void 0, "structural sectionOrder stays non-volatile (patch layer only)");
	assert.throws(() => host.apply(makeHostCtx().ctx, { sectionOrder: -1, sanitize: true, extraRules: [] }), /sectionOrder/, "non-positive sectionOrder fails loudly");
	assert.throws(() => host.apply(makeHostCtx().ctx, { sectionOrder: 2190, sanitize: "yes", extraRules: [] }), /sanitize/, "non-boolean sanitize fails loudly");
	assert.throws(() => host.apply(makeHostCtx().ctx, { sectionOrder: 2190, sanitize: true, extraRules: [42] }), /extraRules/, "non-string extraRules entry fails loudly");
}

/**
 * 按真实 cordis + 0.2.0 设置模型建模：settings 注入挂起（回调异步执行），
 * 回调携带 `settings.configure` 页面策略桩；另捕获纪律段注册。
 */
function makeHostCtx() {
	const listeners = [];
	const sections = [];
	const pendingInjects = [];
	const configureCalls = [];
	const ctx = {
		fiber: { label: "stub-fiber" },
		// 按真实 cordis 建模：inject 回调在依赖就绪后**异步**执行（绝非同步）。
		inject: (names, cb) => {
			if (names.includes("settings")) pendingInjects.push(cb);
		},
		on: (event, listener, options) => {
			listeners.push({ event, listener, options });
			return () => {
				const index = listeners.findIndex((entry) => entry.listener === listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		effect: (fn) => fn(),
		systemPrompt: { section: (definition) => { sections.push(definition); } }
	};
	return {
		ctx, listeners, sections, pendingInjects, configureCalls,
		/** 模拟注入子 fiber 就绪：执行挂起的 inject 回调（configure 页面策略桩）。 */
		fireInject: () => {
			for (const cb of pendingInjects.splice(0)) {
				cb({
					effect: (fn) => { try { fn(); } catch { /* 桩忽略 */ } },
					settings: { configure: (options, fiber) => { configureCalls.push({ options, fiber }); return () => {}; } }
				});
			}
		}
	};
}

/**
 * 组装 apply 入参：结构字段走 Config 解析；volatile 字段用测试持有的**活引用**
 * （改 toggle 即热更，模拟 0.2.0 `config.<field>.get()` 活读）。
 *
 * @param toggle - 本 harness 自有的 `{enabled, mode}` 开关对象。
 * @param structural - 可选结构层覆盖（extraRules/sanitize 等）。
 * @returns apply 入参。
 */
function makeConfig(toggle, structural) {
	return {
		...parse(host.Config, structural ?? {}).value,
		[host.ENABLED_FIELD]: { get: () => toggle.enabled },
		[host.MODE_FIELD]: { get: () => toggle.mode }
	};
}

/** 带触发词的典型装配（tools:fs 段含1处 quick and dirty）。 */
function makeAssembly() {
	return {
		sections: [
			{ name: "harness:identity", text: "You are an AI agent powered by DeepSeek Harness." },
			{ name: "tools:fs", text: "## read tool docs — quick and dirty is fine here" },
			{ name: "code-flow:discipline", text: "LIVE PIPELINE" },
			{ name: "emotive:persona", text: "EMOTION+PERSONA BLOCK" },
			{ name: "deployment:persona-suffix", text: "" }
		],
		contexts: [{ name: "runtime", text: "Runtime snapshot." }],
		tools: [{ name: "read", description: "read files", parameters: {} }],
		variables: { provider: "deepseek" }
	};
}

/** 零触发词的干净装配。 */
function makeCleanAssembly() {
	return {
		sections: [
			{ name: "harness:identity", text: "You are an AI agent powered by DeepSeek Harness." },
			{ name: "tools:fs", text: "## read tool docs (agent-only)" },
			{ name: "emotive:persona", text: "EMOTION+PERSONA BLOCK" }
		],
		contexts: [],
		tools: [],
		variables: { provider: "deepseek" }
	};
}

/** next() 直通夹具：单监听器下 waterfall 返回喂给它的同一个 assembly。 */
const pass = (assembly) => async () => assembly;

// console.warn 捕获（0.2.0 模型下不应出现任何「未就绪」警告）。
const warnCalls = [];
const realWarn = console.warn;
console.warn = (...args) => { warnCalls.push(args.join(" ")); };

const h1Toggle = { enabled: false, mode: "balanced" };
const h1 = makeHostCtx();
host.apply(h1.ctx, makeConfig(h1Toggle));
assert.equal(h1.pendingInjects.length, 1, "settings configure policy registered as a DEFERRED inject (never invoked synchronously at apply time — boot-crash regression)");
assert.equal(h1.configureCalls.length, 0, "configure not called before the injected fiber fires");
assert.equal(h1.sections.length, 1, "discipline section registers synchronously");
assert.equal(h1.sections[0].name, "code-flow:discipline");
assert.equal(h1.sections[0].order, 2190, "section order follows config");
assert.equal(typeof h1.sections[0].text, "function", "section text is a live function (build-time read)");
assert.equal(h1.listeners.length, 1, "calibration waterfall registers without waiting for settings");
assert.equal(h1.listeners[0].event, "system-prompt/assemble");
assert.deepEqual(h1.listeners[0].options, { global: true, prepend: true }, "same waterfall contract as dsh-mode-switch");
assert.deepEqual(host.inject, ["systemPrompt", "settings"], "declares its registries (settings kept for configure policy)");
assert.deepEqual(host.MODES, ["balanced", "quality", "speed"], "three modes exported");

// 页面策略注入前：配置引用已在手 → 关闭态恒等，且无任何「未就绪」警告。
const listener = h1.listeners[0].listener;
const early1 = makeAssembly();
assert.equal(await listener(early1, {}, pass(early1)), early1, "disabled config serves the assembly untouched even before the configure policy fires");
const early2 = makeAssembly();
assert.equal(await listener(early2, {}, pass(early2)), early2, "still identity while disabled (config live, not scope-dependent)");
assert.equal(warnCalls.filter((line) => line.includes("dsh-code-flow")).length, 0, "no not-ready warning in the 0.2.0 volatile-config model (config refs always present)");

// 子 fiber 就绪 → 登记「本插件自带设置行」页面策略（抑制自动生成表单）。
h1.fireInject();
assert.equal(h1.configureCalls.length, 1, "configure policy runs once when the injected fiber fires");
assert.equal(h1.configureCalls[0].options.auto, false, "configure({auto:false}) — plugin ships its own settings row (0.2.0 contract)");
assert.equal(h1.configureCalls[0].fiber, h1.ctx.fiber, "configure policy bound to ctx.fiber");
assert.equal(h1.pendingInjects.length, 0, "no pending settings injects left after firing");

// ── 纪律段 gating 与三档 ────────────────────────────────────────────────────
const sec = h1.sections[0];
assert.equal(sec.text(), "", "disabled by default → empty string (zero contribution)");

h1Toggle.enabled = true;
h1Toggle.mode = "balanced";
const balanced = sec.text();
const CORE_MARKERS = [
	"Understand before you write",
	"Specify before you build",
	"Smallest correct change",
	"Root cause only",
	"Verify narrow to wide",
	"Make it work, then make it right",
	"Done = evidence",
	"Speed economics"
];
for (const marker of CORE_MARKERS) {
	assert.ok(balanced.includes(marker), `balanced pipeline contains: ${marker}`);
}
assert.ok(balanced.includes("the codebase wins"), "codebase-truth tail present in every mode");
assert.ok(!balanced.includes("Quality mode adds"), "balanced omits quality extras");
assert.ok(!balanced.includes("Speed mode adds"), "balanced omits speed extras");
assert.equal(host.scanTriggers(balanced), 0, "balanced block self-scan is zero (anti self-trigger)");

h1Toggle.mode = "quality";
const quality = sec.text();
assert.ok(quality.includes("Quality mode adds"), "quality contains adversarial extras");
assert.ok(quality.includes("regression guard"), "quality mandates regression guards");
assert.ok(quality.includes("partial green is partial work"), "quality rejects partial green");
assert.ok(!quality.includes("Speed mode adds"), "quality omits speed extras");
assert.ok(quality.length > balanced.length, "quality is longer than balanced");
assert.equal(host.scanTriggers(quality), 0, "quality block self-scan is zero (anti self-trigger)");

h1Toggle.mode = "speed";
const speed = sec.text();
assert.ok(speed.includes("Speed mode adds"), "speed contains timebox extras");
assert.ok(speed.includes("smallest shippable slice"), "speed ships smallest slice");
assert.ok(!speed.includes("Quality mode adds"), "speed omits quality extras");
assert.ok(speed.length > balanced.length, "speed is longer than balanced");
assert.equal(host.scanTriggers(speed), 0, "speed block self-scan is zero (anti self-trigger)");

h1Toggle.mode = "turbo";
const fallback = sec.text();
assert.ok(fallback.includes("Speed economics") && !fallback.includes("Quality mode adds") && !fallback.includes("Speed mode adds"), "unknown mode falls back to balanced");

h1Toggle.enabled = "junk";
assert.equal(sec.text(), "", "malformed enabled value renders empty (safe fallback)");
h1Toggle.enabled = true;

// 自定义规则（配置层）。
const h2Toggle = { enabled: true, mode: "balanced" };
const h2 = makeHostCtx();
host.apply(h2.ctx, makeConfig(h2Toggle, { extraRules: ["每合入前必须更新 CHANGELOG。", "  "] }));
h2.fireInject();
assert.equal(h2.configureCalls[0]?.options.auto, false, "second harness registers the same configure policy");
const withRules = h2.sections[0].text();
assert.ok(withRules.includes("**Team rules.**"), "extra rules block present");
assert.ok(withRules.includes("每合入前必须更新 CHANGELOG。"), "extra rule text embedded");
assert.equal(host.scanTriggers(withRules), 0, "extra rules keep self-scan zero");
assert.deepEqual(host.sanitizeRules([42, "", "  ok  "]), ["ok"], "sanitizeRules drops non-strings/blanks and trims");
assert.deepEqual(host.sanitizeRules("nope"), [], "sanitizeRules tolerates non-arrays");
assert.equal(host.sanitizeRules(Array(15).fill("r")).length, 10, "sanitizeRules caps at 10 entries");
assert.equal(host.sanitizeRules(["x".repeat(500)])[0].length, 300, "sanitizeRules caps each entry at 300 chars");

// ── waterfall 契约 ─────────────────────────────────────────────────────────
h1Toggle.enabled = false;
h1Toggle.mode = "balanced";
const offIn = makeAssembly();
assert.equal(await listener(offIn, {}, pass(offIn)), offIn, "disabled → assembly untouched (identity)");

h1Toggle.enabled = true;
h1Toggle.mode = "balanced";
const hitIn = makeAssembly();
const hitOut = await listener(hitIn, {}, pass(hitIn));
assert.notEqual(hitOut, hitIn, "enabled + trigger returns a transformed assembly");
assert.equal(hitOut.sections.length, hitIn.sections.length + 1, "appended exactly ONE section");
assert.equal(hitOut.sections.at(-1).name, "code-flow:calibration");
assert.ok(hitOut.sections.at(-1).text.includes("1 speed-over-quality instruction(s)"), "hit count rendered");
assert.ok(hitOut.sections.at(-1).text.includes("first-cycle correctness"), "calibration states the thesis");
assert.equal(hitOut.sections.at(-1).order, Number.MAX_SAFE_INTEGER, "appended last by order as well as position");
assert.deepEqual(hitOut.sections.slice(0, -1), hitIn.sections, "host sections preserved verbatim (append-only contract)");
assert.equal(hitOut.contexts, hitIn.contexts, "contexts untouched (same reference)");
assert.equal(hitOut.tools, hitIn.tools, "tool schemas untouched");
assert.deepEqual(hitOut.variables, { provider: "deepseek" }, "variables preserved");

const cleanIn = makeCleanAssembly();
assert.equal(await listener(cleanIn, {}, pass(cleanIn)), cleanIn, "no triggers → identity (append only on hits)");

const multiIn = {
	sections: [
		{ name: "a", text: "just make it work for the demo" },
		{ name: "b", text: "别想太多" },
		{ name: "c", text: "plain text" }
	],
	contexts: [],
	tools: [],
	variables: {}
};
const multiOut = await listener(multiIn, {}, pass(multiIn));
assert.ok(multiOut.sections.at(-1).text.includes("2 speed-over-quality instruction(s)"), "multi-hit counts across sections (zh + en)");

const fnIn = {
	sections: [
		{ name: "weird", text: () => "skip the tests" },
		{ name: "ok", text: "quick and dirty" }
	],
	contexts: [],
	tools: [],
	variables: {}
};
const fnOut = await listener(fnIn, {}, pass(fnIn));
assert.ok(fnOut.sections.at(-1).text.includes("1 speed-over-quality instruction(s)"), "non-string text skipped without throwing");

const noSections = { sections: "not-an-array", variables: {} };
assert.equal(await listener(noSections, {}, pass(noSections)), noSections, "non-array sections → identity (defensive)");

// sanitize:false → 水龙关断，但纪律段照常工作。
const h3Toggle = { enabled: true, mode: "quality" };
const h3 = makeHostCtx();
host.apply(h3.ctx, makeConfig(h3Toggle, { sanitize: false }));
h3.fireInject();
const gatedIn = makeAssembly();
assert.equal(await h3.listeners[0].listener(gatedIn, {}, pass(gatedIn)), gatedIn, "sanitize:false disables the calibration waterfall");
assert.ok(h3.sections[0].text().includes("Quality mode adds"), "sanitize:false does NOT affect the discipline section");

console.warn = realWarn;
assert.equal(warnCalls.filter((line) => line.includes("dsh-code-flow")).length, 0, "no spurious warnings across all later assembles (scope-not-ready branch removed in 0.2.0)");
ok("host: config guards/deferred configure policy/pipeline gating/three modes/self-scan zero/waterfall append-only+counts+identities/sanitize off");

// ── 2) 客户端模块（lib/client.js，window/document 桩执行） ─────────────────
let loaded;
globalThis.window = { __ModuleLoader__: { load: (def) => { loaded = def; } } };
const docTags = [];
globalThis.document = {
	body: { dataset: {} },
	head: { appendChild: (node) => { docTags.push(node); } },
	querySelector: (selector) => {
		const id = (String(selector).match(/data-plugin-css="([^"]+)"/) ?? [])[1];
		return id === void 0 ? null : (docTags.find((tag) => tag.dataset?.pluginCss === id) ?? null);
	},
	createElement: (tag) => ({
		tagName: tag,
		dataset: {},
		textContent: "",
		remove() {
			const index = docTags.indexOf(this);
			if (index >= 0) docTags.splice(index, 1);
		}
	})
};
await import("../lib/client.js");
assert.equal(loaded.id, "dsh-code-flow");
assert.equal(typeof loaded.factory, "function");

const jsxStub = {
	jsx: (type, props, key) => ({ type, props: props ?? {}, key }),
	jsxs: (type, props, key) => ({ type, props: props ?? {}, key })
};
const storeStub = {
	defineStore: (spec) => ({ init: spec.init, actions: spec.actions, state: spec.init() })
};
const requireStub = (id) => {
	if (id === "react/jsx-runtime") return jsxStub;
	if (id === "@deepseek-ai/dsh-client-store") return storeStub;
	throw new Error(`unexpected client require: ${id}`);
};
const client = loaded.factory(requireStub);
assert.deepEqual(client.inject, ["slots", "locale", "remote", "configForms"], "client inject uses configForms (0.2.0 settings model)");
assert.deepEqual(client.MODES, ["balanced", "quality", "speed"], "client modes mirror host modes");
assert.equal(client.ENABLED_FIELD, "enabled");
assert.equal(client.MODE_FIELD, "mode");

function makeRun(initialSnapshot) {
	const writes = [];
	const state = { snapshot: initialSnapshot };
	let boundNamespace;
	let slotInjectName;
	let slotDescriptor;
	let slotComponent;
	let localeRegistration;
	const scopeStub = {
		getSnapshot: () => ({ value: state.snapshot }),
		subscribe: () => () => {},
		set: (field, value) => writes.push([field, value])
	};
	const clientCtx = {
		effect: (fn) => fn(),
		configForms: { get: (entryId) => { boundNamespace = entryId; return scopeStub; } },
		locale: { register: (ns, dict) => { localeRegistration = { ns, dict }; return () => {}; } },
		slots: {
			inject: (name, cb) => { slotInjectName = name; cb(); },
			register: (descriptor, component) => { slotDescriptor = descriptor; slotComponent = component; return () => {}; }
		},
		emit: () => {}
	};
	const mod = loaded.factory(requireStub);
	mod.apply(clientCtx);
	return {
		mod, writes, state,
		get boundNamespace() { return boundNamespace; },
		get slotInjectName() { return slotInjectName; },
		get slotDescriptor() { return slotDescriptor; },
		get slotComponent() { return slotComponent; },
		get localeRegistration() { return localeRegistration; }
	};
}

const run = makeRun({ enabled: false, mode: "balanced" });
assert.equal(run.boundNamespace, "code-flow", "client binds configForms entry id (= cordis.patch.yml id)");
assert.equal(run.slotInjectName, "settings.general.item");
assert.equal(run.slotDescriptor.id, "flow", "row id is flow");
assert.equal(run.slotDescriptor.order, 16, "row sits after the think-guard row (order 15)");
assert.equal(run.slotDescriptor.locale, "settings.code-flow");
assert.equal(run.localeRegistration.ns, "settings.code-flow");
assert.deepEqual(Object.keys(run.localeRegistration.dict.zh).sort(), Object.keys(run.localeRegistration.dict.en).sort(), "zh/en key parity");
assert.ok(docTags.some((tag) => tag.dataset.pluginCss === "dsh-code-flow/row.css"), "row stylesheet mounted once");

// store 动作接管：测试持有镜像，模拟框架把 sync 绑到行 store。
const mirror = { enabled: false, mode: "balanced" };
const syncCalls = [];
const actions = run.slotDescriptor.inject({
	sync: (enabled, mode, revision) => {
		syncCalls.push([enabled, mode, revision]);
		mirror.enabled = enabled;
		mirror.mode = mode;
	}
});
assert.equal(typeof actions.setEnabled, "function");
assert.equal(typeof actions.setMode, "function");
assert.deepEqual([mirror.enabled, mirror.mode], [false, "balanced"], "initial snapshot adopted into mirror");

const render = (view) => run.slotComponent({
	t: (key) => key,
	setEnabled: actions.setEnabled,
	setMode: actions.setMode,
	useStore: (selector) => selector(view)
});

// 关闭态：开关 off、无档位按钮。
const offTree = render({ enabled: false, mode: "balanced" });
assert.equal(offTree.type, "div");
assert.equal(offTree.props.className, "cf-group");
const switches = run.mod.findAll(offTree, "cf-switch");
assert.equal(switches.length, 1, "exactly one switch button");
assert.equal(switches[0].type, "button");
assert.equal(switches[0].props.role, "switch");
assert.equal(switches[0].props["aria-checked"], false, "switch reflects disabled state");
assert.ok(!String(switches[0].props.className).includes("cf-switchOn"), "off visual class absent");
assert.equal(run.mod.findAll(offTree, "cf-state")[0].props.children, "cf.off");
assert.equal(run.mod.findAll(offTree, "cf-modeBtn").length, 0, "mode buttons hidden while disabled");
assert.equal(run.mod.findAll(offTree, "cf-desc")[0].props.children, "cf.desc", "description row rendered (t returns the key in tests)");
assert.ok(run.localeRegistration.dict.zh["cf.desc"].includes("门禁"), "zh description documents the gated pipeline");
assert.ok(run.localeRegistration.dict.en["cf.desc"].includes("gates"), "en description documents the gated pipeline");

// 点开关 → 本地镜像翻转 + 持久化。
switches[0].props.onClick();
assert.deepEqual(run.writes.at(-1), ["enabled", true], "toggling persists enabled=true");
assert.equal(mirror.enabled, true, "mirror flips immediately (render-driven appearance)");
assert.ok(syncCalls.at(-1)[0] === true && syncCalls.at(-1)[2] > 0, "store synced with a fresh revision");

// 开启态：开关 on + 三档按钮。
const onTree = render({ enabled: true, mode: "balanced" });
const switchesOn = run.mod.findAll(onTree, "cf-switch");
assert.equal(switchesOn[0].props["aria-checked"], true, "switch reflects enabled state");
assert.ok(String(switchesOn[0].props.className).includes("cf-switchOn"), "on visual class present");
assert.equal(run.mod.findAll(onTree, "cf-state")[0].props.children, "cf.on");
const modeButtons = run.mod.findAll(onTree, "cf-modeBtn");
assert.equal(modeButtons.length, 3, "three mode buttons when enabled");
assert.deepEqual(modeButtons.map((button) => button.props.children), ["cf.mode.balanced", "cf.mode.quality", "cf.mode.speed"], "mode buttons in order");
const active = modeButtons.filter((button) => String(button.props.className).includes("cf-modeOn"));
assert.equal(active.length, 1, "exactly one active mode");
assert.equal(active[0].props.children, "cf.mode.balanced", "balanced active by default");
assert.equal(active[0].props["aria-pressed"], true, "active mode is aria-pressed");

// 点「质量」→ 持久化 + 镜像。
modeButtons[1].props.onClick();
assert.deepEqual(run.writes.at(-1), ["mode", "quality"], "clicking quality persists mode=quality");
assert.equal(mirror.mode, "quality", "mirror mode flips immediately");

// 非法档位归一化 + 幂等零写入。
actions.setMode("turbo");
assert.deepEqual(run.writes.at(-1), ["mode", "balanced"], "invalid mode normalizes to balanced");
const writesAfterNormalize = run.writes.length;
actions.setMode("balanced");
assert.equal(run.writes.length, writesAfterNormalize, "idempotent setMode writes nothing");
actions.setEnabled(true);
assert.equal(run.writes.length, writesAfterNormalize, "idempotent setEnabled writes nothing");

// 再点开关 → 关闭。
switchesOn[0].props.onClick();
assert.deepEqual(run.writes.at(-1), ["enabled", false], "toggling back persists enabled=false");

// 快照净化：畸形外部值安全收敛。
assert.deepEqual(client.sanitizeSnapshot(void 0), { enabled: false, mode: "balanced" });
assert.deepEqual(client.sanitizeSnapshot(null), { enabled: false, mode: "balanced" });
assert.deepEqual(client.sanitizeSnapshot({ enabled: "yes", mode: "turbo" }), { enabled: false, mode: "balanced" });
assert.deepEqual(client.sanitizeSnapshot({ enabled: true, mode: "speed" }), { enabled: true, mode: "speed" });
ok("client: slot/locale/render-driven switch/mode buttons/persistence/idempotence/normalization/parity/snapshot sanitize");

// ── 3) 包清单与 patch 一致性 ──────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(pkg.name, "dsh-code-flow");
assert.equal(pkg.main, "lib/index.js");
assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
assert.equal(pkg.exports["./client"], "./lib/client.js");
assert.equal(pkg.dsh.client.platform, "web");
assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length === 5, "client roster declares its five peers");
assert.ok(pkg.files.includes("lib/*.js"), "files ships lib");
const patchText = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
assert.ok(patchText.includes("id: code-flow"), "patch has the host/roster row");
assert.ok(patchText.includes("name: dsh-code-flow"), "row resolves this package");
assert.ok(patchText.includes("sectionOrder: 2190"), "order pinned in config");
assert.ok(patchText.includes("sanitize: true"), "calibration switch pinned in config");
assert.ok(patchText.includes("extraRules: []"), "extra rules pinned in config");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
assert.ok(readme.includes("成因 → 机制映射"), "README documents the cause→mechanism mapping");
assert.ok(readme.includes("同一个病"), "README states the unified quality/speed thesis");
assert.ok(readme.includes("只追加，绝不修改/删除宿主段"), "README states the append-only boundary");
ok("manifest: dsh.bundle/dsh.client/exports + patch rows + README cause map");

console.log("SMOKE PASS");
