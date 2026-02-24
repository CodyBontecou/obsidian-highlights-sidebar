import {
	App,
	Editor,
	ItemView,
	MarkdownView,
	Menu,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	debounce,
	setIcon,
} from "obsidian";

// ─── Constants ───────────────────────────────────────────────────────────────

const VIEW_TYPE = "highlights-sidebar-view";
const ICON_NAME = "highlighter";

// ─── Types ───────────────────────────────────────────────────────────────────

type ItemType = "highlight" | "comment" | "footnote";
type SortOrder = "line-asc" | "line-desc" | "a-z" | "z-a";

interface ParsedItem {
	type: ItemType;
	text: string;
	/** 0-based line number in the source */
	line: number;
	/** character offset within the line */
	ch: number;
	/** length of the *full* match (including delimiters) so we can select it */
	matchLength: number;
}

interface HighlightsSidebarSettings {
	fontSize: number;
	showHighlights: boolean;
	showComments: boolean;
	showFootnotes: boolean;
	defaultSort: SortOrder;
	sectionsCollapsed: Record<ItemType, boolean>;
	sectionSorts: Record<ItemType, SortOrder>;
}

const DEFAULT_SETTINGS: HighlightsSidebarSettings = {
	fontSize: 13,
	showHighlights: true,
	showComments: true,
	showFootnotes: true,
	defaultSort: "line-asc",
	sectionsCollapsed: {
		highlight: false,
		comment: false,
		footnote: false,
	},
	sectionSorts: {
		highlight: "line-asc",
		comment: "line-asc",
		footnote: "line-asc",
	},
};

const SORT_LABELS: Record<SortOrder, string> = {
	"line-asc": "Line ↑ (top → bottom)",
	"line-desc": "Line ↓ (bottom → top)",
	"a-z": "Alphabetical (A → Z)",
	"z-a": "Alphabetical (Z → A)",
};

const SORT_CYCLE: SortOrder[] = ["line-asc", "line-desc", "a-z", "z-a"];

// ─── Parser ──────────────────────────────────────────────────────────────────

function parseContent(content: string): ParsedItem[] {
	const items: ParsedItem[] = [];
	const lines = content.split("\n");

	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const line = lines[lineIdx];

		// ==highlight== (Obsidian native)
		for (const m of line.matchAll(/==(.*?)==/g)) {
			items.push({
				type: "highlight",
				text: m[1],
				line: lineIdx,
				ch: m.index!,
				matchLength: m[0].length,
			});
		}

		// <mark>highlight</mark> (HTML, with optional style/class attributes)
		for (const m of line.matchAll(/<mark[^>]*>(.*?)<\/mark>/gi)) {
			items.push({
				type: "highlight",
				text: m[1],
				line: lineIdx,
				ch: m.index!,
				matchLength: m[0].length,
			});
		}

		// %%comment%% (Obsidian native – single-line only here)
		for (const m of line.matchAll(/%%(.*?)%%/g)) {
			items.push({
				type: "comment",
				text: m[1].trim(),
				line: lineIdx,
				ch: m.index!,
				matchLength: m[0].length,
			});
		}

		// <!-- HTML comment --> (single-line)
		for (const m of line.matchAll(/<!--(.*?)-->/g)) {
			items.push({
				type: "comment",
				text: m[1].trim(),
				line: lineIdx,
				ch: m.index!,
				matchLength: m[0].length,
			});
		}

		// [^footnoteId]: definition line
		for (const m of line.matchAll(/\[\^([^\]]+)\]:\s*(.*)/g)) {
			items.push({
				type: "footnote",
				text: `[^${m[1]}]: ${m[2]}`,
				line: lineIdx,
				ch: m.index!,
				matchLength: m[0].length,
			});
		}
	}

	return items;
}

// ─── Sort helper ─────────────────────────────────────────────────────────────

function sortItems(items: ParsedItem[], order: SortOrder): ParsedItem[] {
	const sorted = [...items];
	switch (order) {
		case "line-asc":
			return sorted.sort((a, b) => a.line - b.line || a.ch - b.ch);
		case "line-desc":
			return sorted.sort((a, b) => b.line - a.line || b.ch - a.ch);
		case "a-z":
			return sorted.sort((a, b) =>
				a.text.localeCompare(b.text, undefined, {
					sensitivity: "base",
				})
			);
		case "z-a":
			return sorted.sort((a, b) =>
				b.text.localeCompare(a.text, undefined, {
					sensitivity: "base",
				})
			);
		default:
			return sorted;
	}
}

