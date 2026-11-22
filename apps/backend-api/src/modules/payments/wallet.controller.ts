import { Controller, Delete, Get, Headers, Patch, Post, Put } from '@nestjs/common';
import {
  createTransferSchema,
  estateItemParamsSchema,
  estateParamSchema,
  idempotencyKeySchema,
  linkUserPayoutSchema,
  moneyTransferListQuerySchema,
  paymentMethodSchema,
  transferRecipientQuerySchema,
  transferRecipientSchema,
  transferSchema,
  transfersStatusSchema,
  updateUserPayoutSchema,
  userPayoutAccountSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  type AuthContext,
  Can,
  CurrentAuth,
  CurrentEstate,
  type EstateAccess,
  SignedIn,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { DomainError } from '../../common/errors/domain-error';
import { UserDirectory } from '../identity/user-directory.service';
import { TransfersService } from './transfers.service';
import { WalletStore } from './wallet-store.service';

const TAGS = ['payments'];
const idParams = z.object({ id: z.uuid() });

/** Safezone Pay (ADR-0025): saved cards, payout account and transfers between residents. */
@Controller('v1')
export class WalletController {
  constructor(
    private readonly wallet: WalletStore,
    private readonly transfers: TransfersService,
    private readonly users: UserDirectory,
  ) {}

  @Get('me/payment-methods')
  @SignedIn()
  @Contract({ summary: 'My saved cards', tags: TAGS, response: z.array(paymentMethodSchema) })
  methods(@CurrentAuth() auth: AuthContext) {
    return this.wallet.methods(auth.userId);
  }

  @Delete('me/payment-methods/:id')
  @SignedIn()
  @Contract({
    summary: 'Remove a saved card',
    tags: TAGS,
    params: idParams,
    response: z.array(paymentMethodSchema),
    errors: [404],
  })
  removeMethod(@CurrentAuth() auth: AuthContext, @ValidParams() params: z.infer<typeof idParams>) {
    return this.wallet.removeMethod(auth.userId, params.id);
  }

  @Get('me/payout-account')
  @SignedIn()
  @Contract({
    summary: 'Where I receive money from neighbours (null when not set up)',
    tags: TAGS,
    response: userPayoutAccountSchema.nullable(),
  })
  payout(@CurrentAuth() auth: AuthContext) {
    return this.wallet.payoutAccount(auth.userId);
  }

  @Put('me/payout-account')
  @SignedIn()
  @Contract({
    summary: 'Link the bank account I receive money into (held by the payment provider)',
    tags: TAGS,
    body: linkUserPayoutSchema,
    response: userPayoutAccountSchema,
    errors: [422, 502],
  })
  async linkPayout(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof linkUserPayoutSchema>,
  ) {
    const name =
      (await this.users.contactsOf([auth.userId])).get(auth.userId)?.fullName ??
      'Safezone resident';
    return this.wallet.linkPayout(auth.userId, name, body.bankCode, body.accountNumber);
  }

  @Patch('me/payout-account')
  @SignedIn()
  @Contract({
    summary: 'Turn receiving money from neighbours on or off',
    tags: TAGS,
    body: updateUserPayoutSchema,
    response: userPayoutAccountSchema,
    errors: [404],
  })
  setAccept(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof updateUserPayoutSchema>,
  ) {
    return this.wallet.setAcceptTransfers(auth.userId, body.acceptTransfers);
  }

  @Get('estates/:estateId/transfers/status')
  @Can('payment.make')
  @Contract({
    summary: 'Whether transfers between residents are available',
    tags: TAGS,
    params: estateParamSchema,
    response: transfersStatusSchema,
  })
  status() {
    return { enabled: this.transfers.enabled };
  }

  @Get('estates/:estateId/transfers/recipients')
  @Can('payment.make')
  @Contract({
    summary: 'People in a unit who accept transfers (first names only)',
    tags: TAGS,
    params: estateParamSchema,
    query: transferRecipientQuerySchema,
    response: z.array(transferRecipientSchema),
    errors: [503],
  })
  recipients(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof transferRecipientQuerySchema>,
  ) {
    return this.transfers.recipients(estate, query.unit);
  }

  @Post('estates/:estateId/transfers')
  @Can('payment.make')
  @Contract({
    summary:
      'Send money to a neighbour (Idempotency-Key required); it settles to their bank account',
    tags: TAGS,
    params: estateParamSchema,
    body: createTransferSchema,
    response: transferSchema,
    status: 201,
    errors: [402, 403, 404, 422, 502, 503],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createTransferSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = idempotencyKeySchema.safeParse(key);
    if (!parsed.success)
      throw new DomainError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send an Idempotency-Key header (a UUID)',
        400,
      );
    return this.transfers.create(estate, body, parsed.data);
  }

  @Get('estates/:estateId/transfers')
  @Can('payment.make')
  @Contract({
    summary: 'Money I sent and received',
    tags: TAGS,
    params: estateParamSchema,
    query: moneyTransferListQuerySchema,
    response: transferSchema,
    paginated: true,
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof moneyTransferListQuerySchema>,
  ) {
    return this.transfers.list(estate, query);
  }

  @Post('estates/:estateId/transfers/:id/verify')
  @Can('payment.make')
  @Contract({
    summary: 'Check a transfer payment with the provider after checkout',
    tags: TAGS,
    params: estateItemParamsSchema,
    response: transferSchema,
    status: 200,
    errors: [404],
  })
  verify(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.transfers.verify(estate, params.id);
  }
}
