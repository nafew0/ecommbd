import gql from 'graphql-tag';

/** `Asset.customFields.bdImage`: the WebP sizes of an image (roadmap phase 09). */
const imageTypes = `
    type BdImageVariant {
        width: Int!
        height: Int!
        url: String!
    }

    type BdImage {
        id: ID!
        "pending, ready or failed"
        status: String!
        width: Int!
        height: Int!
        animated: Boolean!
        "#rrggbb, for a coloured box while the image loads"
        dominantColor: String
        "A tiny blurred WebP as a data URL"
        placeholder: String
        "Narrowest first; empty until ready"
        variants: [BdImageVariant!]!
        "For <img srcset>, e.g. '/img/…/160.webp 160w, /img/…/320.webp 320w'"
        srcset: String!
    }
`;

export const imageShopApiExtensions = gql(imageTypes);

export const imageAdminApiExtensions = gql`
    ${imageTypes}

    extend type BdImage {
        "Why processing failed, for staff"
        failure: String
    }

    type BdImageUsage {
        "Distinct pictures (the same picture uploaded twice counts once)"
        images: Int!
        "Bytes used by Vendure's source files and our WebP sizes"
        bytes: Float!
    }

    extend type Query {
        bdImageUsage: BdImageUsage!
    }
`;
