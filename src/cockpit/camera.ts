/**
 * The camera over the plant: drag to pan, wheel to zoom in whole steps (1× to 3×, so pixels
 * stay crisp), always clamped to the world, plus opt-in edge scrolling and smooth glides.
 *
 * The maths is pure and exported for tests/cockpit-maths.test.ts. createCamera binds it to
 * pointer events on an element; it touches no renderer, so it works with any stage.
 *
 * Coordinates: world pixels are base-layer pixels of the plant (1 per art pixel). The camera
 * position is the world pixel at the view's top-left corner. View sizes are CSS pixels.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
/** Edge band for edge scrolling, in CSS pixels from each side of the view. */
export const EDGE_PX = 24;
/** How long the pointer must rest in the edge band before scrolling starts. */
export const EDGE_DWELL_MS = 300;
/** Edge-scroll speed in CSS pixels per second (divided by zoom to get world pixels). */
export const EDGE_SPEED = 700;
/** Pointer travel, in CSS pixels, that turns a press into a drag rather than a click. */
export const DRAG_SLOP = 4;

export interface Size { w: number; h: number }
export interface Cam { x: number; y: number; zoom: number }

/**
 * Clamp one axis: centre the world when it is narrower than the view, otherwise keep the
 * view inside the world.
 *
 * @param pos Camera position on this axis, world pixels.
 * @param visible Visible span, world pixels.
 * @param world World span, world pixels.
 * @returns Clamped position.
 */
function clampAxis(pos: number, visible: number, world: number): number {
	if (world <= visible) return (world - visible) / 2;
	return Math.min(Math.max(pos, 0), world - visible);
}

/**
 * Keep the camera inside the world, with a whole-number zoom between MIN_ZOOM and MAX_ZOOM.
 *
 * @param cam Camera.
 * @param view View size, CSS pixels.
 * @param world World size, world pixels.
 * @returns Clamped camera (a new object).
 */
export function clampCamera(cam: Cam, view: Size, world: Size): Cam {
	const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(cam.zoom) || MIN_ZOOM));
	return { zoom, x: clampAxis(cam.x, view.w / zoom, world.w), y: clampAxis(cam.y, view.h / zoom, world.h) };
}

/**
 * Change zoom while keeping the world point under `at` (a view point) fixed on screen.
 *
 * @param cam Camera.
 * @param zoom New zoom (clamped and rounded).
 * @param at View point to zoom about, CSS pixels.
 * @param view View size.
 * @param world World size.
 * @returns New camera.
 */
export function zoomAbout(cam: Cam, zoom: number, at: { x: number; y: number }, view: Size, world: Size): Cam {
	const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
	const wx = cam.x + at.x / cam.zoom, wy = cam.y + at.y / cam.zoom;
	return clampCamera({ zoom: z, x: wx - at.x / z, y: wy - at.y / z }, view, world);
}

/**
 * Camera that puts a world point in the middle of the view (as far as the clamp allows).
 *
 * @param cam Camera (its zoom is kept).
 * @param p World point.
 * @param view View size.
 * @param world World size.
 * @returns New camera.
 */
export function centredOn(cam: Cam, p: { x: number; y: number }, view: Size, world: Size): Cam {
	return clampCamera({ zoom: cam.zoom, x: p.x - view.w / (2 * cam.zoom), y: p.y - view.h / (2 * cam.zoom) }, view, world);
}

/**
 * View point to world point.
 *
 * @param cam Camera.
 * @param p View point, CSS pixels.
 * @returns World point.
 */
export function viewToWorld(cam: Cam, p: { x: number; y: number }): { x: number; y: number } {
	return { x: cam.x + p.x / cam.zoom, y: cam.y + p.y / cam.zoom };
}

/**
 * Which edges of the view a point is within EDGE_PX of.
 *
 * @param p View point.
 * @param view View size.
 * @returns Scroll direction on each axis: -1, 0 or 1.
 */
export function edgeDirection(p: { x: number; y: number }, view: Size): [number, number] {
	const dx = p.x < EDGE_PX ? -1 : p.x >= view.w - EDGE_PX ? 1 : 0;
	const dy = p.y < EDGE_PX ? -1 : p.y >= view.h - EDGE_PX ? 1 : 0;
	return [dx, dy];
}

