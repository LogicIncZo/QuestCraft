import DOMPurify, { type Config } from 'dompurify';

const PURIFY_CONFIG: Config = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

export function sanitizeHtml(dirty: string): string {
    return DOMPurify.sanitize(dirty, PURIFY_CONFIG) as string;
}
