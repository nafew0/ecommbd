import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Field } from './form/field';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Textarea } from './ui/input';

/** Block list mutations (phase 11), used by the block list and the customer page. */
export const BLOCK = `
    mutation Block($input: BdBlockInput!) {
        blockBdContact(input: $input) { entry { id } error }
    }
`;
export const UNBLOCK = `mutation Unblock($id: ID!, $reason: String!) { unblockBdContact(id: $id, reason: $reason) { id } }`;

/** Asks why before unblocking; the reason stays with the record. Also used on the customer page. */
export function UnblockDialog(props: { open: boolean; onClose(): void; onUnblock(reason: string): Promise<void> }) {
    const { messages: m } = useI18n();
    const t = m.blockList;
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    return (
        <Dialog
            open={props.open}
            onClose={props.onClose}
            dismissible={!busy}
            title={t.unblockTitle}
            footer={
                <>
                    <Button variant="secondary" onClick={props.onClose} disabled={busy}>
                        {m.common.cancel}
                    </Button>
                    <Button
                        loading={busy}
                        disabled={!reason.trim()}
                        onClick={async () => {
                            setBusy(true);
                            await props.onUnblock(reason.trim());
                            setBusy(false);
                            setReason('');
                        }}
                    >
                        {t.unblock}
                    </Button>
                </>
            }
        >
            <Field label={t.unblockReason}>
                {control => (
                    <Textarea
                        {...control}
                        rows={2}
                        maxLength={500}
                        value={reason}
                        onChange={event => setReason(event.target.value)}
                    />
                )}
            </Field>
        </Dialog>
    );
}