/** Everything the edge-scroll guard looks at. */
export interface EdgeInput {
	/** The edge-scroll setting. Off by default. */
	enabled: boolean;
	/** A name card or overlay is open, or the pointer is dragging. */
	blocked: boolean;
	/** Pointer over the view, or null when it is outside. */
	pointer: { x: number; y: number } | null;
	view: Size;
	now: number;
}

/**
 * The edge-scroll guard. Scrolls only when the setting is on, nothing is open, the pointer is
 * over the view within EDGE_PX of an edge, and it has rested in that band for EDGE_DWELL_MS.
 * Any break (leaving the band, a card opening, the setting going off) restarts the dwell, so
 * sweeping the pointer past an edge on the way to the tabs never moves the camera.
 *
 * @param since When the pointer entered the band, or null if it is not in it.
 * @param input Current input.
 * @returns The updated `since`, and the direction to scroll now ([0, 0] for none).
 */
export function edgeScroll(since: number | null, input: EdgeInput): { since: number | null; dir: [number, number] } {
	if (!input.enabled || input.blocked || !input.pointer) return { since: null, dir: [0, 0] };
	const dir = edgeDirection(input.pointer, input.view);
	if (!dir[0] && !dir[1]) return { since: null, dir: [0, 0] };
	const start = since ?? input.now;
	return { since: start, dir: input.now - start >= EDGE_DWELL_MS ? dir : [0, 0] };
}

/**
 * Ease in and out, for glides.
 *
 * @param t Progress 0 to 1.
 * @returns Eased progress.
 */
