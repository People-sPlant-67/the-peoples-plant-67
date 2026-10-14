import './style.css';
const videoUrl = new URL('./media/tour.mp4', import.meta.url).href;

const frame = document.querySelector<HTMLDivElement>('#frame')!;
const video = document.querySelector<HTMLVideoElement>('#video')!;
const status = document.querySelector<HTMLElement>('#status')!;
const loading = document.querySelector<HTMLElement>('#loading')!;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const compact = matchMedia('(max-width: 720px)');
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
let iframe: HTMLIFrameElement | null = null;
let videoMode = compact.matches || saveData || reduced.matches;
let autoplayBlocked = false;
let visible = true;
let ready = false;
let videoFailed = false;
let playAttempt = 0;
let bootTimer: ReturnType<typeof setTimeout> | undefined;
const scenes = [
	['See where the work happens.', 'Comrades work at their stations, rest in the canteen and wait for your orders.'],
	['Give an order. Read the reply.', 'A fictional directive reaches Night Shift Welder. His answer comes back in the plant.'],
	['The board decides.', 'Read the Director’s report. In the full demo, hold a stamp to pardon or convict.'],
];

/** Keep readable context outside both the canvas and the mobile video. */
function scene(index: number): void {
	const words = scenes[index];
	if (!words) return;
	document.querySelector('#scene-number')!.textContent = String(index + 1).padStart(2, '0');
	document.querySelector('#caption')!.textContent = words[0];
	document.querySelector('#description')!.textContent = words[1];
}

/** Suspend automatic playback offscreen and respect reduced motion. */
function sync(): void {
	const stopped = reduced.matches || !visible || document.hidden;
	clearTimeout(bootTimer);
	if (!videoMode && !ready && !stopped) bootTimer = setTimeout(() => useVideo('The live tour could not start. Showing the recorded tour.'), 60_000);
	document.querySelector('#mode')!.textContent = videoMode ? 'Recorded tour' : 'Live engine';
	if (videoMode) {
		const attempt = ++playAttempt;
		if (stopped || videoFailed || autoplayBlocked) video.pause();
		else {
			if (!video.getAttribute('src')) video.src = videoUrl;
			void video.play().catch(() => {
				if (attempt !== playAttempt || videoFailed) return;
				autoplayBlocked = true; video.style.display = 'none'; scene(0);
				status.textContent = 'Your browser paused the tour. Open the demo to explore the plant.';
			});
		}
	} else iframe?.contentWindow?.postMessage({ type: 'plant-tour-control', paused: stopped }, location.origin);
}

/** Remove the whole engine realm, including workers, timers and fictional storage. */
function unload(): void {
	playAttempt++;
	clearTimeout(bootTimer);
	iframe?.remove();
	iframe = null;
	frame.replaceChildren();
}

/** Show a video fallback with the poster still available if decoding fails. */
function useVideo(reason: string): void {
	unload();
	videoMode = true;
	document.querySelector('#stage')!.classList.remove('live');
	videoFailed = false;
	ready = true;
	loading.hidden = true;
	autoplayBlocked = false;
	video.style.display = reduced.matches ? 'none' : 'block';
	scene(0);
	status.textContent = reason;
	sync();
}

/** Each loop starts with a fresh isolated fictional plant. */
function startLive(): void {
	unload();
	video.pause();
	video.style.display = 'none';
	videoMode = false;
	document.querySelector('#stage')!.classList.add('live');
	ready = false;
	scene(0);
	loading.hidden = false;
	status.textContent = 'The tour uses fictional data.';
	iframe = document.createElement('iframe');
	iframe.title = 'Scripted tour of a fictional plant';
	iframe.tabIndex = -1;
	iframe.setAttribute('aria-hidden', 'true');
	iframe.src = new URL('./tour.html', location.href).href;
	iframe.addEventListener('load', sync);
	frame.append(iframe);
	sync();
}

window.addEventListener('message', (event) => {
	if (!iframe || event.source !== iframe.contentWindow || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
	switch (event.data.type) {
		case 'plant-tour-ready': ready = true; clearTimeout(bootTimer); loading.hidden = true; sync(); break;
		case 'plant-tour-scene': if (Number.isInteger(event.data.scene)) scene(event.data.scene); break;
		case 'plant-tour-done': startLive(); break;
		case 'plant-tour-slow': useVideo('The live tour is running slowly. Showing the recorded tour.'); break;
		case 'plant-tour-error': useVideo('The live tour stopped. Showing the recorded tour.'); break;
	}
});
video.addEventListener('timeupdate', () => {
	if (!reduced.matches && !videoFailed && !autoplayBlocked) scene(video.currentTime < 7.12 ? 0 : video.currentTime < 18.17 ? 1 : 2);
});
video.addEventListener('error', () => { videoFailed = true; video.style.display = 'none'; scene(0); status.textContent = 'The tour could not load. Open the demo to explore the plant.'; sync(); });
document.addEventListener('visibilitychange', sync);
new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0.05 }).observe(document.querySelector('.hero')!);
reduced.addEventListener('change', () => {
	if (reduced.matches) useVideo('Motion is off to match your device settings.');
	else { video.style.display = videoFailed || autoplayBlocked ? 'none' : 'block'; status.textContent = 'The tour uses fictional data.'; sync(); }
});
compact.addEventListener('change', () => { if (compact.matches && !videoMode) useVideo('Recorded tour for a smaller screen.'); });
window.addEventListener('pagehide', () => { unload(); video.pause(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) { if (videoMode) sync(); else startLive(); } });
if (videoMode) useVideo(reduced.matches ? 'Motion is off to match your device settings.' : 'Recorded tour. The live engine is stopped.');
else startLive();
