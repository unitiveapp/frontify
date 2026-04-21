/* (c) Copyright Unitiveapp, all rights reserved. */

import { NextRequest, NextResponse } from 'next/server';
import { parsePsd } from '../../../utils/psdParser';
import { parseSvg } from '../../../utils/svgParser';
import { parseIdml } from '../../../utils/idmlParser';
import { parseSketch } from '../../../utils/sketchParser';
import { parsePdf } from '../../../utils/pdfParser';
import { parseFigmaFile, extractFigmaFileKey } from '../../../utils/figmaParser';
import type { SmartTemplate, TemplateUploadResponse } from '../../../types/SmartTemplate';

// ─── In-Memory Template Store (replace with DB in production) ─────────────────

const templateStore = new Map<string, SmartTemplate>();

// ─── POST /api/templates ──────────────────────────────────────────────────────
//
// Supports three ingestion modes:
//
//  1. File upload (multipart/form-data)
//     - field "file": .psd | .svg | .idml
//
//  2. Figma URL (application/json)
//     - body: { figmaUrl: string, figmaToken: string }
//
//  3. Pre-parsed SmartTemplate (application/json)
//     - body: { template: SmartTemplate }   (for saving from client)

export async function POST(request: NextRequest): Promise<NextResponse> {
    const contentType = request.headers.get('content-type') ?? '';
    const warnings: string[] = [];
    let template: SmartTemplate;

    try {
        // ── Mode 1: File upload ──
        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            const file = formData.get('file');

            if (!file || typeof file === 'string') {
                return NextResponse.json({ error: 'No file provided' }, { status: 400 });
            }

            const fileName = file.name;
            const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

            switch (ext) {
                case 'psd': {
                    const buf = await file.arrayBuffer();
                    template = parsePsd(buf, fileName);
                    if (template.layers.length === 0) {
                        warnings.push('No layers found in PSD. Check that layers are not hidden or merged.');
                    }
                    break;
                }

                case 'svg': {
                    const text = await file.text();
                    template = parseSvg(text, fileName);
                    if (template.layers.length === 0) {
                        warnings.push('No renderable elements found in SVG.');
                    }
                    break;
                }

                case 'idml': {
                    const buf = await file.arrayBuffer();
                    template = await parseIdml(buf, fileName);
                    if (template.layers.length === 0) {
                        warnings.push('No layers were extracted from IDML. Ensure the document has visible page items on the first spread.');
                    }
                    break;
                }

                case 'sketch': {
                    const buf = await file.arrayBuffer();
                    template = await parseSketch(buf, fileName);
                    if (template.layers.length === 0) {
                        warnings.push('No layers found in Sketch file. Ensure the first page has an artboard with content.');
                    }
                    break;
                }

                case 'pdf': {
                    const buf = await file.arrayBuffer();
                    template = await parsePdf(buf, fileName);
                    if (template.layers.length === 0) {
                        warnings.push('No pages could be rendered from the PDF.');
                    } else if (template.layers.length > 1) {
                        warnings.push(`${template.layers.length} pages imported as background layers. Add editable text/image layers on top in the editor.`);
                    }
                    break;
                }

                default:
                    return NextResponse.json(
                        { error: `Unsupported file type ".${ext}". Accepted: .psd, .svg, .idml, .sketch, .pdf` },
                        { status: 422 },
                    );
            }
        }

        // ── Mode 2 & 3: JSON body ──
        else if (contentType.includes('application/json')) {
            const body = await request.json() as {
                figmaUrl?: string;
                figmaToken?: string;
                template?: SmartTemplate;
            };

            if (body.figmaUrl) {
                // Mode 2: Figma URL import
                const { figmaUrl, figmaToken } = body;

                if (!figmaToken) {
                    return NextResponse.json(
                        { error: 'figmaToken is required for Figma imports. Create one at figma.com/developers.' },
                        { status: 400 },
                    );
                }

                const fileKey = extractFigmaFileKey(figmaUrl);
                if (!fileKey) {
                    return NextResponse.json(
                        { error: 'Could not extract Figma file key from URL. Expected format: figma.com/design/:key/...' },
                        { status: 400 },
                    );
                }

                template = await parseFigmaFile(fileKey, figmaToken);

                if (template.layers.length === 0) {
                    warnings.push('No layers were found on the first Figma frame. Check that the file is not empty and you have view access.');
                }
            } else if (body.template) {
                // Mode 3: Pre-parsed SmartTemplate (save from client)
                template = body.template;
                template.metadata.updatedAt = new Date().toISOString();
            } else {
                return NextResponse.json(
                    { error: 'JSON body must contain either { figmaUrl, figmaToken } or { template }' },
                    { status: 400 },
                );
            }
        } else {
            return NextResponse.json(
                { error: 'Unsupported Content-Type. Use multipart/form-data for file uploads or application/json for Figma URLs.' },
                { status: 415 },
            );
        }

        // ── Persist to store ──
        templateStore.set(template.id, template);

        const response: TemplateUploadResponse = { template, warnings };
        return NextResponse.json(response, { status: 201 });
    } catch (err) {
        console.error('[/api/templates] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}

// ─── GET /api/templates ───────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
        const template = templateStore.get(id);
        if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        return NextResponse.json({ template });
    }

    const templates = Array.from(templateStore.values()).map(({ id, name, status, dimensions, platforms, thumbnailUrl, metadata }) => ({
        id, name, status, dimensions, platforms, thumbnailUrl,
        updatedAt: metadata.updatedAt,
        sourceFormat: metadata.sourceFormat,
    }));

    return NextResponse.json({ templates, total: templates.length });
}

// ─── DELETE /api/templates ────────────────────────────────────────────────────

export async function DELETE(request: NextRequest): Promise<NextResponse> {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id parameter required' }, { status: 400 });

    const deleted = templateStore.delete(id);
    return NextResponse.json({ deleted });
}
