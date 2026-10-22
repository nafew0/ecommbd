/**
 * Video sections (roadmap phase 15): the cover image and play button are ours; YouTube's or
 * Facebook's player loads only when the shopper presses play. The address comes from the server
 * (`data-video`, built from a checked YouTube or Facebook link). Without JavaScript the play button
 * is a link to the video.
 */
export function attachVideos(root: ParentNode = document) {
    for (const frame of root.querySelectorAll<HTMLElement>('[data-video]:not([data-ready])')) {
        frame.dataset.ready = '';
        frame.querySelector('[data-video-play]')?.addEventListener('click', event => {
            event.preventDefault();
            const player = document.createElement('iframe');
            player.src = frame.dataset.video!;
            player.title = frame.dataset.videoTitle ?? '';
            player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
            player.allowFullscreen = true;
            player.referrerPolicy = 'strict-origin-when-cross-origin';
            frame.replaceChildren(player);
            player.focus();
        });
    }
}