// ─── Sidebar View ────────────────────────────────────────────────────────────

interface CachedNote {
	path: string;
	content: string;
	displayName: string;
}

class HighlightsSidebarView extends ItemView {
	private plugin: HighlightsSidebarPlugin;
	private searchQuery: string = "";
	private cachedNote: CachedNote | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: HighlightsSidebarPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Highlights & Comments";
	}

	getIcon(): string {
		return ICON_NAME;
	}

	async onOpen(): Promise<void> {
		this.renderContent();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	// ── Rendering ──────────────────────────────────────────────────────────

	renderContent(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("highlights-sidebar");

		// Apply font-size from settings
		container.style.fontSize = `${this.plugin.settings.fontSize}px`;

		const activeView =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		
		let content: string;
		let notePath: string;
		let displayName: string;

		if (activeView && activeView.file) {
			// Update cache with current active note
			content = activeView.editor.getValue();
			notePath = activeView.file.path;
			displayName = activeView.file.basename;
			this.cachedNote = { path: notePath, content, displayName };
		} else if (this.cachedNote) {
			// Use cached note when no markdown view is active
			content = this.cachedNote.content;
			notePath = this.cachedNote.path;
			displayName = this.cachedNote.displayName;
		} else {
			// No active view and no cache
			container.createEl("p", {
				text: "Open a note to see its highlights, comments, and footnotes.",
				cls: "highlights-sidebar-empty",
			});
			return;
		}

		const allItems = parseContent(content);

		// ── Note title header ──────────────────────────────────────────────
		const noteHeader = container.createDiv({
			cls: "highlights-sidebar-note-header",
		});
		noteHeader.createSpan({
			text: displayName,
			cls: "highlights-sidebar-note-title",
		});
		// Show indicator if viewing cached (non-active) note
		if (!activeView || !activeView.file || activeView.file.path !== notePath) {
			noteHeader.createSpan({
				text: "(not focused)",
				cls: "highlights-sidebar-note-status",
			});
		}

		// Export button
		if (allItems.length > 0) {
			const exportBtn = noteHeader.createSpan({
				cls: "highlights-sidebar-export-btn",
				attr: {
					"aria-label": "Export annotations to markdown",
					title: "Export annotations to markdown",
				},
			});
			setIcon(exportBtn, "file-output");
			exportBtn.addEventListener("click", () => {
				this.exportAnnotations(displayName, notePath, allItems);
			});
		}

		// ── Search bar ─────────────────────────────────────────────────────
		const searchContainer = container.createDiv({
			cls: "highlights-sidebar-search",
		});

		const searchIcon = searchContainer.createSpan({
			cls: "highlights-sidebar-search-icon",
		});
		setIcon(searchIcon, "search");

		const searchInput = searchContainer.createEl("input", {
			cls: "highlights-sidebar-search-input",
			attr: {
				type: "text",
				placeholder: "Filter items…",
				spellcheck: "false",
			},
		});
		searchInput.value = this.searchQuery;
		searchInput.addEventListener("input", () => {
			this.searchQuery = searchInput.value;
			this.renderSections(sectionsContainer, allItems);
		});

		// Clear button
		if (this.searchQuery.length > 0) {
			const clearBtn = searchContainer.createSpan({
				cls: "highlights-sidebar-search-clear",
			});
			setIcon(clearBtn, "x");
			clearBtn.addEventListener("click", () => {
				this.searchQuery = "";
				searchInput.value = "";
				this.renderSections(sectionsContainer, allItems);
			});
		}

		// ── Section visibility toggle bar ──────────────────────────────────
		const toggleBar = container.createDiv({
			cls: "highlights-sidebar-toggle-bar",
		});

		const sectionMeta: { type: ItemType; label: string; icon: string }[] =
			[
				{ type: "highlight", label: "Highlights", icon: "highlighter" },
				{
					type: "comment",
					label: "Comments",
					icon: "message-square",
				},
				{ type: "footnote", label: "Footnotes", icon: "footnote" },
			];

		for (const sec of sectionMeta) {
			const visible = this.isSectionVisible(sec.type);
			const toggle = toggleBar.createDiv({
				cls: `highlights-sidebar-toggle-btn ${visible ? "is-active" : ""}`,
				attr: {
					"aria-label": `${visible ? "Hide" : "Show"} ${sec.label}`,
					title: `${visible ? "Hide" : "Show"} ${sec.label}`,
				},
			});
			const toggleIconEl = toggle.createSpan({
				cls: "highlights-sidebar-toggle-icon",
			});
			setIcon(toggleIconEl, sec.icon);
			toggle.createSpan({
				text: sec.label,
				cls: "highlights-sidebar-toggle-label",
			});

			toggle.addEventListener("click", () => {
				this.toggleSectionVisibility(sec.type);
				this.renderContent();
			});

			// Right-click for context menu
			toggle.addEventListener("contextmenu", (e: MouseEvent) => {
				e.preventDefault();
				const menu = new Menu();
				for (const s of sectionMeta) {
					const sVisible = this.isSectionVisible(s.type);
					menu.addItem((item) => {
						item.setTitle(
							`${sVisible ? "Hide" : "Show"} ${s.label}`
						);
						item.setIcon(sVisible ? "eye-off" : "eye");
						item.onClick(() => {
							this.toggleSectionVisibility(s.type);
							this.renderContent();
						});
					});
				}
				menu.addSeparator();
				menu.addItem((item) => {
					item.setTitle("Show all sections");
					item.setIcon("eye");
					item.onClick(() => {
						this.plugin.settings.showHighlights = true;
						this.plugin.settings.showComments = true;
						this.plugin.settings.showFootnotes = true;
						this.plugin.saveSettings();
						this.renderContent();
					});
				});
				menu.showAtMouseEvent(e);
			});
		}

		// ── Sections container ─────────────────────────────────────────────
		const sectionsContainer = container.createDiv({
			cls: "highlights-sidebar-sections",
		});
		this.renderSections(sectionsContainer, allItems);
	}

	private renderSections(
		container: HTMLElement,
		allItems: ParsedItem[]
	): void {
		container.empty();

		// Filter by search query
		const query = this.searchQuery.toLowerCase().trim();
		const filteredItems =
			query.length > 0
				? allItems.filter((item) =>
						item.text.toLowerCase().includes(query)
					)
				: allItems;

		if (
			filteredItems.length === 0 &&
			allItems.length === 0
		) {
			container.createEl("p", {
				text: "No highlights, comments, or footnotes found.",
				cls: "highlights-sidebar-empty",
			});
			return;
		}

		if (filteredItems.length === 0 && query.length > 0) {
			container.createEl("p", {
				text: "No matching items.",
				cls: "highlights-sidebar-empty",
			});
			return;
		}

		const groups: Record<ItemType, ParsedItem[]> = {
			highlight: [],
			comment: [],
			footnote: [],
		};

		for (const item of filteredItems) {
			groups[item.type].push(item);
		}

		const sectionMeta: { type: ItemType; label: string; icon: string }[] =
			[
				{ type: "highlight", label: "Highlights", icon: "highlighter" },
				{
					type: "comment",
					label: "Comments",
					icon: "message-square",
				},
				{ type: "footnote", label: "Footnotes", icon: "footnote" },
			];

		for (const sec of sectionMeta) {
			if (!this.isSectionVisible(sec.type)) continue;

			const groupItems = groups[sec.type];
			if (groupItems.length === 0) continue;

			// Apply sort
			const sortOrder =
				this.plugin.settings.sectionSorts[sec.type] ||
				this.plugin.settings.defaultSort;
			const sortedItems = sortItems(groupItems, sortOrder);

			const section = container.createDiv({
				cls: "highlights-sidebar-section",
			});

			// Collapsible header
			const header = section.createDiv({
				cls: "highlights-sidebar-header",
			});

			const collapsed =
				this.plugin.settings.sectionsCollapsed[sec.type] ?? false;

			const chevron = header.createSpan({
				cls: `highlights-sidebar-chevron ${collapsed ? "is-collapsed" : ""}`,
			});
			setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");

			const headerIcon = header.createSpan({
				cls: "highlights-sidebar-header-icon",
			});
			setIcon(headerIcon, sec.icon);

			header.createSpan({
				text: `${sec.label} (${groupItems.length})`,
				cls: "highlights-sidebar-header-text",
			});

			// Sort button
			const sortBtn = header.createSpan({
				cls: "highlights-sidebar-sort-btn",
				attr: {
					"aria-label": `Sort: ${SORT_LABELS[sortOrder]}`,
					title: `Sort: ${SORT_LABELS[sortOrder]}`,
				},
			});
			setIcon(sortBtn, this.getSortIcon(sortOrder));
			sortBtn.addEventListener("click", (e: MouseEvent) => {
				e.stopPropagation();
				this.showSortMenu(e, sec.type);
			});

			const listContainer = section.createDiv({
				cls: "highlights-sidebar-list",
			});
			listContainer.style.display = collapsed ? "none" : "block";

			header.addEventListener("click", () => {
				const isNowCollapsed =
					!this.plugin.settings.sectionsCollapsed[sec.type];
				this.plugin.settings.sectionsCollapsed[sec.type] =
					isNowCollapsed;
				this.plugin.saveSettings();

				listContainer.style.display = isNowCollapsed
					? "none"
					: "block";
				chevron.empty();
				setIcon(
					chevron,
					isNowCollapsed ? "chevron-right" : "chevron-down"
				);
				if (isNowCollapsed) {
					chevron.addClass("is-collapsed");
				} else {
					chevron.removeClass("is-collapsed");
				}
			});

			// Right-click header for context menu
			header.addEventListener("contextmenu", (e: MouseEvent) => {
				e.preventDefault();
				const menu = new Menu();

				// Sort options (flat)
				for (const order of SORT_CYCLE) {
					menu.addItem((menuItem) => {
						menuItem.setTitle(SORT_LABELS[order]);
						if (order === sortOrder) {
							menuItem.setIcon("check");
						}
						menuItem.onClick(() => {
							this.plugin.settings.sectionSorts[sec.type] =
								order;
							this.plugin.saveSettings();
							this.renderContent();
						});
					});
				}

				menu.addSeparator();

				// Hide this section
				menu.addItem((menuItem) => {
					menuItem.setTitle(`Hide ${sec.label}`);
					menuItem.setIcon("eye-off");
					menuItem.onClick(() => {
						this.toggleSectionVisibility(sec.type);
						this.renderContent();
					});
				});

				menu.showAtMouseEvent(e);
			});

			for (const item of sortedItems) {
				const row = listContainer.createDiv({
					cls: `highlights-sidebar-item highlights-sidebar-item--${item.type}`,
				});

				// Line number on the LEFT
				row.createSpan({
					text: `${item.line + 1}`,
					cls: "highlights-sidebar-item-line",
				});

				row.createSpan({
					text: item.text,
					cls: "highlights-sidebar-item-text",
				});

				row.addEventListener("click", () => {
					this.scrollToItem(item);
				});
			}
		}
	}

	// ── Sort menu ──────────────────────────────────────────────────────────

	private showSortMenu(e: MouseEvent, sectionType: ItemType): void {
		const currentSort =
			this.plugin.settings.sectionSorts[sectionType] ||
			this.plugin.settings.defaultSort;
		const menu = new Menu();

		for (const order of SORT_CYCLE) {
			menu.addItem((item) => {
				item.setTitle(SORT_LABELS[order]);
				if (order === currentSort) {
					item.setIcon("check");
				}
				item.onClick(() => {
					this.plugin.settings.sectionSorts[sectionType] = order;
					this.plugin.saveSettings();
					this.renderContent();
				});
			});
		}

		menu.showAtMouseEvent(e);
	}

	private getSortIcon(order: SortOrder): string {
		switch (order) {
			case "a-z":
				return "sort-asc";
			case "z-a":
				return "sort-desc";
			case "line-asc":
				return "arrow-down-narrow-wide";
			case "line-desc":
				return "arrow-up-narrow-wide";
			default:
				return "arrow-up-down";
		}
	}

	// ── Section visibility ─────────────────────────────────────────────────

	private isSectionVisible(type: ItemType): boolean {
		switch (type) {
			case "highlight":
				return this.plugin.settings.showHighlights;
			case "comment":
				return this.plugin.settings.showComments;
			case "footnote":
				return this.plugin.settings.showFootnotes;
		}
	}

	private toggleSectionVisibility(type: ItemType): void {
		switch (type) {
			case "highlight":
				this.plugin.settings.showHighlights =
					!this.plugin.settings.showHighlights;
				break;
			case "comment":
				this.plugin.settings.showComments =
					!this.plugin.settings.showComments;
				break;
			case "footnote":
				this.plugin.settings.showFootnotes =
					!this.plugin.settings.showFootnotes;
				break;
		}
		this.plugin.saveSettings();
	}

	// ── Scroll-to-source ───────────────────────────────────────────────────

	private async scrollToItem(item: ParsedItem): Promise<void> {
		// First, ensure the correct file is open
		if (this.cachedNote) {
			const file = this.app.vault.getAbstractFileByPath(this.cachedNote.path);
			if (file instanceof TFile) {
				// Open the file in the most recent leaf (don't create new tab)
				await this.app.workspace.getLeaf(false).openFile(file);
			}
		}

		const activeView =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		const editor: Editor = activeView.editor;

		// Reveal the target line
		editor.setCursor({ line: item.line, ch: item.ch });
		editor.scrollIntoView(
			{
				from: { line: item.line, ch: item.ch },
				to: { line: item.line, ch: item.ch + item.matchLength },
			},
			true
		);

		// Select the match so it's visually obvious
		editor.setSelection(
			{ line: item.line, ch: item.ch },
			{ line: item.line, ch: item.ch + item.matchLength }
		);

		// Make sure the editor pane is focused
		activeView.editor.focus();
	}

	// ── Export annotations ─────────────────────────────────────────────────

	private async exportAnnotations(
		displayName: string,
		notePath: string,
		items: ParsedItem[]
	): Promise<void> {
		const { vault } = this.app;

		// Group items by type
		const groups: Record<ItemType, ParsedItem[]> = {
			highlight: [],
			comment: [],
			footnote: [],
		};
		for (const item of items) {
			groups[item.type].push(item);
		}

		// Generate markdown content
		const lines: string[] = [];
		lines.push(`# Annotations from [[${displayName}]]`);
		lines.push("");
		lines.push(`> Exported on ${new Date().toLocaleString()}`);
		lines.push("");

		const sourceLink = `[[${displayName}]]`;

		// Highlights
		if (groups.highlight.length > 0) {
			lines.push("## Highlights");
			lines.push("");
			for (const item of sortItems(groups.highlight, "line-asc")) {
				lines.push(`- ==${item.text}== *(line ${item.line + 1})*`);
			}
			lines.push("");
		}

		// Comments
		if (groups.comment.length > 0) {
			lines.push("## Comments");
			lines.push("");
			for (const item of sortItems(groups.comment, "line-asc")) {
				lines.push(`- ${item.text} *(line ${item.line + 1})*`);
			}
			lines.push("");
		}

		// Footnotes
		if (groups.footnote.length > 0) {
			lines.push("## Footnotes");
			lines.push("");
			for (const item of sortItems(groups.footnote, "line-asc")) {
				lines.push(`- ${item.text} *(line ${item.line + 1})*`);
			}
			lines.push("");
		}

		lines.push("---");
		lines.push(`*Source: ${sourceLink}*`);

		const content = lines.join("\n");

		// Determine export file path (same folder as source, with " - Annotations" suffix)
		const sourceFile = vault.getAbstractFileByPath(notePath);
		let exportPath: string;
		if (sourceFile instanceof TFile) {
			const folder = sourceFile.parent?.path || "";
			const baseName = `${displayName} - Annotations`;
			exportPath = folder ? `${folder}/${baseName}.md` : `${baseName}.md`;
		} else {
			exportPath = `${displayName} - Annotations.md`;
		}

		// Check if file exists and handle conflict
		const existingFile = vault.getAbstractFileByPath(exportPath);
		if (existingFile instanceof TFile) {
			// Overwrite existing file
			await vault.modify(existingFile, content);
		} else {
			// Create new file
			await vault.create(exportPath, content);
		}

		// Open the exported file
		const exportedFile = vault.getAbstractFileByPath(exportPath);
		if (exportedFile instanceof TFile) {
			await this.app.workspace.getLeaf("tab").openFile(exportedFile);
		}
	}
}

