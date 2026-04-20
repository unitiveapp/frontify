/* (c) Copyright Frontify Ltd., all rights reserved. */

import { NextRequest, NextResponse } from 'next/server';
import { parsePsd } from '../../../utils/psdParser';
import { parseSvg } from '../../../utils/svgParser';
import type { SmartTemplate, TemplateUploadResponse } from '../../../types/SmartTemplate';

// ─── POST /api/templates ──────────────────────────────────────────────────────
// Accepts a multipart form upload with a single "file" field.
// Supported formats: .psd, .svg
// Returns: TemplateUploadResponse

export async function POST(request: NextRequest): Promise<NextResponse> {
    try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file || typeof file === 'string') {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const fileName = file.name;
        const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
        const warnings: string[] = [];
        let template: SmartTemplate;

        if (ext === 'psd') {
            const arrayBuffer = await file.arrayBuffer();
            template = parsePsd(arrayBuffer, fileName);

            if (template.layers.length === 0) {
                warnings.push('No layers were found in the PSD. Check that layers are not hidden or empty.');
            }
        } else if (ext === 'svg') {
            const text = await file.text();
            template = parseSvg(text, fileName);

            if (template.layers.length === 0) {
                warnings.push('No renderable elements found in the SVG.');
            }
        } else {
            return NextResponse.json(
                { error: `Unsupported file type ".${ext}". Accepted: .psd, .svg` },
                { status: 422 },
            );
        }

        const response: TemplateUploadResponse = { template, warnings };
        return NextResponse.json(response, { status: 201 });
    } catch (err) {
        console.error('[/api/templates] Upload error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}

// ─── GET /api/templates ───────────────────────────────────────────────────────
// Lists templates persisted to the session store (in-memory for demo purposes).
// In production, replace with a database query.

const templateStore = new Map<string, SmartTemplate>();

export async function GET(): Promise<NextResponse> {
    const templates = Array.from(templateStore.values());
    return NextResponse.json({ templates, total: templates.length });
}
