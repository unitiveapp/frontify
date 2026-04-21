/* (c) Copyright Unitiveapp, all rights reserved. */

'use client';

import { useCallback, useState } from 'react';
import type { SmartTemplate } from '../types/SmartTemplate';

// ─── Types ────────────────────────────────────────────────────────────────────

type TemplateUploaderProps = {
    onTemplateLoaded: (template: SmartTemplate) => void;
    /** Called when user wants to open the Frontify native template chooser */
    onOpenFrontifyChooser?: () => void;
    /** Whether the Frontify AppBridge is available (platform app context) */
    hasFrontifyBridge?: boolean;
};

type IngestionTab = 'upload' | 'figma' | 'frontify' | 'blank';

const ACCEPTED_EXTENSIONS = ['.psd', '.svg', '.idml'];

// ─── Upload tab ───────────────────────────────────────────────────────────────

function FileUploadTab({ onTemplateLoaded }: Pick<TemplateUploaderProps, 'onTemplateLoaded'>) {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);

    const upload = useCallback(
        async (file: File) => {
            setError(null);
            setWarnings([]);
            setIsUploading(true);
            try {
                const formData = new FormData();
                formData.append('file', file);
                const res = await fetch('/api/templates', { method: 'POST', body: formData });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error((body as { error?: string }).error ?? `Upload failed: ${res.status}`);
                }
                const { template, warnings: w } = (await res.json()) as { template: SmartTemplate; warnings: string[] };
                if (w?.length) setWarnings(w);
                onTemplateLoaded(template);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Upload failed');
            } finally {
                setIsUploading(false);
            }
        },
        [onTemplateLoaded],
    );

    return (
        <div className="space-y-4">
            <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
                className={['w-full border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-all', isDragging ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-gray-50 hover:border-brand-400'].join(' ')}
            >
                {isUploading ? (
                    <>
                        <div className="animate-spin h-8 w-8 border-4 border-brand-500 border-t-transparent rounded-full" />
                        <p className="text-sm text-gray-500">Parsing template…</p>
                    </>
                ) : (
                    <>
                        <div className="flex gap-3 text-3xl">
                            <span title="Photoshop">📄</span>
                            <span title="InDesign">📰</span>
                            <span title="SVG">🎨</span>
                        </div>
                        <div className="text-center">
                            <p className="text-gray-700 font-medium text-sm">Drag & drop your template</p>
                            <p className="text-xs text-gray-400 mt-1">PSD · IDML · SVG</p>
                        </div>
                        <label className="px-4 py-1.5 bg-brand-500 text-white rounded-lg text-sm font-medium cursor-pointer hover:bg-brand-600 transition-colors">
                            Browse
                            <input type="file" className="sr-only" accept={ACCEPTED_EXTENSIONS.join(',')} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                        </label>
                    </>
                )}
            </div>

            {/* Format guide */}
            <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
                {[
                    { ext: '.psd', label: 'Photoshop', hint: 'Prefix layers with ! to lock them' },
                    { ext: '.idml', label: 'InDesign', hint: 'Stories + Styles extracted automatically' },
                    { ext: '.svg', label: 'SVG', hint: 'id="locked-*" locks a layer' },
                ].map(({ ext, label, hint }) => (
                    <div key={ext} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                        <p className="font-mono font-bold text-gray-700">{ext}</p>
                        <p className="font-medium text-gray-600 mt-0.5">{label}</p>
                        <p className="text-gray-400 mt-1 leading-tight">{hint}</p>
                    </div>
                ))}
            </div>

            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>}
            {warnings.map((w, i) => (
                <div key={i} className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-700">⚠ {w}</div>
            ))}
        </div>
    );
}

// ─── Figma tab ────────────────────────────────────────────────────────────────

