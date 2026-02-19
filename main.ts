import {
	App,
	Editor,
	ItemView,
	MarkdownView,
	Plugin,
	WorkspaceLeaf,
	debounce,
	setIcon,
} from "obsidian";

// ─── Constants ───────────────────────────────────────────────────────────────

const VIEW_TYPE = "highlights-sidebar-view";
const ICON_NAME = "highlighter";

// ─── Types ───────────────────────────────────────────────────────────────────

type ItemType = "highlight" | "comment" | "footnote";

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

		// <mark>highlight</mark> (HTML)
		for (const m of line.matchAll(/<mark>(.*?)<\/mark>/gi)) {
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

// ─── Sidebar View ────────────────────────────────────────────────────────────

class HighlightsSidebarView extends ItemView {
	private plugin: HighlightsSidebarPlugin;

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

		const activeView =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			container.createEl("p", {
				text: "Open a note to see its highlights, comments, and footnotes.",
				cls: "highlights-sidebar-empty",
			});
			return;
		}

		const content = activeView.editor.getValue();
		const items = parseContent(content);

		if (items.length === 0) {
			container.createEl("p", {
				text: "No highlights, comments, or footnotes found.",
				cls: "highlights-sidebar-empty",
			});
			return;
		}

		const groups: Record<ItemType, ParsedItem[]> = {
			highlight: [],
			comment: [],
			footnote: [],
		};

		for (const item of items) {
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
			const groupItems = groups[sec.type];
			if (groupItems.length === 0) continue;

			const section = container.createDiv({
				cls: "highlights-sidebar-section",
			});

			// Collapsible header
			const header = section.createDiv({
				cls: "highlights-sidebar-header",
			});

			const chevron = header.createSpan({
				cls: "highlights-sidebar-chevron is-collapsed",
			});
			setIcon(chevron, "chevron-right");

			const headerIcon = header.createSpan({
				cls: "highlights-sidebar-header-icon",
			});
			setIcon(headerIcon, sec.icon);

			header.createSpan({
				text: `${sec.label} (${groupItems.length})`,
				cls: "highlights-sidebar-header-text",
			});

			const listContainer = section.createDiv({
				cls: "highlights-sidebar-list",
			});

			// Start expanded
			let collapsed = false;
			listContainer.style.display = "block";
			chevron.removeClass("is-collapsed");

			header.addEventListener("click", () => {
				collapsed = !collapsed;
				listContainer.style.display = collapsed ? "none" : "block";
				chevron.empty();
				setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
				if (collapsed) {
					chevron.addClass("is-collapsed");
				} else {
					chevron.removeClass("is-collapsed");
				}
			});

			for (const item of groupItems) {
				const row = listContainer.createDiv({
					cls: `highlights-sidebar-item highlights-sidebar-item--${item.type}`,
				});

				row.createSpan({
					text: item.text,
					cls: "highlights-sidebar-item-text",
				});

				row.createSpan({
					text: `L${item.line + 1}`,
					cls: "highlights-sidebar-item-line",
				});

				row.addEventListener("click", () => {
					this.scrollToItem(item);
				});
			}
		}
	}

	// ── Scroll-to-source ───────────────────────────────────────────────────

	private scrollToItem(item: ParsedItem): void {
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
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default class HighlightsSidebarPlugin extends Plugin {
	private debouncedRefresh = debounce(
		() => this.refreshView(),
		300,
		true
	);

	async onload(): Promise<void> {
		// Register the custom view
		this.registerView(VIEW_TYPE, (leaf) => {
			return new HighlightsSidebarView(leaf, this);
		});

		// Ribbon icon
		this.addRibbonIcon(ICON_NAME, "Toggle Highlights Sidebar", () => {
			this.toggleView();
		});

		// Command palette entry
		this.addCommand({
			id: "toggle-highlights-sidebar",
			name: "Toggle Highlights & Comments Sidebar",
			callback: () => this.toggleView(),
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

	// ── Helpers ────────────────────────────────────────────────────────────

	private async toggleView(): Promise<void> {
		const existing =
			this.app.workspace.getLeavesOfType(VIEW_TYPE);

		if (existing.length > 0) {
			// Close it
			existing.forEach((leaf) => leaf.detach());
		} else {
			// Open in right sidebar
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

	private refreshView(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof HighlightsSidebarView) {
				view.renderContent();
			}
		}
	}
}
