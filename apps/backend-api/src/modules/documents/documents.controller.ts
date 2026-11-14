import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  addVersionSchema,
  createDocumentSchema,
  createFolderSchema,
  documentAccessSchema,
  documentListQuerySchema,
  documentSchema,
  estateItemParamsSchema,
  estateParamSchema,
  exportDownloadSchema,
  folderSchema,
  updateDocumentSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { DocumentsService } from './documents.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;
const versionQuerySchema = z.object({ version: z.coerce.number().int().min(1).optional() });

/** Estate documents (documents.md §6). */
@Controller('v1/estates/:estateId')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('document-folders')
  @Member()
  @RequiresFeature('documents')
  @Contract({
    summary: 'Document folders',
    tags: ['documents'],
    params: estateParamSchema,
    response: z.array(folderSchema),
  })
  folders(@CurrentEstate() estate: EstateAccess) {
    return this.documents.folders(estate);
  }

  @Post('document-folders')
  @Can('document.manage')
  @RequiresFeature('documents')
  @Contract({
    summary: 'Create a folder',
    tags: ['documents'],
    params: estateParamSchema,
    body: createFolderSchema,
    response: folderSchema,
    status: 201,
    errors: [403, 404, 409],
  })
  createFolder(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createFolderSchema>,
  ) {
    return this.documents.createFolder(estate, body);
  }

  @Get('documents')
  @Member()
  @RequiresFeature('documents')
  @Contract({
    summary: 'Documents I may see',
    tags: ['documents'],
    params: estateParamSchema,
    query: documentListQuerySchema,
    response: z.array(documentSchema),
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof documentListQuerySchema>,
  ) {
    return this.documents.list(estate, query);
  }

  @Post('documents')
  @Can('document.manage')
  @RequiresFeature('documents')
  @Contract({
    summary: 'Publish a document with its visibility',
    tags: ['documents'],
    params: estateParamSchema,
    body: createDocumentSchema,
    response: documentSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createDocumentSchema>,
  ) {
    return this.documents.create(estate, body);
  }

  @Get('documents/:id')
  @Member()
  @RequiresFeature('documents')
  @Contract({
    summary: 'Document detail (logged)',
    tags: ['documents'],
    params: estateItemParamsSchema,
    response: documentSchema,
    errors: [404],
  })
  get(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.documents.get(estate, params.id);
  }

  @Patch('documents/:id')
  @Can('document.manage')
  @RequiresFeature('documents')
  @Contract({
    summary: 'Change title, category, folder, visibility or expiry',
    tags: ['documents'],
    params: estateItemParamsSchema,
    body: updateDocumentSchema,
    response: documentSchema,
    errors: [403, 404],
  })
  update(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof updateDocumentSchema>,
  ) {
    return this.documents.update(estate, params.id, body);
  }

  @Post('documents/:id/versions')
  @Can('document.manage')
  @RequiresFeature('documents')
  @Contract({
    summary: 'Upload a new version',
    tags: ['documents'],
    params: estateItemParamsSchema,
    body: addVersionSchema,
    response: documentSchema,
    status: 201,
    errors: [403, 404, 409, 422],
  })
  addVersion(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof addVersionSchema>,
  ) {
    return this.documents.addVersion(estate, params.id, body);
  }

  @Post('documents/:id/archive')
  @Can('document.manage')
  @RequiresFeature('documents')
  @HttpCode(200)
  @Contract({
    summary: 'Archive a document (versions are kept)',
    tags: ['documents'],
    params: estateItemParamsSchema,
    response: documentSchema,
    errors: [403, 404],
  })
  archive(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.documents.archive(estate, params.id);
  }

  @Post('documents/:id/download')
  @Member()
  @RequiresFeature('documents')
  @HttpCode(200)
  @Contract({
    summary: 'A 5-minute download link (logged)',
    tags: ['documents'],
    params: estateItemParamsSchema,
    query: versionQuerySchema,
    response: exportDownloadSchema,
    errors: [404, 409],
  })
  download(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidQuery() query: z.infer<typeof versionQuerySchema>,
  ) {
    return this.documents.download(estate, params.id, query.version);
  }

  @Get('documents/:id/access-log')
  @Can('document.manage')
  @RequiresFeature('documents')
  @Contract({
    summary: 'Who viewed or downloaded a document',
    tags: ['documents'],
    params: estateItemParamsSchema,
    response: z.array(documentAccessSchema),
    errors: [403, 404],
  })
  accessLog(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.documents.accessLog(estate, params.id);
  }
}
