import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { adminUpload, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Button } from '../ui/button';

export interface UploadedImage {
    id: string;
    preview: string;
}

const CREATE_ASSETS = `
    mutation CreateAssets($input: [CreateAssetInput!]!) {
        createAssets(input: $input) {
            __typename
            ... on Asset { id preview }
            ... on MimeTypeError { mimeType }
            ... on ErrorResult { errorCode message }
        }
    }
`;

/** What the server accepts (phase 09): checked again there from the file's bytes. No SVG. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** The server's limit; a component may ask for less (a logo needn't be 15 MB). */
const SERVER_MAX_MEGABYTES = 15;

/** iPhone photos: sharp can't read HEVC, so they are refused before a slow upload. */
export function isHeic(file: { name: string; type: string }): boolean {
    return /^image\/hei[cf]/.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

export type UploadProblem = 'wrongType' | 'heic' | 'tooBig' | 'tooManyPixels' | 'damaged' | 'failed';

/** The problem with a file before it is sent, if any. */
export function checkImageFile(file: { name: string; type: string; size: number }, maxMegabytes: number) {
    if (isHeic(file)) return 'heic';
    if (!ACCEPTED.includes(file.type)) return 'wrongType';
    if (file.size > maxMegabytes * 1024 * 1024) return 'tooBig';
    return null;
}

/** The problem the server reported (error codes from the bd-images plugin, and Vendure's type check). */
export function uploadProblem(error: unknown): UploadProblem {
    if (!(error instanceof ApiError)) return 'failed';
    switch (error.code) {
        case 'BD_IMAGE_TOO_LARGE':
            return 'tooBig';
        case 'BD_IMAGE_TOO_MANY_PIXELS':
            return 'tooManyPixels';
        case 'BD_IMAGE_UNREADABLE':
            return 'damaged';
        case 'BD_IMAGE_HEIC':
            return 'heic';
        case 'BD_IMAGE_UNSUPPORTED':
            return 'wrongType';
        default:
            return 'failed';
    }
}

interface ImageUploadProps {
    value: UploadedImage | null;
    onChange(image: UploadedImage | null): void;
    maxMegabytes?: number;
    disabled?: boolean;
    id?: string;
    'aria-describedby'?: string;
}

/**
 * Uploads an image through Vendure's normal asset upload (the logo, the favicon, later product
 * photos), showing how much has been sent. Checks type and size first, so a slow mobile connection
 * isn't wasted on a refused file; the server checks again and cleans the image (phase 09).
 */
export function ImageUpload({
    value,
    onChange,
    maxMegabytes = SERVER_MAX_MEGABYTES,
    disabled,
    ...aria
}: ImageUploadProps) {
    const { messages: m } = useI18n();
    const u = m.inputs.upload;
    const input = useRef<HTMLInputElement>(null);
    const [progress, setProgress] = useState<number | null>(null);
    const [problem, setProblem] = useState<UploadProblem | null>(null);
    const busy = progress !== null;
    const limit = Math.min(maxMegabytes, SERVER_MAX_MEGABYTES);

    const upload = async (file: File | undefined) => {
        if (!file) return;
        const early = checkImageFile(file, limit);
        setProblem(early);
        if (early) return;
        setProgress(0);
        try {
            const { createAssets } = await adminUpload<{
                createAssets: Array<{ __typename: string; id?: string; preview?: string; mimeType?: string }>;
            }>(CREATE_ASSETS, file, setProgress);
            const asset = createAssets[0];
            if (asset?.__typename === 'Asset' && asset.id && asset.preview) {
                onChange({ id: asset.id, preview: asset.preview });
            } else {
                setProblem(
                    asset?.mimeType && isHeic({ name: '', type: asset.mimeType }) ? 'heic' : 'wrongType',
                );
            }
        } catch (error) {
            setProblem(uploadProblem(error));
        } finally {
            setProgress(null);
            if (input.current) input.current.value = '';
        }
    };

    const percent = Math.round((progress ?? 0) * 100);
    const message = problem === 'tooBig' ? u.tooBig(limit) : problem ? u[problem] : null;

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-300 bg-slate-50">
                    {value ? (
                        <img
                            src={`${value.preview}?preset=thumb`}
                            alt=""
                            className="size-full object-contain"
                        />
                    ) : (
                        <ImagePlus className="size-6 text-slate-400" aria-hidden />
                    )}
                </div>
                <input
                    ref={input}
                    type="file"
                    accept={ACCEPTED.join(',')}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={event => upload(event.target.files?.[0])}
                    disabled={disabled || busy}
                />
                <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    disabled={disabled}
                    onClick={() => input.current?.click()}
                    {...aria}
                >
                    {busy ? (percent < 100 ? u.uploading : u.processing) : value ? u.change : u.choose}
                </Button>
                {value && !busy && (
                    <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
                        <Trash2 className="size-4" aria-hidden />
                        {u.remove}
                    </Button>
                )}
            </div>
            {busy && (
                <div
                    role="progressbar"
                    aria-label={u.uploading}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-200"
                >
                    <div
                        className="h-full bg-teal-700 transition-[width]"
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}
            {message && (
                <p role="alert" className="text-sm text-red-700">
                    {message}
                </p>
            )}
        </div>
    );
}
