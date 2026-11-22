'use client';

import { unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import type { AdPlacementKey } from '@safezone/schemas';
import {
  ActionButton,
  CheckboxField,
  FormError,
  InputField,
  PageHeader,
  Panel,
  SelectField,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { usePlatform } from '../../lib/platform';
import { nairaToKobo, placementOptions, splitList, watFromLocal } from './ads';
import { useAdvertiserOptions, useEstateOptions } from './campaigns-screen';

type Scope = 'all' | 'states' | 'estates';
interface LineDraft {
  placementKey: AdPlacementKey;
  scope: Scope;
  states: string;
  estateIds: string[];
  estateIdsText: string;
  weight: string;
  cap: string;
}

const emptyLine = (): LineDraft => ({
  placementKey: 'resident.home.banner',
  scope: 'all',
  states: '',
  estateIds: [],
  estateIdsText: '',
  weight: '10',
  cap: '',
});

/** New campaign (draft): advertiser, flight, agreed price, placements and estate-level targeting. */
export function NewCampaignScreen() {
  const router = useRouter();
  const { can } = usePlatform();
  const advertisers = useAdvertiserOptions();
  const estates = useEstateOptions(can('platform.estate.create'));
  const [advertiserId, setAdvertiserId] = useState('');
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [price, setPrice] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [invalid, setInvalid] = useState(false);

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const build = () => {
    const startsAt = watFromLocal(starts);
    const endsAt = watFromLocal(ends);
    const budgetKobo = nairaToKobo(price);
    if (
      !advertiserId ||
      title.trim().length < 3 ||
      objective.trim().length < 3 ||
      !startsAt ||
      !endsAt ||
      !budgetKobo
    )
      return null;
    const lineItems = lines.map((line) => {
      const estateIds = estates.data ? line.estateIds : splitList(line.estateIdsText);
      const states = splitList(line.states);
      const weight = Number(line.weight);
      const cap = line.cap.trim() ? Number(line.cap) : undefined;
      return {
        placementKey: line.placementKey,
        targeting: {
          scope: line.scope,
          estateIds: line.scope === 'estates' ? estateIds : [],
          states: line.scope === 'states' ? states : [],
        },
        weight: Number.isInteger(weight) && weight >= 1 && weight <= 100 ? weight : 10,
        ...(cap && Number.isInteger(cap) ? { frequencyCapPerDay: cap } : {}),
        ok:
          (line.scope !== 'estates' || estateIds.length > 0) &&
          (line.scope !== 'states' || states.length > 0),
      };
    });
    if (lineItems.some((l) => !l.ok)) return null;
    return {
      advertiserId,
      title: title.trim(),
      objective: objective.trim(),
      startsAt,
      endsAt,
      budgetKobo,
      lineItems: lineItems.map(({ ok: _ok, ...rest }) => rest),
    };
  };

  const create = useMutation({
    mutationFn: (body: NonNullable<ReturnType<typeof build>>) =>
      unwrap(api.POST('/v1/platform/ad-campaigns', { body })),
    onSuccess: (campaign) => router.push(`/ads/campaigns/${campaign.id}`),
  });

  return (
    <>
      <PageHeader
        title={t('admin.ads.campaigns.new')}
        description={t('admin.ads.campaigns.description')}
      />
      <form
        className="sz-form"
        style={{ display: 'grid', gap: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          const body = build();
          setInvalid(!body);
          if (body) create.mutate(body);
        }}
      >
        <Panel>
          <div className="sz-form">
            <SelectField
              label={t('admin.ads.campaigns.advertiser')}
              value={advertiserId}
              onChange={setAdvertiserId}
              options={[
                { value: '', label: t('admin.ads.campaigns.chooseAdvertiser') },
                ...(advertisers.data?.items ?? [])
                  .filter((a) => a.status === 'active')
                  .map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
            <InputField
              label={t('admin.ads.campaigns.titleField')}
              value={title}
              onChange={setTitle}
              maxLength={160}
            />
            <TextAreaField
              label={t('admin.ads.campaigns.objective')}
              value={objective}
              onChange={setObjective}
              rows={2}
              maxLength={500}
            />
            <InputField
              label={t('admin.ads.campaigns.starts')}
              type="datetime-local"
              value={starts}
              onChange={setStarts}
            />
            <InputField
              label={t('admin.ads.campaigns.ends')}
              type="datetime-local"
              value={ends}
              onChange={setEnds}
            />
            <InputField
              label={t('admin.ads.campaigns.price')}
              value={price}
              onChange={setPrice}
              inputMode="decimal"
              maxLength={16}
            />
          </div>
        </Panel>
        <Panel title={t('admin.ads.campaigns.placements')}>
          {lines.map((line, index) => (
            <div
              key={index}
              className="sz-form"
              style={{
                borderTop: index ? `1px solid ${colors.semantic.border}` : undefined,
                paddingTop: index ? 16 : 0,
              }}
            >
              <SelectField
                label={t('admin.ads.campaigns.placement')}
                value={line.placementKey}
                onChange={(placementKey) => setLine(index, { placementKey })}
                options={placementOptions}
              />
              <SelectField
                label={t('admin.ads.campaigns.scope')}
                value={line.scope}
                onChange={(scope) => setLine(index, { scope })}
                options={(['all', 'states', 'estates'] as const).map((value) => ({
                  value,
                  label: t(`admin.ads.campaigns.scope.${value}`),
                }))}
              />
              {line.scope === 'states' ? (
                <InputField
                  label={t('admin.ads.campaigns.states')}
                  value={line.states}
                  onChange={(states) => setLine(index, { states })}
                  maxLength={600}
                />
              ) : null}
              {line.scope === 'estates' ? (
                estates.data ? (
                  <fieldset className="sz-field" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend style={{ fontWeight: 600 }}>{t('admin.ads.campaigns.estates')}</legend>
                    {estates.data.items.map((estate) => (
                      <CheckboxField
                        key={estate.id}
                        label={estate.name}
                        checked={line.estateIds.includes(estate.id)}
                        onChange={(on) =>
                          setLine(index, {
                            estateIds: on
                              ? [...line.estateIds, estate.id]
                              : line.estateIds.filter((id) => id !== estate.id),
                          })
                        }
                      />
                    ))}
                  </fieldset>
                ) : (
                  <InputField
                    label={t('admin.ads.campaigns.estates')}
                    value={line.estateIdsText}
                    onChange={(estateIdsText) => setLine(index, { estateIdsText })}
                    maxLength={4000}
                  />
                )
              ) : null}
              <InputField
                label={t('admin.ads.campaigns.weight')}
                type="number"
                value={line.weight}
                onChange={(weight) => setLine(index, { weight })}
                min={1}
                max={100}
              />
              <InputField
                label={t('admin.ads.campaigns.cap')}
                type="number"
                value={line.cap}
                onChange={(cap) => setLine(index, { cap })}
                min={1}
                max={50}
              />
              {lines.length > 1 ? (
                <div>
                  <ActionButton
                    variant="text"
                    size="sm"
                    onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                  >
                    {t('admin.ads.campaigns.removePlacement')}
                  </ActionButton>
                </div>
              ) : null}
            </div>
          ))}
          {lines.length < 10 ? (
            <div>
              <ActionButton
                variant="outline"
                size="sm"
                icon="plus"
                onClick={() => setLines((c) => [...c, emptyLine()])}
              >
                {t('admin.ads.campaigns.addPlacement')}
              </ActionButton>
            </div>
          ) : null}
        </Panel>
        <FormError
          message={
            invalid
              ? t('admin.ads.campaigns.invalid')
              : create.isError
                ? errorText(create.error)
                : null
          }
        />
        <div>
          <ActionButton type="submit" busy={create.isPending}>
            {t('admin.ads.campaigns.create')}
          </ActionButton>
        </div>
      </form>
    </>
  );
}
