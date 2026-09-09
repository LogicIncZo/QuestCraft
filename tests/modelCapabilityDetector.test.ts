import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => ({ default: class MockOpenAI {} }));

import {
    MODEL_CAPABILITIES,
    detectCapabilities,
    selectPromptVariant,
} from '../services/modelCapabilityDetector';
import type { ModelCapabilities } from '../services/modelCapabilityDetector';
import { COMMUNITY_MODELS } from '../api/generate';

const CAPABILITY_FIELDS: (keyof ModelCapabilities)[] = [
    'supportsJsonSchema',
    'supportsTools',
    'supportsThinking',
    'maxContextTokens',
    'prefersMarkdown',
    'requiresJsonOnly',
    'canDoWebSearch',
    'supportsStreaming',
    'qualityTier',
    'supportsMultiLanguage',
];

describe('modelCapabilityDetector', () => {
    describe('registry integrity', () => {
        it('every entry declares all capability fields with the right types', () => {
            for (const [modelId, caps] of Object.entries(MODEL_CAPABILITIES)) {
                for (const field of CAPABILITY_FIELDS) {
                    expect(caps, `${modelId} missing ${field}`).toHaveProperty(field);
                }
                for (const boolField of CAPABILITY_FIELDS.filter(
                    (f) => f.startsWith('supports') || f.startsWith('canDo') || f.startsWith('prefers') || f.startsWith('requires')
                )) {
                    expect(typeof caps[boolField], `${modelId}.${String(boolField)}`).toBe('boolean');
                }
                expect(typeof caps.maxContextTokens).toBe('number');
                expect(caps.maxContextTokens).toBeGreaterThan(0);
                expect(['high', 'medium', 'basic']).toContain(caps.qualityTier);
            }
        });

        it('has no null/undefined values anywhere in the registry', () => {
            for (const [modelId, caps] of Object.entries(MODEL_CAPABILITIES)) {
                for (const [field, value] of Object.entries(caps)) {
                    expect(value, `${modelId}.${field} is nullish`).toBeDefined();
                    expect(value, `${modelId}.${field} is null`).not.toBeNull();
                }
            }
        });

        it('every community gateway model has a capability entry', () => {
            for (const entry of COMMUNITY_MODELS) {
                expect(
                    MODEL_CAPABILITIES[entry.model],
                    `gateway model ${entry.model} lacks capabilities`
                ).toBeDefined();
            }
        });

        it('community-tier models never advertise web search (community constraint)', () => {
            for (const entry of COMMUNITY_MODELS) {
                const caps = MODEL_CAPABILITIES[entry.model];
                expect(caps.canDoWebSearch, `${entry.model} must not claim web search`).toBe(false);
            }
        });

        it('free-tier OpenRouter models use JSON-only mode (verified live 2026-09-07)', () => {
            for (const entry of COMMUNITY_MODELS) {
                const caps = MODEL_CAPABILITIES[entry.model];
                expect(caps.requiresJsonOnly).toBe(true);
                expect(caps.supportsJsonSchema).toBe(true);
            }
        });
    });

    describe('detectCapabilities', () => {
        it('returns the exact registry entry for a known model', () => {
            const caps = detectCapabilities('openai/gpt-4o');
            expect(caps).toBe(MODEL_CAPABILITIES['openai/gpt-4o']);
            expect(caps.supportsJsonSchema).toBe(true);
            expect(caps.canDoWebSearch).toBe(true);
            expect(caps.qualityTier).toBe('high');
        });

        it('falls back to a conservative default for unknown models', () => {
            const caps = detectCapabilities('totally-unknown/model-x');
            expect(caps).toBe(MODEL_CAPABILITIES.default);
            expect(caps.supportsJsonSchema).toBe(false);
            expect(caps.supportsTools).toBe(false);
            expect(caps.canDoWebSearch).toBe(false);
            expect(caps.supportsStreaming).toBe(false);
            expect(caps.qualityTier).toBe('basic');
            expect(caps.maxContextTokens).toBe(4096);
        });
    });

    describe('selectPromptVariant', () => {
        const basePrompt = '# Your Task\nDesign a quest about civic budgeting.\n\n# JSON Schema\n{"type":"object"}\n';

        it('strips JSON schema sections for models without schema support (no strict requirement)', () => {
            const caps = { ...MODEL_CAPABILITIES.default };
            caps.supportsJsonSchema = false;
            const result = selectPromptVariant(basePrompt, caps, false);
            expect(result).not.toContain('# JSON Schema');
            expect(result).toContain('Design a quest about civic budgeting.');
        });

        it('keeps JSON schema sections when strict JSON output is required', () => {
            const caps = { ...MODEL_CAPABILITIES.default };
            caps.supportsJsonSchema = false;
            const result = selectPromptVariant(basePrompt, caps, true);
            expect(result).toContain('# JSON Schema');
        });

        it('keeps JSON schema sections for schema-capable models', () => {
            const caps = { ...MODEL_CAPABILITIES.default };
            caps.supportsJsonSchema = true;
            const result = selectPromptVariant(basePrompt, caps, false);
            expect(result).toContain('# JSON Schema');
        });

        it('appends tool instructions for tool-capable models', () => {
            const caps = { ...MODEL_CAPABILITIES.default };
            caps.supportsTools = true;
            const result = selectPromptVariant(basePrompt, caps, false);
            expect(result).toContain('# Available Tools');
            expect(result).toContain('web_search');
        });

        it('never duplicates the tools section on re-selection', () => {
            const caps = { ...MODEL_CAPABILITIES.default };
            caps.supportsTools = true;
            const once = selectPromptVariant(basePrompt, caps, false);
            const twice = selectPromptVariant(once, caps, false);
            expect(twice.split('# Available Tools').length - 1).toBe(1);
        });

        it('omits tool instructions for models without tool support', () => {
            const caps = { ...MODEL_CAPABILITIES.default };
            caps.supportsTools = false;
            const result = selectPromptVariant(basePrompt, caps, false);
            expect(result).not.toContain('# Available Tools');
        });

        it('adds thinking instructions only for thinking+markdown models', () => {
            const thinking = { ...MODEL_CAPABILITIES.default };
            thinking.supportsThinking = true;
            thinking.prefersMarkdown = true;
            const withThinking = selectPromptVariant(basePrompt, thinking, false);
            expect(withThinking).toContain('Thinking Instructions');
            expect(withThinking).toContain('<thinking>');

            const nonMarkdown = { ...thinking };
            nonMarkdown.prefersMarkdown = false;
            expect(selectPromptVariant(basePrompt, nonMarkdown, false)).not.toContain(
                'Thinking Instructions'
            );
        });

        it('does not duplicate thinking instructions', () => {
            const caps = { ...MODEL_CAPABILITIES.default };
            caps.supportsThinking = true;
            caps.prefersMarkdown = true;
            const prompt = basePrompt.replace('# Your Task', '# Your Task\nThinking');
            const result = selectPromptVariant(prompt, caps, false);
            expect(result.split('Thinking Instructions').length - 1).toBe(0);
        });
    });
});
