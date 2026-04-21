/* (c) Copyright Unitiveapp, all rights reserved. */

import { NextRequest, NextResponse } from 'next/server';
import { renderTemplate } from '../../../utils/renderer';
import type { RenderRequest, RenderResponse } from '../../../types/SmartTemplate';

// ─── POST /api/render ─────────────────────────────────────────────────────────
// Accepts a RenderRequest JSON body.
// Flattens the template + overrides into a PNG/JPEG/WebP image.
// Returns base64-encoded image data for client-side download.

export async function POST(request: NextRequest): Promise<NextResponse> {
    try {
        const body = (await request.json()) as RenderRequest;

        if (!body.template || !body.template.layers) {
            return NextResponse.json({ error: 'Invalid request: missing template' }, { status: 400 });
        }

        const format = body.format ?? 'png';
        const quality = Math.min(100, Math.max(1, body.quality ?? 90));

        const { buffer, width, height, mimeType } = await renderTemplate(
            body.template,
            body.overrides ?? [],
            format,
            quality,
        );

        const response: RenderResponse = {
            jobId: `render-${Date.now()}`,
            data: buffer.toString('base64'),
            mimeType,
            width,
            height,
        };

        return NextResponse.json(response, { status: 200 });
    } catch (err) {
        console.error('[/api/render] Render error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Render failed' },
            { status: 500 },
        );
    }
}
