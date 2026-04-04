import { marked } from "marked";
import DOMPurify from 'dompurify';
import { extractJSONFromAIResponse } from "@rs-core/document/AIResponseParser";
import { writeText as writeClipboardText } from "@rs-core/modules/Clipboard";

export class WorkCenterDataProcessing {
    formatResult(result: any, format: string, outputFormat?: string): string {
        // Handle auto format - detect the best rendering format based on content
        if (format === 'auto') {
            const rawData = result?.rawData || result;
            let data = extractJSONFromAIResponse<any>(rawData)?.data || rawData;

            // If data is a string that looks like JSON, parse it
            if (typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && typeof parsed === 'object') {
                        data = parsed;
                    }
                } catch {
                    // Keep as string if not valid JSON
                }
            }

            // Check if we have structured AI recognition data
            if (data && typeof data === 'object' && (
                data.recognized_data ||
                data.verbose_data ||
                data.keywords_and_tags ||
                data.suggested_type
            )) {
                // For structured AI data, extract and render content directly as markdown
                const content: string[] = [];

                // Add recognized data (highest priority)
                if (data.recognized_data) {
                    const recognized = Array.isArray(data.recognized_data)
                        ? data.recognized_data
                        : [data.recognized_data];
                    content.push(...recognized.map((item: any) => String(item)));
                }

                // Add verbose data
                if (data.verbose_data) {
                    content.push(String(data.verbose_data));
                }

                // Add keywords/tags if available
                if (data.keywords_and_tags && Array.isArray(data.keywords_and_tags) && data.keywords_and_tags.length > 0) {
                    content.push(`\n**Keywords:** ${data.keywords_and_tags.join(', ')}`);
                }

                // Add confidence and type info
                if (data.confidence || data.suggested_type) {
                    const info: string[] = [];
                    if (data.confidence) info.push(`Confidence: ${Math.round(data.confidence * 100)}%`);
                    if (data.suggested_type) info.push(`Type: ${data.suggested_type}`);
                    if (info.length > 0) {
                        content.push(`\n*${info.join(' • ')}*`);
                    }
                }

                // Render directly as HTML to preserve KaTeX markup
                if (content.length > 0) {
                    const htmlContent = content.join('\n\n');
                    return `<div class="markdown-result structured-content">${htmlContent}</div>`;
                }
            }

            // For other structured data, use JSON format
            if (data && typeof data === 'object') {
                return this.formatResult(result, 'json');
            }