// ─── Settings Tab ────────────────────────────────────────────────────────────

class HighlightsSidebarSettingTab extends PluginSettingTab {
	plugin: HighlightsSidebarPlugin;

	constructor(app: App, plugin: HighlightsSidebarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Highlights & Comments Sidebar" });

		// ── Font size ──────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Font size")
			.setDesc("Font size for the sidebar content (in pixels).")
			.addSlider((slider) =>
				slider
					.setLimits(10, 24, 1)
					.setValue(this.plugin.settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.fontSize = value;
						await this.plugin.saveSettings();
						this.plugin.refreshView();
					})
			);

		// ── Default sort ───────────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Default sort order")
			.setDesc("The default sort order for all sections.")
			.addDropdown((dropdown) => {
				for (const order of SORT_CYCLE) {
					dropdown.addOption(order, SORT_LABELS[order]);
				}
				dropdown.setValue(this.plugin.settings.defaultSort);
				dropdown.onChange(async (value) => {
					const newSort = value as SortOrder;
					this.plugin.settings.defaultSort = newSort;
					// Also reset all per-section sorts to the new default
					this.plugin.settings.sectionSorts.highlight = newSort;
					this.plugin.settings.sectionSorts.comment = newSort;
					this.plugin.settings.sectionSorts.footnote = newSort;
					await this.plugin.saveSettings();
					this.plugin.refreshView();
				});
			});

