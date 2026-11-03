/**
 * dsh-code-flow 宿主半边：编程纪律（特化 agent 编程能力）的**服务端执行者**。
 *
 * 核心论点（README 有完整成因→机制映射表）：**质量差与速度慢是同一个病的
 * 两个症状——没有门禁的流水线**。返工是编程最大的时间开销，因此「快」的
 * 正解是「一次做对」（first-cycle correctness），不是省步骤。门禁不是慢，
 * 门禁是省。
 *
 * 成因归因（设计出发点）：
 * 质量侧：
 * - Q1 无模型先写——没读代码就改 → 不一致、破坏约定   → 流水线 P0 先读后写
 * - Q2 无规格就动工——需求未收敛 → 返工                → 流水线 P1 规格先行
 * - Q3 症状式修补——try/catch 贴膏药 → 缺陷复利        → 流水线 P3 只修根因
 * - Q4 完成无证据——「应该能跑」→ 坏代码上线           → 流水线 P6 完成=证据
 * - Q5 大爆炸式修改——一次改500行 → 调试地狱           → P2 最小改动 / P4 由窄到宽
 * 速度侧：
 * - S1 顺序错了——猜代查、试代读 → 瞎摸浪费            → 速度经济学（便宜证据优先）
 * - S2 返工循环——规格不清/根因没挖 → 最大时间黑洞      → P1+P3（与质量同源）
 * - S3 反馈环太粗——大改+全量构建 → 慢环                → P4 窄→宽增量验证
 * - S4 反复推导已定决策——原地转圈                      → 速度经济学（一次定，线性执行）
 *
 * 机制（全部构建期现读，改设置无需重启）：
 * 1. Config 导出 `enabled`/`mode` 两个 `.volatile()` 运行时字段（0.2.0
 *    设置模型）——纪律段与水龙每次构建经 `config.<field>.get()` 活读；
 *    enabled=false → 纪律段空串、水龙恒等（双零贡献）；
 * 2. 注册系统提示段 `code-flow:discipline`（order 可配，默认 2190），按 mode
 *    组装三档（balanced 全七段 / quality +对抗性自审 / speed +时间盒）；
 * 3. 挂 `system-prompt/assemble` waterfall（{global, prepend}，与
 *    dsh-mode-switch 同款契约）：下游装配完成后扫描各段文本中的**反工程
 *    指令**触发词（「先跑起来就行」「别想太多」「quick and dirty」…），
 *    命中数 >0 时**追加** `code-flow:calibration` 段：把「快」校准为
 *    「快 = 一次做对」。
 *
 * 安全边界：
 * - 校准段只追加、绝不修改/删除宿主段（原数组与各段对象原样保留）；
 * - 纪律段尾注恒在：任务专属指令、安全规则、真实性永远优先；**与真实
 *   代码库冲突时以代码库为准**（纪律不许压过事实）；
 * - 纪律段自身对触发词 pattern 表**零命中**（冒烟有防自激断言）；
 * - 默认 enabled=false：不开启就零影响。
 *
 * 关键 API 约定（0.2.0 新设置模型，与 dsh-think-guard/dsh-memory-vault 一致）：
 * - 运行时字段在导出的 Config 上 `.volatile()` 声明，apply 收到配置引用，
 *   读走 `config.<field>.get()` 活读（旧的 register → owner scope 读法已从
 *   dsh-settings 0.2.0 移除，不可再用）；
 * - 本插件自带设置页行 → `settings.configure({auto:false}, ctx.fiber)`
 *   登记页面策略；ctx.inject 回调**异步**执行，apply 时绝不同步断言；
 * - systemPrompt.section 的 text 是**函数**，每次提示构建调用 → 设置改动
 *   下一次回复即生效。
 *
 * @module dsh-code-flow
 */
import z from "@deepseek-ai/schemastery";

/** Cordis 插件名（诊断用；与 cordis.patch.yml 的 id 一致）。 */
const name = "code-flow";

/** 设置命名空间（须为小写连字符形态；与 lib/client.js 共用）。 */
const SETTINGS_NAMESPACE = "code-flow";

/** 持久化字段：总开关（默认 false = 零影响）。 */
const ENABLED_FIELD = "enabled";

/** 持久化字段：纪律档位。 */
const MODE_FIELD = "mode";

/** 三档：balanced（默认）/ quality / speed。 */
const MODES = ["balanced", "quality", "speed"];

/** 纪律段段名（systemPrompt.section 注册名）。 */
const SECTION_NAME = "code-flow:discipline";

