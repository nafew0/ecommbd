import {
    BadgeCheck,
    CirclePlay,
    CircleQuestionMark,
    Columns2,
    Columns3,
    GalleryHorizontal,
    Images,
    LayoutGrid,
    type LucideIcon,
    Megaphone,
    MessageCircle,
    MessageSquareQuote,
    PanelTop,
    Phone,
    SeparatorHorizontal,
    Shapes,
    Star,
    TextAlignStart,
    Truck,
} from 'lucide-react';

/** The editor's icon for each section (the definitions name them; the admin draws them). */
const ICONS: Record<string, LucideIcon> = {
    hero: PanelTop,
    slideshow: GalleryHorizontal,
    banner: Megaphone,
    'product-grid': LayoutGrid,
    'collection-list': Shapes,
    'featured-product': Star,
    'image-with-text': Columns2,
    'rich-text': TextAlignStart,
    multicolumn: Columns3,
    faq: CircleQuestionMark,
    'image-grid': Images,
    video: CirclePlay,
    testimonials: MessageSquareQuote,
    'trust-badges': BadgeCheck,
    'delivery-info': Truck,
    contact: Phone,
    'whatsapp-cta': MessageCircle,
    divider: SeparatorHorizontal,
};

export function SectionIcon({ type, className }: { type: string; className?: string }) {
    const Icon = ICONS[type] ?? PanelTop;
    return <Icon className={className} aria-hidden />;
}
