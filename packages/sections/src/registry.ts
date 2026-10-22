import type { LayoutType, SectionDefinition } from './define';
import { contact, whatsappCta } from './sections/contact';
import { faq, imageWithText, multicolumn, richText } from './sections/content';
import { banner, hero, slideshow } from './sections/intro';
import { divider } from './sections/layout';
import { imageGrid, video } from './sections/media';
import { collectionList, featuredProduct, productGrid } from './sections/products';
import { deliveryInfo, testimonials, trustBadges } from './sections/trust';

export {
    banner,
    collectionList,
    contact,
    deliveryInfo,
    divider,
    faq,
    featuredProduct,
    hero,
    imageGrid,
    imageWithText,
    multicolumn,
    productGrid,
    richText,
    slideshow,
    testimonials,
    trustBadges,
    video,
    whatsappCta,
};

/** Every section a page can have, in the order the editor's library lists them. */
export const SECTIONS: readonly SectionDefinition[] = [
    hero,
    slideshow,
    banner,
    productGrid,
    collectionList,
    featuredProduct,
    imageWithText,
    richText,
    multicolumn,
    faq,
    imageGrid,
    video,
    testimonials,
    trustBadges,
    deliveryInfo,
    contact,
    whatsappCta,
    divider,
];

const BY_TYPE = new Map(SECTIONS.map(definition => [definition.type, definition]));

export function sectionDefinition(type: string): SectionDefinition | undefined {
    return BY_TYPE.get(type);
}

/** The sections a kind of page can have. */
export function sectionsFor(layout: LayoutType): SectionDefinition[] {
    return SECTIONS.filter(definition => !definition.layouts || definition.layouts.includes(layout));
}