/** 速度校准段名（水龙追加名）。 */
const CALIBRATION_SECTION = "code-flow:calibration";

/** bundle 可配项：volatile = 设置页可热写（表单模型），其余 = 补丁层静态配置。 */
const Config = z.object({
	/** 运行时开关：总开关（默认关 = 零影响）。 */
	[ENABLED_FIELD]: z.boolean().default(false).volatile(),
	/** 运行时开关：纪律档位（默认 balanced）。 */
	// schemastery 无 z.enum：用 const 联合枚举（未知值落校验错，运行期另有
	// mode 回落 balanced 的双保险——见 apply/text 与客户端 sanitize）。
	[MODE_FIELD]: z.union(MODES.map((mode) => z.const(mode))).default("balanced").volatile(),
	/** 纪律段 order（有限正整数，越大越靠后）。 */
	sectionOrder: z.number().default(2190),
	/** 速度校准水龙开关（false = 只注入纪律段）。 */
	sanitize: z.boolean().default(true),
	/** 追加自定义工程规则（构建时净化：≤10 条、每条 ≤300 字）。 */
	extraRules: z.array(z.string()).default([])
});

/**
 * 反工程指令触发词 pattern 表（水龙的扫描对象：速度压倒质量的偷工暗示）。
 * 扫描对象 = 下游装配的各段**文本**；纪律段自身对本表零命中（冒烟断言）。
 * 中英双语；每条 pattern 每段至多计一次命中。
 */
const TRIGGER_PATTERNS = [
	/just make it work/i,
	/quick(?: and dirty|ly done| fix)|hack(?:y|ish| together)/i,
	/don'?t (?:overthink|over-analy(?:ze|se)|bother (?:with|testing))/i,
	/as (?:fast|quick)ly as possible/i,
	/skip(?:ping)? (?:the )?tests?/i,
	/without (?:testing|verification|checking)/i,
	/别想太多|想太多|别纠结/,
	/尽快|赶紧|速战速决/,
	/凑合|糊弄|将就|走过场/,
	/不用(?:测试|验证)|跳过(?:测试|验证)/
];

/** 纪律段头部（所有档位共用）。 */
const HEADER = [
	"## Engineering discipline (user-enabled)",
	"",
	"Code quality and coding speed are properties of the workflow, not the mood. Execute this pipeline in order — a gate that has not passed blocks the next phase:"
].join("\n");

/**
 * 流水线正文段落（编号 = 阶段 = 门禁顺序；README 有成因对照表）。
 * 全部模型向、英文（与 DSH 系统提示惯例一致）；彼此独立可自由组合。
 */
const PIPELINE = {
	/** P0 · Q1：无模型先写是不一致之源。 */
	understand: [
		"**0 · Understand before you write.** Read the code you are about to change and its callers first; grep for existing patterns before inventing new ones. Map the blast radius: who calls this, what depends on it, which tests cover it. Never edit code you have not read, and never introduce a convention the codebase already has a different way of doing."
	].join("\n"),
	/** P1 · Q2/S2：规格先行——返工的最大黑洞在开工前就注定了。 */
	spec: [
		"**1 · Specify before you build.** State in ≤3 lines: the requirement, the acceptance criterion (what must be true when done), and the approach. One blocking ambiguity → ask exactly one question; anything resolvable → state the assumption in one line and proceed. Silence is stalling, and a silent wrong guess is a rewrite."
	].join("\n"),
	/** P2 · Q5：最小正确改动——diff 越小，环越短，错越少。 */
	minimal: [
		"**2 · Smallest correct change.** Implement the smallest diff that satisfies the acceptance criterion. Match the file's existing style over your personal taste. YAGNI: no speculative abstraction, no new dependency for what a few lines do, no drive-by rewrites outside the task's blast radius."
	].join("\n"),
	/** P3 · Q3：只修根因——贴膏药让缺陷复利。 */
	rootcause: [
		"**3 · Root cause only.** Fix causes, not symptoms: no blanket try/catch, no retry loops that swallow the error, no stacking special cases, never weaken or delete a test to go green. Debug protocol: read the complete error/trace → form ONE hypothesis → run the cheapest experiment that discriminates it → fix → add the regression guard that would have caught it."
	].join("\n"),
	/** P4 · Q5/S3：由窄到宽——反馈环决定调试速度。 */
	verify: [
		"**4 · Verify narrow to wide.** After each increment, run the narrowest check that can falsify it (targeted test → file → suite → build), and read the FIRST failure to the end before touching code again. One fix per re-run; never batch fixes against a stale failure. Judge by actual output, not exit codes alone — new warnings count as failures."
	].join("\n"),
	/** P5 · Q5：两段式——正确与漂亮不许混在一步。 */
	twophase: [
		"**5 · Make it work, then make it right.** Get correctness first — relevant checks green — then refactor, rename, or optimize in separate green-keeping steps. No premature optimization: every added layer must pay rent in measured need."
	].join("\n"),
	/** P6 · Q4：完成=证据——没有输出的承诺不是完成。 */
	done: [
		"**6 · Done = evidence.** Done means the acceptance criterion is met AND the verification command was actually executed AND its output shows the expected result. Report what changed and why, the exact command(s) run with their real output, and any known residual. \"Should work\" is not an output — quote it."
	].join("\n"),
	/** 速度经济学（S1/S4）：快来自顺序，不来自省步骤。 */
	speed: [
		"**Speed economics.** Speed comes from ordering, not omission: one read beats three guesses; grep and reads are cheap, rebuilds and blind retries are expensive; plan once and execute linearly — never re-derive a decision already made; batch independent reads; know what result you expect before running a command; after two failed attempts on one hypothesis, change the hypothesis, not the parameters. Omitting a gate is the slowest path — rework dominates every other time cost."
	].join("\n")
};

