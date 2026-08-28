
export const PROMPT_TEMPLATE_NAMES = [
    'enhance-idea.txt',
    'random-idea.txt',
    'quest-outline-system-openai.txt',
    'pregenerated-scenarios-fictional-openai.txt',
    'dynamic-scenario-fictional-openai.txt',
] as const;

export type PromptTemplateName = (typeof PROMPT_TEMPLATE_NAMES)[number];

export function fillPromptTemplate(
    template: string,
    replacements: Record<string, string | number> = {},
): string {
    return Object.entries(replacements).reduce(
        (prompt, [key, value]) => prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
        template,
    );
}
