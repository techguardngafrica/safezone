import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type ObjectHead, ObjectStorage } from './object-storage';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

/** S3 / MinIO adapter. Objects are private; access is only through short-lived signed URLs. */
export class S3ObjectStorage extends ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    super();
    this.client = new S3Client({
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.accessKeyId && options.secretAccessKey
        ? {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }
        : {}),
    });
  }

  presignPut(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresSeconds: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    // Content-Type and Content-Length are signed, so the upload must match what was declared.
    return getSignedUrl(this.client, command, {
      expiresIn: expiresSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
  }

  presignGet(key: string, expiresSeconds: number, downloadName?: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      ...(downloadName
        ? {
            ResponseContentDisposition: `attachment; filename="${downloadName.replace(/[^\w.-]/g, '_')}"`,
          }
        : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresSeconds });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound')
        return null;
      throw error;
    }
  }

  async read(key: string, maxBytes: number): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
    if ((result.ContentLength ?? 0) > maxBytes) throw new Error('Object too large');
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error('Empty object body');
    if (bytes.length > maxBytes) throw new Error('Object too large');
    return Buffer.from(bytes);
  }

  async write(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}
