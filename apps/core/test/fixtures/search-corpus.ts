import type { CatalogRows } from '../../src/plugins/bd-search/catalog';

/**
 * A Bangla/English test catalogue for the search relevance suite (roadmap phase 13): about 200
 * products across clothing, food, gadgets, beauty and home, shaped like the rows the search reads
 * from Vendure. Product keys are the English names in kebab case (`black-cotton-panjabi`).
 */

const ZWJ = String.fromCodePoint(0x200d);
/** ড় written as two characters (ড + nukta), the way NFC stores it. */
const RRA_DECOMPOSED = String.fromCodePoint(0x9a1, 0x9bc);

type Dimension = 'size' | 'colour';
type OptionValue = [code: string, en: string, bn: string];

export interface CorpusProduct {
    key: string;
    en: string | null;
    bn: string;
    category: string;
    sku: string;
    /** Whole taka. */
    price: number;
    inStock?: boolean;
    option?: { dimension: Dimension; values: OptionValue[]; soldOut?: string[] };
    tags?: string[];
    featured?: boolean;
    popularity?: number;
}

/** [id, parentId, English, Bangla] */
const CATEGORIES: Array<[string, string | null, string, string]> = [
    ['1', null, 'Men', 'পুরুষ'],
    ['2', '1', 'Panjabi', 'পাঞ্জাবি'],
    ['3', '1', 'Shirts', 'শার্ট'],
    ['4', '1', 'T-shirts', 'টি-শার্ট'],
    ['5', '1', 'Lungi', 'লুঙ্গি'],
    ['6', null, 'Women', 'নারী'],
    ['7', '6', 'Saree', 'শাড়ি'],
    ['8', '6', 'Three-piece', 'থ্রি-পিস'],
    ['9', '6', 'Kurti', 'কুর্তি'],
    ['10', '6', 'Borka', 'বোরকা'],
    ['11', '6', 'Hijab', 'হিজাব'],
    ['12', null, 'Kids', 'শিশু'],
    ['13', null, 'Food', 'খাবার'],
    ['14', '13', 'Honey', 'মধু'],
    ['15', '13', 'Ghee and oil', 'ঘি ও তেল'],
    ['16', '13', 'Dates and nuts', 'খেজুর ও বাদাম'],
    ['17', '13', 'Spices', 'মসলা'],
    ['18', null, 'Gadgets', 'গ্যাজেট'],
    ['19', null, 'Beauty', 'প্রসাধনী'],
    ['20', null, 'Shoes', 'জুতা'],
    ['21', null, 'Bags', 'ব্যাগ'],
    ['22', null, 'Home and kitchen', 'ঘর ও রান্নাঘর'],
    ['23', null, 'Jewellery', 'গয়না'],
    ['24', null, 'Islamic', 'ইসলামিক'],
    ['25', null, 'Winter', 'শীতের পোশাক'],
    ['26', null, 'Books and stationery', 'বই ও স্টেশনারি'],
    ['27', null, 'Toys', 'খেলনা'],
    ['28', null, 'Accessories', 'এক্সেসরিজ'],
];

const SIZES: OptionValue[] = [
    ['m', 'M', 'M'],
    ['l', 'L', 'L'],
    ['xl', 'XL', 'XL'],
    ['xxl', 'XXL', 'XXL'],
];
const SHOE_SIZES: OptionValue[] = ['40', '41', '42', '43', '44'].map(size => [size, size, size]);
const BORKA_SIZES: OptionValue[] = ['52', '54', '56'].map(size => [size, size, size]);

const COLOURS: Record<string, OptionValue> = {
    black: ['black', 'Black', 'কালো'],
    white: ['white', 'White', 'সাদা'],
    maroon: ['maroon', 'Maroon', 'মেরুন'],
    blue: ['blue', 'Blue', 'নীল'],
    red: ['red', 'Red', 'লাল'],
    green: ['green', 'Green', 'সবুজ'],
};

const kebab = (text: string) =>
    text
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

function product(
    en: string | null,
    bn: string,
    category: string,
    sku: string,
    price: number,
    extra: Partial<CorpusProduct> = {},
): CorpusProduct {
    return { key: kebab(en ?? sku), en, bn, category, sku, price, ...extra };
}