/** 流水线核心序列（所有档位共用：门禁本身不可关）。 */
const CORE_PIPELINE = ["understand", "spec", "minimal", "rootcause", "verify", "twophase", "done", "speed"];

/** 档位追加段（门禁之上的强度差异）。 */
const MODE_ADDS = {
	quality: [
		"**Quality mode adds.** Review your own diff adversarially before reporting: what breaks at the boundaries — null, empty, unicode, concurrency, version skew? Every bug fix ships with a regression guard. Treat every boundary as a test target and prefer boring proven constructs over clever ones. Run the full relevant suite before done — partial green is partial work."
	].join("\n"),
	speed: [
		"**Speed mode adds.** Timebox exploration: if three searches don't find it, instrument or ask instead of searching more. Ship the smallest shippable slice and stop — log deferred polish as a follow-up list rather than doing it now. Decide between equivalent options immediately; never reopen a settled decision. Stop at the first solution that fully passes its acceptance criterion."
	].join("\n")
};

/** 尾注（恒在）：纪律压不过任务指令、安全与事实。 */
const P_TAIL = [
	"Task-specific instructions, safety rules, and truthfulness outrank this block; where this block and the actual codebase disagree, the codebase wins. This calibrates the engineering workflow — never the facts."
].join("\n");

/**
 * 净化自定义规则（配置层）：非字符串剔除、trim、每条 ≤300 字、至多10条。
 *
 * @param rules - 原始 extraRules。
 * @returns 可安全内嵌的规则文本列表。
 */
function sanitizeRules(rules) {
	if (!Array.isArray(rules)) return [];
	return rules
		.filter((rule) => typeof rule === "string" && rule.trim().length > 0)
		.slice(0, 10)
		.map((rule) => rule.trim().slice(0, 300));
}

/**
 * 按档位组装纪律段正文。
 *
 * @param mode - balanced / quality / speed（未知值回落 balanced）。
 * @param extraRules - 自定义规则（会净化）。
 * @returns 模型向纪律文本。
 */
function buildDiscipline(mode, extraRules) {
	const key = MODES.includes(mode) ? mode : "balanced";
	const blocks = [HEADER];
	for (const id of CORE_PIPELINE) blocks.push(PIPELINE[id]);
	if (MODE_ADDS[key] !== void 0) blocks.push(MODE_ADDS[key]);
	const extras = sanitizeRules(extraRules);
	if (extras.length > 0) {
		blocks.push(["**Team rules.**", ...extras.map((rule) => `- ${rule}`)].join("\n"));
	}
	blocks.push(P_TAIL);
	return blocks.join("\n\n");
}

/**
 * 扫描单段文本的反工程触发词命中数。
 *
 * @param text - 段文本（非字符串返回0，不抛）。
 * @returns 命中数（每 pattern 至多1次）。
 */
function scanTriggers(text) {
	if (typeof text !== "string" || text.length === 0) return 0;
	let hits = 0;
	for (const pattern of TRIGGER_PATTERNS) {
		if (pattern.test(text)) hits += 1;
	}
	return hits;
}