            // For plain text or simple content, use markdown
            return this.formatResult(result, 'markdown');
        }

        // For JSON format, render the raw data directly to preserve structure
        if (format === 'json') {
            // Extract the raw data from the result
            const rawData = result?.rawData || result;
            let data = extractJSONFromAIResponse<any>(rawData)?.data || rawData;

            // If data is a string that looks like JSON, parse it
            if (typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && typeof parsed === 'object') {
                        data = parsed;
                    }
                } catch {
                    // Keep as string if not valid JSON
                }
            }

            return this.renderAsJSON(data);
        }

        // Check if we have structured JSON data that should be rendered as markdown
        if (format === 'markdown') {
            const rawData = result?.rawData || result;
            let data = extractJSONFromAIResponse<any>(rawData)?.data || rawData;

            // If data is a string that looks like JSON, parse it
            if (typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && typeof parsed === 'object') {
                        data = parsed;
                    }
                } catch {
                    // Keep as string if not valid JSON
                }
            }

            // If we have structured recognition data, extract content for markdown rendering
            if (data && typeof data === 'object' && (
                data.recognized_data ||
                data.verbose_data ||
                data.keywords_and_tags ||
                data.suggested_type
            )) {
                // Create markdown content from structured data
                const content: string[] = [];

                // Add recognized data (highest priority)
                if (data.recognized_data) {
                    const recognized = Array.isArray(data.recognized_data)
                        ? data.recognized_data
                        : [data.recognized_data];
                    content.push(...recognized.map((item: any) => String(item)));
                }

                // Add verbose data
                if (data.verbose_data) {
                    content.push(String(data.verbose_data));
                }

                // Add keywords/tags if available
                if (data.keywords_and_tags && Array.isArray(data.keywords_and_tags) && data.keywords_and_tags.length > 0) {
                    content.push(`\n**Keywords:** ${data.keywords_and_tags.join(', ')}`);
                }

                // Add confidence and type info
                if (data.confidence || data.suggested_type) {
                    const info: string[] = [];
                    if (data.confidence) info.push(`Confidence: ${Math.round(data.confidence * 100)}%`);
                    if (data.suggested_type) info.push(`Type: ${data.suggested_type}`);
                    if (info.length > 0) {
                        content.push(`\n*${info.join(' • ')}*`);
                    }
                }

                // If we extracted content, render it directly as HTML to preserve KaTeX markup
                if (content.length > 0) {
                    const htmlContent = content.join('\n\n');
                    // For structured data with HTML content, render directly without processing
                    return `<div class="markdown-result structured-content">${htmlContent}</div>`;
                }
            }
        }

        // For other formats or fallback, normalize and extract data first
        const normalizedData = this.normalizeResultData(result);
        if (!normalizedData) return '<div class="no-result">No result</div>';

        // Render based on format
        switch (format) {
            case 'code':
                return this.renderAsCode(normalizedData);
            case 'raw':
                return this.renderAsRaw(result?.rawData || result);
            case 'html':
                return this.renderAsHTML(normalizedData);
            case 'text':
                return this.renderAsText(normalizedData);
            case 'markdown':
            default:
                return this.renderAsMarkdown(normalizedData);
        }
    }

    private normalizeResultData(result: any): any {
        if (!result) return null;

        // Extract data from AI response wrapper
        let data = extractJSONFromAIResponse<any>(result)?.data || result;

        // Handle nested data structures
        if (data && typeof data === 'object') {
            // If data has a 'data' property, use that
            if (data.data !== undefined) {
                data = data.data;
            }

            // If data is still an object, check for string content that needs parsing
            if (typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && typeof parsed === 'object') {
                        data = parsed;
                    }
                } catch {
                    // Keep as string if not valid JSON
                }
            }
        }

        // Handle primitive values by wrapping them
        if (typeof data !== 'object' || data === null) {
            data = { recognized_data: [String(data)] };
        }

        return data;
    }

    private renderAsJSON(data: any): string {
        try {
            // Create a formatted JSON string, but handle HTML content specially
            const createFormattedJSON = (obj: any, indent: number = 0): string => {
                const spaces = '  '.repeat(indent);

                if (obj === null) return 'null';
                if (typeof obj === 'boolean') return obj ? 'true' : 'false';
                if (typeof obj === 'number') return String(obj);
                if (typeof obj === 'string') {
                    // Check if string contains HTML/MathML content that should be rendered
                    if (obj.includes('<math') || obj.includes('class="katex"') || obj.includes('<span>')) {
                        // This is HTML/MathML content - create a placeholder that will be replaced with actual HTML
                        const placeholder = `__HTML_CONTENT_${Math.random().toString(36).substr(2, 9)}__`;
                        (htmlPlaceholders as any)[placeholder] = obj;
                        return `"${placeholder}"`;
                    }
                    // Regular string - escape it
                    return JSON.stringify(obj);
                }

                if (Array.isArray(obj)) {
                    if (obj.length === 0) return '[]';
                    const items = obj.map(item => createFormattedJSON(item, indent + 1));
                    return `[\n${'  '.repeat(indent + 1)}${items.join(`,\n${'  '.repeat(indent + 1)}`)}\n${spaces}]`;
                }

                if (typeof obj === 'object') {
                    const keys = Object.keys(obj);
                    if (keys.length === 0) return '{}';
                    const items = keys.map(key => {
                        const formattedValue = createFormattedJSON(obj[key], indent + 1);
                        return `${JSON.stringify(key)}: ${formattedValue}`;
                    });
                    return `{\n${'  '.repeat(indent + 1)}${items.join(`,\n${'  '.repeat(indent + 1)}`)}\n${spaces}}`;
                }

                return String(obj);
            };

            // Store HTML content placeholders
            const htmlPlaceholders: Record<string, string> = {};
            const jsonString = createFormattedJSON(data);

            // Replace placeholders with actual HTML content
            let finalHTML = `<div class="json-result"><pre>${jsonString}</pre></div>`;

            // Replace placeholders with rendered HTML
            for (const [placeholder, htmlContent] of Object.entries(htmlPlaceholders)) {
                // Create a temporary div to hold the HTML content
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlContent;
                const renderedHTML = tempDiv.innerHTML;

                // Replace the placeholder in the JSON string
                finalHTML = finalHTML.replace(`"${placeholder}"`, `<span class="json-html-content">${renderedHTML}</span>`);
            }

            return finalHTML;
        } catch (error) {
            return `<div class="error">Failed to format JSON: ${error}</div>`;
        }
    }

    private renderAsHTML(data: any): string {
        const content = this.extractContentItems(data);
        const renderedContent = content.map(item => this.renderContentItem(item, 'html')).join('');

        if (!renderedContent) {
            return `<div class="html-result">${this.renderMathAsHTML(this.extractTextContent(data))}</div>`;
        }

        return `<div class="html-result">${renderedContent}</div>`;
    }

    private renderAsText(data: any): string {
        const content = this.extractContentItems(data);
        const renderedContent = content.map(item => this.renderContentItem(item, 'text')).join('\n\n');

        if (!renderedContent.trim()) {
            return `<pre class="text-result">${this.escapeHtml(this.extractTextContent(data))}</pre>`;
        }

        return `<pre class="text-result">${this.escapeHtml(renderedContent)}</pre>`;
    }

    private renderAsRaw(data: any): string {
        let rawText = '';
        if (typeof data === 'string') {
            rawText = data;
        } else {
            try {
                rawText = JSON.stringify(data, null, 2);
            } catch {
                rawText = String(data ?? '');
            }
        }
        return `<pre class="raw-result">${this.escapeHtml(rawText)}</pre>`;
    }

    private renderAsCode(data: any): string {
        const content = this.extractContentItems(data).join('\n\n').trim() || this.extractTextContent(data);
        const code = this.extractLikelyCode(content);
        const language = this.detectCodeLanguage(content);
        return `<pre class="code-result"><code data-lang="${this.escapeHtml(language)}">${this.escapeHtml(code)}</code></pre>`;
    }

    private renderAsMarkdown(data: any): string {
        const content = this.extractContentItems(data);
        const renderedContent = content.map(item => this.renderContentItem(item, 'markdown')).join('\n\n');

        if (!renderedContent.trim()) {
            try {
                const textContent = this.extractTextContent(data);
                const html = marked.parse(textContent) as string;
                return DOMPurify.sanitize(html);
            } catch (error) {
                console.warn('Markdown parsing failed, falling back to simple rendering:', error);
                return this.renderMathAsHTML(renderedContent as string);
            }
        }

        try {
            const html = marked.parse(renderedContent) as string;
            return DOMPurify.sanitize(html);
        } catch (error) {
            console.warn('Markdown parsing failed, falling back to simple rendering:', error);
            return this.renderMathAsHTML(renderedContent as string);
        }
    }

    private extractContentItems(data: any): string[] {
        const items: string[] = [];

        // Extract recognized data (highest priority)
        if (data.recognized_data) {
            const recognized = Array.isArray(data.recognized_data)
                ? data.recognized_data
                : [data.recognized_data];
            items.push(...recognized.map((item: any) => String(item)));
        }

        // Extract verbose data
        if (data.verbose_data) {
            items.push(String(data.verbose_data));
        }

        // Extract other text fields if no recognized/verbose data
        if (items.length === 0) {
            const textFields = ['content', 'text', 'message', 'result', 'response', 'description'];
            for (const field of textFields) {
                if (data[field]) {
                    const content = Array.isArray(data[field]) ? data[field] : [data[field]];
                    items.push(...content.map((item: any) => String(item)));
                    break; // Use first available field
                }
            }
        }

        // Fallback to raw text extraction
        if (items.length === 0) {
            const textContent = this.extractTextContent(data);
            if (textContent) {
                items.push(textContent);
            }
        }

        return items;
    }

    private renderContentItem(item: string, format: 'html' | 'text' | 'markdown'): string {
        switch (format) {
            case 'html':
                return `<div class="recognized-item">${this.renderMathAsHTML(item)}</div>`;
            case 'text':
                return this.stripMarkdown(item);
            case 'markdown':
                return item; // Keep markdown as-is for processing
            default:
                return item;
        }
    }

    private renderMathAsHTML(content: string): string {
        // Unified math rendering for HTML output
        let result = content;

        // Handle display math $$...$$
        result = result.replace(/\$\$([^$]+)\$\$/g, (match, math) => {
            try {
                const mathHtml = marked.parse(`$$${math}$$`) as string;
                return mathHtml.replace(/<p>|<\/p>/g, '').trim();
            } catch {
                return `<span class="math-display">${this.escapeHtml(`$$${math}$$`)}</span>`;
            }
        });

        // Handle inline math $...$
        result = result.replace(/\$([^$]+)\$/g, (match, math) => {
            try {
                const mathHtml = marked.parse(`$${math}$`) as string;
                return mathHtml.replace(/<p>|<\/p>/g, '').trim();
            } catch {
                return `<span class="math-inline">${this.escapeHtml(`$${math}$`)}</span>`;
            }
        });

        // Handle line breaks
        result = result.replace(/\n/g, '<br>');

        return result;
    }

    private stripMarkdown(content: string): string {
        // Simple markdown stripping for text output
        return content
            .replace(/#{1,6}\s*/g, '') // Headers
            .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
            .replace(/\*(.*?)\*/g, '$1') // Italic
            .replace(/`(.*?)`/g, '$1') // Code
            .replace(/^\s*[-*+]\s+/gm, '') // Lists
            .replace(/^\s*\d+\.\s+/gm, '') // Numbered lists
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Links
            .replace(/!\[([^\]]+)\]\([^\)]+\)/g, '$1') // Images
            .trim();
    }

    private extractLikelyCode(content: string): string {
        const fenced = content.match(/```[\t ]*([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/);
        if (fenced?.[2]) {
            return fenced[2].trim();
        }
        return content;
    }

    private detectCodeLanguage(content: string): string {
        const fencedLanguage = content.match(/```[\t ]*([a-zA-Z0-9_-]+)?\n/)?.[1];
        if (fencedLanguage) return fencedLanguage.toLowerCase();
        if (/\b(interface|type|const|let|=>|import\s+type)\b/.test(content)) return 'typescript';
        if (/\b(function|const|let|var|import|export)\b/.test(content)) return 'javascript';
        if (/\b(def |import |from |class )/.test(content)) return 'python';
        if (/\b<[^>]+>/.test(content)) return 'html';
        return 'text';
    }

    private extractTextContent(data: any): string {
        // Handle null/undefined
        if (data == null) return '';

        // Handle strings directly
        if (typeof data === 'string') return data;

        // Handle numbers and booleans
        if (typeof data === 'number' || typeof data === 'boolean') return String(data);

        // Handle arrays
        if (Array.isArray(data)) {
            return data.map(item => this.extractTextContent(item)).join('\n');
        }

        // Handle objects - try to find meaningful text fields
        if (typeof data === 'object') {
            // Use the same field priority as extractContentItems
            const textFields = ['verbose_data', 'recognized_data', 'content', 'text', 'message', 'result', 'response', 'data'];

            for (const field of textFields) {
                if (data[field] != null) {
                    const content = this.extractTextContent(data[field]);
                    if (content) return content;
                }
            }

            // If no meaningful text fields found, stringify as JSON
            try {
                return JSON.stringify(data, null, 2);
            } catch {
                return '[Complex Object]';
            }
        }

        // Fallback
        return String(data);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    copyResultsToClipboard(result: any, format: string): Promise<void> {
        let textToCopy = '';

        // For Auto format, determine what content to copy based on detected type
        if (format === 'auto' && result) {
            const rawData = result?.rawData || result;
            let data = extractJSONFromAIResponse<any>(rawData)?.data || rawData;

            // If data is a string that looks like JSON, parse it
            if (typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && typeof parsed === 'object') {
                        data = parsed;
                    }
                } catch {
                    // Keep as string if not valid JSON
                }
            }

            // For structured AI data, copy the extracted content
            if (data && typeof data === 'object' && (
                data.recognized_data || data.verbose_data
            )) {
                const contentItems: string[] = [];

                if (data.recognized_data) {
                    const recognized = Array.isArray(data.recognized_data)
                        ? data.recognized_data
                        : [data.recognized_data];
                    contentItems.push(...recognized.map((item: any) => String(item)));
                }

                if (data.verbose_data) {
                    contentItems.push(String(data.verbose_data));
                }

                textToCopy = contentItems.join('\n\n');
            } else {
                // For other data, use normalized content
                const normalizedData = this.normalizeResultData(result);
                const contentItems = this.extractContentItems(normalizedData);
                textToCopy = contentItems.join('\n\n');
            }
        }
        // For Markdown and HTML formats, copy raw unparsed content
        else if ((format === 'markdown' || format === 'html') && result) {
            const normalizedData = this.normalizeResultData(result);
            const contentItems = this.extractContentItems(normalizedData);
            textToCopy = contentItems.join('\n\n');
        }
        // For JSON format, copy unwrapped content (not the JSON structure)
        else if (format === 'json' && result) {
            const normalizedData = this.normalizeResultData(result);
            const contentItems = this.extractContentItems(normalizedData);
            textToCopy = contentItems.join('\n\n');
        }
        else if ((format === 'raw' || format === 'code') && result) {
            const rawData = result?.rawData || result;
            textToCopy = typeof rawData === 'string' ? rawData : JSON.stringify(rawData, null, 2);
        }
        // For text format or fallback, use rendered content
        else {
            textToCopy = result?.textContent || '';
        }

        return writeClipboardText(textToCopy).then((result) => {
            if (!result.ok) {
                throw new Error(result.error || "Clipboard write failed");
            }
        });
    }
}