function buildProducts(): CorpusProduct[] {
    const list: CorpusProduct[] = [];

    // Panjabi: material × colour, sizes.
    const materials: Array<[string, string, string]> = [
        ['Cotton', 'সুতির', 'COT'],
        ['Silk', 'সিল্ক', 'SLK'],
        ['Linen', 'লিনেন', 'LIN'],
        ['Khadi', 'খাদি', 'KHD'],
    ];
    for (const [materialEn, materialBn, code] of materials) {
        for (const colour of ['black', 'white', 'maroon', 'blue']) {
            const [, colourEn, colourBn] = COLOURS[colour]!;
            list.push(
                product(
                    `${colourEn} ${materialEn.toLowerCase()} panjabi`,
                    `${colourBn} ${materialBn} পাঞ্জাবি`,
                    '2',
                    `PNJ-${code}-${colour.slice(0, 3).toUpperCase()}`,
                    code === 'SLK' ? 2400 : 1450,
                    {
                        option: { dimension: 'size', values: SIZES },
                        tags: ['eid'],
                        popularity: code === 'COT' ? 30 : 5,
                    },
                ),
            );
        }
    }
    list.push(
        product('Kabli set', 'কাবলি সেট', '2', 'KBL-01', 1850, {
            option: { dimension: 'size', values: SIZES },
        }),
    );
    list.push(
        product('Pajama', 'পায়জামা', '2', 'PJM-01', 450, { option: { dimension: 'size', values: SIZES } }),
    );

    // Shirts.
    for (const kind of ['Formal', 'Casual', 'Denim', 'Check']) {
        for (const colour of ['white', 'blue', 'black']) {
            const [, colourEn, colourBn] = COLOURS[colour]!;
            const kindBn = { Formal: 'ফরমাল', Casual: 'ক্যাজুয়াল', Denim: 'ডেনিম', Check: 'চেক' }[kind]!;
            list.push(
                product(
                    `${colourEn} ${kind.toLowerCase()} shirt`,
                    `${colourBn} ${kindBn} শার্ট`,
                    '3',
                    `SHT-${kind.slice(0, 3).toUpperCase()}-${colour.slice(0, 3).toUpperCase()}`,
                    990,
                    {
                        option: { dimension: 'size', values: SIZES },
                    },
                ),
            );
        }
    }

    // T-shirts and jerseys.
    for (const kind of ['Plain', 'Printed', 'Polo']) {
        const kindBn = { Plain: 'প্লেইন', Printed: 'প্রিন্টেড', Polo: 'পোলো' }[kind]!;
        list.push(
            product(`${kind} T-shirt`, `${kindBn} টি-শার্ট`, '4', `TSH-${kind.toUpperCase()}`, 450, {
                option: { dimension: 'colour', values: [COLOURS.black!, COLOURS.white!, COLOURS.blue!] },
            }),
        );
    }
    list.push(product('Argentina football jersey', 'আর্জেন্টিনা ফুটবল জার্সি', '4', 'JRS-ARG', 650));
    list.push(product('Brazil football jersey', 'ব্রাজিল ফুটবল জার্সি', '4', 'JRS-BRA', 650));
    list.push(
        product('Hoodie', 'হুডি', '25', 'HOD-01', 1200, { option: { dimension: 'size', values: SIZES } }),
    );

    // Lungi and gamcha.
    list.push(product('Check lungi', 'চেক লুঙ্গি', '5', 'LNG-CHK', 550));
    list.push(product('Batik lungi', 'বাটিক লুঙ্গি', '5', 'LNG-BTK', 600));
    list.push(product('Cotton lungi', 'সুতির লুঙ্গি', '5', 'LNG-COT', 500));
    list.push(product('Gamcha', 'গামছা', '5', 'GMC-01', 150));

    // Saree, with colour options.
    const sarees: Array<[string, string]> = [
        ['Jamdani', 'জামদানি'],
        ['Katan', 'কাতান'],
        ['Silk', 'সিল্ক'],
        ['Cotton', 'সুতি'],
        ['Tangail', 'টাঙ্গাইল'],
        ['Muslin', 'মসলিন'],
    ];
    for (const [kindEn, kindBn] of sarees) {
        list.push(
            product(
                `${kindEn} saree`,
                `${kindBn} শাড়ি`,
                '7',
                `SAR-${kindEn.slice(0, 3).toUpperCase()}`,
                kindEn === 'Jamdani' ? 6500 : 3200,
                {
                    option: { dimension: 'colour', values: [COLOURS.red!, COLOURS.green!, COLOURS.blue!] },
                    tags: kindEn === 'Jamdani' ? ['eid'] : [],
                },
            ),
        );
        list.push(
            product(
                `${kindEn} saree premium`,
                `${kindBn} শাড়ি প্রিমিয়াম`,
                '7',
                `SAR-${kindEn.slice(0, 3).toUpperCase()}-P`,
                8500,
                {
                    option: { dimension: 'colour', values: [COLOURS.maroon!, COLOURS.black!] },
                },
            ),
        );
    }
    list.push(
        product('Silk saree sold out', 'সিল্ক শাড়ি (শেষ)', '7', 'SAR-SLK-OUT', 3000, {
            inStock: false,
            popularity: 50,
        }),
    );

    // Three-piece, kurti, borka, hijab.
    for (const [kindEn, kindBn] of [
        ['Cotton', 'সুতির'],
        ['Georgette', 'জর্জেট'],
        ['Lawn', 'লন'],
    ]) {
        for (const colour of ['red', 'green', 'blue']) {
            const [, colourEn, colourBn] = COLOURS[colour]!;
            list.push(
                product(
                    `${colourEn} ${kindEn!.toLowerCase()} three-piece`,
                    `${colourBn} ${kindBn} থ্রি-পিস`,
                    '8',
                    `3PC-${kindEn!.slice(0, 3).toUpperCase()}-${colour.toUpperCase()}`,
                    1800,
                ),
            );
        }
    }
    for (const [en, bn] of [
        ['Cotton kurti', 'সুতির কুর্তি'],
        ['Printed kurti', 'প্রিন্টেড কুর্তি'],
        ['Long kurti', 'লম্বা কুর্তি'],
        ['Embroidered kurti', 'এমব্রয়ডারি কুর্তি'],
        ['Short kurti', 'ছোট কুর্তি'],
        ['Party kurti', 'পার্টি কুর্তি'],
    ]) {
        list.push(
            product(en!, bn!, '9', `KRT-${kebab(en!).toUpperCase()}`, 950, {
                option: { dimension: 'size', values: SIZES },
            }),
        );
    }
    for (const [en, bn] of [
        ['Dubai borka', 'দুবাই বোরকা'],
        ['Saudi borka', 'সৌদি বোরকা'],
        ['Arabian borka', 'অ্যারাবিয়ান বোরকা'],
    ]) {
        list.push(
            product(en!, bn!, '10', `BRK-${kebab(en!).toUpperCase()}`, 2200, {
                option: { dimension: 'size', values: BORKA_SIZES },
            }),
        );
    }
    for (const [en, bn] of [
        ['Chiffon hijab', 'শিফন হিজাব'],
        ['Jersey hijab', 'জার্সি হিজাব'],
        ['Cotton hijab', 'সুতির হিজাব'],
    ]) {
        list.push(product(en!, bn!, '11', `HJB-${kebab(en!).toUpperCase()}`, 350));
    }

    // Kids and baby.
    for (const [en, bn, sku, price] of [
        ['Kids frock', 'বাচ্চাদের ফ্রক', 'KID-FRK', 750],
        ['Kids panjabi', 'বাচ্চাদের পাঞ্জাবি', 'KID-PNJ', 850],
        ['Baby romper', 'বেবি রম্পার', 'KID-RMP', 600],
        ['School shoes', 'স্কুল জুতা', 'KID-SHO', 900],
        ['Baby diaper', 'বেবি ডায়াপার', 'KID-DPR', 1100],
        ['Feeding bottle', 'ফিডিং বোতল', 'KID-BTL', 350],
        ['Baby lotion', 'বেবি লোশন', 'KID-LTN', 400],
    ] as const) {
        list.push(product(en, bn, '12', sku, price));
    }

    // Food.
    for (const [en, bn, category, sku, price] of [
        ['Sundarban honey', 'সুন্দরবনের মধু', '14', 'HNY-SDB', 900],
        ['Mustard flower honey', 'সরিষা ফুলের মধু', '14', 'HNY-MST', 650],
        ['Litchi flower honey', 'লিচু ফুলের মধু', '14', 'HNY-LTC', 700],
        ['Gawa ghee 500 g', 'গাওয়া ঘি ৫০০ গ্রাম', '15', 'GHE-500', 950],
        ['Gawa ghee 1 kg', 'গাওয়া ঘি ১ কেজি', '15', 'GHE-1KG', 1800],
        ['Mustard oil 1 litre', 'সরিষার তেল ১ লিটার', '15', 'OIL-MST', 320],
        ['Black seed oil', 'কালোজিরা তেল', '15', 'OIL-BLK', 450],
        ['Ajwa dates', 'আজওয়া খেজুর', '16', 'DTS-AJW', 1600],
        ['Mabroom dates', 'মাবরুম খেজুর', '16', 'DTS-MAB', 1300],
        ['Medjool dates', 'মেডজুল খেজুর', '16', 'DTS-MED', 1900],
        ['Almonds', 'কাঠবাদাম', '16', 'NUT-ALM', 1100],
        ['Cashew nuts', 'কাজু বাদাম', '16', 'NUT-CSH', 1250],
        ['Chia seeds', 'চিয়া সিড', '16', 'SED-CHI', 600],
        ['Turmeric powder', 'হলুদ গুঁড়া', '17', 'SPC-TRM', 180],
        ['Chilli powder', 'মরিচ গুঁড়া', '17', 'SPC-CHL', 200],
        ['Cumin', 'জিরা', '17', 'SPC-CMN', 260],
        ['Pink salt', 'পিংক সল্ট', '17', 'SPC-SLT', 220],
    ] as const) {
        list.push(product(en, bn, category, sku, price));
    }

    // Gadgets and mobile accessories.
    for (const [en, bn, sku, price] of [
        ['Smart watch', 'স্মার্ট ঘড়ি', 'GDG-SWT', 3500],
        ['Wireless headphones', 'ওয়্যারলেস হেডফোন', 'GDG-HPH', 2500],
        ['Bluetooth earbuds', 'ব্লুটুথ ইয়ারবাডস', 'GDG-EBD', 1900],
        ['Power bank 10000mAh', 'পাওয়ার ব্যাংক ১০০০০mAh', 'GDG-PWB', 1400],
        ['Fast charger 20W', 'ফাস্ট চার্জার ২০W', 'GDG-CHG', 850],
        ['USB cable', 'ইউএসবি ক্যাবল', 'GDG-USB', 250],
        ['Gaming mouse', 'গেমিং মাউস', 'GDG-MSE', 1200],
        ['Hair trimmer', 'হেয়ার ট্রিমার', 'GDG-TRM', 1600],
        ['Phone cover', 'ফোন কভার', 'MOB-CVR', 250],
        ['Screen protector', 'স্ক্রিন প্রটেক্টর', 'MOB-SCR', 200],
        ['Selfie stick', 'সেলফি স্টিক', 'MOB-SLF', 550],
        ['Wired earphone', 'তারের ইয়ারফোন', 'MOB-EPH', 300],
        ["Men's leather watch", 'ছেলেদের চামড়ার ঘড়ি', 'WCH-MEN', 2800],
        ['Ladies watch', 'মেয়েদের ঘড়ি', 'WCH-LDY', 2400],
        ['Wall clock', 'দেয়াল ঘড়ি', 'HOM-CLK', 950],
    ] as const) {
        list.push(product(en, bn, sku.startsWith('HOM') ? '22' : '18', sku, price));
    }

    // Beauty.
    for (const [en, bn, sku, price] of [
        ['Oud attar', 'ঊদ আতর', 'BTY-OUD', 1500],
        ['Rose attar', 'গোলাপ আতর', 'BTY-ROS', 800],
        ['Musk attar', 'মেশক আতর', 'BTY-MSK', 900],
        ['Perfume for men', 'ছেলেদের পারফিউম', 'BTY-PFM', 2200],
        ['Perfume for women', 'মেয়েদের পারফিউম', 'BTY-PFW', 2400],
        ['Matte lipstick', 'ম্যাট লিপস্টিক', 'BTY-LPM', 650],
        ['Liquid lipstick', 'লিকুইড লিপস্টিক', 'BTY-LPL', 700],
        ['Lip balm', 'লিপ বাম', 'BTY-LPB', 300],
        ['Face cream', 'ফেস ক্রিম', 'BTY-FCR', 550],
        ['Sunscreen', 'সানস্ক্রিন', 'BTY-SUN', 850],
        ['Aloe vera gel', 'অ্যালোভেরা জেল', 'BTY-ALO', 450],
        ['Hair oil', 'চুলের তেল', 'BTY-HOL', 380],
        ['Shampoo', 'শ্যাম্পু', 'BTY-SHP', 420],
        ['Herbal soap', 'হারবাল সাবান', 'BTY-SOP', 150],
        ['Face wash', 'ফেস ওয়াশ', 'BTY-FWS', 350],
    ] as const) {
        list.push(product(en, bn, '19', sku, price));
    }

    // Shoes and bags.
    for (const [en, bn, sku] of [
        ['Sneakers', 'স্নিকার্স', 'SHO-SNK'],
        ['Leather sandal', 'চামড়ার স্যান্ডেল', 'SHO-SND'],
        ['Loafer', 'লোফার', 'SHO-LOF'],
        ['Running shoes', 'রানিং জুতা', 'SHO-RUN'],
    ] as const) {
        list.push(product(en, bn, '20', sku, 2200, { option: { dimension: 'size', values: SHOE_SIZES } }));
    }
    for (const [en, bn, sku] of [
        ['Leather bag', 'চামড়ার ব্যাগ', 'BAG-LTR'],
        ['Backpack', 'ব্যাকপ্যাক', 'BAG-BPK'],
        ['Ladies handbag', 'লেডিস হ্যান্ডব্যাগ', 'BAG-HND'],
        ['Big travel bag', `ব${RRA_DECOMPOSED} ট্রাভেল ব্যাগ`, 'BAG-TRV'],
    ] as const) {
        list.push(product(en, bn, '21', sku, 1800));
    }

    // Home and kitchen.
    for (const [en, bn, sku, price] of [
        ['Book rack', `বই র${ZWJ}্যাক`, 'HOM-RCK', 1500],
        ['Bed sheet', 'বিছানার চাদর', 'HOM-BED', 1200],
        ['Cushion cover', 'কুশন কভার', 'HOM-CSH', 350],
        ['Rice cooker', 'রাইস কুকার', 'KIT-RCE', 2800],
        ['Blender', 'ব্লেন্ডার', 'KIT-BLN', 3200],
        ['Pressure cooker', 'প্রেশার কুকার', 'KIT-PRS', 2600],
        ['Non-stick pan', 'ননস্টিক প্যান', 'KIT-PAN', 1400],
        ['Electric kettle', 'ইলেকট্রিক কেটলি', 'KIT-KTL', 1300],
    ] as const) {
        list.push(product(en, bn, '22', sku, price));
    }

    // Jewellery.
    for (const [en, bn, sku] of [
        ['Gold plated earrings', 'গোল্ড প্লেটেড কানের দুল', 'JWL-EAR'],
        ['Pearl necklace', 'মুক্তার নেকলেস', 'JWL-NCK'],
        ['Glass bangles', 'কাচের চুড়ি', 'JWL-BNG'],
        ['Silver ring', 'রুপার আংটি', 'JWL-RNG'],
        ['Nose pin', 'নাকফুল', 'JWL-NSE'],
        ['Anklet', 'নূপুর', 'JWL-ANK'],
        ['Bracelet', 'ব্রেসলেট', 'JWL-BRC'],
        ['Hair clip', 'চুলের ক্লিপ', 'JWL-CLP'],
    ] as const) {
        list.push(product(en, bn, '23', sku, 450));
    }

    // Islamic.
    for (const [en, bn, sku] of [
        ['Quran Sharif', 'কুরআন শরীফ', 'ISL-QRN'],
        ['Tasbih', 'তসবিহ', 'ISL-TSB'],
        ['Prayer mat', 'জায়নামাজ', 'ISL-MAT'],
        ['Attar gift box', 'আতর গিফট বক্স', 'ISL-GFT'],
        ['Tupi cap', 'টুপি', 'ISL-CAP'],
    ] as const) {
        list.push(product(en, bn, '24', sku, 650));
    }

    // Winter.
    for (const [en, bn, sku] of [
        ['Kashmiri shawl', 'কাশ্মীরি শাল', 'WNT-SHL'],
        ['Pashmina shawl', 'পশমিনা শাল', 'WNT-PSH'],
        ['Denim jacket', 'ডেনিম জ্যাকেট', 'WNT-JKT'],
        ['Puffer jacket', 'পাফার জ্যাকেট', 'WNT-PUF'],
        ['Wool sweater', 'উলের সোয়েটার', 'WNT-SWT'],
        ['Cardigan', 'কার্ডিগান', 'WNT-CRD'],
        ['Winter muffler', 'শীতের মাফলার', 'WNT-MFL'],
    ] as const) {
        list.push(product(en, bn, '25', sku, 1500, { option: { dimension: 'size', values: SIZES } }));
    }

    // Books and stationery, toys, electronics, groceries, accessories.
    for (const [en, bn, category, sku, price] of [
        ['Notebook', 'খাতা', '26', 'STN-NTB', 80],
        ['Ball pen', 'বলপেন', '26', 'STN-PEN', 10],
        ['Geometry box', 'জ্যামিতি বক্স', '26', 'STN-GEO', 220],
        ['School bag', 'স্কুল ব্যাগ', '26', 'STN-BAG', 1200],
        ['Story book', 'গল্পের বই', '26', 'STN-STR', 300],
        ['Islamic book', 'ইসলামিক বই', '26', 'STN-ISL', 350],
        ['Pencil box', 'পেন্সিল বক্স', '26', 'STN-PBX', 150],
        ['Drawing book', 'ড্রয়িং খাতা', '26', 'STN-DRW', 120],
        ['Remote control car', 'রিমোট কন্ট্রোল গাড়ি', '27', 'TOY-RCC', 1800],
        ['Teddy bear', 'টেডি বিয়ার', '27', 'TOY-TED', 900],
        ['Lego blocks', 'লেগো ব্লক', '27', 'TOY-LEG', 1500],
        ['Cricket bat', 'ক্রিকেট ব্যাট', '27', 'TOY-BAT', 1100],
        ['Football', 'ফুটবল', '27', 'TOY-FBL', 850],
        ['Doll', 'পুতুল', '27', 'TOY-DOL', 600],
        ['LED bulb', 'এলইডি বাল্ব', '18', 'ELC-LED', 180],
        ['Table fan', 'টেবিল ফ্যান', '18', 'ELC-TFN', 2600],
        ['Rechargeable fan', 'রিচার্জেবল ফ্যান', '18', 'ELC-RFN', 3400],
        ['Electric iron', 'ইলেকট্রিক ইস্ত্রি', '18', 'ELC-IRN', 1500],
        ['Hair dryer', 'হেয়ার ড্রায়ার', '18', 'ELC-DRY', 1700],
        ['Bluetooth speaker', 'ব্লুটুথ স্পিকার', '18', 'ELC-SPK', 2100],
        ['Smart TV box', 'স্মার্ট টিভি বক্স', '18', 'ELC-TVB', 3900],
        ['WiFi router', 'ওয়াইফাই রাউটার', '18', 'ELC-RTR', 2300],
        ['Basmati rice', 'বাসমতি চাল', '13', 'GRC-BSM', 420],
        ['Chinigura rice', 'চিনিগুঁড়া চাল', '13', 'GRC-CHN', 160],
        ['Red lentils', 'মসুর ডাল', '13', 'GRC-DAL', 140],
        ['Green tea', 'গ্রিন টি', '13', 'GRC-GTE', 350],
        ['Coffee', 'কফি', '13', 'GRC-COF', 650],
        ['Tea leaves', 'চা পাতা', '13', 'GRC-TEA', 280],
        ['Leather belt', 'চামড়ার বেল্ট', '28', 'ACC-BLT', 750],
        ['Wallet', 'মানিব্যাগ', '28', 'ACC-WLT', 650],
        ['Sunglasses', 'সানগ্লাস', '28', 'ACC-SUN', 900],
        ['Cap', 'ক্যাপ', '28', 'ACC-CAP', 350],
    ] as const) {
        list.push(product(en, bn, category, sku, price));
    }

    // Bangla names only (no English translation: the index repeats the Bangla name).
    list.push(product(null, 'নকশি কাঁথা', '22', 'BN-KANTHA', 3500));
    list.push(product(null, 'শীতল পাটি', '22', 'BN-PATI', 2500));
    list.push(product(null, 'মাটির ব্যাংক', '22', 'BN-BANK', 250));
    list.push(product(null, 'পিঠা', '13', 'BN-PITHA', 300));

    return list;
}

