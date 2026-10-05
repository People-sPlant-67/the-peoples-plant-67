/**
 * The dictator painter: an MS Paint for the inside of the portrait frame, 20 × 26 pixels, in
 * the plant's palette only. Pencil, bucket fill, pick a colour, mirror (paint both halves at
 * once), undo and clear, and "start from" any archetype.
 *
 * The keyboard works too: arrow keys move a cursor over the canvas, Space or Enter applies the
 * tool there.
 */
import { ARCHETYPES, PORTRAIT_BG, PORTRAIT_H, PORTRAIT_PALETTE, PORTRAIT_W, type Portrait, blankPortrait, copyPortrait } from '../art/archetypes';
import { el, opt } from './dom';

/** Screen pixels per portrait pixel on the canvas. */
export const CELL = 14;
/** Undo steps kept. */
export const UNDO_MAX = 40;

export type Tool = 'pencil' | 'bucket' | 'pick';

/**
 * Fill the patch of one colour around (x, y) with another, four-way.
 *
 * @param g Portrait, changed in place.
 * @param x Column.
 * @param y Row.
 * @param colour New colour.
 * @returns Whether anything changed.
 */
export function floodFill(g: Portrait, x: number, y: number, colour: string): boolean {
	if (x < 0 || y < 0 || x >= PORTRAIT_W || y >= PORTRAIT_H) return false;
	const from = g[y][x];
	if (from === colour) return false;
	const stack: [number, number][] = [[x, y]];
	while (stack.length) {
		const [a, b] = stack.pop()!;
		if (a < 0 || b < 0 || a >= PORTRAIT_W || b >= PORTRAIT_H || g[b][a] !== from) continue;
		g[b][a] = colour;
		stack.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
	}
	return true;
}

/**
 * The column mirrored across the portrait's centre line.
 *
 * @param x Column.
 * @returns Mirrored column.
 */
export const mirrorX = (x: number): number => PORTRAIT_W - 1 - x;

/**
 * Apply a tool at one pixel.
 *
 * @param g Portrait, changed in place.
 * @param tool Pencil or bucket.
 * @param x Column.
 * @param y Row.
 * @param colour Colour.
 * @param mirror Do the same on the other half.
 */
export function applyTool(g: Portrait, tool: 'pencil' | 'bucket', x: number, y: number, colour: string, mirror: boolean): void {
	if (x < 0 || y < 0 || x >= PORTRAIT_W || y >= PORTRAIT_H) return;
	if (tool === 'bucket') {
		floodFill(g, x, y, colour);
		if (mirror) floodFill(g, mirrorX(x), y, colour);
		return;
	}
	g[y][x] = colour;
	if (mirror) g[y][mirrorX(x)] = colour;
}

export interface PainterDeps {
	/** The portrait being painted. */
	get(): Portrait;
	/** Store a changed portrait (the painter hands over a copy it no longer touches). */
	set(p: Portrait): void;
}

export interface Painter {
	el: HTMLElement;
	/** Redraw from get(), after the portrait was changed elsewhere (an archetype, a photo). */
	redraw(): void;
}

/**
 * Build the painter.
 *
 * @param d Dependencies.
 * @returns Painter.
 */