function FigmaTab({ onTemplateLoaded }: Pick<TemplateUploaderProps, 'onTemplateLoaded'>) {
    const [url, setUrl] = useState('');
    const [token, setToken] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleImport = async () => {
        setError(null);
        if (!url.trim()) { setError('Enter a Figma file URL'); return; }
        if (!token.trim()) { setError('Enter your Figma personal access token'); return; }
        setIsLoading(true);
        try {
            const res = await fetch('/api/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ figmaUrl: url.trim(), figmaToken: token.trim() }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error((body as { error?: string }).error ?? `Import failed: ${res.status}`);
            }
            const { template } = (await res.json()) as { template: SmartTemplate };
            onTemplateLoaded(template);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Import failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-4">
                <span className="text-xl mt-0.5">🔷</span>
                <div className="text-sm text-blue-800">
                    <p className="font-semibold">Import from Figma</p>
                    <p className="text-blue-600 mt-1">The first frame on the first page is imported as a SmartTemplate. Layers named <code className="bg-blue-100 px-1 rounded">!Name</code> are brand-locked; <code className="bg-blue-100 px-1 rounded">Name*</code> are required.</p>
                </div>
            </div>

            <div className="space-y-3">
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Figma file URL</label>
                    <input
                        type="url"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder="https://www.figma.com/design/ABC123/My-Brand-Template"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                    />
                </div>

                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                        Personal access token
                        <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" rel="noopener noreferrer" className="ml-2 text-brand-500 hover:underline font-normal">
                            How to get one ↗
                        </a>
                    </label>
                    <input
                        type="password"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                        placeholder="figd_…"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                    />
                </div>
            </div>

            <button
                type="button"
                className="w-full py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                onClick={handleImport}
                disabled={isLoading}
            >
                {isLoading ? <><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> Importing…</> : '↓ Import from Figma'}
            </button>

            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>}
        </div>
    );
}

// ─── Frontify chooser tab ─────────────────────────────────────────────────────

