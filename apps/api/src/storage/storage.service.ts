import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, HttpStatus, Inject, Injectable, Module } from '@nestjs/common';
import { MAX_PHOTO_BYTES } from '@digecom/shared';
import sharp from 'sharp';
import { AppException } from '../common/app-exception';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { createId } from '../stock/ids';

export const BUCKETS = { products: 'products', proofs: 'proofs', documents: 'documents' } as const;
type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

/**
 * Stockage S3 (MinIO en local). Deux clients : l'un parle à MinIO depuis le réseau Docker,
 * l'autre signe les URL avec l'adresse vue par le navigateur (S3_PUBLIC_ENDPOINT).
 */
@Injectable()
export class StorageService {
  private readonly internal: S3Client;
  private readonly publicSigner: S3Client;
  private readonly prefix: string;

  constructor(@Inject(ENV) env: Env) {
    this.prefix = env.S3_BUCKET_PREFIX ?? '';
    const credentials = {
      accessKeyId: env.S3_ACCESS_KEY ?? 'minio',
      secretAccessKey: env.S3_SECRET_KEY ?? 'minio-secret',
    };
    const base = { region: env.S3_REGION, forcePathStyle: true, credentials };
    this.internal = new S3Client({ ...base, endpoint: env.S3_ENDPOINT ?? 'http://localhost:9000' });
    this.publicSigner = new S3Client({
      ...base,
      endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT ?? 'http://localhost:9000',
    });
  }

  /** Nom réel du bucket (préfixe pour un S3 externe où les noms sont uniques). */
  private name(bucket: Bucket): string {
    return `${this.prefix}${bucket}`;
  }

  /** Disponibilité du stockage (GET /ready). */
  async ping(): Promise<boolean> {
    return this.internal
      .send(new HeadBucketCommand({ Bucket: this.name(BUCKETS.documents) }))
      .then(() => true)
      .catch(() => false);
  }

  /** URL pré-signée d'envoi direct (PUT) vers une clé temporaire. */
  async presignUpload(bucket: Bucket, prefix: string, contentType: string) {
    const key = `tmp/${prefix}/${createId()}`;
    const uploadUrl = await getSignedUrl(
      this.publicSigner,
      new PutObjectCommand({ Bucket: this.name(bucket), Key: key, ContentType: contentType }),
      { expiresIn: 300 },
    );
    return { key, uploadUrl, expiresIn: 300 };
  }

  /** URL pré-signée de lecture (1 h). */
  presignGet(bucket: Bucket, key: string): Promise<string> {
    return getSignedUrl(
      this.publicSigner,
      new GetObjectCommand({ Bucket: this.name(bucket), Key: key }),
      {
        expiresIn: 3600,
      },
    );
  }

  /**
   * Lit un envoi temporaire, le convertit en WebP (1600 px max, qualité 80), l'enregistre sous
   * `destPrefix/xxx.webp` et supprime l'original. Refuse les fichiers de plus de 5 Mo.
   */
  async finalizeImage(bucket: Bucket, tmpKey: string, destPrefix: string): Promise<string> {
    if (!tmpKey.startsWith('tmp/')) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Clé de fichier invalide',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    let size: number | undefined;
    try {
      const head = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.name(bucket), Key: tmpKey }),
      );
      size = head.ContentLength;
    } catch {
      throw new AppException('NOT_FOUND', 'Fichier envoyé introuvable', HttpStatus.NOT_FOUND);
    }
    if (!size || size > MAX_PHOTO_BYTES) {
      await this.delete(bucket, tmpKey);
      throw new AppException(
        'VALIDATION_ERROR',
        'Photo trop lourde (5 Mo maximum)',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const obj = await this.internal.send(
      new GetObjectCommand({ Bucket: this.name(bucket), Key: tmpKey }),
    );
    const input = Buffer.from(await obj.Body!.transformToByteArray());
    let output: Buffer;
    try {
      output = await sharp(input)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      await this.delete(bucket, tmpKey);
      throw new AppException(
        'VALIDATION_ERROR',
        'Image illisible (JPEG, PNG ou WebP attendu)',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const key = `${destPrefix}/${createId()}.webp`;
    await this.internal.send(
      new PutObjectCommand({
        Bucket: this.name(bucket),
        Key: key,
        Body: output,
        ContentType: 'image/webp',
      }),
    );
    await this.delete(bucket, tmpKey);
    return key;
  }

  /** Envoi direct depuis l'API (seed, tests). */
  async put(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.internal.send(
      new PutObjectCommand({
        Bucket: this.name(bucket),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    await this.internal
      .send(new DeleteObjectCommand({ Bucket: this.name(bucket), Key: key }))
      .catch(() => undefined);
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
