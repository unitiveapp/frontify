/* (c) Copyright Unitiveapp, all rights reserved. */

/**
 * Headless renderer: flattens a SmartTemplate + overrides into a PNG/JPEG buffer.
 * Runs server-side only (Node.js) — uses sharp for compositing.
 *
 * Architecture:
 *  1. Walk layers bottom → top (z-index order)
 *  2. For each visible layer, produce a sharp buffer (text via SVG-in-sharp, image via download)
 *  3. Composite all buffers onto a base canvas of template dimensions
 *  4. Encode final composite as PNG or JPEG
 */

import sharp from 'sharp';
import type {
    EditorLayerOverride,
    Layer,
    RenderFormat,
    SmartTemplate,
    TextProperties,
} from '../types/SmartTemplate';

type Composite = sharp.OverlayOptions;

// ─── Override Resolution ──────────────────────────────────────────────────────

function resolveLayer(layer: Layer, overrides: EditorLayerOverride[]): Layer {
    const override = overrides.find((o) => o.layerId === layer.id);
    if (!override) return layer;

    const props = { ...layer.properties };

    if (override.textContent && props.layerType === 'text') {
        (props as TextProperties & { layerType: 'text' }).content = override.textContent;
    }
    if (override.assetSrc && props.layerType === 'image') {
        (props as { layerType: 'image'; src: string | null }).src = override.assetSrc;
    }

    return { ...layer, properties: props };
}

// ─── Text Layer → SVG Buffer ──────────────────────────────────────────────────

function textLayerToSvgBuffer(layer: Layer): Buffer {
    if (layer.properties.layerType !== 'text') throw new Error('Not a text layer');
    const p = layer.properties;
    const { width, height } = layer.transform;
    const escaped = p.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <text
    x="${p.align === 'center' ? width / 2 : p.align === 'right' ? width : 0}"
    y="${p.fontSize}"
    font-family="${p.fontFamily}"
    font-size="${p.fontSize}"
    font-weight="${p.fontWeight}"
    fill="${p.color}"
    text-anchor="${p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start'}"
    letter-spacing="${p.letterSpacing}"
  >${escaped}</text>
</svg>`;

    return Buffer.from(svg);
}

// ─── Shape Layer → SVG Buffer ─────────────────────────────────────────────────

function shapeLayerToSvgBuffer(layer: Layer): Buffer {
    if (layer.properties.layerType !== 'shape') throw new Error('Not a shape layer');
    const p = layer.properties;
    const { width, height } = layer.transform;

    let shapeEl = '';
    if (p.shapeType === 'rect') {
        shapeEl = `<rect width="${width}" height="${height}" rx="${p.cornerRadius ?? 0}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" />`;
    } else if (p.shapeType === 'ellipse') {
        shapeEl = `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" />`;
    } else if (p.shapeType === 'path' && p.pathData) {
        shapeEl = `<path d="${p.pathData}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" />`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapeEl}</svg>`;
    return Buffer.from(svg);
}

// ─── Layer → Composite ────────────────────────────────────────────────────────

async function layerToComposite(layer: Layer, overrides: EditorLayerOverride[]): Promise<Composite | null> {
    const resolved = resolveLayer(layer, overrides);
    const { properties, transform } = resolved;

    if (!properties.visible) return null;

    const left = Math.round(transform.x);
    const top = Math.round(transform.y);

    try {
        if (properties.layerType === 'text') {
            const svgBuf = textLayerToSvgBuffer(resolved);
            const input = await sharp(svgBuf).png().toBuffer();
            return { input, left, top, blend: 'over' };
        }

        if (properties.layerType === 'shape') {
            const svgBuf = shapeLayerToSvgBuffer(resolved);
            const input = await sharp(svgBuf).png().toBuffer();
            return { input, left, top, blend: 'over' };
        }

        if ((properties.layerType === 'image' || properties.layerType === 'background') && properties.src) {
            const res = await fetch(properties.src);
            if (!res.ok) return null;
            const arrayBuf = await res.arrayBuffer();
            const input = await sharp(Buffer.from(arrayBuf))
                .resize(Math.round(transform.width), Math.round(transform.height), { fit: 'cover' })
                .png()
                .toBuffer();
            return { input, left, top, blend: 'over' };
        }
    } catch {
        // Silently skip failed layers — partial renders are better than crashes
    }

    return null;
}

// ─── Walk Layers ─────────────────────────────────────────────────────────────

async function collectComposites(layers: Layer[], overrides: EditorLayerOverride[]): Promise<Composite[]> {
    const composites: Composite[] = [];

    // Sort by zIndex ascending (bottom → top)
    const sorted = [...layers].sort((a, b) => (a.properties as { zIndex: number }).zIndex - (b.properties as { zIndex: number }).zIndex);

    for (const layer of sorted) {
        if (layer.type === 'group' && layer.children) {
            const nested = await collectComposites(layer.children, overrides);
            composites.push(...nested);
        } else {
            const comp = await layerToComposite(layer, overrides);
            if (comp) composites.push(comp);
        }
    }

    return composites;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type RenderedOutput = {
    buffer: Buffer;
    width: number;
    height: number;
    mimeType: string;
};

/**
 * Renders a SmartTemplate with applied overrides into a flat image buffer.
 * Designed to be called from the /api/render Next.js route handler.
 */
export async function renderTemplate(
    template: SmartTemplate,
    overrides: EditorLayerOverride[],
    format: RenderFormat = 'png',
    quality = 90,
    outputWidth?: number,
    outputHeight?: number,
): Promise<RenderedOutput> {
    const canvasWidth = outputWidth ?? template.dimensions.width;
    const canvasHeight = outputHeight ?? template.dimensions.height;

    // Base canvas — white background
    let base = sharp({
        create: {
            width: canvasWidth,
            height: canvasHeight,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
    });

    const composites = await collectComposites(template.layers, overrides);

    if (composites.length > 0) {
        base = base.composite(composites);
    }

    let buffer: Buffer;
    let mimeType: string;

    if (format === 'jpeg') {
        buffer = await base.jpeg({ quality }).toBuffer();
        mimeType = 'image/jpeg';
    } else if (format === 'webp') {
        buffer = await base.webp({ quality }).toBuffer();
        mimeType = 'image/webp';
    } else {
        buffer = await base.png({ compressionLevel: Math.round((100 - quality) / 10) }).toBuffer();
        mimeType = 'image/png';
    }

    return { buffer, width: canvasWidth, height: canvasHeight, mimeType };
}
