/**
 * pnpm dev:demo-data (alias dev:demo-billing) — local development only. Gives the demo estate things to
 * try from the Resident App: an open estate poll, three bookable facilities (a paid event hall, a free tennis court and gym),
 * and test bills: links a fake payout account (where estate money would settle) and issues two one-off
 * invoices for unit ADM-12 through the real billing services (ledger entries included). Safe to re-run:
 * the payout account and unpaid sample bills are kept; paid ones are issued again so there is always
 * something to pay.
 */
import '../config/load-dotenv';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { AppModule } from '../app.module';
import type { EstateAccess } from '../common/auth/auth.decorators';
import { InvoicesService } from '../modules/billing/invoices.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { DEV_SEED } from './seed-dev';
import { createFacilitySchema, createPollSchema } from '@safezone/schemas';
import { PollsService } from '../modules/community/polls.service';
import { FacilitiesService } from '../modules/facilities/facilities.service';

const UNIT_CODE = process.argv[2] ?? 'ADM-12';

function dateInDays(days: number): string {
  // WAT is UTC+1 with no daylight saving.
  return new Date(Date.now() + 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error('dev:demo-data is for local development only');
  }
  if ((process.env.PAYMENTS_PROVIDER ?? 'fake') !== 'fake') {
    throw new Error('dev:demo-data needs PAYMENTS_PROVIDER=fake');
  }

  const owner = new pg.Client({
    connectionString: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL,
  });
  await owner.connect();
  const unit = await owner.query<{ id: string }>(
    `select id from tenant.spaces where estate_id = $1 and code = $2 and type = 'unit' and archived_at is null`,
    [DEV_SEED.estateId, UNIT_CODE],
  );
  const spaceId = unit.rows[0]?.id;
  if (!spaceId) throw new Error(`Unit ${UNIT_CODE} not found in the demo estate`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const access: EstateAccess = {
      estateId: DEV_SEED.estateId,
      userId: DEV_SEED.adminUserId,
      roles: ['estate_administrator', 'estate_accountant'],
      permissions: new Set([
        'estate.configure',
        'billing.run.create',
        'charge.manage',
        'invoice.read',
      ]),
    };
    const payments = app.get(PaymentsService);
    const invoices = app.get(InvoicesService);
    const facilities = app.get(FacilitiesService);

    const everyDay = (open: string, close: string) =>
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }));
    const demoFacilities = [
      {
        name: 'Community event hall',
        type: 'event_hall' as const,
        capacity: 150,
        description: 'Air-conditioned hall with chairs and tables for 150 guests.',
        rules: 'No loud music after 10pm. Leave the hall clean. Damage is billed to the booker.',
        openingHours: everyDay('08:00', '22:00'),
        // No approval here: management cannot approve bookings from a screen yet.
        policy: {
          minMinutes: 60,
          maxMinutes: 480,
          maxGuests: 150,
          advanceDays: 60,
          requiresApproval: false,
        },
        pricing: { basis: 'hourly' as const, amount: 500_000 },
      },
      {
        name: 'Tennis court',
        type: 'court' as const,
        capacity: 4,
        description: 'Floodlit hard court.',
        rules: 'Tennis shoes only. Book at most 3 times a week.',
        openingHours: everyDay('06:00', '20:00'),
        policy: {
          minMinutes: 60,
          maxMinutes: 120,
          maxGuests: 3,
          perHouseholdPerWeek: 3,
          advanceDays: 14,
        },
        pricing: { basis: 'free' as const },
      },
      {
        name: 'Gym',
        type: 'gym' as const,
        capacity: 12,
        description: 'Treadmills, bikes and free weights.',
        rules: 'Wipe equipment after use. Under 16s need an adult.',
        openingHours: everyDay('05:00', '22:00'),
        policy: { minMinutes: 30, maxMinutes: 120, maxGuests: 1, advanceDays: 7 },
        pricing: { basis: 'free' as const },
      },
    ];
    const polls = app.get(PollsService);
    const pollQuestion = 'Should the main gate stay open until midnight on weekends?';
    const openPolls = await owner.query(
      `select 1 from tenant.polls where estate_id = $1 and question = $2 and closes_at > now()`,
      [DEV_SEED.estateId, pollQuestion],
    );
    if (openPolls.rowCount === 0) {
      await polls.create(
        access,
        createPollSchema.parse({
          question: pollQuestion,
          options: ['Yes, until midnight', 'Only on Saturdays', 'No, keep 11pm'],
          closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          votePer: 'household',
          audience: { type: 'estate' },
        }),
      );
      console.warn('poll added: weekend gate hours');
    } else console.warn('poll already open: weekend gate hours');

    const existingFacilities = new Set(
      (await facilities.list(access)).map((facility) => facility.name),
    );
    for (const facility of demoFacilities) {
      if (existingFacilities.has(facility.name)) {
        console.warn(`facility exists: ${facility.name}`);
        continue;
      }
      await facilities.create(access, createFacilitySchema.parse(facility));
      console.warn(`facility added: ${facility.name}`);
    }

    const payout = await owner.query(
      `select 1 from tenant.payout_accounts where estate_id = $1 and provider = 'fake' and status = 'active'`,
      [DEV_SEED.estateId],
    );
    if (payout.rowCount === 0) {
      const linked = await payments.setupPayout(access, {
        bankCode: '999',
        accountNumber: '0123456789',
      });
      console.warn(`payout account linked: ${linked.bankName} ****${linked.accountLast4}`);
    } else console.warn('payout account already linked');

    const samples = [
      {
        description: 'Service charge, December 2026',
        dueDate: dateInDays(14),
        lines: [
          { description: 'Service charge', quantity: 1, unitAmount: 2_500_000 },
          { description: 'Security levy', quantity: 1, unitAmount: 500_000 },
        ],
      },
      {
        description: 'Estate dues, Q4 2026',
        dueDate: dateInDays(2),
        lines: [{ description: 'Estate dues', quantity: 1, unitAmount: 1_500_000 }],
      },
    ];
    for (const sample of samples) {
      const existing = await owner.query(
        `select 1 from tenant.invoices where estate_id = $1 and space_id = $2 and description = $3
         and status in ('issued', 'partially_paid', 'overdue')`,
        [DEV_SEED.estateId, spaceId, sample.description],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        console.warn(`still unpaid, kept: ${sample.description}`);
        continue;
      }
      const invoice = await invoices.createOneOff(access, { spaceId, ...sample });
      console.warn(
        `issued ${invoice.number}: ${sample.description} (${invoice.total / 100} NGN, due ${sample.dueDate})`,
      );
    }
  } finally {
    await app.close();
    await owner.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'dev:demo-billing failed');
  process.exit(1);
});
