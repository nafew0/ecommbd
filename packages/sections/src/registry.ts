import type { LayoutType, SectionDefinition } from './define';
import { contact, whatsappCta } from './sections/contact';
import { customSection } from './sections/custom';
import { faq, imageWithText, multicolumn, richText } from './sections/content';
import { banner, hero, slideshow } from './sections/intro';
import { divider } from './sections/layout';
import { imageGrid, video } from './sections/media';
import { collectionList, featuredProduct, productGrid } from './sections/products';
import {
    benefits,
    comparison,
    countdown,
    guarantee,
    orderForm,
    pricePacks,
    salesHero,
    specs,
} from './sections/sales';
import { deliveryInfo, testimonials, trustBadges } from './sections/trust';

export {
    banner,
    benefits,
    comparison,
    countdown,
    customSection,
    guarantee,
    orderForm,
    pricePacks,
    salesHero,
    specs,
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
    // Phase 16: sales sections and the Custom section.
    salesHero,
    benefits,
    specs,
    pricePacks,
    comparison,
    countdown,
    guarantee,
    orderForm,
    customSection,
];

const BY_TYPE = new Map(SECTIONS.map(definition => [definition.type, definition]));

export function sectionDefinition(type: string): SectionDefinition | undefined {
    return BY_TYPE.get(type);
}

/** The sections a kind of page can have. */
export function sectionsFor(layout: LayoutType): SectionDefinition[] {
    return SECTIONS.filter(definition => !definition.layouts || definition.layouts.includes(layout));
}
