/* (c) Copyright Unitiveapp, all rights reserved. */

'use client';

import type { EditorLayerOverride, Layer, RenderFormat, SmartTemplate } from '../types/SmartTemplate';

// ─── Types ────────────────────────────────────────────────────────────────────

type PublishBarProps = {
    template: SmartTemplate;
    overrides: EditorLayerOverride[];
    isRendering: boolean;
    onRender: (format: RenderFormat) => void;
    onSaveDraft: () => void;
};

// ─── Validation ───────────────────────────────────────────────────────────────

function validateRequiredLayers(layers: Layer[], overrides: EditorLayerOverride[]): string[] {
    const errors: string[] = [];

    const walk = (ls: Layer[]) => {
        for (const l of ls) {
            if (!l.constraints.required) {
                if (l.children) walk(l.children);
                continue;
            }

            const override = overrides.find((o) => o.layerId === l.id);
            const isEmpty =
                (l.type === 'text' && !(override?.textContent ?? (l.properties as { content?: string }).content)) ||
                (l.type === 'image' && !(override?.assetSrc ?? (l.properties as { src?: string | null }).src));

            if (isEmpty) errors.push(l.name);
            if (l.children) walk(l.children);
        }
    };

    walk(layers);
    return errors;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishBar({ template, overrides, isRendering, onRender, onSaveDraft }: PublishBarProps) {
    const missingFields = validateRequiredLayers(template.layers, overrides);
    const canPublish = missingFields.length === 0 && !isRendering;

    return (
        <div className="h-14 bg-white border-t border-gray-200 flex items-center justify-between px-6 shrink-0">
            {/* Validation feedback */}
            <div className="flex-1">
                {missingFields.length > 0 && (
                    <p className="text-xs text-red-500">
                        <span className="font-semibold">Required:</span>{' '}
                        {missingFields.join(', ')}
                    </p>
                )}
            </div>

            <div className="flex items-center gap-3">
                <button
                    type="button"
                    className="px-4 py-1.5 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                    onClick={onSaveDraft}
                    disabled={isRendering}
                >
                    Save draft
                </button>

                {/* Format picker + publish */}
                <div className="flex items-center rounded-lg overflow-hidden border border-brand-500 divide-x divide-brand-500">
                    {(['png', 'jpeg', 'webp'] as RenderFormat[]).map((fmt) => (
                        <button
                            key={fmt}
                            type="button"
                            className={[
                                'px-4 py-1.5 text-sm font-medium transition-colors',
                                canPublish
                                    ? 'bg-brand-500 text-white hover:bg-brand-600'
                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed',
                            ].join(' ')}
                            disabled={!canPublish}
                            onClick={() => onRender(fmt)}
                            title={canPublish ? `Export as ${fmt.toUpperCase()}` : `Fill required fields first`}
                        >
                            {isRendering ? '…' : fmt.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
