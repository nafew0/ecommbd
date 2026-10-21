import os from 'node:os';
import sharp from 'sharp';
import { cleanImage, makeVariants } from '../src/plugins/bd-images/pipeline';
import { phonePhoto } from '../test/support/images';

/**
 * Throughput of the image pipeline for capacity planning (roadmap phase 09):
 * `npm run images:throughput -w @ecommbd/core [-- <count>]`.
 *
 * Cleans and makes the WebP sizes of 100 different 5 MB phone photos one after another, as the
 * worker does, with libvips limited to 2 threads to stand in for a 2 vCPU server. Making the test
 * photos is not timed.
 */
async function main() {
    const count = Number(process.argv[2] ?? 100);
    sharp.concurrency(2);
    console.log(`Making ${count} test photos…`);
    const photos: Buffer[] = [];
    for (let i = 0; i < count; i++) photos.push(await phonePhoto(i));
    const started = Date.now();
    let bytes = 0;
    for (const photo of photos) {
        const clean = await cleanImage(photo);
        const made = await makeVariants(clean.data);
        bytes += made.variants.reduce((sum, variant) => sum + variant.data.byteLength, 0);
    }
    const seconds = (Date.now() - started) / 1000;
    console.log(
        `${count} photos in ${seconds.toFixed(1)} s (${(seconds / count).toFixed(2)} s each, 2 libvips threads, ` +
            `${os.cpus()[0]?.model ?? 'unknown CPU'}); sizes average ${Math.round(bytes / count / 1024)} KB per photo`,
    );
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
