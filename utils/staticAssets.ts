/**
 * Helpers for fetching static text assets (docs markdown, quests JSON).
 *
 * When a static asset is missing from a deployment, the SPA fallback serves
 * index.html with a 200 status. Treating that as valid content leads to blank
 * docs pages and HTML being fed to JSON parsing or AI prompts, so these
 * helpers detect an HTML-document body and fail with a clear error instead.
 */

export class StaticAssetError extends Error {
    constructor(
        path: string,
        message: string
    ) {
        super(`Static asset "${path}": ${message}`);
        this.name = 'StaticAssetError';
    }
}

const HTML_DOC_PATTERN = /^\s*(<!doctype\s+html|<html[\s>])/i;

const throwIfHtmlDocument = (path: string, text: string): void => {
    if (HTML_DOC_PATTERN.test(text)) {
        throw new StaticAssetError(
            path,
            'server returned an HTML document (SPA fallback) instead of the asset. Is the file present in the deployed static assets?'
        );
    }
};

export const fetchTextAsset = async (path: string): Promise<string> => {
    const response = await fetch(path);
    if (!response.ok) {
        throw new StaticAssetError(path, `request failed with ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    throwIfHtmlDocument(path, text);
    return text;
};

export const fetchJsonAsset = async <T>(path: string): Promise<T> => {
    const text = await fetchTextAsset(path);
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new StaticAssetError(path, `response is not valid JSON: ${(error as Error).message}`);
    }
};
