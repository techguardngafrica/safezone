import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  downloadUrlSchema,
  estateFileParamsSchema,
  estateParamSchema,
  estateUploadRequestSchema,
  fileStatusSchema,
  idParamSchema,
  personalUploadRequestSchema,
  uploadTicketSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import {
  type AuthContext,
  CurrentAuth,
  CurrentEstate,
  type EstateAccess,
  Member,
  SignedIn,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams } from '../../common/contract/contract';
import { FilesService, type FileOwner } from './files.service';

const estateOwner = (estate: EstateAccess): FileOwner => ({
  kind: 'estate',
  estateId: estate.estateId,
  userId: estate.userId,
  permissions: estate.permissions,
});

/** Estate files: pass photos, maintenance and incident media, documents, imports. */
@Controller('v1/estates/:estateId/files')
export class EstateFilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload-url')
  @Member()
  @HttpCode(200)
  @Contract({
    summary: 'Get a signed upload URL for an estate file',
    tags: ['files'],
    params: estateParamSchema,
    body: estateUploadRequestSchema,
    response: uploadTicketSchema,
    errors: [403, 422],
  })
  createUpload(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof estateUploadRequestSchema>,
  ) {
    return this.files.createUpload(estateOwner(estate), body);
  }

  @Post(':id/complete')
  @Member()
  @HttpCode(200)
  @Contract({
    summary: 'Confirm the upload and start the scan',
    tags: ['files'],
    params: estateFileParamsSchema,
    response: fileStatusSchema,
    errors: [404, 409, 422],
  })
  complete(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateFileParamsSchema>,
  ) {
    return this.files.completeUpload(estateOwner(estate), params.id);
  }

  @Get(':id')
  @Member()
  @Contract({
    summary: 'File status',
    tags: ['files'],
    params: estateFileParamsSchema,
    response: fileStatusSchema,
    errors: [404],
  })
  status(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateFileParamsSchema>,
  ) {
    return this.files.status(estateOwner(estate), params.id);
  }

  @Get(':id/download-url')
  @Member()
  @Contract({
    summary: 'Signed download URL (5 minutes)',
    tags: ['files'],
    params: estateFileParamsSchema,
    response: downloadUrlSchema,
    errors: [403, 404, 409],
  })
  download(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateFileParamsSchema>,
  ) {
    return this.files.downloadUrl(estateOwner(estate), params.id);
  }
}

/** Personal files: avatar and estate application documents. */
@Controller('v1/me/files')
export class MyFilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload-url')
  @SignedIn()
  @HttpCode(200)
  @Contract({
    summary: 'Get a signed upload URL for a personal file',
    tags: ['files'],
    body: personalUploadRequestSchema,
    response: uploadTicketSchema,
    errors: [422],
  })
  createUpload(
    @CurrentAuth() auth: AuthContext,
    @ValidBody() body: z.infer<typeof personalUploadRequestSchema>,
  ) {
    return this.files.createUpload({ kind: 'user', userId: auth.userId }, body);
  }

  @Post(':id/complete')
  @SignedIn()
  @HttpCode(200)
  @Contract({
    summary: 'Confirm the upload and start the scan',
    tags: ['files'],
    params: idParamSchema,
    response: fileStatusSchema,
    errors: [404, 409, 422],
  })
  complete(@CurrentAuth() auth: AuthContext, @ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.files.completeUpload({ kind: 'user', userId: auth.userId }, params.id);
  }

  @Get(':id')
  @SignedIn()
  @Contract({
    summary: 'File status',
    tags: ['files'],
    params: idParamSchema,
    response: fileStatusSchema,
    errors: [404],
  })
  status(@CurrentAuth() auth: AuthContext, @ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.files.status({ kind: 'user', userId: auth.userId }, params.id);
  }

  @Get(':id/download-url')
  @SignedIn()
  @Contract({
    summary: 'Signed download URL (5 minutes)',
    tags: ['files'],
    params: idParamSchema,
    response: downloadUrlSchema,
    errors: [404, 409],
  })
  download(@CurrentAuth() auth: AuthContext, @ValidParams() params: z.infer<typeof idParamSchema>) {
    return this.files.downloadUrl({ kind: 'user', userId: auth.userId }, params.id);
  }
}
