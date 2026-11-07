import gql from 'graphql-tag';

export const courierAdminApiExtensions = gql`
    extend enum HistoryEntryType {
        BD_COURIER
    }

    type BdCourierCredentialField {
        name: String!
        saved: Boolean!
        value: String
    }

    type BdCourierCredentials {
        courier: String!
        mode: String!
        complete: Boolean!
        fields: [BdCourierCredentialField!]!
    }

    type BdCourierWebhook {
        courier: String!
        "Paste into the courier's panel. Shown only to staff who can change settings."
        url: String
        "Steadfast: the Bearer token. Pathao: the webhook secret."
        secret: String
    }

    type BdCourierSetup {
        "CourierSettings from @ecommbd/shared"
        settings: JSON!
        credentials: [BdCourierCredentials!]!
        webhooks: [BdCourierWebhook!]!
        keyringConfigured: Boolean!
        "Pathao cities in the local copy (0: sync first)"
        pathaoCities: Int!
    }

    type BdUpdateCourierSettingsResult {
        settings: JSON
        errors: [BdSettingsFieldError!]!
    }

    type BdSaveCourierCredentialsResult {
        credentials: BdCourierCredentials
        errors: [BdSettingsFieldError!]!
    }

    type BdCourierTestResult {
        ok: Boolean!
        message: String
    }

    type BdCourierEvent {
        at: DateTime!
        source: String!
        status: String!
    }

    type BdCourierBooking {
        id: ID!
        createdAt: DateTime!
        orderId: ID!
        "steadfast or pathao; manual for a parcel booked by hand (see courierName); empty when bulk booking found no courier"
        courier: String!
        "The courier's name typed for a booking made by hand"
        courierName: String
        mode: String!
        "Our order number as the courier knows it"
        invoice: String
        "booking, unconfirmed (no clear answer from the courier: tried again, or staff check its panel), booked, failed, cancelled or manual"
        status: String!
        consignmentId: String
        trackingCode: String
        trackingUrl: String
        codAmount: Money!
        "What the courier should collect now, when it changed after booking: change it in the courier's panel, then confirm"
        newCodAmount: Money
        "Calls to this courier are paused after repeated failures: the booking waits for it"
        waitingForCourier: Boolean!
        weightGrams: Int
        deliveryFee: Money
        "booked, pickedUp, delivered, partiallyDelivered, returned, cancelled or note"
        outcome: String!
        courierStatus: String
        statusAt: DateTime
        errorCode: String
        errorMessage: String
        bookedBy: String
        events: [BdCourierEvent!]!
    }

    "A courier action was refused. message is in the request's language."
    type BdCourierError implements ErrorResult {
        errorCode: ErrorCode!
        message: String!
        "ORDER_NOT_FOUND, NOT_READY, NO_COURIER, COURIER_OFF, UNMAPPED_ADDRESS, NO_PHONE, NO_PATHAO_STORE, COURIER_REFUSED, COURIER_UNAVAILABLE, COURIER_BUSY, CHECK_COURIER_PANEL, ALREADY_BOOKED, NOT_BOOKED, ALREADY_PICKED_UP or INVALID_INPUT"
        reason: String!
        "The courier's own words"
        detail: String
    }

    union BdCourierBookingResult = BdCourierBooking | BdCourierError

    type BdCourierPlace {
        id: Int!
        name: String!
    }

    type BdUnmappedAddress {
        districtId: String!
        thanaId: String!
        "In the request's language"
        districtName: String!
        thanaName: String!
        orderIds: [ID!]!
    }

    type BdCourierCounts {
        inTransit: Int!
        deliveredToday: Int!
        returnedThisWeek: Int!
    }

    type BdPathaoStore {
        id: String!
        name: String!
    }

    type BdSyncLocationsResult {
        cities: Int!
        zones: Int!
    }

    extend type Query {
        bdCourierSetup: BdCourierSetup!
        "The order's live booking, else its latest one"
        bdCourierBooking(orderId: ID!): BdCourierBooking
        "Each order's live booking, else its latest one (bulk booking's progress); at most 100"
        bdCourierBookings(orderIds: [ID!]!): [BdCourierBooking!]!
        bdPathaoCities: [BdCourierPlace!]!
        bdPathaoZones(cityId: Int!): [BdCourierPlace!]!
        bdPathaoStores: [BdPathaoStore!]!
        "Thanas Pathao couldn't place, with the orders waiting"
        bdUnmappedAddresses: [BdUnmappedAddress!]!
        bdCourierCounts: BdCourierCounts!
    }

    extend type Mutation {
        updateBdCourierSettings(input: JSON!): BdUpdateCourierSettingsResult!
        saveBdCourierCredentials(
            courier: String!
            mode: String!
            input: JSON!
        ): BdSaveCourierCredentialsResult!
        testBdCourierConnection(courier: String!, mode: String!): BdCourierTestResult!
        syncBdPathaoLocations: BdSyncLocationsResult!
        "courier: steadfast or pathao; default: the store's courier for the delivery zone. An unconfirmed booking is tried again (looked up at the courier first)."
        bookBdCourier(orderId: ID!, courier: String): BdCourierBookingResult!
        "Books in the background (one job per order); returns how many were queued. An order that can't be booked gets a failed booking saying why."
        bookBdCouriers(orderIds: [ID!]!, courier: String): Int!
        markBdCourierBooked(
            orderId: ID!
            courierName: String!
            trackingCode: String!
        ): BdCourierBookingResult!
        "After cancelling it in the courier's panel; only before pickup"
        cancelBdCourierBooking(orderId: ID!): BdCourierBookingResult!
        "An unconfirmed booking, after checking the courier's panel: its consignment ID if the parcel is there, none if it isn't"
        resolveBdCourierBooking(orderId: ID!, consignmentId: String): BdCourierBookingResult!
        "The parcel's COD was changed in the courier's panel to newCodAmount"
        confirmBdCourierCodUpdated(orderId: ID!): BdCourierBookingResult!
        checkBdCourierStatus(orderId: ID!): BdCourierBooking
        setBdPathaoMapping(districtId: String!, thanaId: String!, cityId: Int!, zoneId: Int!): Boolean!
    }
`;
