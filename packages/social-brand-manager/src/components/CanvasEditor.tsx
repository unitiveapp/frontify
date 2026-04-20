/* (c) Copyright Frontify Ltd., all rights reserved. */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Canvas, FabricObject } from 'fabric';
import type { EditorLayerOverride, Layer, SmartTemplate } from '../types/SmartTemplate';

// ─── Types ────────────────────────────────────────────────────────────────────

type CanvasEditorProps = {
    template: SmartTemplate;
    overrides: EditorLayerOverride[];
    selectedLayerId: string | null;
    onLayerSelect: (layerId: string | null) => void;
    onOverrideChange: (layerId: string, patch: Partial<EditorLayerOverride>) => void;
    /** Scale factor to fit template in the viewport (0.1 – 2.0) */
    zoom?: number;
};

// ─── Fabric Loader ────────────────────────────────────────────────────────────

let fabricModule: typeof import('fabric') | null = null;

async function getFabric() {
    if (!fabricModule) {
        fabricModule = await import('fabric');
    }
    return fabricModule;
}

// ─── Layer → Fabric Object ────────────────────────────────────────────────────

async function layerToFabricObject(
    layer: Layer,
    overrides: EditorLayerOverride[],
    fabric: typeof import('fabric'),
): Promise<FabricObject | null> {
    const override = overrides.find((o) => o.layerId === layer.id);
    const { transform, properties, constraints } = layer;
    const isLocked = !constraints.editable;

    const commonProps = {
        left: transform.x,
        top: transform.y,
        width: transform.width,
        height: transform.height,
        angle: transform.rotation,
        opacity: (properties as { opacity: number }).opacity,
        visible: (properties as { visible: boolean }).visible,
        selectable: !isLocked,
        evented: !isLocked,
        lockMovementX: constraints.locked.position,
        lockMovementY: constraints.locked.position,
        lockScalingX: constraints.locked.size,
        lockScalingY: constraints.locked.size,
        lockRotation: constraints.locked.rotation,
        // Store the layer id so selection events can map back
        data: { layerId: layer.id },
    };

    if (properties.layerType === 'text') {
        const content = override?.textContent ?? properties.content;
        const obj = new fabric.Textbox(content, {
            ...commonProps,
            fontFamily: properties.fontFamily,
            fontSize: properties.fontSize,
            fontWeight: properties.fontWeight,
            fill: override?.color ?? properties.color,
            textAlign: properties.align,
            editable: !constraints.locked.content,
        });
        return obj;
    }

    if (properties.layerType === 'image' || properties.layerType === 'background') {
        const src = override?.assetSrc ?? properties.src;
        if (!src) {
            // Placeholder rectangle for empty image slots
            return new fabric.Rect({
                ...commonProps,
                fill: '#e5e7eb',
                stroke: '#9ca3af',
                strokeWidth: 1,
                strokeDashArray: [6, 3],
            });
        }
        try {
            const img = await fabric.FabricImage.fromURL(src, { crossOrigin: 'anonymous' });
            img.set({
                ...commonProps,
                scaleX: transform.width / (img.width ?? transform.width),
                scaleY: transform.height / (img.height ?? transform.height),
            });
            return img;
        } catch {
            return new fabric.Rect({ ...commonProps, fill: '#fca5a5' });
        }
    }

    if (properties.layerType === 'shape') {
        if (properties.shapeType === 'ellipse') {
            return new fabric.Ellipse({
                ...commonProps,
                rx: transform.width / 2,
                ry: transform.height / 2,
                fill: override?.color ?? properties.fill,
                stroke: properties.stroke,
                strokeWidth: properties.strokeWidth,
            });
        }
        return new fabric.Rect({
            ...commonProps,
            fill: override?.color ?? properties.fill,
            stroke: properties.stroke,
            strokeWidth: properties.strokeWidth,
            rx: properties.cornerRadius ?? 0,
            ry: properties.cornerRadius ?? 0,
        });
    }

    return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CanvasEditor({
    template,
    overrides,
    selectedLayerId,
    onLayerSelect,
    onOverrideChange,
    zoom = 1,
}: CanvasEditorProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // ── Initialize canvas ──
    useEffect(() => {
        if (!canvasRef.current) return;

        let canvas: Canvas;

        (async () => {
            const fabric = await getFabric();
            canvas = new fabric.Canvas(canvasRef.current!, {
                width: template.dimensions.width * zoom,
                height: template.dimensions.height * zoom,
                backgroundColor: '#ffffff',
                selection: true,
                preserveObjectStacking: true,
            });

            canvas.setZoom(zoom);
            fabricRef.current = canvas;

            // Selection events → layer selection
            canvas.on('selection:created', (e) => {
                const obj = e.selected?.[0];
                const id = (obj as FabricObject & { data?: { layerId?: string } })?.data?.layerId ?? null;
                onLayerSelect(id);
            });
            canvas.on('selection:cleared', () => onLayerSelect(null));

            // Text editing → override
            canvas.on('text:changed', (e) => {
                const obj = e.target as FabricObject & { data?: { layerId?: string }; text?: string };
                if (obj?.data?.layerId) {
                    onOverrideChange(obj.data.layerId, { textContent: obj.text ?? '' });
                }
            });

            // Object moved/scaled → track position overrides (for unlocked layers)
            canvas.on('object:modified', (e) => {
                // Position changes are kept in canvas state; no schema override needed for now
                void e;
            });

            await populateCanvas(canvas, template, overrides, fabric);
            setIsLoading(false);
        })();

        return () => {
            canvas?.dispose();
            fabricRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [template.id]);

    // ── Re-render when overrides change ──
    useEffect(() => {
        if (!fabricRef.current) return;

        (async () => {
            const fabric = await getFabric();
            await populateCanvas(fabricRef.current!, template, overrides, fabric);
        })();
    }, [overrides, template]);

    // ── Sync external selection → canvas active object ──
    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        if (!selectedLayerId) {
            canvas.discardActiveObject();
            canvas.requestRenderAll();
            return;
        }

        const obj = canvas.getObjects().find(
            (o) => (o as FabricObject & { data?: { layerId?: string } })?.data?.layerId === selectedLayerId,
        );
        if (obj) {
            canvas.setActiveObject(obj);
            canvas.requestRenderAll();
        }
    }, [selectedLayerId]);

    return (
        <div className="relative flex items-center justify-center bg-gray-100 rounded-lg overflow-auto p-4">
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10 rounded-lg">
                    <div className="animate-spin h-8 w-8 border-4 border-brand-500 border-t-transparent rounded-full" />
                </div>
            )}
            <div
                className="shadow-2xl"
                style={{ width: template.dimensions.width * zoom, height: template.dimensions.height * zoom }}
            >
                <canvas ref={canvasRef} />
            </div>
        </div>
    );
}