/**
 * 速度校准段正文：把「快」校准为「快 = 一次做对」。
 *
 * @param hits - 触发词命中总数（≥1，由调用方保证）。
 * @returns 模型向校准文本。
 */
function buildCalibration(hits) {
	return [
		"## Speed calibration (code-flow)",
		"",
		`The prompt carries ${hits} speed-over-quality instruction(s). Execute them THROUGH the gates, never around them: in software, first-cycle correctness is the fastest cycle — rework, debugging masked by swallowed errors, and rebuilding broken states dominate every other time cost. Be fast by ordering (cheap evidence first, narrow feedback loops, linear execution of a plan made once), never by omission (unverified changes, silent guesses, untested fixes). A small proven result beats a large claimed one.`
	].join("\n");
}

/**
 * 配置引用活读（0.2.0 volatile 字段）：引用形态返回 `.get()` 的当前活值，
 * 非引用（缺失/畸形/未声明）原样返回，由调用方安全判定。
 *
 * @param value - config 字段（引用或普通值）。
 * @returns 当前活值。
 */
function readField(value) {
	return value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
}

/**
 * 插件主体：页面策略登记 + 纪律段 + 速度校准水龙。
 *
 * @param ctx - cordis 上下文（模块级 inject 声明了 systemPrompt/settings）。
 * @param config - 经 Config 校验的配置（volatile 字段为活引用）。
 * @throws {Error} 配置畸形时启动即失败（配置要响亮地错）。
 */
function apply(ctx, config) {
	const resolved = config;
	if (!Number.isInteger(resolved?.sectionOrder) || resolved.sectionOrder < 1) {
		throw new Error("dsh-code-flow: sectionOrder must be a positive integer");
	}
	if (typeof resolved.sanitize !== "boolean") {
		throw new Error("dsh-code-flow: sanitize must be a boolean");
	}
	if (!Array.isArray(resolved.extraRules) || resolved.extraRules.some((rule) => typeof rule !== "string")) {
		throw new Error("dsh-code-flow: extraRules must be an array of strings");
	}

	/** 自定义行页面策略：本插件自带设置行 → 抑制自动生成的表单面（0.2.0 契约）。 */
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});
	/** enabled 现读（每次提示构建/每次水龙一次；缺失/畸形一律安全回落 false）。 */
	const enabledNow = () => {
		try {
			return readField(resolved?.[ENABLED_FIELD]) === true;
		} catch {
			return false;
		}
	};
	/** mode 现读（未知值回落 balanced 双保险）。 */
	const modeNow = () => {
		try {
			const mode = readField(resolved?.[MODE_FIELD]);
			return MODES.includes(mode) ? mode : "balanced";
		} catch {
			return "balanced";
		}
	};

	// ── 机制1+2：纪律段（构建期现读，改设置下一次回复即生效） ──────────────
	ctx.systemPrompt.section({
		name: SECTION_NAME,
		order: resolved.sectionOrder,
		text: () => {
			if (!enabledNow()) return "";
			return buildDiscipline(modeNow(), resolved.extraRules);
		}
	});

	// ── 机制3：速度校准水龙（只追加，不删不改宿主段） ───────────────────────
	ctx.effect(() => ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
		const assembly = await next();
		if (!resolved.sanitize) return assembly;
		if (!enabledNow()) return assembly;
		const entries = Array.isArray(assembly.sections) ? assembly.sections : [];
		let hits = 0;
		for (const entry of entries) {
			if (entry === null || typeof entry !== "object") continue;
			hits += scanTriggers(entry.text);
		}
		if (hits === 0) return assembly;
		return {
			...assembly,
			sections: [...entries, {
				name: CALIBRATION_SECTION,
				// 各家 order 语义「越大越靠后」；双保险（不重排时它也在数组末尾）。
				order: Number.MAX_SAFE_INTEGER,
				text: buildCalibration(hits)
			}]
		};
	}, { global: true, prepend: true }), "dsh-code-flow: speed calibration");
}

/** Registries this plugin contributes to. */
const inject = ["systemPrompt", "settings"];

export {
	CALIBRATION_SECTION,
	Config,
	ENABLED_FIELD,
	MODES,
	MODE_FIELD,
	SECTION_NAME,
	SETTINGS_NAMESPACE,
	TRIGGER_PATTERNS,
	apply,
	buildCalibration,
	buildDiscipline,
	inject,
	name,
	readField,
	sanitizeRules,
	scanTriggers
};
