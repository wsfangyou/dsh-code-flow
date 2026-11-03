/**
 * dsh-code-flow 浏览器半边（手写发布格式，无构建步骤）：
 * 设置 → 通用 → 「编程纪律（工程流水线）」行。
 *
 * 一个**切换开关**（enabled）+ 展开后的**三档选择**（balanced/quality/speed）。
 * 外观与状态由**渲染结果**驱动（快照 → 属性）——无本地 React state；点击先
 * 本地镜像即时反馈、再 scope.set 持久化，订阅回声收敛。改动立即生效（宿主
 * 纪律段/水龙每次提示构建现读，无需重启）。
 *
 * 文案字典 zh/en 键集必须对齐（smoke 交叉核对）。
 *
 * @module dsh-code-flow/client
 */
window.__ModuleLoader__.load({
	id: "dsh-code-flow",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let jsx_runtime = require("react/jsx-runtime");
		let client_store = require("@deepseek-ai/dsh-client-store");
		const { jsx, jsxs } = jsx_runtime;

		/** 设置页文案字典命名空间（locale 注册 + 槽位描述同一字符串）。 */
		const SETTINGS_NS = "settings.code-flow";
		/** 宿主配置表单入口 id（= cordis.patch.yml 的 id，与宿主 SETTINGS_NAMESPACE 一致）。 */
		const THEME_NS = "code-flow";
		/** 持久化字段：总开关。 */
		const ENABLED_FIELD = "enabled";
		/** 持久化字段：纪律档位。 */
		const MODE_FIELD = "mode";
		/** 三档强度（与宿主一致；顺序即按钮顺序）。 */
		const MODES = ["balanced", "quality", "speed"];

		/** `settings.code-flow` 字典（zh 键集为唯一真源，en 须对齐）。 */
		const zh = {
			"cf.title": "编程纪律（工程流水线）",
			"cf.desc": "质量差与速度慢同源——没有门禁的流水线。开启后注入七段流水线：先读后写、先规格后动工、最小正确改动、只修根因、由窄到宽验证、先跑通再优化、完成=证据，外加速度经济学（快来自顺序，不来自省步骤）；水龙还会扫描「先跑起来就行/别想太多」类反工程指令并校准为「快=一次做对」",
			"cf.on": "已开启",
			"cf.off": "已关闭",
			"cf.mode.balanced": "均衡",
			"cf.mode.quality": "质量",
			"cf.mode.speed": "速度"
		};
		const en = {
			"cf.title": "Engineering discipline (code pipeline)",
			"cf.desc": "Poor quality and slow speed share one root cause — a pipeline without gates. Enables a seven-stage pipeline: read before write, specify before build, smallest correct change, root causes only, verify narrow to wide, make it work then make it right, done = evidence, plus speed economics (speed from ordering, not omission); the waterfall also scans for quick-fix style anti-engineering instructions and calibrates them to fast = right the first time",
			"cf.on": "On",
			"cf.off": "Off",
			"cf.mode.balanced": "Balanced",
			"cf.mode.quality": "Quality",
			"cf.mode.speed": "Speed"
		};

		/** 行样式（纯类名，挂载一次；不含 `</style`）。 */
		const ROW_CSS = [
			".cf-group{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:16px 0;display:flex}",
			".cf-text{flex-direction:column;gap:4px;display:flex}",
			".cf-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
			".cf-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}",
			".cf-switchRow{align-items:center;gap:10px;display:flex}",
			".cf-switch{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:40px;height:22px;border-radius:11px;position:relative;cursor:pointer;padding:0;background:var(--dsw-alias-bg-layer-2);transition:background .15s ease,border-color .15s ease}",
			".cf-switchOn{background:var(--dsw-alias-brand-primary);border-color:transparent}",
			".cf-knob{position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.35)}",
			".cf-switchOn .cf-knob{left:20px}",
			".cf-state{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}",
			".cf-modeRow{display:flex;gap:6px;flex-wrap:wrap}",
			".cf-modeBtn{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);transition:background .15s ease,color .15s ease}",
			".cf-modeOn{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}"
		].join("");

		/** 行样式挂载（防重复；无 document 的运行时直接跳过）。 */
		function installRowStyles() {
			if (typeof document === "undefined") return;
			const tagId = "dsh-code-flow/row.css";
			if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-code-flow";
			tag.dataset.pluginCss = tagId;
			tag.textContent = ROW_CSS;
			document.head.appendChild(tag);
		}

		/**
		 * 快照净化：把任意外部快照收敛为安全镜像（未知档位回落 balanced）。
		 *
		 * @param raw - settings 快照值。
		 * @returns 净化后的镜像。
		 */
		function sanitizeSnapshot(raw) {
			const source = raw !== null && typeof raw === "object" ? raw : {};
			return {
				enabled: source[ENABLED_FIELD] === true,
				mode: MODES.includes(source[MODE_FIELD]) ? source[MODE_FIELD] : "balanced"
			};
		}

		/**
		 * 行 store：镜像宿主快照（enabled+mode），插件的 adopt/setter 是唯一写入方。
		 *
		 * @returns store 句柄（与 dsh-mode-switch/dsh-think-guard 行 store 同构）。
		 */
		function createRowStore() {
			return client_store.defineStore({
				init: () => ({ enabled: false, mode: "balanced", revision: -1 }),
				actions: { sync: (d, enabled, mode, revision) => {
					if (revision <= d.revision) return;
					d.enabled = enabled;
					d.mode = mode;
					d.revision = revision;
				} }
			});
		}

		/**
		 * 编程纪律行：标题 + 说明 + 切换开关 + 状态文案；开启后追加三档按钮。
		 * 全程无本地 state：外观来自渲染（快照 → 属性）。
		 *
		 * @param props - 槽位组合注入的 props（t/setEnabled/setMode/useStore）。
		 * @returns 行元素树。
		 */
		function FlowRow({ t, setEnabled, setMode, useStore }) {
			const enabled = useStore((s) => s.enabled);
			const mode = useStore((s) => s.mode);
			const children = [
				jsxs("div", {
					className: "cf-text",
					children: [
						jsx("div", { className: "cf-title", children: t("cf.title") }),
						jsx("div", { className: "cf-desc", children: t("cf.desc") })
					]
				}),
				jsxs("div", {
					className: "cf-switchRow",
					children: [
						jsx("button", {
							type: "button",
							role: "switch",
							"aria-checked": enabled === true,
							"aria-label": t("cf.title"),
							className: "cf-switch" + (enabled === true ? " cf-switchOn" : ""),
							onClick: () => {
								setEnabled(enabled !== true);
							},
							children: [jsx("span", { className: "cf-knob" })]
						}),
						jsx("span", { className: "cf-state", children: enabled === true ? t("cf.on") : t("cf.off") })
					]
				})
			];
			if (enabled === true) {
				children.push(jsxs("div", {
					className: "cf-modeRow",
					key: "modes",
					children: MODES.map((value) => jsx("button", {
						type: "button",
						"aria-pressed": mode === value,
						className: "cf-modeBtn" + (mode === value ? " cf-modeOn" : ""),
						onClick: () => {
							setMode(value);
						},
						children: t("cf.mode." + value)
					}, value))
				}));
			}
			return jsxs("div", { className: "cf-group", children });
		}

		/** 必需服务：槽位/文案，配置表单（configForms = 0.2.0 设置模型；remote 携带转发的失效通知）。 */
		const inject = ["slots", "locale", "remote", "configForms"];

		/**
		 * 客户端插件主体：挂行样式、绑定配置表单（启动采用 + 订阅实时
		 * 采用）、注册字典与设置行。
		 *
		 * @param ctx - 客户端 cordis 上下文。
		 */
		function apply(ctx) {
			installRowStyles();
			let scope;
			try {
				scope = ctx.configForms.get(THEME_NS);
			} catch (error) {
				console.warn("[dsh-code-flow] config form unavailable:", error);
				return;
			}
			const store = createRowStore();
			let bound;
			let revision = 0;
			let current = { enabled: false, mode: "balanced" };

			const syncStores = () => {
				bound?.sync(current.enabled, current.mode, revision);
			};
			/** 采用持久化快照（不回写；畸形值安全化）。 */
			const adopt = () => {
				let raw;
				try {
					raw = typeof scope.getSnapshot === "function" ? scope.getSnapshot().value : typeof scope.get === "function" ? scope.get() : void 0;
				} catch {
					raw = void 0;
				}
				const next = sanitizeSnapshot(raw);
				if (next.enabled === current.enabled && next.mode === current.mode) return;
				current = next;
				revision += 1;
				syncStores();
			};
			ctx.effect(() => scope.subscribe(() => {
				adopt();
			}), "dsh-code-flow: settings adoption");
			adopt();

			ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), "dsh-code-flow: dictionaries");

			const injected = (actions) => {
				bound = actions;
				syncStores();
				return {
					/** 开关：本地镜像先翻（即时反馈），再持久化；订阅回声收敛。无变化则零写入。 */
					setEnabled: (value) => {
						const next = value === true;
						if (next === current.enabled) return;
						current.enabled = next;
						revision += 1;
						syncStores();
						scope.set(ENABLED_FIELD, next);
					},
					/** 档位：非法值回落 balanced；无变化则零写入。 */
					setMode: (value) => {
						const next = MODES.includes(value) ? value : "balanced";
						if (next === current.mode) return;
						current.mode = next;
						revision += 1;
						syncStores();
						scope.set(MODE_FIELD, next);
					}
				};
			};
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "flow",
				order: 16,
				store,
				locale: SETTINGS_NS,
				inject: injected
			}, FlowRow));
		}

		/** 遍历元素树找带目标 className 的节点（测试与结构内省用）。 */
		function findAll(node, className) {
			const found = [];
			const visit = (current) => {
				if (current === null || typeof current !== "object") return;
				const classValue = current.props?.className;
				if (typeof classValue === "string" && classValue.split(" ").includes(className)) found.push(current);
				const children = current.props?.children;
				if (Array.isArray(children)) children.forEach(visit);
				else visit(children);
			};
			visit(node);
			return found;
		}

		exports.ENABLED_FIELD = ENABLED_FIELD;
		exports.MODES = MODES;
		exports.MODE_FIELD = MODE_FIELD;
		exports.SETTINGS_NS = SETTINGS_NS;
		exports.FlowRow = FlowRow;
		exports.apply = apply;
		exports.findAll = findAll;
		exports.inject = inject;
		exports.sanitizeSnapshot = sanitizeSnapshot;
		return module.exports;
	}
});
