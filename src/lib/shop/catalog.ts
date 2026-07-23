// Rook13 merch, sold through the Troll Factory Shopify store and
// fulfilled by Printful. The brand site never runs a cart: "Buy" is a
// plain Shopify cart-permalink that lands straight on checkout.
//
// Variant ids come from the store's public product JSON:
//   https://troll-factory.myshopify.com/products/rook-short-sleeve-tri-blend-t-shirt.json

export const CHECKOUT_BASE = 'https://troll-factory.myshopify.com/cart';

export const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] as const;
export type ShirtSize = (typeof SHIRT_SIZES)[number];

// $36 through XL, $40 for 2XL, $44 for 3XL
export const SIZE_PRICES: Record<ShirtSize, number> = {
    XS: 36, S: 36, M: 36, L: 36, XL: 36, '2XL': 40, '3XL': 44,
};

export interface ShirtColor {
    name: string;       // Printful's color name
    label: string;      // what we show
    swatch: string;     // css color for the picker dot
    image: string;      // front mockup on the Shopify CDN
    // size -> Shopify variant id; a missing size isn't offered in this color
    variants: Partial<Record<ShirtSize, string>>;
}

const CDN = 'https://cdn.shopify.com/s/files/1/0786/3759/6861/files';

export const SHIRT_COLORS: ShirtColor[] = [
    {
        name: 'True Royal Triblend', label: 'True Royal', swatch: '#3f5ea9',
        image: `${CDN}/unisex-tri-blend-t-shirt-true-royal-triblend-front-6a6233ee39184.jpg?v=1784820744&width=800`,
        variants: {
            XS: '47716965613757', S: '47716965646525', M: '47716965679293',
            L: '47716965712061', XL: '47716965744829', '2XL': '47716965777597', '3XL': '47716965810365',
        },
    },
    {
        name: 'Teal Triblend', label: 'Teal', swatch: '#268e8b',
        image: `${CDN}/unisex-tri-blend-t-shirt-teal-triblend-front-6a6233ee3cd8b.jpg?v=1784820744&width=800`,
        variants: {
            XS: '47716965843133', S: '47716965875901', M: '47716965908669',
            L: '47716965941437', XL: '47716965974205', '2XL': '47716966006973', '3XL': '47716966039741',
        },
    },
    {
        name: 'Berry Triblend', label: 'Berry', swatch: '#b24c71',
        image: `${CDN}/unisex-tri-blend-t-shirt-berry-triblend-front-6a6233ee3f7a2.jpg?v=1784820744&width=800`,
        variants: {
            XS: '47716966072509', S: '47716966105277', M: '47716966138045',
            L: '47716966170813', XL: '47716966203581', '2XL': '47716966236349', '3XL': '47716966269117',
        },
    },
    {
        name: 'Red Triblend', label: 'Red', swatch: '#b53f3f',
        image: `${CDN}/unisex-tri-blend-t-shirt-red-triblend-front-6a6233ee4392f.jpg?v=1784820744&width=800`,
        variants: {
            XS: '47716966301885', S: '47716966334653', M: '47716966367421',
            L: '47716966400189', XL: '47716966432957', '2XL': '47716966465725', '3XL': '47716966498493',
        },
    },
    {
        name: 'Aqua Triblend', label: 'Aqua', swatch: '#55b7c4',
        image: `${CDN}/unisex-tri-blend-t-shirt-aqua-triblend-front-6a6233ee490b2.jpg?v=1784820744&width=800`,
        variants: {
            XS: '47716966531261', S: '47716966564029', M: '47716966596797',
            L: '47716966629565', XL: '47716966662333', '2XL': '47716966695101', '3XL': '47716966727869',
        },
    },
    {
        name: 'Olive Triblend', label: 'Olive', swatch: '#6e6e4e',
        image: `${CDN}/unisex-tri-blend-t-shirt-olive-triblend-front-6a6233ee4fff0.jpg?v=1784820744&width=800`,
        variants: {
            XS: '47716966760637', S: '47716966793405', M: '47716966826173',
            L: '47716966858941', XL: '47716966891709', '2XL': '47716966924477', '3XL': '47716966957245',
        },
    },
    {
        name: 'Mauve Triblend', label: 'Mauve', swatch: '#be8b98',
        image: `${CDN}/unisex-tri-blend-t-shirt-mauve-triblend-front-6a6233ee58822.jpg?v=1784820744&width=800`,
        variants: {
            XS: '47716966990013', S: '47716967022781', M: '47716967055549',
            L: '47716967088317', XL: '47716967121085', '2XL': '47716967153853',
        },
    },
    {
        name: 'Tan Triblend', label: 'Tan', swatch: '#c9ae8c',
        image: `${CDN}/unisex-tri-blend-t-shirt-tan-triblend-front-6a6233ee628c9.jpg?v=1784820743&width=800`,
        variants: {
            XS: '47716967186621', S: '47716967219389', M: '47716967252157',
            L: '47716967284925', XL: '47716967317693', '2XL': '47716967350461', '3XL': '47716967383229',
        },
    },
];

export function checkoutUrl(variantId: string): string {
    return `${CHECKOUT_BASE}/${variantId}:1`;
}
