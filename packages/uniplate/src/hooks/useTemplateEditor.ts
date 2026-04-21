/* (c) Copyright Unitiveapp, all rights reserved. */

'use client';

import { useCallback, useReducer, useState } from 'react';
import type {
    EditorLayerOverride,
    EditorSession,
    RenderFormat,
    RenderResponse,
    SmartTemplate,
    SocialPlatform,
} from '../types/SmartTemplate';

// ─── State Machine ────────────────────────────────────────────────────────────

type EditorAction =
    | { type: 'LOAD_TEMPLATE'; template: SmartTemplate }
    | { type: 'SET_OVERRIDE'; layerId: string; patch: Partial<EditorLayerOverride> }
    | { type: 'RESET_LAYER'; layerId: string }
    | { type: 'RESET_ALL' }
    | { type: 'SET_PLATFORM'; platform: SocialPlatform }
    | { type: 'MARK_SAVED' };

function editorReducer(state: EditorSession | null, action: EditorAction): EditorSession | null {
    if (action.type === 'LOAD_TEMPLATE') {
        return {
            templateId: action.template.id,
            baseTemplate: action.template,
            overrides: [],
            targetPlatform: action.template.platforms[0] ?? 'instagram-post',
            isDirty: false,
        };
    }

    if (!state) return null;

    switch (action.type) {
        case 'SET_OVERRIDE': {
            const existing = state.overrides.find((o) => o.layerId === action.layerId);
            const updated: EditorLayerOverride = existing
                ? { ...existing, ...action.patch }
                : { layerId: action.layerId, ...action.patch };

            return {
                ...state,
                isDirty: true,
                overrides: existing
                    ? state.overrides.map((o) => (o.layerId === action.layerId ? updated : o))
                    : [...state.overrides, updated],
            };
        }

        case 'RESET_LAYER':
            return {
                ...state,
                isDirty: true,
                overrides: state.overrides.filter((o) => o.layerId !== action.layerId),
            };

        case 'RESET_ALL':
            return { ...state, overrides: [], isDirty: false };

        case 'SET_PLATFORM':
            return { ...state, targetPlatform: action.platform, isDirty: true };

        case 'MARK_SAVED':
            return { ...state, isDirty: false, lastSavedAt: new Date().toISOString() };

        default:
            return state;
    }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type TemplateEditorHandle = {
    session: EditorSession | null;
    selectedLayerId: string | null;
    isRendering: boolean;
    renderResult: RenderResponse | null;
    renderError: string | null;

    loadTemplate: (template: SmartTemplate) => void;
    selectLayer: (id: string | null) => void;
    setOverride: (layerId: string, patch: Partial<EditorLayerOverride>) => void;
    resetLayer: (layerId: string) => void;
    resetAll: () => void;
    setPlatform: (platform: SocialPlatform) => void;
    saveDraft: () => void;
    render: (format: RenderFormat) => Promise<void>;
};

export function useTemplateEditor(): TemplateEditorHandle {
    const [session, dispatch] = useReducer(editorReducer, null);
    const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
    const [isRendering, setIsRendering] = useState(false);
    const [renderResult, setRenderResult] = useState<RenderResponse | null>(null);
    const [renderError, setRenderError] = useState<string | null>(null);

    const loadTemplate = useCallback((template: SmartTemplate) => {
        dispatch({ type: 'LOAD_TEMPLATE', template });
        setSelectedLayerId(null);
        setRenderResult(null);
        setRenderError(null);
    }, []);

    const selectLayer = useCallback((id: string | null) => {
        setSelectedLayerId(id);
    }, []);

    const setOverride = useCallback((layerId: string, patch: Partial<EditorLayerOverride>) => {
        dispatch({ type: 'SET_OVERRIDE', layerId, patch });
    }, []);

    const resetLayer = useCallback((layerId: string) => {
        dispatch({ type: 'RESET_LAYER', layerId });
    }, []);

    const resetAll = useCallback(() => {
        dispatch({ type: 'RESET_ALL' });
    }, []);

    const setPlatform = useCallback((platform: SocialPlatform) => {
        dispatch({ type: 'SET_PLATFORM', platform });
    }, []);

    const saveDraft = useCallback(() => {
        if (!session) return;
        // Persist to localStorage as a simple draft store
        try {
            const key = `sbm-draft-${session.templateId}`;
            localStorage.setItem(key, JSON.stringify(session));
            dispatch({ type: 'MARK_SAVED' });
        } catch {
            // Storage unavailable — silently skip
        }
    }, [session]);

    const render = useCallback(
        async (format: RenderFormat) => {
            if (!session) return;

            setIsRendering(true);
            setRenderError(null);
            setRenderResult(null);

            try {
                const res = await fetch('/api/render', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        template: session.baseTemplate,
                        overrides: session.overrides,
                        format,
                        quality: 90,
                    }),
                });

                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error((body as { error?: string }).error ?? `Render failed: ${res.status}`);
                }

                const result = (await res.json()) as RenderResponse;
                setRenderResult(result);

                // Auto-download the result
                if (result.data) {
                    const a = document.createElement('a');
                    a.href = `data:${result.mimeType};base64,${result.data}`;
                    a.download = `${session.baseTemplate.name}.${format}`;
                    a.click();
                }
            } catch (err) {
                setRenderError(err instanceof Error ? err.message : 'Render failed');
            } finally {
                setIsRendering(false);
            }
        },
        [session],
    );

    return {
        session,
        selectedLayerId,
        isRendering,
        renderResult,
        renderError,
        loadTemplate,
        selectLayer,
        setOverride,
        resetLayer,
        resetAll,
        setPlatform,
        saveDraft,
        render,
    };
}