export function createPainter(d: PainterDeps): Painter {
	let tool: Tool = 'pencil';
	let colour = '#3a2e26';
	let mirror = true;
	const undo: Portrait[] = [];
	/** Keyboard cursor, shown while the canvas has focus. */
	let cur = { x: Math.floor(PORTRAIT_W / 2), y: Math.floor(PORTRAIT_H / 2) };
	let focused = false;

	const box = el('div', 'p67-painter');
	const frame = el('div', 'p67-paint-frame');
	const canvas = el('canvas', 'p67-paint');
	canvas.width = PORTRAIT_W * CELL;
	canvas.height = PORTRAIT_H * CELL;
	canvas.tabIndex = 0;
	canvas.setAttribute('role', 'img');
	canvas.setAttribute('aria-label', 'Paint canvas, 20 by 26 pixels. Arrow keys move the cursor; Space paints.');
	frame.append(canvas);
	const side = el('div', 'p67-paint-side');
	const tools = el('div', 'p67-paint-tools');
	const toolButtons = new Map<Tool, HTMLButtonElement>();
	for (const [t, label] of [['pencil', '✎ Pencil'], ['bucket', 'Bucket fill'], ['pick', 'Pick colour']] as [Tool, string][]) {
		const b = el('button', 'p67-paint-tool', label);
		b.type = 'button';
		b.addEventListener('click', () => { tool = t; paintControls(); });
		toolButtons.set(t, b);
		tools.append(b);
	}
	const mirrorBtn = el('button', 'p67-paint-tool', '⇋ Mirror');
	mirrorBtn.type = 'button';
	mirrorBtn.title = 'Paint both halves at once';
	mirrorBtn.addEventListener('click', () => { mirror = !mirror; paintControls(); draw(); });
	const undoBtn = el('button', 'p67-paint-tool', '↶ Undo');
	undoBtn.type = 'button';
	undoBtn.addEventListener('click', () => { const p = undo.pop(); if (p) { d.set(p); draw(); paintControls(); } });
	const clearBtn = el('button', 'p67-paint-tool', 'Clear');
	clearBtn.type = 'button';
	clearBtn.addEventListener('click', () => change((g) => { for (const row of g) row.fill(PORTRAIT_BG); }));
	tools.append(mirrorBtn, undoBtn, clearBtn);

	const swatches = el('div', 'p67-swatches');
	swatches.setAttribute('role', 'radiogroup');
	swatches.setAttribute('aria-label', 'Colour');
	const swatchButtons = new Map<string, HTMLButtonElement>();
	for (const c of PORTRAIT_PALETTE) {
		const b = el('button', 'p67-swatch');
		b.type = 'button';
		b.style.background = c;
		b.title = c;
		b.setAttribute('role', 'radio');
		b.setAttribute('aria-label', `Colour ${c}`);
		b.addEventListener('click', () => { colour = c; if (tool === 'pick') tool = 'pencil'; paintControls(); });
		swatchButtons.set(c, b);
		swatches.append(b);
	}

	const startField = el('label', 'p67-wiz-field');
	startField.append(el('span', '', 'Start from'));
	const start = el('select');
	start.append(opt('Keep what is on the canvas', ''));
	for (const a of ARCHETYPES) start.append(opt(a.name, a.id));
	start.append(opt('A blank canvas', 'blank'));
	start.addEventListener('change', () => {
		const v = start.value;
		start.value = '';
		if (!v) return;
		const a = ARCHETYPES.find((x) => x.id === v);
		change((g) => { const src = a ? a.pixels : blankPortrait(); g.forEach((row, y) => row.splice(0, PORTRAIT_W, ...src[y])); });
	});
	startField.append(start);
	side.append(tools, swatches, startField, el('p', 'p67-wiz-note', '20 × 26 pixels: the inside of the gold frame on the wall. Alt-click picks a colour.'));
	box.append(frame, side);

	/**
	 * Change the portrait, keeping the old one for undo.
	 *
	 * @param fn Edits a working copy in place.
	 */
	function change(fn: (g: Portrait) => void): void {
		const before = d.get();
		const g = copyPortrait(before);
		fn(g);
		if (g.every((row, y) => row.every((c, x) => c === before[y][x]))) return;
		undo.push(copyPortrait(before));
		if (undo.length > UNDO_MAX) undo.shift();
		d.set(g);
		draw();
		paintControls();
	}

	/** Show which tool, colour and mirror are on. */
	function paintControls(): void {
		for (const [t, b] of toolButtons) b.setAttribute('aria-pressed', String(t === tool));
		mirrorBtn.setAttribute('aria-pressed', String(mirror));
		undoBtn.disabled = undo.length === 0;
		for (const [c, b] of swatchButtons) b.setAttribute('aria-checked', String(c === colour));
		canvas.style.cursor = tool === 'pick' ? 'copy' : 'crosshair';
	}

	/** Paint the canvas: pixels, a faint grid, the mirror line, and the keyboard cursor. */
	function draw(): void {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const g = d.get();
		for (let y = 0; y < PORTRAIT_H; y++) for (let x = 0; x < PORTRAIT_W; x++) { ctx.fillStyle = g[y][x]; ctx.fillRect(x * CELL, y * CELL, CELL, CELL); }
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let x = 1; x < PORTRAIT_W; x++) { ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, PORTRAIT_H * CELL); }
		for (let y = 1; y < PORTRAIT_H; y++) { ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(PORTRAIT_W * CELL, y * CELL + 0.5); }
		ctx.stroke();
		if (mirror) {
			ctx.strokeStyle = 'rgba(230, 185, 46, 0.5)';
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			ctx.moveTo((PORTRAIT_W / 2) * CELL, 0);
			ctx.lineTo((PORTRAIT_W / 2) * CELL, PORTRAIT_H * CELL);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		if (focused) {
			ctx.strokeStyle = '#f4d58a';
			ctx.lineWidth = 2;
			ctx.strokeRect(cur.x * CELL + 1, cur.y * CELL + 1, CELL - 2, CELL - 2);
		}
	}

	/**
	 * The portrait pixel under a pointer.
	 *
	 * @param e Pointer event.
	 * @returns Column and row.
	 */
	const cellAt = (e: PointerEvent): { x: number; y: number } => {
		const r = canvas.getBoundingClientRect();
		return {
			x: Math.min(PORTRAIT_W - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * PORTRAIT_W))),
			y: Math.min(PORTRAIT_H - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * PORTRAIT_H))),
		};
	};

	/**
	 * Use the current tool at a pixel.
	 *
	 * @param x Column.
	 * @param y Row.
	 * @param pick Pick the colour whatever the tool (Alt-click).
	 */
	function use(x: number, y: number, pick: boolean): void {
		if (pick || tool === 'pick') {
			const c = d.get()[y][x];
			if (PORTRAIT_PALETTE.includes(c)) colour = c;
			tool = 'pencil';
			paintControls();
			return;
		}
		const t = tool;
		change((g) => applyTool(g, t, x, y, colour, mirror));
	}

	// A pencil stroke is one undo step: the picture before it is kept when the stroke starts, and
	// becomes an undo step when the stroke ends, if the stroke changed anything at all.
	let stroke: Portrait | null = null;
	/**
	 * Paint one pixel of the stroke, storing the picture only when a pixel really changed.
	 *
	 * @param x Column.
	 * @param y Row.
	 */
	const paintAt = (x: number, y: number): void => {
		const before = d.get();
		if (before[y][x] === colour && (!mirror || before[y][mirrorX(x)] === colour)) return;
		const g = copyPortrait(before);
		applyTool(g, 'pencil', x, y, colour, mirror);
		d.set(g);
		draw();
	};
	const endStroke = (): void => {
		if (!stroke) return;
		const before = stroke;
		stroke = null;
		const now = d.get();
		if (now.some((row, y) => row.some((c, x) => c !== before[y][x]))) {
			undo.push(before);
			if (undo.length > UNDO_MAX) undo.shift();
			paintControls();
		}
	};
	canvas.addEventListener('pointerdown', (e) => {
		const { x, y } = cellAt(e);
		cur = { x, y };
		if (e.altKey || tool !== 'pencil') { use(x, y, e.altKey); return; }
		stroke = copyPortrait(d.get());
		canvas.setPointerCapture(e.pointerId);
		paintAt(x, y);
	});
	canvas.addEventListener('pointermove', (e) => {
		if (!stroke) return;
		const { x, y } = cellAt(e);
		paintAt(x, y);
	});
	canvas.addEventListener('pointerup', endStroke);
	canvas.addEventListener('pointercancel', endStroke);
	canvas.addEventListener('lostpointercapture', endStroke);
	canvas.addEventListener('focus', () => { focused = true; draw(); });
	canvas.addEventListener('blur', () => { focused = false; draw(); });
	canvas.addEventListener('keydown', (e) => {
		const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
		if (step[e.key]) {
			cur = { x: Math.min(PORTRAIT_W - 1, Math.max(0, cur.x + step[e.key][0])), y: Math.min(PORTRAIT_H - 1, Math.max(0, cur.y + step[e.key][1])) };
			e.preventDefault();
			draw();
		} else if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			use(cur.x, cur.y, e.altKey);
		}
	});

	paintControls();
	draw();
	return { el: box, redraw: () => { draw(); paintControls(); } };
}
