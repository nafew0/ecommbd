import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { adminUpload } from '../../lib/api';
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
            ... on ErrorResult { errorCode message }
        }
    }
`;

/** Raster images only: SVG can carry scripts, so it waits for phase 09's upload checks. */
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

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
 * photos). Checks type and size first, so a slow mobile connection isn't wasted on a refused file.
 */
export function ImageUpload({ value, onChange, maxMegabytes = 2, disabled, ...aria }: ImageUploadProps) {
    const { messages: m } = useI18n();
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const upload = async (file: File | undefined) => {
        if (!file) return;
        setError(null);
        if (!ACCEPTED.includes(file.type)) {
            setError(m.inputs.upload.wrongType);
            return;
        }
        if (file.size > maxMegabytes * 1024 * 1024) {
            setError(m.inputs.upload.tooBig(maxMegabytes));
            return;
        }
        setBusy(true);
        try {
            const { createAssets } = await adminUpload<{
                createAssets: Array<{ __typename: string; id?: string; preview?: string }>;
            }>(CREATE_ASSETS, file);
            const asset = createAssets[0];
            if (asset?.__typename === 'Asset' && asset.id && asset.preview) {
                onChange({ id: asset.id, preview: asset.preview });
            } else {
                setError(m.inputs.upload.wrongType);
            }
        } catch {
            setError(m.inputs.upload.failed);
        } finally {
            setBusy(false);
            if (input.current) input.current.value = '';
        }
    };

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
                    {busy
                        ? m.inputs.upload.uploading
                        : value
                          ? m.inputs.upload.change
                          : m.inputs.upload.choose}
                </Button>
                {value && !busy && (
                    <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
                        <Trash2 className="size-4" aria-hidden />
                        {m.inputs.upload.remove}
                    </Button>
                )}
            </div>
            {error && (
                <p role="alert" className="text-sm text-red-700">
                    {error}
                </p>
            )}
        </div>
    );
}
