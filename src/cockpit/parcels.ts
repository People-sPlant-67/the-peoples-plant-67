/**
 * Parcels waiting to go with a message: the 📎 button, dropping files onto the chat, and a chip
 * per file with a ✕. Nothing is uploaded here; the chat uploads them when the message is sent
 * and marks each one done, so a send that fails halfway never uploads a file twice.
 *
 * File names are the owner's own, but they are still only ever written with textContent.
 */
import { type FileLike, MAX_FILES, MAX_FILE_BYTES, type Parcel, fileProblem, sizeWords } from '../live/attachments';
import { el } from './dom';

/** A file in the box, and the parcel it became once uploaded, on which issue. */
export interface Pending {
	file: FileLike;
	uploaded: { parcel: Parcel; issueId: string } | null;
}

export interface Parcels {
	/** The row of chips (hidden while empty). */
	el: HTMLElement;
	/** The 📎 button. */
	button: HTMLButtonElement;
	/** Files in the box, in the order added. */
	readonly pending: readonly Pending[];
	/**
	 * Put files in the box, refusing those that are empty, too big, already there, or one too many.
	 *
	 * @param files Files.
	 */
	add(files: Iterable<FileLike>): void;
	/**
	 * Record that a file has been uploaded. While the box still sends to that issue, the file
	 * cannot be taken out (it is on the issue already) and goes with the next message.
	 *
	 * @param p The pending file.
	 * @param parcel What it became.
	 * @param issueId The issue it went to.
	 */
	done(p: Pending, parcel: Parcel, issueId: string): void;
	/** Empty the box. */
	clear(): void;
	/**
	 * Say which issue the next message goes to (null for a new one), so only files already on
	 * that issue are held in the box.
	 *
	 * @param issueId Issue, or null.
	 */
	aim(issueId: string | null): void;
	/**
	 * Keep files and the ✕ still while a message is being sent.
	 *
	 * @param busy True while sending.
	 */
	lock(busy: boolean): void;
	/**
	 * Take files dropped onto an element.
	 *
	 * @param target Drop target.
	 */
	dropOnto(target: HTMLElement): void;
}

/**
 * Build the box.
 *
 * @param onProblem Called with a sentence when a file is refused (or '' when a later add succeeds).
 * @returns Parcels.
 */
export function createParcels(onProblem: (sentence: string) => void): Parcels {
	const row = el('div', 'p67-parcels');
	row.hidden = true;
	const button = el('button', 'p67-attach', '📎');
	button.type = 'button';
	button.title = `Attach files, up to ${sizeWords(MAX_FILE_BYTES)} each. You can also drop them onto the chat.`;
	button.setAttribute('aria-label', 'Attach files');
	// The file input never joins the page: a detached one opens the file dialog just the same.
	const picker = el('input');
	picker.type = 'file';
	picker.multiple = true;
	let pending: Pending[] = [];
	let busy = false;
	let target: string | null = null;

	/** Redraw the chips. */
	const draw = (): void => {
		row.replaceChildren(...pending.map((p) => {
			const chip = el('span', `p67-parcel${p.uploaded ? ' p67-parcel-sent' : ''}`);
			chip.append(el('span', '', `📦 ${p.file.name} · ${sizeWords(p.file.size)}`));
			const held = !!target && p.uploaded?.issueId === target;
			const x = el('button', 'p67-parcel-x', '✕');
			x.type = 'button';
			x.disabled = busy || held;
			x.title = held ? 'This file is on the issue already, so it goes with this message.' : '';
			x.setAttribute('aria-label', held ? `${p.file.name} is on the issue already, so it goes with this message` : `Remove ${p.file.name}`);
			x.addEventListener('click', () => { pending = pending.filter((q) => q !== p); draw(); });
			chip.append(x);
			return chip;
		}));
		row.hidden = pending.length === 0;
		button.disabled = busy;
	};

	const parcels: Parcels = {
		el: row,
		button,
		get pending() { return pending; },
		add(files) {
			const refused: string[] = [];
			for (const f of files) {
				const problem = fileProblem(f);
				if (problem) { refused.push(problem); continue; }
				if (pending.some((p) => p.file.name === f.name && p.file.size === f.size)) continue;
				if (pending.length >= MAX_FILES) { refused.push(`A message takes at most ${MAX_FILES} files, so ${f.name} was not added.`); continue; }
				pending.push({ file: f, uploaded: null });
			}
			onProblem(refused.join(' '));
			draw();
		},
		done(p, parcel, issueId) {
			p.uploaded = { parcel, issueId };
			draw();
		},
		clear() {
			pending = [];
			draw();
		},
		aim(issueId) {
			if (issueId === target) return;
			target = issueId;
			draw();
		},
		lock(b) {
			if (b === busy) return;
			busy = b;
			draw();
		},
		dropOnto(target) {
			/**
			 * Whether a drag carries files (not text or a link).
			 *
			 * @param e Drag event.
			 * @returns True for files.
			 */
			const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
			target.addEventListener('dragover', (e) => {
				if (!hasFiles(e) || busy) return;
				e.preventDefault();
				target.classList.add('p67-drop');
			});
			target.addEventListener('dragleave', (e) => {
				if (!target.contains(e.relatedTarget as Node | null)) target.classList.remove('p67-drop');
			});
			target.addEventListener('drop', (e) => {
				target.classList.remove('p67-drop');
				if (!hasFiles(e) || busy) return;
				e.preventDefault();
				parcels.add(Array.from(e.dataTransfer!.files));
			});
		},
	};
	button.addEventListener('click', () => picker.click());
	picker.addEventListener('change', () => {
		if (picker.files) parcels.add(Array.from(picker.files));
		picker.value = '';
	});
	draw();
	return parcels;
}