function FrontifyChooserTab({ onOpenFrontifyChooser, hasFrontifyBridge }: Pick<TemplateUploaderProps, 'onOpenFrontifyChooser' | 'hasFrontifyBridge'>) {
    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 bg-purple-50 border border-purple-100 rounded-xl p-4">
                <span className="text-xl mt-0.5">🏷</span>
                <div className="text-sm text-purple-800">
                    <p className="font-semibold">Frontify Template Library</p>
                    <p className="text-purple-600 mt-1">
                        Select a template from your Frontify brand portal. The preview image is imported
                        as a guide layer, and you can build editable fields on top.
                    </p>
                </div>
            </div>

            {/* Architecture reference */}
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 text-xs font-mono text-gray-500 space-y-1">
                <p className="font-semibold text-gray-600 not-italic text-[11px] uppercase tracking-wider mb-2">How it works</p>
                {[
                    'appBridge.dispatch(openTemplateChooser())',
                    '→ event: templateChosen  { template: TemplateLegacy }',
                    '→ frontifyLegacyTemplateToSmartTemplate(template)',
                    '→ SmartTemplate (preview layer + editable scaffold)',
                    '→ appBridge.updateBlockSettings(serializeSmartTemplate(...))',
                ].map((line, i) => <p key={i}>{line}</p>)}
            </div>

            <button
                type="button"
                className={['w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2', hasFrontifyBridge ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'].join(' ')}
                onClick={hasFrontifyBridge ? onOpenFrontifyChooser : undefined}
                disabled={!hasFrontifyBridge}
                title={hasFrontifyBridge ? 'Open template chooser' : 'Only available inside a Frontify Platform App'}
            >
                {hasFrontifyBridge ? '🏷 Open Frontify Template Chooser' : '⚠ Requires Frontify App Context'}
            </button>

            {!hasFrontifyBridge && (
                <p className="text-xs text-gray-400 text-center">
                    Deploy this as a Frontify Platform App and pass an AppBridgeBlock instance to enable this.
                </p>
            )}
        </div>
    );
}

// ─── Blank templates ──────────────────────────────────────────────────────────

const BLANK_PRESETS = [
    { label: 'IG Post', platform: 'instagram-post' as const, w: 1080, h: 1080, aspect: '1/1' },
    { label: 'IG Story', platform: 'instagram-story' as const, w: 1080, h: 1920, aspect: '9/16' },
    { label: 'LinkedIn', platform: 'linkedin-post' as const, w: 1200, h: 627, aspect: '1.91/1' },
    { label: 'Twitter', platform: 'twitter-post' as const, w: 1600, h: 900, aspect: '16/9' },
    { label: 'YouTube', platform: 'youtube-thumbnail' as const, w: 1280, h: 720, aspect: '16/9' },
    { label: 'Pinterest', platform: 'pinterest-pin' as const, w: 1000, h: 1500, aspect: '2/3' },
];

function BlankTab({ onTemplateLoaded }: Pick<TemplateUploaderProps, 'onTemplateLoaded'>) {
    return (
        <div className="grid grid-cols-3 gap-3">
            {BLANK_PRESETS.map(({ label, platform, w, h }) => (
                <button
                    key={platform}
                    type="button"
                    className="flex flex-col items-center gap-2 p-3 bg-white border border-gray-200 rounded-xl hover:border-brand-400 hover:shadow-sm transition-all text-xs text-gray-700 font-medium"
                    onClick={() => onTemplateLoaded(createBlankTemplate(platform, w, h))}
                >
                    <div
                        className="bg-gray-100 rounded w-full"
                        style={{ aspectRatio: `${w}/${h}`, maxHeight: 60 }}
                    />
                    <span>{label}</span>
                    <span className="text-gray-400 font-normal">{w}×{h}</span>
                </button>
            ))}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TemplateUploader({ onTemplateLoaded, onOpenFrontifyChooser, hasFrontifyBridge = false }: TemplateUploaderProps) {
    const [tab, setTab] = useState<IngestionTab>('upload');

    const tabs: { id: IngestionTab; label: string; icon: string }[] = [
        { id: 'upload', label: 'File Upload', icon: '📁' },
        { id: 'figma', label: 'Figma', icon: '🔷' },
        { id: 'frontify', label: 'Frontify', icon: '🏷' },
        { id: 'blank', label: 'Blank', icon: '✦' },
    ];

    return (
        <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
            <div className="text-center max-w-lg">
                <h2 className="text-2xl font-bold text-gray-800">Uniplate</h2>
                <p className="mt-2 text-gray-500 text-sm">
                    Import a Photoshop, InDesign, SVG, or Figma design — or start from a blank canvas. Brand-locked layers are preserved automatically.
                </p>
            </div>

            <div className="w-full max-w-lg">
                {/* Tabs */}
                <div className="flex border-b border-gray-200 mb-5">
                    {tabs.map(({ id, label, icon }) => (
                        <button
                            key={id}
                            type="button"
                            className={['flex-1 py-2 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors', tab === id ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'].join(' ')}
                            onClick={() => setTab(id)}
                        >
                            <span>{icon}</span> {label}
                        </button>
                    ))}
                </div>

                {tab === 'upload' && <FileUploadTab onTemplateLoaded={onTemplateLoaded} />}
                {tab === 'figma' && <FigmaTab onTemplateLoaded={onTemplateLoaded} />}
                {tab === 'frontify' && <FrontifyChooserTab onOpenFrontifyChooser={onOpenFrontifyChooser} hasFrontifyBridge={hasFrontifyBridge} />}
                {tab === 'blank' && <BlankTab onTemplateLoaded={onTemplateLoaded} />}
            </div>
        </div>
    );
}

// ─── Blank Template Factory ───────────────────────────────────────────────────

function createBlankTemplate(platform: string, width: number, height: number): SmartTemplate {
    const id = () => Math.random().toString(36).slice(2);

    return {
        id: id(),
        name: `New ${platform} Template`,
        description: '',
        version: '1.0.0',
        status: 'draft',
        dimensions: { width, height },
        platforms: [platform as SmartTemplate['platforms'][0]],
        brand: { colors: [], fonts: [], logos: [] },
        layers: [
            {
                id: id(),
                name: '!Background',
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
                id: id(),
                name: 'Headline*',
                type: 'text',
                transform: { x: 60, y: Math.round(height * 0.75), width: width - 120, height: 80, rotation: 0, scaleX: 1, scaleY: 1 },
                constraints: {
                    locked: { position: false, size: false, rotation: true, opacity: false, color: false, font: true, content: false, hidden: false },
                    editable: true,
                    required: true,
                    placeholder: 'Enter your headline',
                },
                properties: { layerType: 'text', opacity: 1, blendMode: 'normal', visible: true, zIndex: 1, content: '', fontFamily: 'sans-serif', fontWeight: 700, fontSize: Math.round(width / 18), lineHeight: 1.1, letterSpacing: -1, color: '#ffffff', align: 'left', verticalAlign: 'bottom', textTransform: 'none', truncate: false },
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
