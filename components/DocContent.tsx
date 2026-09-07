import React, { useState, useEffect } from 'react';
import showdown from 'showdown';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { fetchTextAsset } from '../utils/staticAssets';

const converter = new showdown.Converter({
    ghCompatibleHeaderId: true,
    simpleLineBreaks: true,
    tables: true,
});

export interface Heading {
    id: string;
    level: number;
    text: string;
}

interface DocContentProps {
    docId: string;
    onHeadingsExtracted: (headings: Heading[]) => void;
}

const DocContent: React.FC<DocContentProps> = ({ docId, onHeadingsExtracted }) => {
    const [content, setContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        fetchTextAsset(`/docs/${docId}.md`)
            .then((text) => {
                const html = sanitizeHtml(converter.makeHtml(text));

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                const headings: Heading[] = Array.from(tempDiv.querySelectorAll('h1, h2, h3')).map(
                    (h) => ({
                        id: h.id,
                        level: parseInt(h.tagName.substring(1), 10),
                        text: h.textContent || '',
                    })
                );
                onHeadingsExtracted(headings);

                setContent(html);
            })
            .catch((err) => {
                console.error(err);
                setError(
                    'Error: Could not load documentation content. Please check the console for details.'
                );
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [docId, onHeadingsExtracted]);

    if (isLoading) {
        return <p className="text-lg text-sage animate-pulse">Loading documentation...</p>;
    }

    if (error) {
        return <p className="text-clay">{error}</p>;
    }

    return (
        <article
            className="prose prose-p:text-ink/90 prose-li:text-ink/90 prose-strong:text-ink prose-headings:text-felt-700 prose-a:text-brass-deep hover:prose-a:text-brass prose-code:text-clay-deep prose-pre:bg-felt-900 prose-pre-code:text-brass-bright prose-th-borders:border-ink/20 prose-td-borders:border-ink/10 prose-hr:border-ink/20 max-w-none bg-paper text-ink rounded-lg border border-ink/10 shadow-xl p-6 md:p-10"
            dangerouslySetInnerHTML={{ __html: content }}
        />
    );
};

export default DocContent;