export const CORPUS = buildProducts();

/** The tag facet (public). */
const TAGS: Record<string, [string, string]> = { eid: ['Eid collection', 'ঈদ কালেকশন'] };

/** The corpus as the rows the search reads, with created dates spread over the last 200 days. */
export function corpusRows(): CatalogRows {
    const rows: CatalogRows = {
        index: [],
        products: [],
        options: [],
        facetValues: [],
        collections: [],
        popularity: new Map(),
    };
    rows.collections.push({
        id: '100',
        parentId: null,
        isRoot: true,
        isPrivate: false,
        languageCode: 'en',
        name: '__root_collection__',
        slug: '__root_collection__',
    });
    for (const [id, parent, en, bn] of CATEGORIES) {
        for (const [languageCode, name] of [
            ['en', en],
            ['bn', bn],
        ] as const) {
            rows.collections.push({
                id,
                parentId: parent ?? '100',
                isRoot: false,
                isPrivate: false,
                languageCode,
                name,
                slug: languageCode === 'en' ? kebab(en) : bn.replace(/\s+/g, '-'),
            });
        }
    }
    const tagIds = new Map<string, string>();
    Object.entries(TAGS).forEach(([code, [en, bn]], index) => {
        const id = String(500 + index);
        tagIds.set(code, id);
        rows.facetValues.push({ id, code, facetCode: 'tag', languageCode: 'en', name: en, facetName: 'Tag' });
        rows.facetValues.push({
            id,
            code,
            facetCode: 'tag',
            languageCode: 'bn',
            name: bn,
            facetName: 'ট্যাগ',
        });
    });
    let variantId = 1000;
    CORPUS.forEach((item, index) => {
        const id = String(index + 1);
        rows.products.push({
            id,
            createdAt: new Date(Date.UTC(2026, 9, 1) - index * 86_400_000),
            featured: !!item.featured,
        });
        if (item.popularity) rows.popularity.set(id, item.popularity);
        const values = item.option?.values ?? [null];
        for (const value of values) {
            const vid = String(++variantId);
            const soldOut = item.inStock === false || (!!value && !!item.option?.soldOut?.includes(value[0]));
            for (const languageCode of ['en', 'bn'] as const) {
                const productName = languageCode === 'en' ? (item.en ?? item.bn) : item.bn;
                const optionName = value ? (languageCode === 'en' ? value[1] : value[2]) : '';
                rows.index.push({
                    variantId: vid,
                    productId: id,
                    languageCode,
                    productName,
                    productVariantName: optionName ? `${productName} ${optionName}` : productName,
                    sku: value ? `${item.sku}-${value[0].toUpperCase()}` : item.sku,
                    priceWithTax: item.price * 100,
                    inStock: !soldOut,
                    facetValueIds: (item.tags ?? []).map(tag => tagIds.get(tag)!).join(','),
                    collectionIds: item.category,
                });
            }
            if (value && item.option) {
                rows.options.push({
                    variantId: vid,
                    groupCode: `${id}:${item.option.dimension}`,
                    optionCode: value[0],
                    languageCode: 'en',
                    name: value[1],
                });
                rows.options.push({
                    variantId: vid,
                    groupCode: `${id}:${item.option.dimension}`,
                    optionCode: value[0],
                    languageCode: 'bn',
                    name: value[2],
                });
            }
        }
    });
    return rows;
}

/** Product ID (as the catalog has it) → corpus key. */
export function keyOf(id: string): string {
    return CORPUS[Number(id) - 1]!.key;
}
