import { type FraudSettings, OTP_MODES, type OtpMode } from '@ecommbd/shared/fraud';
import { banglaToAsciiDigits } from '@ecommbd/shared/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { useDigits } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { Input, Select, Textarea } from '../components/ui/input';
import { Alert, Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const UPDATE = `
    mutation UpdateFraudSettings($input: JSON!) {
        updateBdFraudSettings(input: $input) { settings errors { path code } }
    }
`;

/** Fake-order protection settings (roadmap phase 11): order limits, the COD code and the risky score. */
export function FraudSettingsPage() {
    const { messages: m } = useI18n();
    const s = m.fraud;
    const { can } = useAuth();
    const toast = useToast();
    const digits = useDigits();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateStoreSettings');
    const query = useQuery({
        queryKey: ['fraudSettings'],
        queryFn: () => adminApi<{ bdFraudSettings: FraudSettings }>('{ bdFraudSettings }').then(r => r.bdFraudSettings),
    });
    const [draft, setDraft] = useState<FraudSettings | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (query.data && !draft) setDraft(query.data);
    }, [query.data, draft]);
    const save = useMutation({
        mutationFn: (input: FraudSettings) =>
            adminApi<{
                updateBdFraudSettings: {
                    settings: FraudSettings | null;
                    errors: Array<{ path: string; code: string }>;
                };
            }>(UPDATE, { input }).then(result => result.updateBdFraudSettings),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.settings) {
                setDraft(result.settings);
                toast.success(s.saved);
                void queryClient.invalidateQueries({ queryKey: ['fraudSettings'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });
    if (!draft) return <PageSkeleton />;
    const velocity = (patch: Partial<FraudSettings['velocity']>) =>
        setDraft({ ...draft, velocity: { ...draft.velocity, ...patch } });
    const otp = (patch: Partial<FraudSettings['otp']>) => setDraft({ ...draft, otp: { ...draft.otp, ...patch } });
    const number = (text: string) => Number(banglaToAsciiDigits(text.trim()) || 0);

    return (
        <>
            <PageHeader title={s.title} description={s.description} />
            {!canEdit && (
                <div className="mb-4">
                    <Alert>{s.readOnly}</Alert>
                </div>
            )}
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                <Card>
                    <CardHeader title={s.velocity} />
                    <CardBody>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field
                                label={s.maxPerDay}
                                hint={s.maxPerDayHint}
                                error={errors['velocity.maxOrdersPerPhonePerDay']}
                            >
                                {control => (
                                    <Input
                                        {...control}
                                        inputMode="numeric"
                                        className="w-24"
                                        value={digits(draft.velocity.maxOrdersPerPhonePerDay)}
                                        disabled={!canEdit}
                                        onChange={event =>
                                            velocity({ maxOrdersPerPhonePerDay: number(event.target.value) })
                                        }
                                    />
                                )}
                            </Field>
                            <Field
                                label={s.duplicateMinutes}
                                hint={s.duplicateMinutesHint}
                                error={errors['velocity.duplicateOrderMinutes']}
                            >
                                {control => (
                                    <Input
                                        {...control}
                                        inputMode="numeric"
                                        className="w-24"
                                        value={digits(draft.velocity.duplicateOrderMinutes)}
                                        disabled={!canEdit}
                                        onChange={event =>
                                            velocity({ duplicateOrderMinutes: number(event.target.value) })
                                        }
                                    />
                                )}
                            </Field>
                        </div>
                        {draft.velocity.duplicateOrderMinutes > 0 &&
                            (['bn', 'en'] as const).map(language => (
                                <Field
                                    key={language}
                                    label={`${s.duplicateMessage}: ${s[language]}`}
                                    error={errors[`velocity.duplicateOrderMessage.${language}`]}
                                >
                                    {control => (
                                        <Textarea
                                            {...control}
                                            rows={2}
                                            maxLength={300}
                                            value={draft.velocity.duplicateOrderMessage[language]}
                                            readOnly={!canEdit}
                                            onChange={event =>
                                                velocity({
                                                    duplicateOrderMessage: {
                                                        ...draft.velocity.duplicateOrderMessage,
                                                        [language]: event.target.value,
                                                    },
                                                })
                                            }
                                        />
                                    )}
                                </Field>
                            ))}
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={s.otp} description={s.otpHint} />
                    <CardBody>
                        <Field label={s.otpMode}>
                            {control => (
                                <Select
                                    {...control}
                                    value={draft.otp.mode}
                                    disabled={!canEdit}
                                    onChange={event => otp({ mode: event.target.value as OtpMode })}
                                >
                                    {OTP_MODES.map(mode => (
                                        <option key={mode} value={mode}>
                                            {s.otpModes[mode]}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        {draft.otp.mode !== 'off' && (
                            <Switch
                                label={s.allowUnverified}
                                checked={draft.otp.allowUnverified}
                                disabled={!canEdit}
                                onChange={checked => otp({ allowUnverified: checked })}
                            />
                        )}
                    </CardBody>
                </Card>

                <Card>
                    <CardBody>
                        <Field label={s.riskyScore} hint={s.riskyScoreHint} error={errors['risk.riskyScore']}>
                            {control => (
                                <Input
                                    {...control}
                                    inputMode="numeric"
                                    className="w-24"
                                    value={digits(draft.risk.riskyScore)}
                                    disabled={!canEdit}
                                    onChange={event =>
                                        setDraft({ ...draft, risk: { riskyScore: number(event.target.value) } })
                                    }
                                />
                            )}
                        </Field>
                    </CardBody>
                </Card>

                {canEdit && (
                    <Button type="submit" loading={save.isPending}>
                        {m.settings.save}
                    </Button>
                )}
            </form>
        </>
    );
}