// ─── Canvas Population ────────────────────────────────────────────────────────

async function populateCanvas(
    canvas: Canvas,
    template: SmartTemplate,
    overrides: EditorLayerOverride[],
    fabric: typeof import('fabric'),
): Promise<void> {
    canvas.clear();
    canvas.backgroundColor = '#ffffff';

    const sortedLayers = flattenLayers(template.layers).sort(
        (a, b) => ((a.properties as { zIndex: number }).zIndex ?? 0) - ((b.properties as { zIndex: number }).zIndex ?? 0),
    );

    for (const layer of sortedLayers) {
        const obj = await layerToFabricObject(layer, overrides, fabric);
        if (obj) canvas.add(obj);
    }

    canvas.requestRenderAll();
}

function flattenLayers(layers: Layer[]): Layer[] {
    return layers.flatMap((l) => (l.children ? [l, ...flattenLayers(l.children)] : [l]));
}

// ─── Zoom Controls ────────────────────────────────────────────────────────────

type ZoomControlsProps = {
    zoom: number;
    onZoomChange: (zoom: number) => void;
};

export function ZoomControls({ zoom, onZoomChange }: ZoomControlsProps) {
    const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

    return (
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
            <button
                className="text-gray-500 hover:text-gray-800 disabled:opacity-30"
                onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))}
                disabled={zoom <= 0.25}
                aria-label="Zoom out"
            >
                −
            </button>
            <select
                className="text-sm text-gray-700 border-none outline-none bg-transparent cursor-pointer"
                value={zoom}
                onChange={(e) => onZoomChange(parseFloat(e.target.value))}
            >
                {steps.map((s) => (
                    <option key={s} value={s}>
                        {Math.round(s * 100)}%
                    </option>
                ))}
            </select>
            <button
                className="text-gray-500 hover:text-gray-800 disabled:opacity-30"
                onClick={() => onZoomChange(Math.min(2, zoom + 0.25))}
                disabled={zoom >= 2}
                aria-label="Zoom in"
            >
                +
            </button>
        </div>
    );
}