		// ── Section visibility ──────────────────────────────────────────────
		containerEl.createEl("h3", { text: "Section visibility" });
		containerEl.createEl("p", {
			text: "Choose which sections are shown by default. You can also toggle these from the sidebar.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Show Highlights")
			.setDesc("Show ==highlights== and <mark>highlights</mark>.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showHighlights)
					.onChange(async (value) => {
						this.plugin.settings.showHighlights = value;
						await this.plugin.saveSettings();
						this.plugin.refreshView();
					})
			);

		new Setting(containerEl)
			.setName("Show Comments")
			.setDesc("Show %%comments%% and <!-- HTML comments -->.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showComments)
					.onChange(async (value) => {
						this.plugin.settings.showComments = value;
						await this.plugin.saveSettings();
						this.plugin.refreshView();
					})
			);

		new Setting(containerEl)
			.setName("Show Footnotes")
			.setDesc("Show [^footnote]: definitions.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showFootnotes)
					.onChange(async (value) => {
						this.plugin.settings.showFootnotes = value;
						await this.plugin.saveSettings();
						this.plugin.refreshView();
					})
			);
	}
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default class HighlightsSidebarPlugin extends Plugin {
	settings: HighlightsSidebarSettings = DEFAULT_SETTINGS;

	private debouncedRefresh = debounce(
		() => this.refreshView(),
		300,
		true
	);

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the custom view
		this.registerView(VIEW_TYPE, (leaf) => {
			return new HighlightsSidebarView(leaf, this);
		});

		// Settings tab
		this.addSettingTab(new HighlightsSidebarSettingTab(this.app, this));

		// Ribbon icon
		this.addRibbonIcon(ICON_NAME, "Toggle Highlights Sidebar", () => {
			this.toggleView();
		});

		// Command palette entries
		this.addCommand({
			id: "toggle-highlights-sidebar",
			name: "Toggle Highlights & Comments Sidebar",
			callback: () => this.toggleView(),
		});

		this.addCommand({
			id: "increase-sidebar-font-size",
			name: "Increase sidebar font size",
			callback: async () => {
				this.settings.fontSize = Math.min(
					24,
					this.settings.fontSize + 1
				);
				await this.saveSettings();
				this.refreshView();
			},
		});

		this.addCommand({
			id: "decrease-sidebar-font-size",
			name: "Decrease sidebar font size",
			callback: async () => {
				this.settings.fontSize = Math.max(
					10,
					this.settings.fontSize - 1
				);
				await this.saveSettings();
				this.refreshView();
			},
		});

		// Auto-refresh when the active leaf changes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.debouncedRefresh();
			})
		);

		// Auto-refresh on editor changes (debounced)
		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.debouncedRefresh();
			})
		);
	}

	async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	// ── Settings ───────────────────────────────────────────────────────────

	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		// Deep merge nested objects
		this.settings.sectionsCollapsed = Object.assign(
			{},
			DEFAULT_SETTINGS.sectionsCollapsed,
			data?.sectionsCollapsed
		);
		this.settings.sectionSorts = Object.assign(
			{},
			DEFAULT_SETTINGS.sectionSorts,
			data?.sectionSorts
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	private async toggleView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);

		if (existing.length > 0) {
			existing.forEach((leaf) => leaf.detach());
		} else {
			await this.activateView();
		}
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	refreshView(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof HighlightsSidebarView) {
				view.renderContent();
			}
		}
	}
}
