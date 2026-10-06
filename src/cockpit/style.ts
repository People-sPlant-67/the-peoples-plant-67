/**
 * The cockpit's stylesheet, as a string so both hosts can install it the same way: the dev
 * page and the extension, where the page is a Paperclip URL and there is no CSS file to link.
 * Every class starts with p67- so nothing can collide with whatever the host page had.
 */
export const COCKPIT_CSS = `
/* --p67-top: where the windows start, under the corner speaker. */
.p67-root { --p67-top: 36px; position: fixed; inset: 0; overflow: hidden; background: #16181d; color: #e6e1d6;
	font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; user-select: none; }
.p67-stage { position: absolute; inset: 0; touch-action: none; cursor: grab; }
.p67-stage canvas { display: block; image-rendering: pixelated; }
.p67-papers button { background: #2a2c31; color: #e6e1d6; border: 1px solid #4a453e; border-radius: 4px;
	padding: 2px 8px; font: inherit; cursor: pointer; }
.p67-chip:hover, .p67-papers button:hover { border-color: #c9b27a; }
.p67-roster { position: absolute; left: 10px; right: 230px; bottom: 10px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap-reverse; pointer-events: none; }
.p67-roster > * { pointer-events: auto; }
/* The COMRADES chip: Soviet red with gold trim, on top of the chips that fly out from behind it. It keeps
   a layer of its own, so chips flying under it never make the browser repaint it mid-flight. */
.p67-roster > .p67-roster-head { position: relative; z-index: 1; will-change: transform; gap: 8px; padding: 6px 14px 6px 12px; font-size: 14px; font-weight: 700;
	letter-spacing: 0.08em; color: #f4efe2; background: linear-gradient(#c73b2f, #9c2820); border: 1px solid #c9b27a; border-radius: 16px;
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.18); }
.p67-roster > .p67-roster-head:hover { border-color: #f4d58a; background: linear-gradient(#d0463a, #a82e25); }
.p67-roster > .p67-roster-head:focus { outline: none; }
.p67-roster > .p67-roster-head:focus-visible { outline: 2px solid #f4d58a; outline-offset: 2px; }
.p67-roster-emblem { color: #f4d58a; font-size: 16px; line-height: 1; }
.p67-roster-head .p67-flag { color: #9c2820; background: #f4efe2; }
.p67-roster-head .p67-reply { color: #f4efe2; background: #2a2420; }
.p67-roster-arrow { color: #f4d58a; font-size: 11px; }
.p67-roster > .p67-chip[hidden] { display: none; }
/* Folded, each chip sits behind the head (--p67-dx/--p67-dy, set in roster.ts); open, it flies out, one after another. */
.p67-roster > .p67-chip:not(.p67-roster-head) { opacity: 0; transform: translate(var(--p67-dx, 0), var(--p67-dy, 0)) scale(0.6); pointer-events: none;
	will-change: transform, opacity; --p67-d: calc((var(--p67-fan-n, 1) - 1 - var(--p67-i, 0)) * var(--p67-fan-step, 30ms));
	/* Folding, last out is first back; each fades only as it reaches the head, so it is seen flying home. */
	transition: transform var(--p67-slide, 320ms) cubic-bezier(0.65, 0, 0.35, 1) var(--p67-d),
		opacity calc(var(--p67-slide, 320ms) * 0.4) linear calc(var(--p67-d) + var(--p67-slide, 320ms) * 0.6); }
.p67-roster.p67-open > .p67-chip:not(.p67-roster-head) { opacity: 1; transform: none; pointer-events: auto; --p67-d: calc(var(--p67-i, 0) * var(--p67-fan-step, 30ms));
	transition: transform var(--p67-slide, 320ms) cubic-bezier(0.22, 1, 0.36, 1) var(--p67-d), opacity calc(var(--p67-slide, 320ms) * 0.5) ease-out var(--p67-d); }
.p67-roster.p67-aiming > .p67-chip { transition: none; }
@media (prefers-reduced-motion: reduce) { .p67-roster > .p67-chip:not(.p67-roster-head) { transition: none; } }
.p67-chip { display: flex; gap: 6px; align-items: center; padding: 3px 9px; background: rgba(22, 23, 26, 0.9);
	color: #e6e1d6; border: 1px solid #3a3530; border-radius: 12px; font: inherit; cursor: pointer; }
.p67-chip.p67-on { border-color: #f4efe2; background: #2e2a26; }
.p67-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.p67-flag { color: #fff; background: #bd352c; border-radius: 3px; padding: 0 4px; font-weight: 700; }
.p67-flag[hidden] { display: none; }
.p67-minimap { position: absolute; right: 10px; bottom: 10px; padding: 3px; background: rgba(22, 23, 26, 0.9);
	border: 1px solid #3a3530; border-radius: 4px; line-height: 0; }
.p67-minimap canvas { cursor: crosshair; }
.p67-card { z-index: 4; position: absolute; top: calc(var(--p67-top) + 20px); right: 10px; width: 360px; box-sizing: border-box;
	max-height: calc(100% - var(--p67-top) - 40px); display: flex; flex-direction: column; padding: 12px 14px;
	background: rgba(28, 27, 25, 0.97); border: 1px solid #6b5d45; border-radius: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); user-select: text; }
.p67-card[hidden] { display: none; }
@media (max-width: 600px) { .p67-card { left: 10px; width: auto; } }
.p67-chat { display: flex; flex-direction: column; min-height: 0; flex: 1; margin-top: 10px; padding-top: 10px; border-top: 1px solid #3a3530; }
.p67-chat-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.p67-chat-head h3 { margin: 0; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #c9b27a; }
.p67-threads { order: 3; flex: 1 1 100%; min-width: 0; background: #1c1b19; color: #e6e1d6; border: 1px solid #4a453e; border-radius: 4px; font: inherit; padding: 2px 4px; }
.p67-open { margin-left: auto; color: #c9b27a; font-size: 12px; }
.p67-open[hidden] { display: none; }
.p67-log { flex: 1; min-height: 90px; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
	padding: 8px; background: #16151a; border: 1px solid #2c2925; border-radius: 4px; }
.p67-msg { max-width: 85%; padding: 6px 9px; border-radius: 6px; overflow-wrap: anywhere; }
.p67-msg .p67-who { font-size: 11px; color: #9a958a; margin-bottom: 2px; }
.p67-msg .p67-body { white-space: pre-wrap; }
/* Markdown, read safely (markdown.ts): the blocks keep their own spacing, so no pre-wrap inside them. */
.p67-md { white-space: normal; }
.p67-md.p67-md-plain { white-space: pre-wrap; }
.p67-md > :first-child { margin-top: 0; }
.p67-md > :last-child { margin-bottom: 0; }
.p67-md p { margin: 0 0 6px; }
.p67-md-h { margin: 6px 0 4px; font-weight: 700; }
.p67-md-h1 { font-size: 1.15em; }
.p67-md-h2 { font-size: 1.07em; }
.p67-md-list { margin: 0 0 6px; padding-left: 20px; }
.p67-md-list li { margin: 1px 0; }
.p67-md-quote { margin: 0 0 6px; padding-left: 8px; border-left: 3px solid currentColor; opacity: 0.85; }
.p67-md-hr { border: 0; border-top: 1px solid currentColor; opacity: 0.35; margin: 6px 0; }
.p67-md-code { padding: 0 3px; background: rgba(127, 127, 127, 0.18); border-radius: 2px; font-family: ui-monospace, monospace; font-size: 0.92em; }
.p67-md-pre { margin: 0 0 6px; padding: 6px 8px; background: rgba(0, 0, 0, 0.25); border-radius: 3px; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.p67-md-href { font-style: italic; overflow-wrap: anywhere; }
.p67-me { align-self: flex-end; background: #efe6cf; color: #2a2420; border-bottom-right-radius: 1px; }
.p67-me .p67-who { color: #6b5d45; }
.p67-them { align-self: flex-start; background: #2e2a26; border: 1px solid #4a453e; border-bottom-left-radius: 1px; }
.p67-sys { align-self: center; max-width: 95%; background: none; color: #9a958a; font-size: 12px; text-align: center; font-style: italic; padding: 0; }
.p67-empty { margin: auto 0; color: #9a958a; text-align: center; font-size: 12px; }
.p67-chat-note { margin: 8px 0 0; color: #8fd0ff; font-size: 12px; }
.p67-chat-note[hidden] { display: none; }
.p67-input { margin-top: 8px; resize: vertical; min-height: 54px; max-height: 200px; background: #1c1b19; color: #e6e1d6; border: 1px solid #4a453e;
	border-radius: 4px; padding: 6px 8px; font: inherit; }
.p67-input:focus { outline: none; border-color: #c9b27a; }
.p67-chat-error { margin: 6px 0 0; color: #ff8f80; font-size: 12px; }
.p67-chat-error:empty { display: none; }
.p67-send-row { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.p67-hint { color: #7a756b; font-size: 11px; }
.p67-send { background: #7a2a22; color: #f4efe2; border: 1px solid #bd352c; border-radius: 4px; padding: 4px 12px; font: inherit; font-weight: 600; cursor: pointer; }
.p67-send:hover:not(:disabled) { background: #93342a; }
.p67-send:disabled { opacity: 0.6; cursor: default; }
.p67-chat-swap { background: none; color: #c9b27a; border: 1px solid #4a453e; border-radius: 4px; padding: 1px 7px; font: inherit; font-size: 12px; cursor: pointer; }
.p67-chat-swap:hover { border-color: #c9b27a; }
.p67-chat-swap[hidden] { display: none; }
.p67-writing { margin: 6px 0 0; color: #9a958a; font-size: 12px; font-style: italic; }
.p67-writing[hidden] { display: none; }
.p67-chat.p67-drop { outline: 2px dashed #c9b27a; outline-offset: 4px; }
.p67-send-tools { display: flex; align-items: center; gap: 8px; }
.p67-attach { background: none; border: 1px solid #4a453e; border-radius: 4px; padding: 1px 6px; font: inherit; cursor: pointer; }
.p67-attach:hover:not(:disabled) { border-color: #c9b27a; }
.p67-attach:disabled { opacity: 0.5; cursor: default; }
.p67-parcels { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.p67-parcels[hidden] { display: none; }
.p67-parcel { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px; background: #d9c79c; color: #2a2420; border: 1px solid #8a7550;
	border-radius: 3px; font-size: 12px; max-width: 100%; overflow-wrap: anywhere; }
.p67-parcel-sent { background: #c9d9a8; }
.p67-parcel-x { background: none; border: 0; color: #5a4a30; font: inherit; cursor: pointer; padding: 0 4px; }
.p67-parcel-x:disabled { opacity: 0.4; cursor: default; }
.p67-msg-parcels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.p67-msg-parcel { padding: 1px 6px; background: #d9c79c; color: #2a2420 !important; border-radius: 3px; font-size: 12px; font-style: normal; text-decoration: none; overflow-wrap: anywhere; }
.p67-msg-parcel:hover { background: #e3d3ab; }
/* The comrade's questions: slips of paper above the chat box, answered with stamps. */
/* A column to the left of the name card (360px wide, 10px from the edge), as tall as the card may be. */
.p67-asks { z-index: 4; position: absolute; top: calc(var(--p67-top) + 20px); right: 380px; width: 340px; box-sizing: border-box;
	max-height: calc(100% - var(--p67-top) - 40px); display: flex; flex-direction: column; gap: 8px; overflow-y: auto; user-select: text; }
.p67-asks[hidden], .p67-asks.p67-away { display: none; }
/* No room beside the card: along the bottom instead, over the plant. */
@media (max-width: 780px) { .p67-asks { top: auto; bottom: 10px; left: 10px; right: 10px; width: auto; max-height: 45vh; } }
.p67-ask { padding: 9px 11px 6px; background: #efe6cf; color: #2a2420; border: 1px solid #8a7550; border-top: 3px solid #bd352c;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35); font-size: 13px; overflow-wrap: anywhere; }
.p67-ask-head { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #7a2a22; }
.p67-ask-text { margin: 0 0 6px; white-space: pre-wrap; }
.p67-ask-help { margin: 0 0 4px; color: #6b5d45; font-size: 12px; white-space: pre-wrap; }
.p67-ask-details { margin: 0 0 6px; font-size: 12px; }
.p67-ask-details summary { cursor: pointer; color: #7a2a22; }
.p67-ask-options, .p67-ask-items { display: flex; flex-direction: column; gap: 3px; margin: 0 0 6px; }
.p67-ask-option { display: block; cursor: pointer; }
.p67-ask-option small { color: #6b5d45; }
.p67-ask-target { margin: 0 0 6px; padding: 4px 8px; background: #f3e4c0; border-left: 3px solid #9a6212; font-size: 12px; }
.p67-ask-href { display: block; color: #6b5d45; font-family: ui-monospace, monospace; font-size: 11px; overflow-wrap: anywhere; }
.p67-ask-why { margin: 0 0 4px; color: #6b5d45; font-size: 12px; text-align: center; }
.p67-ask-why:empty { display: none; }
.p67-ask-clear { margin-top: 2px; background: none; border: 0; padding: 0; color: #7a2a22; font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }
.p67-ask-question { margin: 0 0 8px; padding: 4px 8px 6px; border: 1px solid #c9b88f; }
.p67-ask-question legend { padding: 0 4px; font-weight: 600; }
.p67-ask-other, .p67-ask-reason { display: block; width: 100%; box-sizing: border-box; margin: 3px 0 6px; padding: 4px 6px; background: #f9f4e6; color: #2a2420;
	border: 1px solid #8a7550; border-radius: 2px; font: inherit; font-size: 12px; resize: vertical; }
.p67-ask-other[hidden], .p67-ask-reason[hidden] { display: none; }
.p67-ask-item { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; padding: 3px 0; border-bottom: 1px dashed #c9b88f; }
.p67-ask-item small, .p67-ask-item .p67-ask-reason, .p67-ask-item .p67-ask-details { grid-column: 1 / -1; }
.p67-ask-item small { color: #6b5d45; }
.p67-ask-verdict { display: flex; gap: 3px; }
.p67-ask-v { width: 26px; height: 22px; background: #f9f4e6; color: #6b5d45; border: 1px solid #8a7550; border-radius: 2px; font: inherit; font-weight: 700; cursor: pointer; }
.p67-ask-v[aria-pressed=true].p67-ask-v-approve { background: #3f7a34; color: #f4efe2; }
.p67-ask-v[aria-pressed=true].p67-ask-v-reject { background: #bd352c; color: #f4efe2; }
.p67-ask-v[aria-pressed=true].p67-ask-v-defer { background: #9a6212; color: #f4efe2; }
.p67-ask .p67-two .p67-stamp { padding: 6px 4px 5px; }
.p67-ask .p67-stamp-word { font-size: 15px; }
.p67-ask .p67-one { justify-content: center; }
.p67-ask .p67-one .p67-stamp { flex: 0 1 60%; }
.p67-ask-wake { margin: 0 0 4px; color: #6b5d45; font-size: 11px; text-align: center; font-style: italic; }
.p67-ask-status { margin: 0 0 4px; color: #7a2a22; font-size: 12px; }
.p67-ask-status:empty { display: none; }
.p67-ask-link { display: inline-block; margin: 2px 0 6px; color: #7a2a22; font-weight: 700; }
.p67-reply { color: #2a2420; background: #efe6cf; border-radius: 3px; padding: 0 4px; font-weight: 700; line-height: 1.1; }
.p67-reply[hidden] { display: none; }
.p67-card h2 { margin: 0 24px 2px 0; flex: none; font-size: 16px; color: #f4efe2; overflow-wrap: anywhere; }
.p67-card .p67-title { margin: 0 0 10px; color: #c9b27a; overflow-wrap: anywhere; }
.p67-row { display: grid; grid-template-columns: 96px 1fr; gap: 6px; margin: 4px 0; }
.p67-row[hidden] { display: none; }
.p67-label { color: #9a958a; }
.p67-value { overflow-wrap: anywhere; white-space: pre-wrap; }
.p67-close { position: absolute; top: 6px; right: 8px; background: none; border: 0; color: #9a958a; font-size: 20px; cursor: pointer; }
.p67-close:hover { color: #f4efe2; }
.p67-overlay { z-index: 6; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
	background: rgba(16, 17, 20, 0.62); }
.p67-overlay[hidden] { display: none; }
.p67-papers { max-width: 440px; margin: 16px; padding: 22px 26px; background: #efe6cf; color: #2a2420;
	border: 3px double #7a2a22; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6); text-align: center; user-select: text; }
.p67-papers h2 { margin: 0 0 12px; color: #bd352c; font-size: 26px; letter-spacing: 0.12em;
	border: 3px solid #bd352c; display: inline-block; padding: 2px 12px; transform: rotate(-3deg); }
.p67-papers p { margin: 0 0 14px; font-size: 14px; }
.p67-papers a { color: #7a2a22; font-weight: 600; }
.p67-papers .p67-note { margin: 12px 0 0; font-size: 12px; color: #6b5d45; }
.p67-board { z-index: 4; position: absolute; top: calc(var(--p67-top) + 20px); right: 10px; width: 470px; max-width: calc(100% - 20px); box-sizing: border-box;
	max-height: calc(100% - var(--p67-top) - 40px); overflow-y: auto; padding: 20px 24px; background: #efe6cf; color: #2a2420;
	border: 3px double #7a2a22; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6); user-select: text; }
.p67-board[hidden] { display: none; }
.p67-board .p67-close { color: #6b5d45; }
.p67-board-head { font-size: 11px; letter-spacing: 0.18em; color: #7a2a22; font-weight: 700; }
.p67-board h2 { margin: 4px 24px 2px 0; font-size: 22px; overflow-wrap: anywhere; }
.p67-board-sub { margin: 0 0 10px; color: #6b5d45; overflow-wrap: anywhere; }
.p67-charge { margin: 8px 0 12px; padding: 4px 10px; border-left: 4px solid #bd352c; font-style: italic; font-size: 15px; white-space: pre-wrap; overflow-wrap: anywhere; }
.p67-strikes { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 10px; }
.p67-strikes td { padding: 4px 6px; border-bottom: 1px solid #d8ccb0; vertical-align: top; overflow-wrap: anywhere; }
.p67-strikes td:first-child { white-space: nowrap; color: #6b5d45; }
.p67-serious { font-weight: 700; }
.p67-report { display: inline-block; margin: 2px 0 14px; color: #7a2a22; font-weight: 700; }
.p67-report-text { white-space: pre-wrap; margin: 2px 0 14px; max-height: 220px; overflow-y: auto; padding: 8px; background: #f3ead2; border: 1px solid #c9b88a; }
.p67-stamps { display: flex; gap: 16px; margin: 6px 0 10px; }
.p67-stamp { flex: 1; position: relative; overflow: hidden; background: none; border: 4px solid; padding: 12px 6px 10px; font: inherit; cursor: pointer;
	transform: rotate(-2deg); touch-action: none; user-select: none; }
.p67-stamp + .p67-stamp { transform: rotate(2deg); }
.p67-stamp.p67-red { color: #bd352c; border-color: #bd352c; }
.p67-stamp.p67-green { color: #3f7a34; border-color: #3f7a34; }
.p67-stamp.p67-amber { color: #9a6212; border-color: #9a6212; }
.p67-three { gap: 10px; }
.p67-three .p67-stamp { padding: 10px 4px 8px; }
.p67-three .p67-stamp:nth-child(3) { transform: rotate(-1deg); }
.p67-three .p67-stamp-word { font-size: 15px; letter-spacing: 0.02em; white-space: normal; line-height: 1.15; }
.p67-three .p67-stamp small { font-size: 10px; }
.p67-warn { margin: 4px 0 10px; padding: 7px 10px; background: #f3e4c0; color: #6b4410; border: 1px solid #9a6212; font-size: 13px; }
.p67-folder { margin: 6px 0 10px; }
.p67-open-dossier { display: block; width: 100%; padding: 14px 10px; background: #d9c79c; color: #2a2420; border: 2px solid #8a7550;
	border-radius: 2px 10px 2px 2px; font: inherit; font-weight: 700; letter-spacing: 0.06em; cursor: pointer; }
.p67-open-dossier:hover { background: #e3d3ab; }
.p67-fields-head { margin: 4px 0 2px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b5d45; }
.p67-fields td:first-child { white-space: normal; width: 32%; }
.p67-fields td { white-space: pre-wrap; }
.p67-dossiers { margin-top: 10px; padding-top: 8px; border-top: 1px solid #3a3530; flex: none; }
.p67-dossiers[hidden] { display: none; }
.p67-dossiers h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #ff8f80; }
.p67-dossiers ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.p67-dossier-pick { width: 100%; text-align: left; background: #efe6cf; color: #2a2420; border: 1px solid #bd352c; border-radius: 3px;
	padding: 5px 8px; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
.p67-dossier-pick:hover { background: #f7f1e2; }
.p67-dossier-done { margin: 0 0 6px; color: #9fd08a; font-size: 12px; }
.p67-dossier-hint { margin: 6px 0 0; color: #9a958a; font-size: 12px; }
.p67-tabs { display: flex; gap: 4px; margin: 10px 0 0; border-bottom: 1px solid #3a3530; flex: none; }
.p67-tab { background: none; border: 1px solid transparent; border-bottom: none; border-radius: 4px 4px 0 0; margin-bottom: -1px;
	padding: 5px 10px; color: #9a958a; font: inherit; font-size: 12px; cursor: pointer; }
.p67-tab:hover { color: #f4efe2; }
.p67-tab[aria-selected="true"] { color: #f4efe2; border-color: #3a3530; background: #1c1b19; }
.p67-tab:focus-visible { outline: 2px solid #c9b27a; outline-offset: -2px; }
.p67-tab-flag::after { content: '!'; display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 3px; background: #bd352c; color: #f4efe2; font-weight: 700; }
.p67-file-warn { margin: 0 0 6px; padding: 5px 8px; background: #f3e4c0; color: #6b4410; border: 1px solid #9a6212; font-size: 12px; }
.p67-file-warn[hidden] { display: none; }
.p67-file-result:focus { outline: none; }
.p67-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.p67-pane[hidden] { display: none; }
.p67-file { overflow-y: auto; min-height: 0; padding-top: 8px; }
.p67-file h3 { margin: 12px 0 6px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #c9b27a; }
.p67-budget-bar { height: 6px; margin: 0 0 4px 102px; background: #3a3530; border-radius: 3px; overflow: hidden; }
.p67-budget-bar[hidden] { display: none; }
.p67-budget-bar span { display: block; height: 100%; background: #c9b27a; }
.p67-budget-bar .p67-over { background: #e0503f; }
.p67-shifts { margin: 0; padding: 0; list-style: none; font-size: 12px; }
.p67-shifts li { display: grid; grid-template-columns: 96px 1fr auto; gap: 8px; padding: 3px 0; border-top: 1px solid #2c2926; }
.p67-shift-when, .p67-shift-len { color: #9a958a; white-space: nowrap; }
.p67-shift-ok { color: #9fd08a; }
.p67-shift-bad { color: #ff8f80; overflow-wrap: anywhere; }
.p67-file-note { margin: 6px 0; color: #9a958a; font-size: 12px; }
.p67-file-note[hidden] { display: none; }
.p67-file > div[hidden] { display: none; }
.p67-shifts li.p67-file-note { display: block; border: none; }
.p67-file-papers { padding: 10px 12px 8px; background: #efe6cf; color: #2a2420; border: 3px double #7a2a22; }
.p67-two { gap: 10px; margin: 4px 0 8px; }
.p67-two .p67-stamp { padding: 8px 4px 7px; }
.p67-two .p67-stamp-word { font-size: 16px; }
.p67-two .p67-stamp small { font-size: 10px; white-space: normal; }
.p67-file-why { margin: 0; font-size: 12px; color: #6b5d45; }
.p67-file-result { margin: 8px 0 0; font-size: 13px; }
.p67-file-ok { color: #9fd08a; }
.p67-file-fail { color: #ff8f80; }
.p67-pravda { width: 600px; max-width: calc(100% - 32px); max-height: calc(100% - 40px); overflow-y: auto; box-sizing: border-box; margin: 16px;
	padding: 16px 22px 14px; background: #efe6cf; color: #2a2420; border: 3px double #7a2a22; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
	font-family: Georgia, 'Times New Roman', serif; user-select: text; }
.p67-pravda:focus { outline: none; }
.p67-pravda-mast { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 4px solid #bd352c; padding-bottom: 2px; }
.p67-pravda-mast b { font-size: 46px; color: #bd352c; letter-spacing: 0.06em; line-height: 1; }
.p67-pravda-mast small { max-width: 160px; font-size: 11px; color: #6b5d45; text-align: right; font-family: system-ui, sans-serif; }
.p67-pravda-dateline { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; padding: 4px 0; border-bottom: 1px solid #b9a988;
	font-size: 12px; color: #6b5d45; font-family: system-ui, sans-serif; }
.p67-pravda-lead { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: start; margin: 12px 0; }
.p67-pravda-figure { margin: 0; text-align: center; font-size: 11px; color: #6b5d45; font-family: system-ui, sans-serif; }
.p67-pravda-portrait { display: block; image-rendering: pixelated; margin-bottom: 2px; }
.p67-pravda-lead h2 { margin: 0 0 6px; font-size: 24px; line-height: 1.2; overflow-wrap: anywhere; }
.p67-pravda-lead p { margin: 0; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.p67-pravda-briefs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; padding-top: 8px; border-top: 1px solid #b9a988; }
.p67-pravda-briefs[hidden] { display: none; }
.p67-pravda-briefs h3 { margin: 0 0 3px; font-size: 15px; overflow-wrap: anywhere; }
.p67-pravda-briefs p { margin: 0 0 10px; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
@media (max-width: 600px) { .p67-pravda-briefs { grid-template-columns: 1fr; } .p67-pravda-lead { grid-template-columns: 1fr; } .p67-pravda-portrait { margin: 0 auto 2px; } .p67-pravda-mast b { font-size: 34px; } }
.p67-pravda-inbrief, .p67-pravda-note { margin: 4px 0 8px; font-size: 13px; }
.p67-pravda-inbrief[hidden], .p67-pravda-note[hidden] { display: none; }
.p67-pravda-note { color: #7a2a22; }
.p67-pravda-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 8px; border-top: 1px solid #b9a988;
	font-size: 11px; color: #6b5d45; font-family: system-ui, sans-serif; }
.p67-pravda-close { background: #7a2a22; color: #f4efe2; border: 0; border-radius: 2px; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer; }
.p67-pravda-close:focus-visible { outline: 2px solid #2a2420; outline-offset: 2px; }
.p67-stamp:disabled { opacity: 0.35; cursor: not-allowed; }
.p67-stamp:focus-visible { outline: 2px solid #2a2420; outline-offset: 3px; }
.p67-stamp-word { display: block; font-weight: 800; font-size: 21px; letter-spacing: 0.05em; white-space: nowrap; }
.p67-stamp small { display: block; font-size: 11px; font-weight: 600; margin-top: 3px; }
.p67-hold { position: absolute; left: 0; bottom: 0; height: 5px; width: 0; background: currentColor; }
.p67-slam { animation: p67-slam 0.35s ease-out; }
@keyframes p67-slam { 0% { transform: scale(1.25) rotate(-6deg); } 100% { transform: scale(1) rotate(-2deg); } }
.p67-reason { width: 100%; box-sizing: border-box; border: 1px solid #b9ad92; background: #f7f1e2; color: #2a2420; font: inherit; padding: 6px 8px; resize: vertical; }
.p67-board-note { margin: 8px 0 0; font-size: 12px; color: #6b5d45; }
.p67-lock { margin: 6px 0 4px; padding: 7px 10px; background: #f6dcd6; color: #7a1f17; border: 1px solid #bd352c; font-weight: 600; font-size: 13px; }
.p67-lock[hidden] { display: none; }
.p67-link { margin-top: 8px; background: none; border: 0; padding: 0; color: #6b5d45; text-decoration: underline; font: inherit; font-size: 12px; cursor: pointer; }
.p67-board .p67-chat-error { color: #9a2a20; }
.p67-fx { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.p67-fall { position: absolute; left: 0; top: 0; padding: 4px 10px; border: 4px solid; font-weight: 800; font-size: 22px; letter-spacing: 0.1em;
	background: rgba(239, 230, 207, 0.85); animation: p67-fall 0.3s ease-out; white-space: nowrap; }
.p67-fall.p67-red { color: #bd352c; border-color: #bd352c; }
.p67-fall.p67-green { color: #3f7a34; border-color: #3f7a34; }
.p67-fall.p67-amber { color: #9a6212; border-color: #9a6212; }
@keyframes p67-fall { 0% { opacity: 0; font-size: 44px; } 100% { opacity: 1; font-size: 22px; } }
.p67-notice { position: absolute; top: calc(var(--p67-top) + 20px); left: 50%; transform: translateX(-50%); max-width: min(560px, calc(100% - 40px));
	padding: 10px 34px 10px 14px; background: #efe6cf; color: #2a2420; border: 2px solid #7a2a22; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); user-select: text; }
.p67-notice[hidden] { display: none; }
.p67-notice p { margin: 0; }
.p67-notice .p67-close { color: #6b5d45; }
.p67-photo { z-index: 4; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 16px 20px; background: #2e2a26; border: 1px solid #6b5d45;
	box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6); max-width: calc(100% - 40px); max-height: calc(100% - 40px); overflow-y: auto; user-select: text; }
.p67-photo[hidden] { display: none; }
.p67-photo h2 { margin: 0 24px 10px 0; font-size: 15px; color: #f4efe2; }
.p67-photo canvas { display: block; image-rendering: pixelated; max-width: 100%; }
.p67-photo-cap { margin: 10px 0 0; color: #e6e1d6; }
.p67-unpersons { margin: 10px 0 0; padding-left: 20px; color: #c9bfa6; font-size: 12px; }
/* the speaker alone in the top-right corner; everything else is in the scenery. */
.p67-corner { position: absolute; top: 10px; right: 10px; z-index: 7; display: flex; align-items: center; }
.p67-corner .p67-speaker { display: flex; align-items: center; height: 26px; padding: 0 9px; background: rgba(22, 23, 26, 0.88); color: #e6e1d6;
	border: 1px solid #4a453e; border-radius: 4px; cursor: pointer; }
.p67-corner .p67-speaker:hover { border-color: #c9b27a; }
.p67-corner .p67-speaker[aria-pressed=true] { background: #bd352c; color: #f4efe2; border-color: #bd352c; }
.p67-corner .p67-speaker:focus { outline: none; }
.p67-corner .p67-speaker:focus-visible { outline: 2px solid #c9b27a; outline-offset: 1px; }
.p67-speaker svg { display: block; width: 16px; height: 16px; }
.p67-sound { position: fixed; z-index: 8; width: 280px; box-sizing: border-box; padding: 10px 12px; background: rgba(28, 27, 25, 0.97);
	border: 1px solid #6b5d45; border-radius: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
.p67-sound[hidden] { display: none; }
.p67-sound-row { display: grid; grid-template-columns: 58px 1fr 38px auto; gap: 6px; align-items: center; margin: 4px 0; }
.p67-sound-row label { color: #c9b27a; }
.p67-sound-row input[type=range] { width: 100%; accent-color: #bd352c; }
.p67-sound-value { color: #9a958a; font-variant-numeric: tabular-nums; text-align: right; }
.p67-sound-mute { display: flex; gap: 3px; align-items: center; color: #9a958a !important; cursor: pointer; }
.p67-sound-note { margin: 6px 0 0; color: #9a958a; font-size: 12px; }
.p67-sound-note[hidden] { display: none; }
.p67-sound-hushed { margin: 0 0 6px; color: #e8d9a8; font-size: 12px; }
.p67-sound-hushed[hidden] { display: none; }
.p67-sound-onair { margin: 0 0 4px 64px; color: #e0b92e; font-size: 12px; }
.p67-sound-onair[hidden] { display: none; }
.p67-boot { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #9a958a; font-size: 15px; }
/* The posters: what waits on the owner, pinned top-left; a new kind unrolls big first. */
.p67-posters { position: absolute; top: 14px; left: 14px; z-index: 2; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; pointer-events: none; }
.p67-poster-stack { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.p67-poster { position: relative; display: block; width: 200px; padding: 0 0 8px; text-align: left; background: #efe3c4; color: #1c1614;
	border: 1px solid #7a1712; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.55); font: 13px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
	transform: rotate(-1.2deg); cursor: pointer; pointer-events: auto; transition: transform 0.15s; }
.p67-poster-stack .p67-poster:nth-child(even) { transform: rotate(0.9deg); }
.p67-poster:hover, .p67-poster:focus-visible { transform: rotate(0deg) scale(1.03); outline: none; box-shadow: 0 0 0 2px #e6b92e, 0 6px 14px rgba(0, 0, 0, 0.6); }
.p67-poster-still { cursor: default; }
.p67-poster::before { content: ''; position: absolute; top: -5px; left: 50%; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%;
	background: radial-gradient(circle at 35% 35%, #f0a39b, #b02a22 55%, #5a100c); box-shadow: 0 2px 2px rgba(0, 0, 0, 0.5); }
.p67-poster-head { display: flex; align-items: center; gap: 6px; background: #b02a22; color: #efe3c4; font-weight: 900; letter-spacing: 0.16em;
	padding: 7px 10px 6px; font-size: 14px; }
.p67-poster-head i { color: #e6b92e; font-style: normal; }
.p67-poster-head em { margin-left: auto; font-style: normal; background: #1c1614; color: #e6b92e; border-radius: 2px; padding: 0 6px; letter-spacing: 0; font-size: 15px; }
.p67-poster-text { display: block; margin: 7px 10px 0; }
.p67-herald { width: 320px; padding-bottom: 10px; overflow: hidden; transform: rotate(-0.6deg); transform-origin: top center; }
.p67-herald[hidden] { display: none; }
.p67-herald-in { animation: p67-unroll 0.45s ease-out; }
@keyframes p67-unroll { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
.p67-herald-rays { display: grid; place-items: center; height: 86px; color: #e6b92e; font-size: 46px; text-shadow: 0 2px 0 #7a1712;
	background: repeating-conic-gradient(from 0deg at 50% 100%, #b02a22 0 6deg, #c9443a 6deg 12deg); }
.p67-herald-head { justify-content: center; font-size: 22px; letter-spacing: 0.28em; background: #1c1614; color: #efe3c4; }
.p67-herald .p67-poster-text { font-size: 16px; font-weight: 700; text-align: center; margin: 10px 14px 4px; }
.p67-herald-hint { display: block; text-align: center; color: #6b5d45; font-size: 12px; }
.p67-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 780px) { .p67-poster { width: 160px; } .p67-herald { width: 240px; } .p67-poster-text { font-size: 12px; } }
@media (prefers-reduced-motion: reduce) { .p67-herald-in { animation: none; } .p67-poster { transition: none; } }

/* The plan fulfilled: «ПЛАН ВЫПОЛНЕН!» unrolls at the top of the plant, then rolls away. */
.p67-planmet { position: absolute; top: 14px; left: 0; right: 0; z-index: 2; width: fit-content; max-width: calc(100% - 28px); margin-inline: auto; pointer-events: none;
	filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.55)); animation: p67-unroll 0.6s ease-out; }
.p67-planmet canvas { display: block; max-width: 100%; image-rendering: pixelated; }
.p67-planmet-out { animation: p67-rollup 0.5s ease-in forwards; }
@keyframes p67-rollup { from { clip-path: inset(0 0 0 0); } to { clip-path: inset(0 0 100% 0); } }
@media (prefers-reduced-motion: reduce) { .p67-planmet, .p67-planmet-out { animation: none; } }

/* The fixtures in the scenery: invisible buttons for the keyboard, the hover label, and the note card. */
.p67-fixtures { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.p67-fixture { position: absolute; top: 0; left: 0; padding: 0; margin: 0; border: 0; background: none; opacity: 0; pointer-events: none; }
.p67-fixture-label { position: absolute; top: 0; left: 0; z-index: 2; pointer-events: none; background: #1c1b19; color: #e6e1d6;
	border: 1px solid #e6b92e; border-radius: 3px; padding: 3px 8px; font-size: 12px; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5); }
.p67-fixture-label[hidden] { display: none; }
.p67-propnote { position: absolute; top: 0; left: 0; z-index: 3; width: 280px; box-sizing: border-box; padding: 10px 30px 8px 12px; background: #efe6cf; color: #2a2420;
	border: 1px solid #8a7550; border-top: 3px solid #bd352c; border-radius: 3px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5); user-select: text; }
.p67-propnote[hidden] { display: none; }
/* Furnishing: the drawer along the bottom, the selected thing's buttons, the note that says why not. */
.p67-furnish { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 5; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;
	background: rgba(28, 27, 25, 0.97); border: 1px solid #6b5d45; border-radius: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
.p67-furnish[hidden] { display: none; }
.p67-furnishing .p67-roster, .p67-furnishing .p67-minimap { visibility: hidden; }
.p67-furnish-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.p67-furnish-title { margin: 0; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #c9b27a; }
.p67-furnish-hint { margin: 0; flex: 1; color: #b8b0a0; }
.p67-furnish-items { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 2px; }
.p67-furnish-row { display: flex; gap: 6px; }
.p67-furnish-row + .p67-furnish-row { padding-left: 14px; border-left: 1px solid #3a3530; }
.p67-furnish-item { flex: none; width: 54px; height: 66px; padding: 4px; display: flex; align-items: center; justify-content: center; background: #1c1b19;
	border: 1px solid #4a453e; border-radius: 4px; cursor: grab; touch-action: none; }
.p67-furnish-item canvas { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; pointer-events: none; }
.p67-furnish-item:hover { border-color: #c9b27a; }
.p67-furnish button:focus { outline: none; }
.p67-furnish button:focus-visible, .p67-furnish-controls button:focus-visible { outline: 2px solid #f4d58a; outline-offset: 1px; }
.p67-furnish-actions { display: flex; gap: 8px; justify-content: flex-end; }
.p67-furnish-reset, .p67-furnish-done, .p67-furnish-cursor { background: #2a2c31; color: #e6e1d6; border: 1px solid #4a453e; border-radius: 4px; padding: 3px 10px; font: inherit; cursor: pointer; }
.p67-furnish-reset:hover, .p67-furnish-cursor:hover { border-color: #c9b27a; }
.p67-furnish-done { background: #bd352c; color: #f4efe2; border-color: #bd352c; }
.p67-furnish-done:hover { background: #cf4337; }
.p67-furnish-controls { position: absolute; top: 0; left: 0; z-index: 4; display: flex; gap: 4px; }
.p67-furnish-controls[hidden], .p67-furnish-controls button[hidden] { display: none; }
.p67-furnish-controls button { width: 26px; height: 26px; padding: 0; border-radius: 13px; background: rgba(22, 23, 26, 0.92); color: #f4efe2; border: 1px solid #c9b27a;
	font-size: 15px; line-height: 1; cursor: pointer; }
.p67-furnish-controls button:disabled { opacity: 0.4; cursor: default; }
.p67-furnish-note { position: absolute; top: 0; left: 0; z-index: 4; pointer-events: none; padding: 2px 8px; white-space: nowrap; background: #1c1b19; color: #f4c7b8;
	border: 1px solid #bd352c; border-radius: 4px; }
.p67-furnish-note[hidden] { display: none; }
.p67-propnote:focus { outline: none; }
.p67-propnote h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #7a2a22; }
.p67-propnote p { margin: 0 0 4px; }
.p67-propnote .p67-close { color: #6b5d45; }
.p67-sound-head { margin: 10px 0 4px; padding-top: 8px; border-top: 1px solid #3a3530; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #c9b27a; }
.p67-sound-setting { display: flex; gap: 6px; align-items: flex-start; color: #c9bfa6; font-size: 12px; cursor: pointer; }
/* The Wardrobe tab: the turning preview beside a row per part, the extras, the buttons. */
.p67-wardrobe { overflow-y: auto; min-height: 0; padding-top: 8px; }
.p67-wardrobe-top { display: flex; gap: 10px; align-items: flex-start; }
.p67-wardrobe-preview { flex: none; width: 112px; height: 188px; image-rendering: pixelated; background: #1c1b19; border: 1px solid #3a3530; border-radius: 4px; }
.p67-wardrobe-rows { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.p67-wardrobe-row { display: grid; grid-template-columns: 40px 20px 1fr 20px; gap: 3px; align-items: center; font-size: 12px; }
.p67-wardrobe-label { color: #c9b27a; }
.p67-wardrobe-arrow { height: 20px; padding: 0; background: #2a2c31; color: #e6e1d6; border: 1px solid #4a453e; border-radius: 3px; font: inherit; cursor: pointer; }
.p67-wardrobe-arrow:hover { border-color: #c9b27a; }
.p67-wardrobe-value { text-align: center; color: #e6e1d6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p67-wardrobe-cloth { grid-column: 2 / 5; min-width: 0; background: #1c1b19; color: #e6e1d6; border: 1px solid #4a453e; border-radius: 3px; font: inherit; font-size: 11px; }
.p67-wardrobe-only { grid-column: 2 / 5; color: #9a958a; font-size: 11px; text-align: center; }
.p67-wardrobe-extras { display: flex; flex-wrap: wrap; gap: 2px 10px; margin: 8px 0; padding: 4px 8px 6px; border: 1px solid #3a3530; border-radius: 4px; font-size: 12px; }
.p67-wardrobe-extras legend { color: #c9b27a; padding: 0 4px; }
.p67-wardrobe-extra { display: flex; gap: 4px; align-items: center; color: #c9bfa6; cursor: pointer; }
.p67-wardrobe-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.p67-wardrobe-actions button { background: #2a2c31; color: #e6e1d6; border: 1px solid #4a453e; border-radius: 4px; padding: 4px 10px; font: inherit; cursor: pointer; }
.p67-wardrobe-actions button:hover:not(:disabled) { border-color: #c9b27a; }
.p67-wardrobe-actions .p67-wardrobe-keep { background: #7a2a22; border-color: #bd352c; color: #f4efe2; font-weight: 600; }
.p67-wardrobe-actions button:disabled { opacity: 0.45; cursor: default; }
.p67-wardrobe-note { margin: 8px 0 0; color: #9a958a; font-size: 11px; }
/* The founding form (wizard.ts): an official paper form over the dimmed plant. */
.p67-ministry-chip { height: 26px; margin-right: 6px; padding: 0 10px; font: inherit; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
	color: #e6e1d6; background: rgba(22, 23, 26, 0.88); border: 1px solid #3a3530; border-radius: 13px; cursor: pointer; }
.p67-ministry-chip:hover { border-color: #c9b27a; }
.p67-ministry-chip.p67-nag { color: #f4efe2; background: linear-gradient(#c73b2f, #9c2820); border-color: #c9b27a; }
.p67-ministry-chip:focus-visible { outline: 2px solid #f4d58a; outline-offset: 2px; }
.p67-wiz-back { z-index: 7; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;
	background: rgba(10, 10, 12, 0.62); user-select: text; }
.p67-wiz-back[hidden] { display: none; }
.p67-wiz { width: min(880px, 100%); max-height: 100%; display: flex; flex-direction: column; box-sizing: border-box; background: #efe6cf; color: #2a2420;
	border: 3px double #7a2a22; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6); font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.p67-wiz:focus { outline: none; }
.p67-wiz [hidden] { display: none !important; }
.p67-wiz-head { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px; background: linear-gradient(#b02a22, #8c1f19); color: #f4efe2; border-bottom: 2px solid #7a1712; }
.p67-wiz-emblem { color: #f4d58a; font-size: 18px; }
.p67-wiz-head h2 { margin: 0; font: 700 15px/1.2 Georgia, 'Times New Roman', serif; letter-spacing: 0.06em; }
.p67-wiz-head small { margin-left: auto; font-size: 11px; opacity: 0.85; letter-spacing: 0.06em; }
.p67-wiz-shut { background: none; border: 1px solid rgba(244, 239, 226, 0.4); border-radius: 3px; color: #f4efe2; font: inherit; font-size: 16px; line-height: 1; padding: 2px 8px; cursor: pointer; }
.p67-wiz-shut:hover { border-color: #f4d58a; }
.p67-wiz-pips { display: flex; gap: 2px; padding: 6px 14px 0; flex-wrap: wrap; }
.p67-wiz-pip { flex: 1 1 0; min-width: 0; padding: 4px 4px 5px; font: inherit; font-size: 10.5px; letter-spacing: 0.05em; text-transform: uppercase; text-align: center; color: #8a7550;
	background: none; border: 0; border-bottom: 3px solid #d2c39c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.p67-wiz-pip:disabled { cursor: default; opacity: 0.55; }
.p67-wiz-pip.p67-on { color: #7a2a22; border-bottom-color: #bd352c; font-weight: 700; opacity: 1; }
.p67-wiz-pip.p67-done { color: #3f7a34; border-bottom-color: #8fb07f; }
.p67-wiz-body { padding: 12px 18px 8px; overflow-y: auto; min-height: 0; }
.p67-wiz-h { margin: 0 0 2px; font: 700 21px/1.2 Georgia, 'Times New Roman', serif; }
.p67-wiz-lede { margin: 0 0 12px; color: #5a4a30; font-size: 13.5px; }
.p67-wiz-foot { display: flex; align-items: center; gap: 10px; padding: 9px 18px 11px; border-top: 1px solid #c9b88a; }
.p67-wiz-gap { flex: 1; }
.p67-wiz-footnote { font-size: 12px; color: #6b5d45; }
.p67-wiz-btn { display: inline-block; background: #2a2420; color: #f4efe2; border: 1px solid #2a2420; border-radius: 3px; padding: 6px 14px; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
.p67-wiz-btn:hover { background: #3a322c; }
.p67-wiz-btn.p67-red { background: #7a2a22; border-color: #bd352c; }
.p67-wiz-btn.p67-red:hover { background: #93342a; }
.p67-wiz-btn.p67-ghost { background: none; color: #5a4a30; border-color: #b9a988; font-weight: 500; }
.p67-wiz-btn.p67-ghost:hover { border-color: #7a2a22; color: #7a2a22; }
.p67-wiz-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.p67-wiz button:focus-visible, .p67-wiz a:focus-visible, .p67-wiz pre:focus-visible, .p67-wiz canvas:focus-visible { outline: 2px solid #bd352c; outline-offset: 2px; }
.p67-wiz-field { display: grid; gap: 3px; margin-bottom: 10px; align-content: start; }
.p67-wiz-field > span:first-child { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b5d45; }
.p67-wiz-field input, .p67-wiz-field select { font: inherit; padding: 6px 8px; background: #fbf6e8; color: #2a2420; border: 1px solid #b9a988; border-radius: 2px; min-width: 0; }
.p67-wiz-field input:focus, .p67-wiz-field select:focus { outline: 2px solid #c9b27a; outline-offset: 0; }
.p67-wiz-note { display: block; font-size: 12px; color: #6b5d45; margin: 4px 0 8px; }
.p67-wiz-err { margin: 0 0 10px; padding: 7px 10px; background: #f6d9d2; color: #7a1712; border: 1px solid #bd352c; font-size: 13px; }
.p67-wiz-ok { margin: 0 0 10px; padding: 7px 10px; background: #dfe8cf; border: 1px solid #8fb07f; color: #2f5426; font-size: 13px; }
.p67-wiz-party { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 300px); gap: 20px; align-items: start; }
.p67-wiz-booklet { position: relative; padding: 14px 16px; background: linear-gradient(135deg, #a3271f, #7d1a14); color: #f4d58a; border-radius: 4px 10px 10px 4px;
	box-shadow: inset 6px 0 0 #5e130f, 0 4px 14px rgba(0, 0, 0, 0.35); font-family: Georgia, 'Times New Roman', serif; }
.p67-wiz-cap { font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; text-align: center; opacity: 0.9; }
.p67-wiz-star { text-align: center; font-size: 30px; line-height: 1.1; margin: 4px 0; }
.p67-wiz-inner { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; margin-top: 8px; padding: 9px; background: #efe3c4; color: #2a2420; border-radius: 2px; }
.p67-wiz-slot { width: 72px; height: 90px; line-height: 0; }
.p67-wiz-slotpic { width: 72px; height: 90px; image-rendering: pixelated; }
.p67-wiz-k { font: 11px system-ui, sans-serif; color: #6b5d45; text-transform: uppercase; letter-spacing: 0.06em; }
.p67-wiz-v { font-size: 15px; font-weight: 700; margin-bottom: 4px; overflow-wrap: anywhere; }
.p67-wiz-seal { position: absolute; right: 14px; bottom: 10px; width: 46px; height: 46px; box-sizing: border-box; padding: 4px; border: 3px solid rgba(189, 53, 44, 0.75); border-radius: 50%;
	color: rgba(189, 53, 44, 0.85); display: grid; place-items: center; font: 700 8px/1.1 system-ui, sans-serif; transform: rotate(-14deg); text-align: center; }
.p67-wiz-tabs { display: flex; gap: 4px; margin-bottom: 10px; border-bottom: 2px solid #c9b88a; }
.p67-wiz-tab { padding: 6px 12px; font: inherit; font-weight: 600; background: #e3d6b4; color: #5a4a30; border: 1px solid #c9b88a; border-bottom: 0; border-radius: 4px 4px 0 0; cursor: pointer; margin-bottom: -2px; }
.p67-wiz-tab[aria-selected=true] { background: #efe6cf; color: #7a2a22; border-color: #b9a988; border-bottom: 2px solid #efe6cf; }
.p67-wiz-dict { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 16px; align-items: start; }
.p67-wiz-archs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.p67-wiz-arch { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 8px; align-items: center; padding: 6px; background: #f7f0dc; border: 2px solid #d2c39c; border-radius: 3px;
	cursor: pointer; text-align: left; font: inherit; color: inherit; }
.p67-wiz-arch:hover { border-color: #b9a988; }
.p67-wiz-arch[aria-checked=true] { border-color: #bd352c; background: #fbf2dc; box-shadow: 0 0 0 2px rgba(189, 53, 44, 0.15); }
.p67-wiz-archpic { width: 48px; height: 60px; image-rendering: pixelated; }
.p67-wiz-arch b { display: block; font: 700 13px/1.15 Georgia, 'Times New Roman', serif; }
.p67-wiz-arch span { display: block; font-size: 11.5px; color: #6b5d45; margin-top: 2px; }
.p67-wiz-preview { text-align: center; }
.p67-wiz-wall { padding: 12px 0 8px; line-height: 0; background: repeating-linear-gradient(0deg, #8e3b2a 0 9px, #6e2b1f 9px 10px); border: 1px solid #5e2318; border-radius: 2px; }
.p67-wiz-big { width: 120px; height: 150px; image-rendering: pixelated; filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.45)); }
.p67-wiz-caption { font: italic 12px Georgia, 'Times New Roman', serif; color: #5a4a30; margin-top: 6px; overflow-wrap: anywhere; }
.p67-painter { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; align-items: start; }
.p67-paint-frame { line-height: 0; border: 2px solid #8a6a10; outline: 2px solid #e6b92e; background: #2b2420; }
.p67-paint { width: 280px; height: 364px; image-rendering: pixelated; cursor: crosshair; touch-action: none; }
.p67-paint-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.p67-paint-tool { padding: 4px 9px; font: inherit; font-size: 12.5px; background: #f7f0dc; color: #2a2420; border: 1px solid #b9a988; border-radius: 3px; cursor: pointer; }
.p67-paint-tool[aria-pressed=true] { background: #2a2420; color: #f4efe2; border-color: #2a2420; }
.p67-paint-tool:disabled { opacity: 0.45; cursor: default; }
.p67-swatches { display: grid; grid-template-columns: repeat(8, 22px); gap: 3px; margin-bottom: 8px; }
.p67-swatch { width: 22px; height: 22px; padding: 0; border: 1px solid rgba(0, 0, 0, 0.4); border-radius: 2px; cursor: pointer; }
.p67-swatch[aria-checked=true] { outline: 2px solid #bd352c; outline-offset: 1px; }
.p67-wiz-drop { display: grid; place-items: center; gap: 6px; padding: 18px; border: 2px dashed #b9a988; border-radius: 4px; background: #f7f0dc; text-align: center; cursor: pointer; }
.p67-wiz-row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
.p67-wiz-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.p67-wiz-choice { padding: 12px; background: #f7f0dc; border: 2px solid #d2c39c; border-radius: 3px; }
.p67-wiz-choice h4 { margin: 0 0 4px; font: 700 15px Georgia, 'Times New Roman', serif; }
.p67-wiz-choice p { margin: 0 0 8px; font-size: 13px; color: #5a4a30; }
.p67-wiz-coffee { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 18px; align-items: center; padding: 8px 4px 4px; }
.p67-wiz-mug { width: 120px; height: 120px; image-rendering: pixelated; }
.p67-wiz-coffee .p67-wiz-btn { margin-bottom: 4px; }
.p67-wiz-regimes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 4px 0 12px; }
.p67-wiz-regime { background: none; border: 4px solid; padding: 10px 6px 8px; font: inherit; cursor: pointer; transform: rotate(-2deg); text-align: center; opacity: 0.5; }
.p67-wiz-regime:nth-child(2) { transform: rotate(1.5deg); }
.p67-wiz-regime:nth-child(3) { transform: rotate(-1deg); }
.p67-wiz-regime[aria-checked=true] { opacity: 1; background: rgba(255, 255, 255, 0.35); box-shadow: inset 0 0 0 2px currentColor; }
.p67-wiz-regime.p67-green { color: #3f7a34; border-color: #3f7a34; }
.p67-wiz-regime.p67-amber { color: #9a6212; border-color: #9a6212; }
.p67-wiz-regime.p67-red { color: #bd352c; border-color: #bd352c; }
.p67-wiz-rword { display: block; font-size: 17px; font-weight: 800; letter-spacing: 0.04em; line-height: 1.1; }
.p67-wiz-rnum { display: block; font: 700 26px/1 Georgia, 'Times New Roman', serif; margin: 3px 0; }
.p67-wiz-regime small { display: block; font-size: 11px; line-height: 1.25; }
.p67-wiz-prompt { position: relative; }
.p67-wiz-prompt pre { margin: 0; max-height: 230px; overflow: auto; padding: 10px 12px; background: #fbf6e8; border: 1px solid #b9a988;
	font: 12px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; color: #2a2420; }
.p67-wiz-prompt mark { background: #f6d27a; color: #2a2420; padding: 0 2px; }
.p67-wiz-prompt .p67-copy { display: block; margin: 0 0 6px auto; }
.p67-wiz-checks { display: grid; gap: 6px; }
.p67-wiz-check { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 12px; align-items: center; padding: 7px 10px; background: #f7f0dc; border: 1px solid #d2c39c; }
.p67-wiz-check b { display: block; font-size: 13.5px; }
.p67-wiz-check span { display: block; font-size: 12px; color: #6b5d45; overflow-wrap: anywhere; }
.p67-wiz-st { justify-self: center; padding: 3px 6px; border: 3px solid; font-weight: 800; font-size: 13px; letter-spacing: 0.04em; transform: rotate(-3deg); text-align: center; line-height: 1.1; }
.p67-wiz-st.p67-ok { color: #3f7a34; border-color: #3f7a34; }
.p67-wiz-st.p67-fresh { animation: p67-thud 0.25s ease-out; }
.p67-wiz-st.p67-bad { color: #9a6212; border-color: #9a6212; }
.p67-wiz-st.p67-no, .p67-wiz-st.p67-manual { color: #a8997a; border-color: #c9b88a; border-style: dashed; font-weight: 600; font-size: 11px; transform: none; }
@keyframes p67-thud { 0% { transform: scale(1.8) rotate(-12deg); opacity: 0; } 70% { transform: scale(0.95) rotate(-3deg); opacity: 1; } 100% { transform: rotate(-3deg); } }
@media (prefers-reduced-motion: reduce) { .p67-wiz-st.p67-fresh { animation: none; } }
@media (max-width: 760px) {
	.p67-wiz-back { padding: 0; }
	.p67-wiz-party, .p67-wiz-dict, .p67-painter, .p67-wiz-two, .p67-wiz-coffee { grid-template-columns: minmax(0, 1fr); }
	.p67-wiz-archs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.p67-wiz-regimes { grid-template-columns: minmax(0, 1fr); }
}
.p67-wiz-err p { margin: 0 0 6px; }
.p67-wiz-err[hidden] { display: none; }
.p67-wiz-confirm { margin: 0 0 12px; padding: 9px 12px; background: #f3e4c0; color: #6b4410; border: 1px solid #9a6212; font-size: 13px; }
.p67-wiz-confirm p { margin: 0 0 8px; }
.p67-wiz-confirm .p67-wiz-btn { margin-right: 8px; }
.p67-wiz-fold summary { cursor: pointer; font-weight: 600; color: #5a4a30; margin-bottom: 6px; }
.p67-wiz-field select:disabled { color: #8a7550; }
`;

/**
 * Install the stylesheet. A constructed stylesheet is used where possible: unlike a <style>
 * element it is not blocked by a host page's style-src policy.
 *
 * @param doc Document to style.
 */
export function installStyles(doc: Document): void {
	try {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(COCKPIT_CSS);
		doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	} catch {
		const style = doc.createElement('style');
		style.textContent = COCKPIT_CSS;
		doc.head.append(style);
	}
}
