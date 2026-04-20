/* (c) Copyright Frontify Ltd., all rights reserved. */

'use client';

import type { Asset } from '@frontify/app-bridge';
import type {
    BrandColor,
    EditorLayerOverride,
    Layer,
    SmartTemplate,
    TextProperties,
} from '../types/SmartTemplate';

// ─── Types ────────────────────────────────────────────────────────────────────

type ConstraintsPanelProps = {
    template: SmartTemplate;
    selectedLayerId: string | null;
    overrides: EditorLayerOverride[];
    onOverrideChange: (layerId: string, patch: Partial<EditorLayerOverride>) => void;
    onOpenAssetChooser: (layerId: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findLayer(layers: Layer[], id: string): Layer | null {
    for (const l of layers) {
        if (l.id === id) return l;
        if (l.children) {
            const found = findLayer(l.children, id);
            if (found) return found;
        }
    }
    return null;
}

// ─── Color Swatch ─────────────────────────────────────────────────────────────

function ColorSwatch({ color, selected, onClick }: { color: BrandColor; selected: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            title={`${color.name} — ${color.value}`}
            className={[
                'w-7 h-7 rounded-full border-2 transition-transform hover:scale-110',
                selected ? 'border-brand-500 scale-110' : 'border-transparent',
            ].join(' ')}
            style={{ backgroundColor: color.value }}
            onClick={onClick}
        />
    );
}

// ─── Text Fields ──────────────────────────────────────────────────────────────

function TextField({
    layer,
    override,
    brandColors,
    onOverrideChange,
}: {
    layer: Layer;
    override: EditorLayerOverride | undefined;
    brandColors: BrandColor[];
    onOverrideChange: (patch: Partial<EditorLayerOverride>) => void;
}) {
    if (layer.properties.layerType !== 'text') return null;
    const props = layer.properties as TextProperties & { layerType: 'text' };
    const locked = layer.constraints.locked;
    const currentText = override?.textContent ?? props.content;
    const currentColor = override?.color ?? props.color;

    return (
        <div className="space-y-4">
            {/* Text content */}
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                    Text
                    {layer.constraints.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {locked.content ? (
                    <p className="text-sm text-gray-400 bg-gray-50 px-3 py-2 rounded border border-gray-200 select-none">
                        {currentText || '—'}
                    </p>
                ) : (
                    <textarea
                        className="w-full text-sm border border-gray-200 rounded px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                        rows={3}
                        value={currentText}
                        placeholder={layer.constraints.placeholder ?? 'Enter text…'}
                        onChange={(e) => onOverrideChange({ textContent: e.target.value })}
                    />
                )}
            </div>

            {/* Color */}
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Color</label>
                {locked.color ? (
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full border border-gray-300" style={{ backgroundColor: currentColor }} />
                        <span className="text-xs text-gray-400 font-mono">{currentColor}</span>
                        <span className="text-xs text-gray-300">🔒</span>
                    </div>
                ) : brandColors.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {brandColors.map((c) => (
                            <ColorSwatch
                                key={c.id}
                                color={c}
                                selected={currentColor === c.value}
                                onClick={() => onOverrideChange({ color: c.value })}
                            />
                        ))}
                    </div>
                ) : (
                    <input
                        type="color"
                        className="h-8 w-full rounded cursor-pointer border border-gray-200"
                        value={currentColor}
                        onChange={(e) => onOverrideChange({ color: e.target.value })}
                    />
                )}
            </div>

            {/* Read-only font info */}
            <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                <div>
                    <span className="block font-medium text-gray-400 mb-0.5">Font</span>
                    <span className={locked.font ? 'text-gray-300' : ''}>{props.fontFamily}</span>
                    {locked.font && <span className="ml-1">🔒</span>}
                </div>
                <div>
                    <span className="block font-medium text-gray-400 mb-0.5">Size</span>
                    <span>{props.fontSize}px</span>
                </div>
            </div>
        </div>
    );
}

// ─── Image Fields ─────────────────────────────────────────────────────────────

function ImageField({
    layer,
    override,
    onOverrideChange,
    onOpenAssetChooser,
}: {
    layer: Layer;
    override: EditorLayerOverride | undefined;
    onOverrideChange: (patch: Partial<EditorLayerOverride>) => void;
    onOpenAssetChooser: () => void;
}) {
    if (layer.properties.layerType !== 'image' && layer.properties.layerType !== 'background') return null;
    const locked = layer.constraints.locked;
    const currentSrc = override?.assetSrc ?? (layer.properties as { src: string | null }).src;

    return (
        <div className="space-y-3">
            <label className="block text-xs font-medium text-gray-600">
                Image
                {layer.constraints.required && <span className="text-red-500 ml-1">*</span>}
            </label>

            {currentSrc ? (
                <div className="relative group rounded-lg overflow-hidden border border-gray-200 aspect-square bg-gray-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={currentSrc} alt="Layer preview" className="w-full h-full object-cover" />
                    {!locked.content && (
                        <button
                            type="button"
                            className="absolute inset-0 bg-black/50 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1"
                            onClick={onOpenAssetChooser}
                        >
                            Change image
                        </button>
                    )}
                </div>
            ) : (
                <button
                    type="button"
                    className={[
                        'w-full aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 text-sm transition-colors',
                        locked.content
                            ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                            : 'border-gray-300 text-gray-500 hover:border-brand-500 hover:text-brand-600 cursor-pointer',
                    ].join(' ')}
                    onClick={locked.content ? undefined : onOpenAssetChooser}
                    disabled={locked.content}
                >
                    <span className="text-2xl">+</span>
                    <span>{layer.constraints.placeholder ?? 'Choose from DAM'}</span>
                </button>
            )}

            {locked.content && (
                <p className="text-xs text-gray-400 flex items-center gap-1">
                    <span>🔒</span> Brand-locked — image cannot be changed
                </p>
            )}
        </div>
    );
}

// ─── Shape Fields ─────────────────────────────────────────────────────────────

function ShapeField({
    layer,
    override,
    brandColors,
    onOverrideChange,
}: {
    layer: Layer;
    override: EditorLayerOverride | undefined;
    brandColors: BrandColor[];
    onOverrideChange: (patch: Partial<EditorLayerOverride>) => void;
}) {
    if (layer.properties.layerType !== 'shape') return null;
    const locked = layer.constraints.locked;
    const currentColor = override?.color ?? layer.properties.fill;

    return (
        <div className="space-y-3">
            <label className="block text-xs font-medium text-gray-600">Fill Color</label>
            {locked.color ? (
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded border border-gray-300" style={{ backgroundColor: currentColor }} />
                    <span className="text-xs text-gray-400 font-mono">{currentColor}</span>
                    <span className="text-xs text-gray-300">🔒</span>
                </div>
            ) : brandColors.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {brandColors.map((c) => (
                        <ColorSwatch
                            key={c.id}
                            color={c}
                            selected={currentColor === c.value}
                            onClick={() => onOverrideChange({ color: c.value })}
                        />
                    ))}
                </div>
            ) : (
                <input
                    type="color"
                    className="h-8 w-full rounded cursor-pointer border border-gray-200"
                    value={currentColor}
                    onChange={(e) => onOverrideChange({ color: e.target.value })}
                />
            )}
        </div>
    );
}

// ─── Transform Info ───────────────────────────────────────────────────────────

function TransformInfo({ layer }: { layer: Layer }) {
    const { transform, constraints } = layer;
    return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-500">
            {[
                { label: 'X', value: `${Math.round(transform.x)}px`, locked: constraints.locked.position },
                { label: 'Y', value: `${Math.round(transform.y)}px`, locked: constraints.locked.position },
                { label: 'W', value: `${Math.round(transform.width)}px`, locked: constraints.locked.size },
                { label: 'H', value: `${Math.round(transform.height)}px`, locked: constraints.locked.size },
            ].map(({ label, value, locked }) => (
                <div key={label} className="flex items-center justify-between">
                    <span className="font-medium text-gray-400">{label}</span>
                    <span className={locked ? 'text-gray-300' : ''}>
                        {value} {locked && '🔒'}
                    </span>
                </div>
            ))}
        </div>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConstraintsPanel({
    template,
    selectedLayerId,
    overrides,
    onOverrideChange,
    onOpenAssetChooser,
}: ConstraintsPanelProps) {
    const layer = selectedLayerId ? findLayer(template.layers, selectedLayerId) : null;
    const override = layer ? overrides.find((o) => o.layerId === layer.id) : undefined;

    const handleChange = (patch: Partial<EditorLayerOverride>) => {
        if (!layer) return;
        onOverrideChange(layer.id, patch);
    };

    return (
        <aside className="w-64 shrink-0 bg-white border-l border-gray-200 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Properties</h3>
            </div>

            <div className="flex-1 overflow-y-auto">
                {!layer ? (
                    <p className="text-sm text-gray-400 text-center py-12 px-4">
                        Select a layer on the canvas to edit its properties
                    </p>
                ) : (
                    <div className="px-4 py-4 space-y-6">
                        {/* Layer name */}
                        <div>
                            <p className="text-sm font-semibold text-gray-800">{layer.name}</p>
                            <p className="text-xs text-gray-400 capitalize mt-0.5">{layer.type} layer</p>
                        </div>

                        {/* Type-specific controls */}
                        <TextField
                            layer={layer}
                            override={override}
                            brandColors={template.brand.colors}
                            onOverrideChange={handleChange}
                        />
                        <ImageField
                            layer={layer}
                            override={override}
                            onOverrideChange={handleChange}
                            onOpenAssetChooser={() => onOpenAssetChooser(layer.id)}
                        />
                        <ShapeField
                            layer={layer}
                            override={override}
                            brandColors={template.brand.colors}
                            onOverrideChange={handleChange}
                        />

                        {/* Separator */}
                        <hr className="border-gray-100" />

                        {/* Position / size (read-only) */}
                        <div>
                            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Transform</p>
                            <TransformInfo layer={layer} />
                        </div>
                    </div>
                )}
            </div>
        </aside>
    );
}
