/* (c) Copyright Unitiveapp, all rights reserved. */

/**
 * PDF → SmartTemplate parser.
 *
 * Strategy: page-as-image.
 *   Each PDF page is rendered to a PNG at 150 DPI using sharp (libvips + poppler).
 *   The PNG is stored as a base64 data URL in the background layer's `src` field.
 *   Non-designers can later swap these placeholders with real assets.
 *
 * Why not editable layers?
 *   PDF does not reliably expose positioned, editable text/shape layers in the way
 *   PSD/Sketch/IDML do. Page-as-image gives a faithful visual and lets designers
 *   add proper editable layers on top in the Uniplate editor.
 *
 * Limits:
 *   MAX_PAGES (10) — only the first 10 pages are imported to avoid huge JSON payloads.
 *   RENDER_DENSITY (150 DPI) — balances quality vs payload size.
 *     At 150 DPI: A4 → ~1240×1754px, US Letter → ~1275×1650px, square → varies.
 *
 * Requirements:
 *   sharp ≥ 0.33 with libvips built with poppler support (standard on Linux).
 *   If PDF support is unavailable, a clear error is thrown.
 */

import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import type {
    BrandGuardrails,
    Layer,
    SmartTemplate,
    SocialPlatform,
} from '../types/SmartTemplate';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_PAGES = 10;
const RENDER_DENSITY = 150; // DPI — 150 is a good quality/size balance

// ─── Page Renderer ────────────────────────────────────────────────────────────

async function renderPage(
    buffer: Buffer,
    pageIndex: number,
    density: number,
): Promise<{ width: number; height: number; dataUrl: string }> {
    const rendered = sharp(buffer, { page: pageIndex, density });
    const meta = await rendered.metadata();
    const width = meta.width ?? 1080;
    const height = meta.height ?? 1080;

    const png = await rendered.png({ compressionLevel: 6 }).toBuffer();
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

    return { width, height, dataUrl };
}

// ─── Layer Builder ────────────────────────────────────────────────────────────

function buildPageLayer(
    pageIndex: number,
    width: number,
    height: number,
    dataUrl: string,
    totalPages: number,
): Layer {
    const isFirst = pageIndex === 0;
    return {
        id: uuidv4(),
        name: totalPages > 1 ? `!Page ${pageIndex + 1}` : '!Background',
        type: 'background',
        transform: { x: 0, y: 0, width, height, rotation: 0, scaleX: 1, scaleY: 1 },
        constraints: {
            locked: {
                position: true, size: true, rotation: true,
                opacity: true, color: true, font: true, content: false, hidden: false,
            },
            editable: true,
            required: false,
        },
        properties: {
            layerType: 'background',
            opacity: 1,
            blendMode: 'normal',
            visible: isFirst, // only first page visible by default
            zIndex: pageIndex,
            assetId: null,
            src: dataUrl,
            objectFit: 'contain',
            objectPosition: 'center',
        },
        sourceIndex: pageIndex,
    };
}

// ─── Dimension → Platform Guess ───────────────────────────────────────────────

function guessPlatform(width: number, height: number): SocialPlatform {
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.05) return 'instagram-post';
    if (ratio < 0.7) return 'instagram-story';
    if (ratio > 1.5) return 'twitter-post';
    return 'instagram-post';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parsePdf(buffer: ArrayBuffer, fileName: string): Promise<SmartTemplate> {
    const nodeBuffer = Buffer.from(buffer);

    // Probe metadata to get page count — throws if PDF support unavailable
    let totalPages: number;
    let firstWidth: number;
    let firstHeight: number;

    try {
        const meta = await sharp(nodeBuffer, { page: 0, density: RENDER_DENSITY }).metadata();
        totalPages = Math.min(meta.pages ?? 1, MAX_PAGES);
        firstWidth = meta.width ?? 1080;
        firstHeight = meta.height ?? 1080;
    } catch (err) {
        throw new Error(
            `PDF rendering failed. Ensure libvips was compiled with poppler support. Detail: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // Render all pages (sequentially to avoid memory spikes on large PDFs)
    const layers: Layer[] = [];
    for (let i = 0; i < totalPages; i++) {
        const { width, height, dataUrl } = await renderPage(nodeBuffer, i, RENDER_DENSITY);
        layers.push(buildPageLayer(i, width, height, dataUrl, totalPages));
    }

    const brand: BrandGuardrails = { colors: [], fonts: [], logos: [] };
    const platform = guessPlatform(firstWidth, firstHeight);

    const warnings: string[] = [];
    if ((await sharp(nodeBuffer, { page: 0, density: RENDER_DENSITY }).metadata()).pages ?? 1 > MAX_PAGES) {
        warnings.push(`Only the first ${MAX_PAGES} pages were imported.`);
    }

    return {
        id: uuidv4(),
        name: fileName.replace(/\.pdf$/i, ''),
        description: totalPages > 1 ? `${totalPages} pages imported` : '',
        version: '1.0.0',
        status: 'draft',
        dimensions: { width: firstWidth, height: firstHeight },
        platforms: [platform],
        brand,
        layers,
        metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            author: 'Imported',
            tags: [],
            sourceFormat: 'pdf',
            originalFileName: fileName,
        },
    };
}
