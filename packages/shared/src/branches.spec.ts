import { describe, expect, it } from 'vitest';
import {
    BRANCH_ZONES,
    defaultBranchSettings,
    formatBranchAddress,
    formatTransferNumber,
    parseBranchInput,
    parseBranchSettings,
    parseReceiveTransfer,
    parseSendTransfer,
} from './branches';

const branch = {
    name: '  দোকান  ',
    phone: ' ০১৭১১ ',
    districtId: 'BD3026',
    thanaId: 'BD3026M26',
    addressLine: '  রোড ১  ',
    note: '  লাইন ১\n\nলাইন ২  ',
    sellsOnline: true,
};

describe('branch settings', () => {
    it('starts from ST and empty zones', () => {
        expect(BRANCH_ZONES).toEqual(['dhaka_city', 'dhaka_suburb', 'chattogram_city', 'outside_dhaka']);
        expect(defaultBranchSettings()).toEqual({
            transferPrefix: 'ST',
            zoneBranch: { dhaka_city: '', dhaka_suburb: '', chattogram_city: '', outside_dhaka: '' },
            pickupBranch: { steadfast: '', pathao: '' },
        });
        expect(formatTransferNumber('ST', 1001)).toBe('ST-1001');
        expect(formatTransferNumber('', 1001)).toBe('1001');
    });

    it('keeps a short prefix and trims a location id', () => {
        const parsed = parseBranchSettings({
            transferPrefix: ' st-12 বাংলা ',
            zoneBranch: {
                dhaka_city: ' 1 ',
                dhaka_suburb: '',
                chattogram_city: '',
                outside_dhaka: '',
            },
            pickupBranch: { steadfast: '2', pathao: '' },
        });
        expect(parsed.ok && parsed.settings.transferPrefix).toBe('ST12');
        expect(parsed.ok && parsed.settings.zoneBranch.dhaka_city).toBe('1');
        const long = parseBranchSettings({
            transferPrefix: 'ABCDEFGH',
            zoneBranch: { dhaka_city: 'x'.repeat(41), dhaka_suburb: '', chattogram_city: '', outside_dhaka: '' },
            pickupBranch: { steadfast: '', pathao: '' },
        });
        expect(long.ok).toBe(false);
        expect(parseBranchSettings({ transferPrefix: 'ST' }).ok).toBe(false);
    });
});

describe('branch and transfer input', () => {
    it('cleans a branch and refuses an empty or oversized name', () => {
        const parsed = parseBranchInput(branch);
        expect(parsed.ok && parsed.value.name).toBe('দোকান');
        expect(parsed.ok && parsed.value.note).toBe('লাইন ১\n\nলাইন ২');
        expect(parseBranchInput({ ...branch, name: '   ' }).ok).toBe(false);
        expect(parseBranchInput({ ...branch, name: 'ন'.repeat(81) }).ok).toBe(false);
        expect(parseBranchInput({ ...branch, addressLine: 'a'.repeat(201) }).ok).toBe(false);
        expect(parseBranchInput({ ...branch, note: 'a'.repeat(501) }).ok).toBe(false);
        expect(parseBranchInput({ ...branch, sellsOnline: 'yes' }).ok).toBe(false);
    });

    it('sends at least one line and receives zero or more of what was sent', () => {
        const sent = parseSendTransfer({
            fromId: '1',
            toId: '2',
            note: '  নোট  ',
            lines: [{ variantId: '9', quantity: 2 }],
        });
        expect(sent.ok && sent.value.note).toBe('নোট');
        expect(parseSendTransfer({ fromId: '', toId: '2', note: '', lines: [{ variantId: '9', quantity: 1 }] }).ok).toBe(
            false,
        );
        expect(parseSendTransfer({ fromId: '1', toId: '2', note: '', lines: [] }).ok).toBe(false);
        expect(
            parseSendTransfer({
                fromId: '1',
                toId: '2',
                note: '',
                lines: [{ variantId: '9', quantity: 1.5 }],
            }).ok,
        ).toBe(false);
        expect(
            parseSendTransfer({
                fromId: '1',
                toId: '2',
                note: 'n'.repeat(501),
                lines: Array.from({ length: 101 }, () => ({ variantId: '9', quantity: 1 })),
            }).ok,
        ).toBe(false);
        const received = parseReceiveTransfer({ lines: [{ lineId: '3', quantity: 0 }] });
        expect(received.ok && received.value.lines[0]?.quantity).toBe(0);
        expect(parseReceiveTransfer({ lines: [] }).ok).toBe(false);
        expect(parseReceiveTransfer({ lines: [{ lineId: '3', quantity: -1 }] }).ok).toBe(false);
        expect(
            parseReceiveTransfer({
                lines: Array.from({ length: 101 }, () => ({ lineId: '3', quantity: 1 })),
            }).ok,
        ).toBe(false);
    });
});

describe('pickup address', () => {
    it('joins the parts that exist and stops at 500 characters', () => {
        expect(
            formatBranchAddress({
                name: 'দোকান',
                addressLine: 'রোড ১',
                thana: 'মিরপুর',
                district: 'ঢাকা',
                phone: '+8801711000000',
            }),
        ).toBe('দোকান\nরোড ১\nমিরপুর, ঢাকা\n+8801711000000');
        expect(
            formatBranchAddress({
                name: '  ',
                addressLine: '',
                thana: '',
                district: ' ঢাকা ',
                phone: '',
            }),
        ).toBe('ঢাকা');
        expect(
            formatBranchAddress({
                name: 'দোকান',
                addressLine: 'র'.repeat(500),
                thana: '',
                district: '',
                phone: '১',
            }).length,
        ).toBe(500);
    });
});
