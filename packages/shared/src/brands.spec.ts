import { describe, expect, it } from 'vitest';
import { brandCode, parseBrandInput } from './brands';

describe('brands', () => {
    it('makes an address from English and gives none for Bangla only', () => {
        expect(brandCode(' Bashundhara Tissue! ')).toBe('bashundhara-tissue');
        expect(brandCode('Café Ñu')).toBe('cafe-nu');
        expect(brandCode('আড়ং')).toBe('');
    });

    it('cleans the input and makes the address from the English name when it is empty', () => {
        const parsed = parseBrandInput({ name: { bn: ' আড়ং ', en: 'Aarong' } });
        expect(parsed).toEqual({
            ok: true,
            brand: {
                id: null,
                name: { bn: 'আড়ং', en: 'Aarong' },
                code: 'aarong',
                description: { bn: '', en: '' },
                logoAssetId: null,
            },
        });
        const own = parseBrandInput({ name: { bn: 'আড়ং', en: '' }, code: 'My Brand', logoAssetId: '7' });
        expect(own.ok && own.brand).toMatchObject({ code: 'my-brand', logoAssetId: '7' });
    });

    it('needs a name and refuses one that is too long', () => {
        expect(parseBrandInput({ name: { bn: '', en: '' } })).toEqual({
            ok: false,
            errors: [{ path: 'name.bn', code: 'required' }],
        });
        const long = parseBrandInput({ name: { bn: 'ক'.repeat(81), en: '' } });
        expect(!long.ok && long.errors).toEqual([{ path: 'name.bn', code: 'tooLong' }]);
    });
});
