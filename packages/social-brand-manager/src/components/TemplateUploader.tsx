/* (c) Copyright Frontify Ltd., all rights reserved. */

'use client';

import { useCallback, useState } from 'react';
import type { SmartTemplate } from '../types/SmartTemplate';

// ─── Types ────────────────────────────────────────────────────────────────────

type TemplateUploaderProps = {
    onTemplateLoaded: (template: SmartTemplate) => void;
};

const ACCEPTED_EXTENSIONS = ['.psd', '.svg'];
const ACCEPTED_MIME = ['image/svg+xml', 'image/vnd.adobe.photoshop', 'application/octet-stream'];

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplateUploader({ onTemplateLoaded }: TemplateUploaderProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const upload = useCallback(
        async (file: File) => {
            setError(null);
            setIsUploading(true);

            try {
                const formData = new FormData();
                formData.append('file', file);

                const res = await fetch('/api/templates', { method: 'POST', body: formData });

                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error((body as { error?: string }).error ?? `Upload failed: ${res.status}`);
                }

                const { template } = (await res.json()) as { template: SmartTemplate };
                onTemplateLoaded(template);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setIsUploading(false);
            }
        },
        [onTemplateLoaded],
    );

    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) upload(file);
        },
        [upload],
    );

    const handleFileInput = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
        },
        [upload],
    );

    return (
        <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
            <div className="text-center max-w-md">
                <h2 className="text-2xl font-bold text-gray-800">Brand Template Editor</h2>
                <p className="mt-2 text-gray-500 text-sm">
                    Upload a Photoshop (.psd) or SVG template to get started. Brand-locked layers
                    are preserved automatically.
                </p>
            </div>

            <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={[
                    'w-full max-w-md border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-4 cursor-pointer transition-all',
                    isDragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-gray-50 hover:border-brand-400',
                ].join(' ')}
            >
                {isUploading ? (
                    <>
                        <div className="animate-spin h-10 w-10 border-4 border-brand-500 border-t-transparent rounded-full" />
                        <p className="text-sm text-gray-500">Parsing template…</p>
                    </>
                ) : (
                    <>
                        <div className="text-5xl">🎨</div>
                        <div className="text-center">
                            <p className="text-gray-700 font-medium">Drag & drop your template</p>
                            <p className="text-sm text-gray-400 mt-1">or</p>
                        </div>
                        <label className="px-5 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium cursor-pointer hover:bg-brand-600 transition-colors">
                            Browse files
                            <input
                                type="file"
                                className="sr-only"
                                accept={ACCEPTED_EXTENSIONS.join(',')}
                                onChange={handleFileInput}
                            />
                        </label>
                        <p className="text-xs text-gray-400">Supports PSD, SVG</p>
                    </>
                )}
            </div>

            {error && (
                <div className="w-full max-w-md bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
                    {error}
                </div>
            )}

            {/* Sample templates */}
            <div className="w-full max-w-md">
                <p className="text-xs font-medium text-gray-400 text-center mb-3">Or start with a blank template</p>
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { label: 'Instagram Post', platform: 'instagram-post' as const, w: 1080, h: 1080 },
                        { label: 'Story', platform: 'instagram-story' as const, w: 1080, h: 1920 },
                        { label: 'LinkedIn', platform: 'linkedin-post' as const, w: 1200, h: 627 },
                    ].map(({ label, platform, w, h }) => (
                        <button
                            key={platform}
                            type="button"
                            className="flex flex-col items-center gap-2 p-3 bg-white border border-gray-200 rounded-xl hover:border-brand-400 hover:shadow-sm transition-all text-xs text-gray-600 font-medium"
                            onClick={() => onTemplateLoaded(createBlankTemplate(platform, w, h))}
                        >
                            <div
                                className="bg-gray-100 rounded"
                                style={{
                                    width: 40,
                                    height: 40 * (h / w),
                                    maxHeight: 56,
                                }}
                            />
                            {label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ─── Blank Template ───────────────────────────────────────────────────────────

function createBlankTemplate(platform: string, width: number, height: number): SmartTemplate {
    const { v4: uuidv4 } = require('uuid') as { v4: () => string };

    return {
        id: uuidv4(),
        name: `New ${platform} Template`,
        description: '',
        version: '1.0.0',
        status: 'draft',
        dimensions: { width, height },
        platforms: [platform as SmartTemplate['platforms'][0]],
        brand: { colors: [], fonts: [], logos: [] },
        layers: [
            {
                id: uuidv4(),
                name: 'Background',
                type: 'background',
                transform: { x: 0, y: 0, width, height, rotation: 0, scaleX: 1, scaleY: 1 },
                constraints: {
                    locked: { position: true, size: true, rotation: true, opacity: true, color: false, font: false, content: false, hidden: false },
                    editable: true,
                    required: false,
                },
                properties: { layerType: 'background', opacity: 1, blendMode: 'normal', visible: true, zIndex: 0, assetId: null, src: null, objectFit: 'cover', objectPosition: 'center' },
            },
            {
                id: uuidv4(),
                name: 'Headline*',
                type: 'text',
                transform: { x: 60, y: height - 240, width: width - 120, height: 80, rotation: 0, scaleX: 1, scaleY: 1 },
                constraints: {
                    locked: { position: false, size: false, rotation: true, opacity: false, color: false, font: true, content: false, hidden: false },
                    editable: true,
                    required: true,
                    placeholder: 'Enter your headline',
                },
                properties: { layerType: 'text', opacity: 1, blendMode: 'normal', visible: true, zIndex: 1, content: '', fontFamily: 'sans-serif', fontWeight: 700, fontSize: 48, lineHeight: 1.1, letterSpacing: -1, color: '#ffffff', align: 'left', verticalAlign: 'bottom', textTransform: 'none', truncate: false },
            },
        ],
        metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            author: 'New',
            tags: [],
            sourceFormat: 'manual',
        },
    };
}
