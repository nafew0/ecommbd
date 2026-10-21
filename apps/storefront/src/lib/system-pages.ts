/**
 * Plain bilingual pages for when the store can't render: suspended, under maintenance, or the core
 * unreachable. No data and no template, so they work when nothing else does.
 */

type Kind = 'maintenance' | 'suspended' | 'unavailable' | 'error';

const TEXT: Record<Kind, { status: number; bn: [string, string]; en: [string, string] }> = {
    maintenance: {
        status: 503,
        bn: ['কিছুক্ষণের জন্য বন্ধ', 'দোকানে কাজ চলছে। একটু পরে আবার আসুন।'],
        en: ['Back soon', 'We are working on the shop. Please come back in a little while.'],
    },
    suspended: {
        status: 503,
        bn: ['দোকানটি এখন বন্ধ', 'এই দোকানটি এখন খোলা নেই।'],
        en: ['This shop is closed', 'This shop is not open at the moment.'],
    },
    unavailable: {
        status: 503,
        bn: ['কিছুক্ষণের জন্য বন্ধ', 'দোকানটি কিছুক্ষণের জন্য বন্ধ আছে। এক মিনিট পরে আবার চেষ্টা করুন।'],
        en: ['Temporarily unavailable', 'The shop is temporarily unavailable. Please try again in a minute.'],
    },
    error: {
        status: 500,
        bn: ['কিছু একটা সমস্যা হয়েছে', 'আবার চেষ্টা করুন।'],
        en: ['Something went wrong', 'Please try again.'],
    },
};

export function systemPage(kind: Kind): Response {
    const { status, bn, en } = TEXT[kind];
    const html = `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${bn[0]} · ${en[0]}</title>
<link rel="stylesheet" href="/system.css">
</head>
<body>
<main>
<h1>${bn[0]}</h1>
<p>${bn[1]}</p>
<h2 lang="en">${en[0]}</h2>
<p lang="en">${en[1]}</p>
</main>
</body>
</html>`;
    const headers = new Headers({
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
    });
    // Search engines come back later instead of dropping the pages.
    if (status === 503) headers.set('retry-after', kind === 'unavailable' ? '60' : '3600');
    return new Response(html, { status, headers });
}
