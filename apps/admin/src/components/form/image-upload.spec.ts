import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { checkImageFile, isHeic, uploadProblem } from './image-upload';

const MB = 1024 * 1024;

describe('image upload checks', () => {
    it('stops iPhone HEIC photos, other types and big files before uploading', () => {
        expect(checkImageFile({ name: 'IMG_0001.HEIC', type: '', size: MB }, 15)).toBe('heic');
        expect(checkImageFile({ name: 'photo', type: 'image/heif', size: MB }, 15)).toBe('heic');
        expect(checkImageFile({ name: 'logo.svg', type: 'image/svg+xml', size: 1000 }, 15)).toBe('wrongType');
        expect(checkImageFile({ name: 'scan.pdf', type: 'application/pdf', size: 1000 }, 15)).toBe(
            'wrongType',
        );
        expect(checkImageFile({ name: 'logo.png', type: 'image/png', size: 3 * MB }, 2)).toBe('tooBig');
        for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']) {
            expect(checkImageFile({ name: 'photo', type, size: MB }, 15)).toBeNull();
        }
        expect(isHeic({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false);
    });

    it('turns the server’s refusals into a clear message', () => {
        expect(uploadProblem(new ApiError('…', 'BD_IMAGE_TOO_LARGE'))).toBe('tooBig');
        expect(uploadProblem(new ApiError('…', 'BD_IMAGE_TOO_MANY_PIXELS'))).toBe('tooManyPixels');
        expect(uploadProblem(new ApiError('…', 'BD_IMAGE_UNREADABLE'))).toBe('damaged');
        expect(uploadProblem(new ApiError('…', 'BD_IMAGE_HEIC'))).toBe('heic');
        expect(uploadProblem(new ApiError('…', 'BD_IMAGE_UNSUPPORTED'))).toBe('wrongType');
        expect(uploadProblem(new ApiError('…', 'NETWORK'))).toBe('failed');
        expect(uploadProblem(new Error('boom'))).toBe('failed');
    });
});
