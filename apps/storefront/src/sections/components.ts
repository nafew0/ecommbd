import Banner from './Banner.astro';
import Benefits from './Benefits.astro';
import CollectionList from './CollectionList.astro';
import Comparison from './Comparison.astro';
import Contact from './Contact.astro';
import Countdown from './Countdown.astro';
import DeliveryInfo from './DeliveryInfo.astro';
import Divider from './Divider.astro';
import Faq from './Faq.astro';
import FeaturedProduct from './FeaturedProduct.astro';
import Guarantee from './Guarantee.astro';
import Hero from './Hero.astro';
import ImageGrid from './ImageGrid.astro';
import ImageWithText from './ImageWithText.astro';
import Multicolumn from './Multicolumn.astro';
import OrderForm from './OrderForm.astro';
import PricePacks from './PricePacks.astro';
import ProductGrid from './ProductGrid.astro';
import RichTextSection from './RichTextSection.astro';
import SalesHero from './SalesHero.astro';
import Slideshow from './Slideshow.astro';
import Specs from './Specs.astro';
import Testimonials from './Testimonials.astro';
import TrustBadges from './TrustBadges.astro';
import Video from './Video.astro';
import WhatsappCta from './WhatsappCta.astro';

/**
 * The component that draws each ready-made section: on the page (Sections.astro) and inside a
 * free section's live block (Node.astro). The free section itself isn't here: it's the one that
 * holds the others.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SMART_COMPONENTS: Record<string, any> = {
    hero: Hero,
    slideshow: Slideshow,
    banner: Banner,
    'product-grid': ProductGrid,
    'collection-list': CollectionList,
    'featured-product': FeaturedProduct,
    'image-with-text': ImageWithText,
    'rich-text': RichTextSection,
    multicolumn: Multicolumn,
    faq: Faq,
    'image-grid': ImageGrid,
    video: Video,
    testimonials: Testimonials,
    'trust-badges': TrustBadges,
    'delivery-info': DeliveryInfo,
    contact: Contact,
    'whatsapp-cta': WhatsappCta,
    divider: Divider,
    // Phase 16
    'sales-hero': SalesHero,
    benefits: Benefits,
    specs: Specs,
    'price-packs': PricePacks,
    comparison: Comparison,
    countdown: Countdown,
    guarantee: Guarantee,
    'order-form': OrderForm,
};
