/* (c) Copyright Frontify Ltd., all rights reserved. */

'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { LayerPanel } from '../components/LayerPanel';
import { ConstraintsPanel } from '../components/ConstraintsPanel';
import { PublishBar } from '../components/PublishBar';
import { TemplateUploader } from '../components/TemplateUploader';
import { ZoomControls } from '../components/CanvasEditor';
import { useTemplateEditor } from '../hooks/useTemplateEditor';
import type { SmartTemplate, SocialPlatform } from '../types/SmartTemplate';
import { PLATFORM_DIMENSIONS } from '../types/SmartTemplate';

// Fabric.js uses browser APIs — load it only on the client
const CanvasEditor = dynamic(
    () => import('../components/CanvasEditor').then((m) => ({ default: m.CanvasEditor })),
    { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-500 border-t-transparent rounded-full" /></div> },
);

// ─── Platform Badge ───────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
    'instagram-post': 'IG Post',
    'instagram-story': 'IG Story',
    'instagram-reel': 'Reel',
    'facebook-post': 'FB Post',
    'facebook-story': 'FB Story',
    'twitter-post': 'Twitter',
    'linkedin-post': 'LinkedIn',
    'tiktok-cover': 'TikTok',
    'youtube-thumbnail': 'YouTube',
    'pinterest-pin': 'Pinterest',
};

// ─── Top Bar ──────────────────────────────────────────────────────────────────

function TopBar({
    template,
    zoom,
    onZoomChange,
    onReset,
    onBackToUpload,
}: {
    template: SmartTemplate;
    zoom: number;
    onZoomChange: (z: number) => void;
    onReset: () => void;
    onBackToUpload: () => void;
}) {
    const dim = template.dimensions;
    return (
        <header className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-4 shrink-0">
            <button
                type="button"
                onClick={onBackToUpload}
                className="text-sm text-gray-500 hover:text-gray-800 transition-colors flex items-center gap-1"
            >
                ← Templates
            </button>

            <div className="h-5 w-px bg-gray-200" />

            <h1 className="text-sm font-semibold text-gray-800 truncate max-w-xs">{template.name}</h1>

            <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded font-mono">
                {dim.width}×{dim.height}
            </span>

            {/* Platform tags */}
            <div className="flex items-center gap-1">
                {template.platforms.map((p) => (
                    <span key={p} className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-medium">
                        {PLATFORM_LABELS[p] ?? p}
                    </span>
                ))}
            </div>

            <div className="flex-1" />

            <ZoomControls zoom={zoom} onZoomChange={onZoomChange} />

            <button
                type="button"
                onClick={onReset}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors px-2 py-1 rounded hover:bg-gray-50"
            >
                Reset
            </button>
        </header>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BrandEditorPage() {
    const editor = useTemplateEditor();
    const [zoom, setZoom] = useState(0.5);
    const [renderError, setRenderError] = useState<string | null>(null);

    const hasTemplate = !!editor.session;

    // ── Open Frontify Asset Chooser ──
    // In a real Frontify Platform App this would call appBridge.dispatch(openAssetChooser)
    // Here we fall back to a simple file input for demo purposes
    const handleOpenAssetChooser = (layerId: string) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            editor.setOverride(layerId, { assetSrc: url });
        };
        input.click();
    };

    if (!hasTemplate || !editor.session) {
        return (
            <main className="h-screen flex flex-col">
                <header className="h-12 bg-white border-b border-gray-200 flex items-center px-6">
                    <span className="text-sm font-bold text-brand-600">Frontify</span>
                    <span className="mx-2 text-gray-300">|</span>
                    <span className="text-sm text-gray-600">Social Brand Manager</span>
                </header>
                <div className="flex-1 overflow-auto">
                    <TemplateUploader onTemplateLoaded={editor.loadTemplate} />
                </div>
            </main>
        );
    }

    const { session } = editor;

    return (
        <main className="h-screen flex flex-col overflow-hidden">
            <TopBar
                template={session.baseTemplate}
                zoom={zoom}
                onZoomChange={setZoom}
                onReset={editor.resetAll}
                onBackToUpload={() => editor.loadTemplate(null as unknown as SmartTemplate)}
            />

            <div className="flex flex-1 overflow-hidden">
                {/* Layer panel */}
                <LayerPanel
                    template={session.baseTemplate}
                    selectedLayerId={editor.selectedLayerId}
                    onLayerSelect={editor.selectLayer}
                />

                {/* Canvas */}
                <div className="flex-1 overflow-auto bg-gray-100">
                    <CanvasEditor
                        template={session.baseTemplate}
                        overrides={session.overrides}
                        selectedLayerId={editor.selectedLayerId}
                        onLayerSelect={editor.selectLayer}
                        onOverrideChange={editor.setOverride}
                        zoom={zoom}
                    />
                </div>

                {/* Constraints / properties panel */}
                <ConstraintsPanel
                    template={session.baseTemplate}
                    selectedLayerId={editor.selectedLayerId}
                    overrides={session.overrides}
                    onOverrideChange={editor.setOverride}
                    onOpenAssetChooser={handleOpenAssetChooser}
                />
            </div>

            {/* Render error toast */}
            {editor.renderError && (
                <div className="fixed bottom-16 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
                    {editor.renderError}
                </div>
            )}

            {/* Publish bar */}
            <PublishBar
                template={session.baseTemplate}
                overrides={session.overrides}
                isRendering={editor.isRendering}
                onRender={editor.render}
                onSaveDraft={editor.saveDraft}
            />
        </main>
    );
}
