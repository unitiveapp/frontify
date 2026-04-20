/* (c) Copyright Frontify Ltd., all rights reserved. */

'use client';

import type { Layer, SmartTemplate } from '../types/SmartTemplate';

// ─── Types ────────────────────────────────────────────────────────────────────

type LayerPanelProps = {
    template: SmartTemplate;
    selectedLayerId: string | null;
    onLayerSelect: (layerId: string | null) => void;
};

// ─── Layer Icon ───────────────────────────────────────────────────────────────

function LayerTypeIcon({ type }: { type: Layer['type'] }) {
    const icons: Record<Layer['type'], string> = {
        text: 'T',
        image: '⬜',
        shape: '◆',
        group: '▼',
        video: '▶',
        background: '🖼',
    };
    return (
        <span className="w-5 h-5 flex items-center justify-center text-xs font-bold text-gray-500">
            {icons[type]}
        </span>
    );
}

// ─── Layer Row ────────────────────────────────────────────────────────────────

function LayerRow({
    layer,
    depth,
    selectedLayerId,
    onLayerSelect,
}: {
    layer: Layer;
    depth: number;
    selectedLayerId: string | null;
    onLayerSelect: (id: string | null) => void;
}) {
    const isSelected = layer.id === selectedLayerId;
    const isLocked = !layer.constraints.editable;
    const isRequired = layer.constraints.required;

    return (
        <>
            <button
                type="button"
                className={[
                    'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm rounded transition-colors',
                    isSelected ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-gray-50 text-gray-700',
                    isLocked ? 'opacity-60' : '',
                ].join(' ')}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                onClick={() => onLayerSelect(isSelected ? null : layer.id)}
            >
                <LayerTypeIcon type={layer.type} />
                <span className="flex-1 truncate">{layer.name}</span>

                <span className="flex items-center gap-1 shrink-0">
                    {isRequired && (
                        <span
                            className="text-red-500 text-xs font-bold"
                            title="Required — must be filled before publishing"
                        >
                            ●
                        </span>
                    )}
                    {isLocked && (
                        <span className="text-gray-400 text-xs" title="Brand-locked layer">
                            🔒
                        </span>
                    )}
                </span>
            </button>

            {layer.children?.map((child) => (
                <LayerRow
                    key={child.id}
                    layer={child}
                    depth={depth + 1}
                    selectedLayerId={selectedLayerId}
                    onLayerSelect={onLayerSelect}
                />
            ))}
        </>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LayerPanel({ template, selectedLayerId, onLayerSelect }: LayerPanelProps) {
    // Layers are displayed top → bottom (reverse z-order) for designer convention
    const displayLayers = [...template.layers].reverse();

    const editableCount = countEditable(template.layers);
    const totalCount = countAll(template.layers);

    return (
        <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Layers</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                    {editableCount} editable / {totalCount} total
                </p>
            </div>

            <div className="flex-1 overflow-y-auto py-1">
                {displayLayers.map((layer) => (
                    <LayerRow
                        key={layer.id}
                        layer={layer}
                        depth={0}
                        selectedLayerId={selectedLayerId}
                        onLayerSelect={onLayerSelect}
                    />
                ))}
            </div>

            {/* Legend */}
            <div className="px-4 py-3 border-t border-gray-100 space-y-1">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="text-red-500 font-bold">●</span> Required field
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>🔒</span> Brand-locked
                </div>
            </div>
        </aside>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countAll(layers: Layer[]): number {
    return layers.reduce((acc, l) => acc + 1 + (l.children ? countAll(l.children) : 0), 0);
}

function countEditable(layers: Layer[]): number {
    return layers.reduce(
        (acc, l) =>
            acc +
            (l.constraints.editable ? 1 : 0) +
            (l.children ? countEditable(l.children) : 0),
        0,
    );
}
