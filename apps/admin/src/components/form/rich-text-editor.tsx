import { Bold, Heading2, Italic, Link2, Link2Off, List, ListOrdered, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useI18n } from '../../lib/i18n';
import type { ControlProps } from './field';

interface RichTextEditorProps extends ControlProps {
    /** HTML (or plain text from earlier) */
    value: string;
    onChange(html: string): void;
    disabled?: boolean;
    /** The text's language, for spell checking and screen readers. */
    lang?: string;
    /** The field's name for screen readers (a `<label for>` can't name an editable box). */
    label: string;
}

/** Plain text from before: shown with its line breaks. */
function toEditable(value: string): string {
    if (/<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i.test(value)) return value;
    const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped
        .split(/\n\s*\n/)
        .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
        .join('');
}

/**
 * A small editor for page text: bold, italic, headings, lists and links, nothing else. Built on
 * the browser's own editing (no library). The server keeps only safe formatting whatever is sent
 * (phase 12's sanitizer), and the storefront sanitizes again when it shows the page.
 */
export function RichTextEditor({ value, onChange, disabled, lang, label, ...control }: RichTextEditorProps) {
    const { messages: m } = useI18n();
    const e = m.editor;
    const box = useRef<HTMLDivElement>(null);

    // Set the content once (and when another page loads), not on every keystroke: the caret stays put.
    useEffect(() => {
        if (
            box.current &&
            box.current.innerHTML !== toEditable(value) &&
            document.activeElement !== box.current
        ) {
            box.current.innerHTML = toEditable(value);
        }
    }, [value]);

    const run = (command: string, argument?: string) => {
        box.current?.focus();
        document.execCommand(command, false, argument);
        onChange(box.current?.innerHTML ?? '');
    };
    const tools: Array<{ label: string; icon: LucideIcon; action(): void }> = [
        { label: e.bold, icon: Bold, action: () => run('bold') },
        { label: e.italic, icon: Italic, action: () => run('italic') },
        { label: e.heading, icon: Heading2, action: () => run('formatBlock', 'h2') },
        { label: e.bulletList, icon: List, action: () => run('insertUnorderedList') },
        { label: e.numberedList, icon: ListOrdered, action: () => run('insertOrderedList') },
        {
            label: e.link,
            icon: Link2,
            action: () => {
                const url = window.prompt(e.linkPrompt, 'https://');
                if (url && /^(https?:\/\/|\/|mailto:|tel:)/.test(url.trim())) run('createLink', url.trim());
            },
        },
        { label: e.unlink, icon: Link2Off, action: () => run('unlink') },
    ];

    return (
        <div className="overflow-hidden rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-600">
            <div
                role="toolbar"
                aria-label={e.toolbar}
                className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 p-1"
            >
                {tools.map(tool => (
                    <button
                        key={tool.label}
                        type="button"
                        title={tool.label}
                        aria-label={tool.label}
                        disabled={disabled}
                        // Keep the selection in the text while clicking.
                        onMouseDown={event => event.preventDefault()}
                        onClick={tool.action}
                        className="rounded p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                    >
                        <tool.icon className="size-4" aria-hidden />
                    </button>
                ))}
            </div>
            <div
                ref={box}
                {...control}
                lang={lang}
                aria-label={label}
                role="textbox"
                aria-multiline="true"
                contentEditable={!disabled}
                suppressContentEditableWarning
                onInput={() => onChange(box.current?.innerHTML ?? '')}
                className="min-h-48 px-3 py-2 outline-none [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-teal-700 [&_a]:underline"
            />
        </div>
    );
}