function ease(t: number): number {
	return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export interface CameraOptions {
	/** Element that receives pointer and wheel events; its size is the view. */
	el: HTMLElement;
	world: Size;
	/** True while a card or overlay is open: no edge scrolling then. */
	isBlocked: () => boolean;
	/** The edge-scroll setting. */
	edgeEnabled: () => boolean;
	/** A press and release without dragging, at a view point. */
	onClick: (p: { x: number; y: number }) => void;
}

export interface Camera {
	readonly cam: Cam;
	readonly view: Size;
	/** Advance glides and edge scrolling. */
	tick(dt: number, now: number): void;
	/** Glide so a world point ends up centred. */
	glideTo(p: { x: number; y: number }, ms?: number): void;
	/** Centre a world point at once. */
	jumpTo(p: { x: number; y: number }): void;
	/** Zoom in or out a step about the view's centre, or about a view point. */
	zoomBy(step: number, at?: { x: number; y: number }): void;
	/** Pan by a distance in CSS pixels. */
	panBy(dx: number, dy: number): void;
	/** Re-read the element's size (call on resize). */
	resize(): void;
	destroy(): void;
}

/**
 * Bind a camera to an element.
 *
 * @param o Options.
 * @returns Camera controls.
 */
export function createCamera(o: CameraOptions): Camera {
	let view: Size = { w: o.el.clientWidth || 1, h: o.el.clientHeight || 1 };
	let cam: Cam = clampCamera({ x: 0, y: 0, zoom: 2 }, view, o.world);
	let pointer: { x: number; y: number } | null = null;
	let since: number | null = null;
	let press: { id: number; x: number; y: number; cx: number; cy: number; dragging: boolean } | null = null;
	let glide: { from: Cam; to: Cam; t: number; ms: number } | null = null;
	// Trackpads send many small wheel deltas; add them up so one flick is one zoom step.
	let wheel = 0;

	/**
	 * View point of a pointer event.
	 *
	 * @param e Event.
	 * @returns Point relative to the element.
	 */
	const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
		const r = o.el.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	/**
	 * Set the camera, clamped.
	 *
	 * @param c Camera.
	 */
	const set = (c: Cam): void => { cam = clampCamera(c, view, o.world); };

	/** The browser took the pointer away (a gesture, a dialog), or the release was missed: forget the press. */
	const cancel = (): void => {
		if (press && o.el.hasPointerCapture?.(press.id)) o.el.releasePointerCapture(press.id);
		press = null;
		o.el.style.cursor = '';
	};
	/** Start a press: it becomes a drag once it moves past DRAG_SLOP, otherwise a click. */
	const down = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		const p = local(e);
		press = { id: e.pointerId, x: p.x, y: p.y, cx: cam.x, cy: cam.y, dragging: false };
	};
	/** Track the pointer for edge scrolling, and pan while dragging. */
	const move = (e: PointerEvent): void => {
		const p = local(e);
		pointer = p;
		if (!press || press.id !== e.pointerId) return;
		// No button held: the release happened where we could not see it (outside the window,
		// or swallowed by a dialog). End the press rather than pan with nothing held.
		if (e.pointerType === 'mouse' && e.buttons === 0) { cancel(); return; }
		if (!press.dragging && Math.hypot(p.x - press.x, p.y - press.y) > DRAG_SLOP) {
			press.dragging = true;
			glide = null;
			o.el.setPointerCapture?.(e.pointerId);
			o.el.style.cursor = 'grabbing';
		}
		if (press.dragging) set({ zoom: cam.zoom, x: press.cx - (p.x - press.x) / cam.zoom, y: press.cy - (p.y - press.y) / cam.zoom });
	};
	/** End a press; report a click if it never became a drag. */
	const up = (e: PointerEvent): void => {
		if (!press || press.id !== e.pointerId) return;
		const wasDrag = press.dragging;
		press = null;
		o.el.style.cursor = '';
		if (o.el.hasPointerCapture?.(e.pointerId)) o.el.releasePointerCapture(e.pointerId);
		if (!wasDrag) o.onClick(local(e));
	};
	/** The pointer left the view: no edge scrolling. */
	const leave = (): void => { pointer = null; };
	/** Zoom one whole step per wheel notch (or per trackpad flick) about the pointer. */
	const onWheel = (e: WheelEvent): void => {
		e.preventDefault();
		wheel += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
		if (Math.abs(wheel) < 40) return;
		const step = wheel < 0 ? 1 : -1;
		wheel = 0;
		glide = null;
		cam = zoomAbout(cam, cam.zoom + step, local(e), view, o.world);
	};

	o.el.addEventListener('pointerdown', down);
	o.el.addEventListener('pointermove', move);
	o.el.addEventListener('pointerup', up);
	o.el.addEventListener('pointercancel', cancel);
	o.el.addEventListener('pointerleave', leave);
	o.el.addEventListener('wheel', onWheel, { passive: false });

	return {
		get cam() { return cam; },
		get view() { return view; },
		tick(dt, now) {
			if (glide) {
				glide.t += dt;
				const k = ease(Math.min(1, glide.t / glide.ms));
				set({ zoom: glide.to.zoom, x: glide.from.x + (glide.to.x - glide.from.x) * k, y: glide.from.y + (glide.to.y - glide.from.y) * k });
				if (glide.t >= glide.ms) glide = null;
			}
			const e = edgeScroll(since, { enabled: o.edgeEnabled(), blocked: o.isBlocked() || !!press?.dragging, pointer, view, now });
			since = e.since;
			if (e.dir[0] || e.dir[1]) {
				glide = null;
				const d = (EDGE_SPEED * dt) / 1000 / cam.zoom;
				set({ zoom: cam.zoom, x: cam.x + e.dir[0] * d, y: cam.y + e.dir[1] * d });
			}
		},
		glideTo(p, ms = 450) {
			glide = { from: cam, to: centredOn(cam, p, view, o.world), t: 0, ms };
		},
		jumpTo(p) {
			glide = null;
			cam = centredOn(cam, p, view, o.world);
		},
		zoomBy(step, at) {
			glide = null;
			cam = zoomAbout(cam, cam.zoom + step, at ?? { x: view.w / 2, y: view.h / 2 }, view, o.world);
		},
		panBy(dx, dy) {
			glide = null;
			set({ zoom: cam.zoom, x: cam.x + dx / cam.zoom, y: cam.y + dy / cam.zoom });
		},
		resize() {
			view = { w: o.el.clientWidth || 1, h: o.el.clientHeight || 1 };
			set(cam);
		},
		destroy() {
			o.el.removeEventListener('pointerdown', down);
			o.el.removeEventListener('pointermove', move);
			o.el.removeEventListener('pointerup', up);
			o.el.removeEventListener('pointercancel', cancel);
			o.el.removeEventListener('pointerleave', leave);
			o.el.removeEventListener('wheel', onWheel);
		},
	};
}
